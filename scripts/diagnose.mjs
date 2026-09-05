import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validStatuses = new Set(["pass", "warning", "error"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseVersion(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value ?? "").trim());
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : undefined;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function satisfiesRange(version, range) {
  const installed = parseVersion(version);
  const minimum = parseVersion(String(range).replace(/^[~^]|^>=\s*/, ""));
  if (!installed || !minimum) return undefined;
  if (compareVersions(version, minimum.join(".")) < 0) return false;
  if (String(range).startsWith("^")) {
    if (minimum[0] > 0) return installed[0] === minimum[0];
    if (minimum[1] > 0) return installed[0] === 0 && installed[1] === minimum[1];
    return installed[0] === 0 && installed[1] === 0 && installed[2] === minimum[2];
  }
  if (String(range).startsWith("~")) return installed[0] === minimum[0] && installed[1] === minimum[1];
  if (String(range).startsWith(">=")) return true;
  return compareVersions(version, minimum.join(".")) === 0;
}

function baseVersion(value) {
  return String(value ?? "").split("+", 1)[0];
}

function toDisplayPath(root, path) {
  const value = relative(root, path);
  return value && !value.startsWith("..") ? value : path;
}

export function javaRegistryValidationError(value, expectedVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "registry root is not an object";
  if (value.schemaVersion !== 1 || value.edition !== "java" || value.version !== expectedVersion) return "schema, edition, or version mismatch";
  if (!["release", "snapshot", "old_beta", "old_alpha"].includes(value.type)) return "invalid release type";
  if (typeof value.releaseTime !== "string" || Number.isNaN(Date.parse(value.releaseTime)) || typeof value.syncedAt !== "string" || Number.isNaN(Date.parse(value.syncedAt))) return "invalid release or synchronization timestamp";
  if (value.source !== "Mojang Java client JAR blockstate assets" || typeof value.sourceUrl !== "string" || !value.sourceUrl.startsWith("https://") || typeof value.manifestUrl !== "string" || !value.manifestUrl.startsWith("https://")) return "invalid registry provenance";
  if (!value.client || typeof value.client !== "object" || !/^[a-f0-9]{40}$/i.test(value.client.sha1 ?? "") || !Number.isInteger(value.client.size) || value.client.size <= 0) return "invalid client checksum metadata";
  if (!Number.isInteger(value.worldVersion) || value.worldVersion < 0 || !Number.isInteger(value.protocolVersion) || value.protocolVersion < 0) return "invalid world or protocol version";
  for (const version of [value.resourcePackVersion, value.dataPackVersion]) {
    if (!version || typeof version !== "object" || !Number.isInteger(version.major) || version.major < 0 || !Number.isInteger(version.minor) || version.minor < 0) return "invalid pack version";
  }
  if (!Number.isInteger(value.blockCount) || value.blockCount <= 0 || !Array.isArray(value.blocks) || value.blockCount !== value.blocks.length) return "invalid block count";
  const ids = new Set();
  for (const block of value.blocks) {
    if (!block || typeof block !== "object" || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(block.id ?? "") || typeof block.displayName !== "string" || !block.displayName.trim() || !/^assets\/minecraft\/blockstates\/[a-z0-9_./-]+\.json$/.test(block.blockstatePath ?? "") || ids.has(block.id)) return "invalid or duplicate block record";
    ids.add(block.id);
  }
  return undefined;
}

export function runDiagnostics(root = scriptRoot, options = {}) {
  const resolvedRoot = resolve(root);
  const sourceMode = existsSync(resolve(resolvedRoot, "src", "server.ts"));
  const mode = sourceMode ? "source" : "plugin";
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const spawnProcess = options.spawnSync ?? spawnSync;
  const checks = [];
  const add = (id, area, status, message, details) => {
    if (!validStatuses.has(status)) throw new Error(`Invalid diagnostic status: ${status}`);
    checks.push({ id, area, status, message, ...(details === undefined ? {} : { details }) });
  };

  const paths = {
    sourcePackage: resolve(resolvedRoot, "package.json"),
    runtimePackage: resolve(resolvedRoot, "app", "package.json"),
    pluginManifest: resolve(resolvedRoot, ".codex-plugin", "plugin.json"),
    mcpConfig: resolve(resolvedRoot, ".mcp.json"),
    runtimeLockfile: resolve(resolvedRoot, "app", "package-lock.json"),
    runtimeDist: resolve(resolvedRoot, "app", "dist"),
    runtimeRegistry: resolve(resolvedRoot, "app", "data", "java"),
    runtimeNodeModules: resolve(resolvedRoot, "app", "node_modules"),
    sourceLockfile: resolve(resolvedRoot, "package-lock.json"),
    sourceDist: resolve(resolvedRoot, "dist"),
    sourceRegistry: resolve(resolvedRoot, "data", "java"),
    sourceNodeModules: resolve(resolvedRoot, "node_modules"),
    privateNode: resolve(resolvedRoot, "runtime", "node", "node.exe"),
    privateNpm: resolve(resolvedRoot, "runtime", "node", "npm.cmd"),
    privateNpmCli: resolve(resolvedRoot, "runtime", "node", "node_modules", "npm", "bin", "npm-cli.js"),
  };

  let sourcePackage;
  let runtimePackage;
  let pluginManifest;
  let mcpConfig;
  for (const [id, path] of [
    ["source_manifest", paths.sourcePackage],
    ["runtime_manifest", paths.runtimePackage],
    ["plugin_manifest", paths.pluginManifest],
    ["mcp_config", paths.mcpConfig],
  ]) {
    if (!existsSync(path)) {
      add(id, "manifest", id === "source_manifest" && !sourceMode ? "pass" : "error", id === "source_manifest" && !sourceMode ? "Standalone source manifest is not required in a packaged plugin." : `Missing ${toDisplayPath(resolvedRoot, path)}.`);
      continue;
    }
    try {
      const parsed = readJson(path);
      if (id === "source_manifest") sourcePackage = parsed;
      if (id === "runtime_manifest") runtimePackage = parsed;
      if (id === "plugin_manifest") pluginManifest = parsed;
      if (id === "mcp_config") mcpConfig = parsed;
      add(id, "manifest", "pass", `${toDisplayPath(resolvedRoot, path)} is valid JSON.`);
    } catch (error) {
      add(id, "manifest", "error", `${toDisplayPath(resolvedRoot, path)} is not valid JSON.`, error instanceof Error ? error.message : String(error));
    }
  }

  const versions = [
    sourcePackage?.version && { file: "package.json", version: baseVersion(sourcePackage.version) },
    runtimePackage?.version && { file: "app/package.json", version: baseVersion(runtimePackage.version) },
    pluginManifest?.version && { file: ".codex-plugin/plugin.json", version: baseVersion(pluginManifest.version) },
  ].filter(Boolean);
  const uniqueVersions = [...new Set(versions.map(({ version }) => version))];
  add(
    "version_alignment",
    "manifest",
    uniqueVersions.length <= 1 ? "pass" : "error",
    uniqueVersions.length <= 1 ? `Package manifests agree on ${uniqueVersions[0] ?? "an unspecified version"}.` : "Package manifest versions do not agree.",
    versions,
  );

  if (pluginManifest) {
    try {
      const rawReferences = [
        [pluginManifest.skills, "skills"],
        [pluginManifest.mcpServers, "MCP configuration"],
        [pluginManifest.interface?.composerIcon, "composer icon"],
        [pluginManifest.interface?.logo, "logo"],
        [pluginManifest.interface?.logoDark, "dark logo"],
        ...(Array.isArray(pluginManifest.interface?.screenshots) ? pluginManifest.interface.screenshots.map((value, index) => [value, `screenshot ${index + 1}`]) : []),
      ].filter(([value]) => value !== undefined);
      if (pluginManifest.interface?.screenshots !== undefined && !Array.isArray(pluginManifest.interface.screenshots)) throw new Error("interface.screenshots must be an array");
      const references = [...new Map(rawReferences.map(([value, label]) => [value, label])).entries()].map(([value, label]) => {
        if (typeof value !== "string" || !value.startsWith("./")) throw new Error(`${label} reference must begin with ./`);
        const path = resolve(resolvedRoot, value);
        const relativePath = relative(resolvedRoot, path);
        if (!relativePath || /^\.\.(?:[\\/]|$)/.test(relativePath) || isAbsolute(relativePath)) throw new Error(`${label} reference escapes the package root`);
        return { label, reference: value, path };
      });
      const missing = references.filter(({ path }) => !existsSync(path)).map(({ label, reference }) => ({ label, reference }));
      add(
        "plugin_payload",
        "manifest",
        missing.length ? "error" : "pass",
        missing.length ? `${missing.length} plugin-manifest payload reference(s) are missing.` : `${references.length} plugin-manifest payload reference(s) are present inside the package root.`,
        { references: references.map(({ label, reference }) => ({ label, reference })), missing },
      );
    } catch (error) {
      add("plugin_payload", "manifest", "error", "Plugin-manifest payload references are invalid.", error instanceof Error ? error.message : String(error));
    }
  } else {
    add("plugin_payload", "manifest", "error", "Plugin-manifest payload references cannot be validated without a valid plugin manifest.");
  }

  const minimumNode = /(?:^|\s)>=\s*(\d+(?:\.\d+){0,2})/.exec(String((runtimePackage ?? sourcePackage)?.engines?.node ?? ""))?.[1];
  const nodeComparison = minimumNode ? compareVersions(process.versions.node, minimumNode) : undefined;
  add(
    "node_version",
    "dependency",
    minimumNode && nodeComparison !== undefined && nodeComparison < 0 ? "error" : minimumNode ? "pass" : "warning",
    minimumNode ? `Node ${process.versions.node} ${nodeComparison !== undefined && nodeComparison < 0 ? "does not meet" : "meets"} the ${minimumNode}+ requirement.` : "No minimum Node version could be read from the package manifest.",
    { installed: process.versions.node, required: minimumNode },
  );

  const privateRuntimeFiles = [paths.privateNode, paths.privateNpm, paths.privateNpmCli];
  const missingPrivateRuntimeFiles = sourceMode ? [] : privateRuntimeFiles.filter((path) => !existsSync(path));
  let npmCommand;
  let npmArgs;
  let npmDisplayCommand;
  if (sourceMode) {
    npmCommand = platform === "win32" ? environment.ComSpec || "cmd.exe" : "npm";
    npmArgs = platform === "win32" ? ["/d", "/s", "/c", "npm --version"] : ["--version"];
    npmDisplayCommand = platform === "win32" ? "npm via ComSpec" : npmCommand;
  } else {
    npmCommand = paths.privateNode;
    npmArgs = [paths.privateNpmCli, "--version"];
    npmDisplayCommand = `${toDisplayPath(resolvedRoot, paths.privateNode)} ${toDisplayPath(resolvedRoot, paths.privateNpmCli)}`;
  }
  const npmResult = missingPrivateRuntimeFiles.length
    ? { status: null, stdout: "", stderr: "", error: new Error(`Missing ${missingPrivateRuntimeFiles.map((path) => toDisplayPath(resolvedRoot, path)).join(", ")}`) }
    : spawnProcess(npmCommand, npmArgs, { encoding: "utf8", windowsHide: true, timeout: 5_000, env: environment });
  const npmVersion = npmResult.status === 0 ? String(npmResult.stdout ?? "").trim() : undefined;
  add(
    "npm_version",
    "dependency",
    npmVersion ? "pass" : "error",
    npmVersion
      ? `npm ${npmVersion} is available from ${sourceMode ? "the source-development environment" : "the packaged private runtime"}.`
      : sourceMode
        ? "npm is unavailable; the source workspace cannot install or repair dependencies."
        : "The packaged private Node/npm runtime is unavailable; Blockwright will not fall back to machine-wide npm.",
    npmVersion
      ? { command: npmDisplayCommand, launcher: npmCommand, version: npmVersion }
      : { command: npmDisplayCommand, launcher: npmCommand, missing: missingPrivateRuntimeFiles.map((path) => toDisplayPath(resolvedRoot, path)), error: npmResult.error?.message || String(npmResult.stderr ?? "").trim() || `exit ${npmResult.status ?? "unknown"}` },
  );

  const configured = mcpConfig?.mcpServers?.blockwright;
  const configuredBridge = resolve(resolvedRoot, "mcp", "server.mjs");
  const configuredWrapper = resolve(resolvedRoot, "scripts", "windows", "Launch-Blockwright-Mcp.cmd");
  let bridgeExists = false;
  try {
    bridgeExists = statSync(configuredBridge).isFile();
  } catch {
    bridgeExists = false;
  }
  let wrapperExists = false;
  let wrapperUsesPrivateRuntime = false;
  try {
    wrapperExists = statSync(configuredWrapper).isFile();
    if (wrapperExists) {
      const wrapper = readFileSync(configuredWrapper, "utf8");
      wrapperUsesPrivateRuntime = /runtime\\node\\node\.exe/i.test(wrapper) && /mcp\\server\.mjs/i.test(wrapper);
    }
  } catch {
    wrapperExists = false;
  }
  const configuredArgs = Array.isArray(configured?.args) ? configured.args : [];
  const sourceConfigValid = configured?.cwd === "."
    && configured?.command === "node"
    && configuredArgs.length === 1
    && configuredArgs[0] === "./mcp/server.mjs";
  const packagedConfigValid = configured?.cwd === "."
    && String(configured?.command ?? "").toLowerCase() === "cmd.exe"
    && configuredArgs.length === 4
    && configuredArgs[0]?.toLowerCase() === "/d"
    && configuredArgs[1]?.toLowerCase() === "/s"
    && configuredArgs[2]?.toLowerCase() === "/c"
    && configuredArgs[3]?.replaceAll("/", "\\").toLowerCase() === ".\\scripts\\windows\\launch-blockwright-mcp.cmd";
  const mcpConfigValid = sourceMode ? sourceConfigValid : packagedConfigValid;
  const mcpValid = mcpConfigValid && bridgeExists && (sourceMode || (wrapperExists && wrapperUsesPrivateRuntime));
  const invalidMessage = !mcpConfigValid
    ? sourceMode
      ? "Source MCP config must launch node ./mcp/server.mjs from the project root."
      : "Packaged MCP config must launch the private-runtime wrapper through cmd.exe from the package root."
    : !bridgeExists
      ? `Configured MCP bridge is missing or is not a file: ${toDisplayPath(resolvedRoot, configuredBridge)}.`
      : !sourceMode && !wrapperExists
        ? `Configured packaged MCP wrapper is missing or is not a file: ${toDisplayPath(resolvedRoot, configuredWrapper)}.`
        : "The packaged MCP wrapper does not launch runtime\\node\\node.exe and mcp\\server.mjs.";
  add(
    "mcp_launch",
    "manifest",
    mcpValid ? "pass" : "error",
    mcpValid ? sourceMode ? "Source MCP config launches the present stdio bridge with Node.js." : "Packaged MCP config launches the present stdio bridge through the private-runtime wrapper." : invalidMessage,
    {
      mode: sourceMode ? "source-node-bridge" : "packaged-private-runtime-wrapper",
      configured,
      bridge: toDisplayPath(resolvedRoot, configuredBridge),
      bridgeExists,
      ...(sourceMode ? {} : { wrapper: toDisplayPath(resolvedRoot, configuredWrapper), wrapperExists, wrapperUsesPrivateRuntime }),
    },
  );

  const checkLockfile = (id, path, expectedVersion, label) => {
    if (!existsSync(path)) {
      add(id, "dependency", "error", `Missing ${toDisplayPath(resolvedRoot, path)}; ${label} cannot use a reproducible npm ci install.`);
      return;
    }
    try {
      const lock = readJson(path);
      const expected = baseVersion(expectedVersion);
      const locked = baseVersion(lock.packages?.[""]?.version ?? lock.version);
      add(id, "dependency", expected && locked !== expected ? "error" : "pass", expected && locked !== expected ? `${label} lockfile version ${locked || "unknown"} does not match ${expected}.` : `${label} lockfile is valid and aligned to ${locked || "the package manifest"}.`, { path: toDisplayPath(resolvedRoot, path), lockfileVersion: lock.lockfileVersion, packageVersion: locked });
    } catch (error) {
      add(id, "dependency", "error", `${label} lockfile is not valid JSON.`, error instanceof Error ? error.message : String(error));
    }
  };

  const checkDependencies = (id, manifest, nodeModules, label) => {
    const expectedDependencies = manifest?.dependencies ?? {};
    const installed = [];
    const missing = [];
    const mismatched = [];
    for (const [name, range] of Object.entries(expectedDependencies)) {
      const packagePath = resolve(nodeModules, ...name.split("/"), "package.json");
      if (!existsSync(packagePath)) {
        missing.push({ name, expected: range });
        continue;
      }
      try {
        const version = readJson(packagePath).version;
        const satisfies = satisfiesRange(version, range);
        installed.push({ name, expected: range, version });
        if (satisfies === false) mismatched.push({ name, expected: range, version });
      } catch (error) {
        mismatched.push({ name, expected: range, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const status = mismatched.length ? "error" : missing.length ? "warning" : "pass";
    add(id, "dependency", status, mismatched.length ? `${mismatched.length} direct ${label} dependency version(s) are incompatible.` : missing.length ? `${missing.length} direct ${label} dependency package(s) are not installed yet.` : `${installed.length} direct ${label} dependency version(s) satisfy the manifest.`, { root: toDisplayPath(resolvedRoot, nodeModules), installed, missing, mismatched });
  };

  const checkBuild = (serverId, assetsId, dist, label) => {
    const serverPath = resolve(dist, "server.js");
    const entryPath = resolve(dist, "__entry.js");
    const viteManifestPath = resolve(dist, "assets", ".vite", "manifest.json");
    const bundlesPresent = existsSync(serverPath) && existsSync(entryPath);
    add(serverId, "build", bundlesPresent ? "pass" : "error", bundlesPresent ? `Found ${label} server and direct entry bundles in ${toDisplayPath(resolvedRoot, dist)}.` : `Missing ${label} bundle(s): ${[serverPath, entryPath].filter((path) => !existsSync(path)).map((path) => toDisplayPath(resolvedRoot, path)).join(", ")}.`);
    if (!existsSync(viteManifestPath)) {
      add(assetsId, "build", "error", `Missing ${toDisplayPath(resolvedRoot, viteManifestPath)}.`);
      return;
    }
    try {
      const viteManifest = readJson(viteManifestPath);
      const assetRoot = resolve(dist, "assets");
      const referenced = [...new Set(Object.values(viteManifest).flatMap((entry) => [entry?.file, ...(entry?.css ?? []), ...(entry?.assets ?? [])]).filter((file) => typeof file === "string" && file.length))];
      const invalidAssets = referenced.filter((file) => {
        const target = resolve(assetRoot, file);
        const value = relative(assetRoot, target);
        return !value || value.startsWith("..") || isAbsolute(value);
      });
      const missingAssets = referenced.filter((file) => !invalidAssets.includes(file) && !existsSync(resolve(assetRoot, file)));
      const failedAssets = [...invalidAssets, ...missingAssets];
      add(assetsId, "build", failedAssets.length || !referenced.length ? "error" : "pass", invalidAssets.length ? `${invalidAssets.length} ${label} Vite-manifest asset path(s) escape the packaged asset root.` : missingAssets.length ? `${missingAssets.length} ${label} Vite-manifest asset(s) are missing.` : `${referenced.length} ${label} Vite-manifest asset(s) are present.`, { manifest: toDisplayPath(resolvedRoot, viteManifestPath), invalid: invalidAssets, missing: missingAssets });
    } catch (error) {
      add(assetsId, "build", "error", `${label} Vite manifest is invalid.`, error instanceof Error ? error.message : String(error));
    }
  };

  const checkRegistries = (id, registry, label) => {
    if (!existsSync(registry)) {
      add(id, "data", "error", `Missing ${label} Java registry directory ${toDisplayPath(resolvedRoot, registry)}.`);
      return;
    }
    const registryFiles = readdirSync(registry).filter((name) => name.endsWith(".registry.json"));
    const valid = [];
    const invalid = [];
    for (const name of registryFiles) {
      try {
        const value = readJson(resolve(registry, name));
        const validationError = javaRegistryValidationError(value, name.slice(0, -".registry.json".length));
        if (validationError) {
          invalid.push({ name, reason: validationError });
        } else {
          valid.push({ name, version: value.version, blockCount: value.blockCount, clientSha1: value.client?.sha1 });
        }
      } catch (error) {
        invalid.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    add(id, "data", invalid.length || !valid.length ? "error" : "pass", invalid.length ? `${invalid.length} ${label} Java registry file(s) failed validation.` : valid.length ? `${valid.length} ${label} Java registry file(s) passed structural validation.` : `No ${label} Java registry files were found.`, { root: toDisplayPath(resolvedRoot, registry), valid, invalid });
  };

  checkLockfile("lockfile", paths.runtimeLockfile, runtimePackage?.version, "Managed runtime");
  checkDependencies("runtime_dependencies", runtimePackage, paths.runtimeNodeModules, "managed runtime");
  checkBuild("server_bundle", "view_assets", paths.runtimeDist, "managed runtime");
  checkRegistries("java_registries", paths.runtimeRegistry, "managed runtime");

  if (sourceMode) {
    checkLockfile("source_lockfile", paths.sourceLockfile, sourcePackage?.version, "Source workspace");
    checkDependencies("source_dependencies", sourcePackage, paths.sourceNodeModules, "source");
    checkBuild("source_server_bundle", "source_view_assets", paths.sourceDist, "source");
    checkRegistries("source_java_registries", paths.sourceRegistry, "source");
    const sourceServer = resolve(paths.sourceDist, "server.js");
    const packagedServer = resolve(paths.runtimeDist, "server.js");
    if (existsSync(sourceServer) && existsSync(packagedServer)) {
      const sourceDigest = digest(sourceServer);
      const packagedDigest = digest(packagedServer);
      add("packaged_build_sync", "build", sourceDigest === packagedDigest ? "pass" : "warning", sourceDigest === packagedDigest ? "Packaged server bundle matches the latest production build." : "Packaged server bundle is stale; run npm run package:plugin after the production build.", { productionSha256: sourceDigest, packagedSha256: packagedDigest });
    }
  }

  if (sourceMode) {
    const reusableSkillRoot = resolve(resolvedRoot, "skill");
    const packagedSkillRoot = resolve(resolvedRoot, "skills", "blockwright");
    const reusableSkill = resolve(reusableSkillRoot, "SKILL.md");
    const packagedSkill = resolve(packagedSkillRoot, "SKILL.md");
    if (existsSync(reusableSkill) && existsSync(packagedSkill)) {
      const reusableReferences = resolve(reusableSkillRoot, "references");
      const packagedReferences = resolve(packagedSkillRoot, "references");
      const referenceNames = [...new Set([
        ...(existsSync(reusableReferences) ? readdirSync(reusableReferences) : []).filter((name) => name.endsWith(".md")),
        ...(existsSync(packagedReferences) ? readdirSync(packagedReferences) : []).filter((name) => name.endsWith(".md")),
      ])];
      const pairs = [
        ["SKILL.md", reusableSkill, packagedSkill],
        ...referenceNames.map((name) => [`references/${name}`, resolve(reusableSkillRoot, "references", name), resolve(packagedSkillRoot, "references", name)]),
      ];
      const differences = pairs.filter(([, left, right]) => !existsSync(left) || !existsSync(right) || digest(left) !== digest(right)).map(([name]) => name);
      add("skill_sync", "documentation", differences.length ? "warning" : "pass", differences.length ? `${differences.length} reusable and packaged skill file(s) differ; synchronize intentional usage changes before packaging.` : `${pairs.length} reusable and packaged Blockwright skill file(s) match.`, { differences });
    } else {
      add("skill_sync", "documentation", "warning", "One of the reusable or packaged Blockwright skill entrypoints is missing.");
    }
  }

  const controllerFiles = [
    resolve(resolvedRoot, "scripts", "windows", "Blockwright-ControlCenter.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Blockwright-Paths.psm1"),
    resolve(resolvedRoot, "scripts", "windows", "Initialize-Blockwright.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Install-BlockwrightShortcut.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Invoke-BlockwrightRuntimeRepair.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Launch-Blockwright-Mcp.cmd"),
    resolve(resolvedRoot, "scripts", "windows", "Launch-Blockwright-ControlCenter.cmd"),
    resolve(resolvedRoot, "scripts", "windows", "Launch-Blockwright-ControlCenter.vbs"),
    resolve(resolvedRoot, "scripts", "windows", "New-BlockwrightSupportBundle.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Register-BlockwrightCodex.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Remove-BlockwrightOwnedState.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Set-BlockwrightSchematicAssociation.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Start-Blockwright-Portable.cmd"),
    resolve(resolvedRoot, "scripts", "windows", "Test-ControlCenter.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Test-PortableLifecycle.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Test-WindowsDistribution.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "Update-Blockwright.ps1"),
    resolve(resolvedRoot, "scripts", "windows", "README.md"),
  ];
  const missingController = controllerFiles.filter((path) => !existsSync(path));
  add("windows_control_center", "operator", missingController.length ? "warning" : "pass", missingController.length ? `${missingController.length} Windows control-center file(s) are not present in this package.` : "Windows control center, shared repair helper, launchers, shortcut installer, self-test, and operator notes are present.", { missing: missingController.map((path) => toDisplayPath(resolvedRoot, path)) });

  const errors = checks.filter(({ status }) => status === "error").length;
  const warnings = checks.filter(({ status }) => status === "warning").length;
  const passed = checks.filter(({ status }) => status === "pass").length;
  return {
    summary: {
      status: errors ? "unhealthy" : warnings ? "degraded" : "healthy",
      errors,
      warnings,
      passed,
      mode,
      root: resolvedRoot,
      checkedAt: new Date().toISOString(),
    },
    checks,
  };
}

function formatReport(report) {
  const icon = { pass: "PASS", warning: "WARN", error: "FAIL" };
  const lines = [
    `Blockwright diagnostics: ${report.summary.status.toUpperCase()} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`,
    `Mode: ${report.summary.mode} | Root: ${report.summary.root}`,
    "",
    ...report.checks.map((check) => `[${icon[check.status]}] ${check.area}/${check.id}: ${check.message}`),
  ];
  return lines.join("\n");
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
const isMain = process.platform === "win32" ? invokedPath.toLowerCase() === modulePath.toLowerCase() : invokedPath === modulePath;
if (isMain) {
  const report = runDiagnostics(argumentValue("--root") ?? scriptRoot);
  process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(report)}\n` : `${formatReport(report)}\n`);
  if (report.summary.errors) process.exitCode = 1;
}
