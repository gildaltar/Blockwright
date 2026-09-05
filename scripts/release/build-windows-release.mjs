import { createHash } from "node:crypto";
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  assertChildPath,
  assertPluginManifestReferences,
  clearReleaseCandidateOutputs,
  copyPluginManifestPayload,
  createSboms,
  inventoryFromInstalledTree,
  normalizeThumbprint,
  readJson,
  readReleaseConfig,
  repositoryRoot,
  semverFromTag,
  sha256File,
  writeChecksums,
  writeJson,
} from "./release-lib.mjs";
import { assertNoRedistributionRestrictedResourceArchives } from "./resource-archive-policy.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function run(command, args, options = {}) {
  let executable = command;
  let invocationArguments = args;
  if (process.platform === "win32" && /\.cmd$/i.test(command)) {
    if (basename(command).toLowerCase() !== "npm.cmd") throw new Error(`Unsupported command shim: ${command}`);
    executable = isAbsolute(command) ? resolve(dirname(command), "node.exe") : process.execPath;
    const npmCli = isAbsolute(command)
      ? resolve(dirname(command), "node_modules", "npm", "bin", "npm-cli.js")
      : [
          process.env.npm_execpath,
          resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
        ].find((candidate) => candidate && existsSync(candidate));
    if (!npmCli || !existsSync(npmCli)) throw new Error(`npm CLI entry could not be resolved for ${command}.`);
    invocationArguments = [npmCli, ...args];
  }
  const result = spawnSync(executable, invocationArguments, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: options.capture ? "pipe" : "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trimEnd() : "";
    throw new Error(`${basename(command)} exited with code ${result.status}.${detail}`);
  }
  return result;
}

async function downloadPinnedRuntime(config, cacheDirectory) {
  mkdirSync(cacheDirectory, { recursive: true });
  const archivePath = resolve(cacheDirectory, config.runtime.archive);
  assertChildPath(cacheDirectory, archivePath, "Runtime cache file");
  if (existsSync(archivePath)) {
    if (statSync(archivePath).size !== config.runtime.sizeBytes) throw new Error(`Cached runtime byte size mismatch: ${archivePath}. Remove only that file before retrying.`);
    if (sha256File(archivePath) === config.runtime.sha256.toLowerCase()) return archivePath;
    throw new Error(`Cached runtime checksum mismatch: ${archivePath}. Remove only that file before retrying.`);
  }
  const partialPath = `${archivePath}.partial-${process.pid}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Runtime download exceeded ${config.runtime.timeoutSeconds} seconds.`)), config.runtime.timeoutSeconds * 1000);
  try {
    const response = await fetch(config.runtime.url, { redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`Runtime download failed with HTTP ${response.status}.`);
    if (!/^application\/(?:zip|octet-stream)/i.test(response.headers.get("content-type") ?? "application/octet-stream")) {
      throw new Error(`Runtime download returned an unexpected content type: ${response.headers.get("content-type")}.`);
    }
    if (response.headers.get("content-encoding")) throw new Error("Pinned runtime download must not use compressed HTTP content encoding.");
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength !== config.runtime.sizeBytes || contentLength > config.runtime.maxSizeBytes) {
        throw new Error(`Pinned runtime Content-Length ${contentLengthHeader} does not match the expected ${config.runtime.sizeBytes} bytes.`);
      }
    }
    if (!response.body) throw new Error("Pinned runtime download did not provide a response body.");
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > config.runtime.maxSizeBytes) callback(new Error(`Pinned runtime download exceeded ${config.runtime.maxSizeBytes} bytes.`));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(partialPath, { flags: "wx" }), { signal: controller.signal });
    if (received !== config.runtime.sizeBytes) throw new Error(`Pinned runtime byte size mismatch. Expected ${config.runtime.sizeBytes}; received ${received}.`);
    const actual = sha256File(partialPath);
    if (actual !== config.runtime.sha256.toLowerCase()) {
      throw new Error(`Pinned Node runtime checksum mismatch. Expected ${config.runtime.sha256}; received ${actual}.`);
    }
    renameSync(partialPath, archivePath);
    return archivePath;
  } finally {
    clearTimeout(timeout);
    rmSync(partialPath, { force: true });
  }
}

function copySourcePayload(stageRoot) {
  const appSource = resolve(repositoryRoot, "app");
  if (!existsSync(resolve(appSource, "dist", "server.js"))) throw new Error("The packaged app build is missing app/dist/server.js.");
  cpSync(appSource, resolve(stageRoot, "app"), {
    recursive: true,
    filter: (source) => !source.toLowerCase().includes(`${resolve(appSource, "node_modules").toLowerCase()}${process.platform === "win32" ? "\\" : "/"}`) && resolve(source).toLowerCase() !== resolve(appSource, "node_modules").toLowerCase(),
  });
  cpSync(resolve(repositoryRoot, "scripts", "windows"), resolve(stageRoot, "scripts", "windows"), { recursive: true });
  cpSync(resolve(repositoryRoot, "scripts", "diagnose.mjs"), resolve(stageRoot, "scripts", "diagnose.mjs"));
  cpSync(resolve(repositoryRoot, "mcp"), resolve(stageRoot, "mcp"), {
    recursive: true,
    filter: (source) => !source.toLowerCase().endsWith(".test.ts"),
  });
  for (const name of ["README.md", "LICENSE", ".mcp.json"]) {
    const source = resolve(repositoryRoot, name);
    if (existsSync(source)) cpSync(source, resolve(stageRoot, name), { recursive: statSync(source).isDirectory() });
  }
  copyPluginManifestPayload(repositoryRoot, stageRoot);
  const presentationIcon = resolve(repositoryRoot, "assets", "github", "blockwright-icon-v060.png");
  const windowsIcon = resolve(repositoryRoot, "installer", "windows", "assets", "blockwright-v060.ico");
  if (!existsSync(presentationIcon)) throw new Error(`The reviewed Blockwright presentation icon is missing: ${presentationIcon}`);
  if (!existsSync(windowsIcon)) throw new Error(`The reviewed multi-resolution Windows icon is missing: ${windowsIcon}`);
  mkdirSync(resolve(stageRoot, "assets"), { recursive: true });
  cpSync(presentationIcon, resolve(stageRoot, "assets", "blockwright-icon-v060.png"));
  cpSync(windowsIcon, resolve(stageRoot, "assets", "blockwright-v060.ico"));
}

function extractRuntime(archivePath, config, workDirectory, stageRoot) {
  const extractionRoot = resolve(workDirectory, "runtime-extract");
  assertChildPath(workDirectory, extractionRoot, "Runtime extraction directory");
  rmSync(extractionRoot, { recursive: true, force: true });
  mkdirSync(extractionRoot, { recursive: true });
  const powershell = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const archiveHelper = resolve(repositoryRoot, "scripts", "release", "Invoke-BlockwrightArchive.ps1");
  run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", archiveHelper, "-Action", "Expand", "-Source", archivePath, "-Destination", extractionRoot]);
  const runtimeSource = resolve(extractionRoot, `node-v${config.runtime.version}-win-x64`);
  if (!existsSync(resolve(runtimeSource, "node.exe")) || !existsSync(resolve(runtimeSource, "npm.cmd"))) {
    throw new Error("The verified Node runtime archive does not contain the expected Windows x64 layout.");
  }
  cpSync(runtimeSource, resolve(stageRoot, "runtime", "node"), { recursive: true });
}

function installProductionDependencies(stageRoot) {
  const privateNpm = resolve(stageRoot, "runtime", "node", "npm.cmd");
  run(privateNpm, ["ci", "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: resolve(stageRoot, "app") });
  run(privateNpm, ["ls", "--omit=dev", "--depth=0", "--json"], { cwd: resolve(stageRoot, "app"), capture: true });
}

function writeBundleMetadata(stageRoot, config, version, trustedPublisherThumbprint) {
  mkdirSync(resolve(stageRoot, "config"), { recursive: true });
  writeJson(resolve(stageRoot, "config", "defaults.json"), {
    schemaVersion: 1,
    port: config.defaultPort,
    bindAddress: "127.0.0.1",
    updateMetadataUri: config.update.metadataUrl,
    trustedPublisherThumbprint: trustedPublisherThumbprint ?? null,
    stateMode: "per-user",
  });
  writeJson(resolve(stageRoot, "release-manifest.json"), {
    schemaVersion: 1,
    product: "Blockwright",
    version,
    platform: config.platform,
    architecture: config.architecture,
    packagedRuntime: {
      name: config.runtime.name,
      version: config.runtime.version,
      source: config.runtime.url,
      archiveSha256: config.runtime.sha256,
      private: true,
    },
    signing: { status: trustedPublisherThumbprint ? "awaiting-external-authenticode" : "unsigned", trustedPublisherThumbprint: trustedPublisherThumbprint ?? null },
  });
  writeJson(resolve(stageRoot, ".mcp.json"), {
    mcpServers: {
      blockwright: {
        cwd: ".",
        command: "cmd.exe",
        args: ["/d", "/s", "/c", ".\\scripts\\windows\\Launch-Blockwright-Mcp.cmd"],
      },
    },
  });
}

function compressPortable(sourceRoot, productName, destination) {
  const powershell = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync(destination)) rmSync(destination, { force: true });
  const archiveHelper = resolve(repositoryRoot, "scripts", "release", "Invoke-BlockwrightArchive.ps1");
  run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", archiveHelper, "-Action", "Compress", "-Source", resolve(sourceRoot, productName), "-Destination", destination]);
}

function compileInstaller({ isccPath, version, stageRoot, outputDirectory }) {
  const installerScript = resolve(repositoryRoot, "installer", "windows", "Blockwright.iss");
  if (!existsSync(installerScript)) throw new Error(`Inno Setup script is missing: ${installerScript}`);
  const powershell = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const compilerBoundary = resolve(repositoryRoot, "scripts", "release", "Invoke-PinnedInnoCompile.ps1");
  run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", compilerBoundary, "-CompilerPath", isccPath, "-Version", version, "-StageDir", stageRoot, "-OutputDir", outputDirectory, "-ScriptPath", installerScript]);
  const expected = resolve(outputDirectory, `Blockwright-${version}-windows-x64-setup.exe`);
  if (!existsSync(expected)) throw new Error(`Inno Setup completed without producing ${expected}.`);
  return expected;
}

const config = readReleaseConfig();
const rootPackage = readJson(resolve(repositoryRoot, "package.json"));
const version = semverFromTag(argument("--version", rootPackage.version));
const trustedPublisherArgument = argument("--trusted-publisher-thumbprint", null);
const trustedPublisherThumbprint = trustedPublisherArgument ? normalizeThumbprint(trustedPublisherArgument) : null;
if (version !== rootPackage.version) throw new Error(`Requested release ${version} does not match package.json ${rootPackage.version}. Align manifests before release packaging.`);
if (process.platform !== "win32") throw new Error("The Windows release must be assembled on Windows so runtime dependencies and installer evidence match the target platform.");

const outputDirectory = resolve(argument("--out-dir", resolve(repositoryRoot, "release", "windows")));
const releaseRoot = resolve(repositoryRoot, "release");
assertChildPath(releaseRoot, outputDirectory, "Release output directory");
mkdirSync(outputDirectory, { recursive: true });
const workDirectory = resolve(outputDirectory, ".work");
assertChildPath(outputDirectory, workDirectory, "Release work directory");
rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });

try {
  if (!hasFlag("--skip-source-build")) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    run(npm, ["run", "build"]);
    run(npm, ["run", "package:plugin"]);
  }
  const archiveOverride = argument("--runtime-archive", null);
  let runtimeArchive;
  if (archiveOverride) {
    runtimeArchive = resolve(archiveOverride);
    if (statSync(runtimeArchive).size !== config.runtime.sizeBytes) throw new Error(`Provided runtime archive byte size mismatch. Expected ${config.runtime.sizeBytes}.`);
    const actual = sha256File(runtimeArchive);
    if (actual !== config.runtime.sha256.toLowerCase()) throw new Error(`Provided runtime archive checksum mismatch. Expected ${config.runtime.sha256}; received ${actual}.`);
  } else {
    runtimeArchive = await downloadPinnedRuntime(config, resolve(outputDirectory, ".runtime-cache"));
  }

  const stageRoot = resolve(workDirectory, "installer", "Blockwright");
  mkdirSync(stageRoot, { recursive: true });
  copySourcePayload(stageRoot);
  extractRuntime(runtimeArchive, config, workDirectory, stageRoot);
  installProductionDependencies(stageRoot);
  assertNoRedistributionRestrictedResourceArchives(stageRoot);
  writeBundleMetadata(stageRoot, config, version, trustedPublisherThumbprint);
  assertPluginManifestReferences(stageRoot);
  clearReleaseCandidateOutputs(outputDirectory, version);

  const portableParent = resolve(workDirectory, "portable");
  const portableRoot = resolve(portableParent, "Blockwright");
  mkdirSync(portableParent, { recursive: true });
  cpSync(stageRoot, portableRoot, { recursive: true });
  writeFileSync(resolve(portableRoot, "portable.flag"), "Blockwright portable state v1\n", "utf8");
  const portableZip = resolve(outputDirectory, `Blockwright-${version}-windows-x64-portable.zip`);
  compressPortable(portableParent, "Blockwright", portableZip);

  const stagedApplicationManifest = readJson(resolve(stageRoot, "app", "package.json"));
  if (stagedApplicationManifest.name !== rootPackage.name || stagedApplicationManifest.version !== version || stagedApplicationManifest.license !== rootPackage.license) {
    throw new Error("Staged application package identity/version/license does not match the release package.");
  }
  const applicationInventory = inventoryFromInstalledTree(resolve(stageRoot, "app", "node_modules"), { rootManifest: stagedApplicationManifest });
  const runtimeNpmInventory = inventoryFromInstalledTree(resolve(stageRoot, "runtime", "node", "node_modules"));
  const serialHash = createHash("sha256").update(`blockwright:${version}:windows:x64`).digest("hex");
  const serial = `urn:uuid:${serialHash.slice(0, 8)}-${serialHash.slice(8, 12)}-4${serialHash.slice(13, 16)}-8${serialHash.slice(17, 20)}-${serialHash.slice(20, 32)}`;
  const { cyclonedx, spdx } = createSboms({
    applicationInventory,
    runtimeNpmInventory,
    name: rootPackage.name,
    version,
    license: rootPackage.license,
    bundledRuntime: {
      name: config.runtime.name,
      version: config.runtime.version,
      source: config.runtime.url,
      archiveSha256: config.runtime.sha256,
      license: "MIT",
    },
    serial,
  });
  const cyclonedxPath = resolve(outputDirectory, `blockwright-${version}-cyclonedx.json`);
  const spdxPath = resolve(outputDirectory, `blockwright-${version}-spdx.json`);
  writeJson(cyclonedxPath, cyclonedx);
  writeJson(spdxPath, spdx);

  const artifacts = [portableZip];
  let installerPath = null;
  if (hasFlag("--installer")) {
    const isccArgument = argument("--iscc", null);
    if (!isccArgument) throw new Error("Installer compilation requires an explicit compiler path from Install-PinnedInnoSetup.ps1.");
    const isccPath = resolve(isccArgument);
    if (!existsSync(isccPath)) throw new Error(`Inno Setup compiler was requested but not found: ${isccPath}`);
    installerPath = compileInstaller({ isccPath, version, stageRoot, outputDirectory });
    artifacts.push(installerPath);
  }
  const statusPath = resolve(outputDirectory, `blockwright-${version}-signature-status.json`);
  writeJson(statusPath, {
    schemaVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    status: "unsigned",
    satisfiesSignedReleaseGate: false,
    reason: "No external Authenticode signing identity was supplied to this local build.",
    artifacts: artifacts.map((path) => ({ file: basename(path), sha256: sha256File(path), authenticode: extnameForAuthenticode(path) })),
  });
  writeChecksums(outputDirectory, [...artifacts, cyclonedxPath, spdxPath, statusPath]);
  console.log(JSON.stringify({ version, stageRoot, portableZip, installerPath, signatureStatus: "unsigned", signedReleaseGate: false }, null, 2));
} finally {
  if (!hasFlag("--keep-work")) rmSync(workDirectory, { recursive: true, force: true });
}

function extnameForAuthenticode(path) {
  return path.toLowerCase().endsWith(".exe") ? "not-signed" : "not-applicable";
}
