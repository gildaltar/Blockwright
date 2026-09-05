import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const releaseConfigPath = resolve(repositoryRoot, "scripts", "release", "windows-release.json");

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readReleaseConfig() {
  const value = readJson(releaseConfigPath);
  if (value?.schemaVersion !== 1 || value?.platform !== "windows" || value?.architecture !== "x64") {
    throw new Error("scripts/release/windows-release.json is not a supported Windows x64 release configuration.");
  }
  if (!/^https:\/\//i.test(value.runtime?.url ?? "")) throw new Error("The pinned runtime URL must use HTTPS.");
  if (!/^[a-f0-9]{64}$/i.test(value.runtime?.sha256 ?? "")) throw new Error("The pinned runtime SHA-256 is missing or invalid.");
  if (!Number.isSafeInteger(value.runtime?.sizeBytes) || value.runtime.sizeBytes < 1) throw new Error("The pinned runtime byte size is missing or invalid.");
  if (!Number.isSafeInteger(value.runtime?.maxSizeBytes) || value.runtime.maxSizeBytes < value.runtime.sizeBytes) throw new Error("The pinned runtime maximum byte size is missing or invalid.");
  if (!Number.isInteger(value.runtime?.timeoutSeconds) || value.runtime.timeoutSeconds < 1 || value.runtime.timeoutSeconds > 3600) throw new Error("The pinned runtime timeout is missing or invalid.");
  if (!/^\d+\.\d+\.\d+$/.test(value.innoSetup?.version ?? "")) throw new Error("The pinned Inno Setup version is missing or invalid.");
  if (!/^https:\/\//i.test(value.innoSetup?.url ?? "")) throw new Error("The pinned Inno Setup URL must use HTTPS.");
  if (!/^[a-f0-9]{64}$/i.test(value.innoSetup?.sha256 ?? "")) throw new Error("The pinned Inno Setup installer SHA-256 is missing or invalid.");
  if (!Number.isSafeInteger(value.innoSetup?.sizeBytes) || value.innoSetup.sizeBytes < 1) throw new Error("The pinned Inno Setup installer byte size is missing or invalid.");
  if (!Number.isSafeInteger(value.innoSetup?.maxSizeBytes) || value.innoSetup.maxSizeBytes < value.innoSetup.sizeBytes) throw new Error("The pinned Inno Setup maximum byte size is missing or invalid.");
  if (!Number.isInteger(value.innoSetup?.timeoutSeconds) || value.innoSetup.timeoutSeconds < 1 || value.innoSetup.timeoutSeconds > 3600) throw new Error("The pinned Inno Setup timeout is missing or invalid.");
  if (value.innoSetup?.productVersion !== value.innoSetup.version) throw new Error("The pinned Inno Setup product version must match its release version.");
  normalizeThumbprint(value.innoSetup?.publisherThumbprint, "Inno Setup publisher thumbprint");
  if (typeof value.innoSetup?.publisherSubject !== "string" || value.innoSetup.publisherSubject.length < 1 || value.innoSetup.publisherSubject.length > 500) throw new Error("The pinned Inno Setup publisher subject is missing or invalid.");
  if (value.innoSetup?.requireTimestamp !== true) throw new Error("The pinned Inno Setup installer must require an Authenticode timestamp.");
  const compilerRelativePath = value.innoSetup?.compilerRelativePath ?? "";
  if (typeof compilerRelativePath !== "string" || !compilerRelativePath || isAbsolute(compilerRelativePath) || compilerRelativePath.split(/[\\/]/).includes("..")) throw new Error("The pinned Inno Setup compiler path must be relative and traversal-free.");
  if (!/^[a-f0-9]{64}$/i.test(value.innoSetup?.compilerSha256 ?? "")) throw new Error("The pinned Inno Setup compiler SHA-256 is missing or invalid.");
  if (!Number.isSafeInteger(value.innoSetup?.compilerSizeBytes) || value.innoSetup.compilerSizeBytes < 1) throw new Error("The pinned Inno Setup compiler byte size is missing or invalid.");
  return value;
}

export function assertChildPath(parent, target, label = "Path") {
  const parentPath = resolve(parent);
  const targetPath = resolve(target);
  const child = relative(parentPath, targetPath);
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error(`${label} must be a child of ${parentPath}; received ${targetPath}.`);
  }
  return targetPath;
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function normalizeSha256(value, label = "SHA-256") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be exactly 64 hexadecimal characters.`);
  return normalized;
}

export function normalizeThumbprint(value, label = "certificate thumbprint") {
  const normalized = String(value ?? "").replace(/[^a-f0-9]/gi, "").toUpperCase();
  if (!/^[A-F0-9]{40,128}$/.test(normalized)) throw new Error(`${label} is missing or invalid.`);
  return normalized;
}

function packageIdentity(packagePath, entry) {
  const clean = packagePath.replace(/^node_modules\//, "");
  if (!clean) return null;
  const leaf = clean.split("/node_modules/").at(-1);
  const segments = leaf.split("/");
  const name = leaf.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  if (!name || !entry?.version) return null;
  return { path: packagePath, name, version: String(entry.version), license: normalizePackageLicense(entry.license) };
}

function normalizePackageLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.type === "string" && value.type.trim()) return value.type.trim();
  return "NOASSERTION";
}

function cyclonedxLicense(value) {
  const license = normalizePackageLicense(value);
  if (license === "NOASSERTION") return undefined;
  return /\s|[()]/.test(license) ? { expression: license } : { license: { id: license } };
}

export const sbomPartitions = Object.freeze({
  application: "app-production",
  runtimeNpm: "node-runtime-npm",
});

export function npmPackagePurl(name, version) {
  const packageName = String(name ?? "");
  const packageVersion = String(version ?? "");
  if (!packageName || !packageVersion) throw new Error("npm package purl requires a non-empty name and version.");
  let path;
  if (packageName.startsWith("@")) {
    const match = /^@([^/]+)\/([^/]+)$/.exec(packageName);
    if (!match) throw new Error(`Scoped npm package name is invalid: ${packageName}`);
    path = `${encodeURIComponent(`@${match[1]}`)}/${encodeURIComponent(match[2])}`;
  } else {
    if (packageName.includes("/")) throw new Error(`Unscoped npm package name is invalid: ${packageName}`);
    path = encodeURIComponent(packageName);
  }
  return `pkg:npm/${path}@${encodeURIComponent(packageVersion)}`;
}

export function probeExecutableVersion({ executable, args, expected, label, spawnProcess = spawnSync, timeoutMs = 15_000 }) {
  const result = spawnProcess(executable, args, { encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 1_048_576 });
  if (result.error) throw new Error(`${label} probe could not run within ${timeoutMs} ms: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} probe failed with exit code ${result.status}: ${String(result.stderr ?? result.stdout).trim()}`);
  const actual = String(result.stdout ?? "").trim();
  if (actual !== expected) throw new Error(`${label} version mismatch. Expected ${expected}; received ${actual || "no version"}.`);
  return actual;
}

function partitionPackages(applicationPackages, runtimeNpmPackages) {
  const merged = new Map();
  const add = (packages, partition) => {
    if (!Array.isArray(packages)) throw new Error(`${partition} SBOM packages must be an array.`);
    for (const item of packages) {
      if (!item || typeof item.name !== "string" || !item.name || typeof item.version !== "string" || !item.version) {
        throw new Error(`${partition} SBOM package is missing name/version.`);
      }
      const key = `${partition}\0${item.name}@${item.version}`;
      const license = normalizePackageLicense(item.license);
      const existing = merged.get(key);
      if (existing) {
        if (existing.license === "NOASSERTION" && license !== "NOASSERTION") existing.license = license;
        else if (license !== "NOASSERTION" && existing.license !== license) throw new Error(`Conflicting licenses for ${key}: ${existing.license} versus ${license}.`);
      } else {
        merged.set(key, { ...item, name: item.name, version: item.version, license, partition });
      }
    }
  };
  add(applicationPackages, sbomPartitions.application);
  add(runtimeNpmPackages, sbomPartitions.runtimeNpm);
  return [...merged.values()]
    .sort((left, right) => `${left.partition}\0${npmPackagePurl(left.name, left.version)}`.localeCompare(`${right.partition}\0${npmPackagePurl(right.name, right.version)}`));
}

function partitionComponentRef(partition, name, version) {
  if (!Object.values(sbomPartitions).includes(partition)) throw new Error(`Unknown SBOM distribution partition: ${partition}`);
  return `urn:blockwright:npm:${encodeURIComponent(partition)}:${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function assertExactValues(actualValues, expectedValues, label) {
  const actualList = [...actualValues];
  const expectedList = [...expectedValues];
  const actual = new Set(actualList);
  const expected = new Set(expectedList);
  if (actual.size !== actualList.length) throw new Error(`${label} contains duplicate values.`);
  const missing = [...expected].filter((value) => !actual.has(value));
  const unexpected = [...actual].filter((value) => !expected.has(value));
  if (missing.length || unexpected.length) throw new Error(`${label} mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`);
}

export function validateSbomPartitions({ cyclonedx, spdx, rootName, rootVersion, runtimeName, runtimeVersion }) {
  const rootRef = npmPackagePurl(rootName, rootVersion);
  const runtimeRef = `pkg:generic/${encodeURIComponent(runtimeName)}@${encodeURIComponent(runtimeVersion)}`;
  if (cyclonedx?.metadata?.component?.["bom-ref"] !== rootRef) throw new Error("CycloneDX root bom-ref is not the canonical npm purl.");
  const components = Array.isArray(cyclonedx?.components) ? cyclonedx.components : [];
  const runtimeComponents = components.filter((component) => component?.["bom-ref"] === runtimeRef);
  if (runtimeComponents.length !== 1 || runtimeComponents[0].name !== runtimeName || runtimeComponents[0].version !== runtimeVersion) throw new Error("CycloneDX bundled runtime component is missing or duplicated in the partition model.");
  const [runtimeComponent] = runtimeComponents;
  const componentByPartition = new Map(Object.values(sbomPartitions).map((partition) => [partition, new Map()]));
  const componentByRef = new Map();
  for (const component of components.filter((item) => item !== runtimeComponent)) {
    const expectedPurl = npmPackagePurl(component?.name, component?.version);
    if (component.purl !== expectedPurl) throw new Error(`CycloneDX npm component does not use its canonical purl: ${component?.name}@${component?.version}`);
    const partitionProperty = component.properties?.filter(({ name }) => name === "blockwright:distribution-partitions") ?? [];
    if (partitionProperty.length !== 1) throw new Error(`CycloneDX npm component must declare one distribution partition property: ${expectedPurl}`);
    const partition = partitionProperty[0].value;
    if (!Object.values(sbomPartitions).includes(partition)) throw new Error(`CycloneDX npm component has an invalid distribution partition: ${expectedPurl}`);
    const expectedRef = partitionComponentRef(partition, component.name, component.version);
    if (component["bom-ref"] !== expectedRef) throw new Error(`CycloneDX npm component does not use its partition-bound bom-ref: ${expectedPurl}`);
    const partitionMap = componentByPartition.get(partition);
    if (partitionMap.has(expectedPurl) || componentByRef.has(expectedRef)) throw new Error(`CycloneDX npm component is duplicated in ${partition}: ${expectedPurl}`);
    partitionMap.set(expectedPurl, component);
    componentByRef.set(expectedRef, component);
    if (partition === sbomPartitions.runtimeNpm) {
      if (!component.properties?.some(({ name, value }) => name === "blockwright:contained-by" && value === runtimeRef)) throw new Error(`CycloneDX runtime npm component is missing its containment property: ${expectedPurl}`);
    } else if (component.properties?.some(({ name }) => name === "blockwright:contained-by")) {
      throw new Error(`CycloneDX application component must not claim Node-runtime containment: ${expectedPurl}`);
    }
  }
  const applicationComponents = componentByPartition.get(sbomPartitions.application);
  const runtimeNpmComponents = componentByPartition.get(sbomPartitions.runtimeNpm);
  const applicationPurls = [...applicationComponents.keys()];
  const runtimeNpmPurls = [...runtimeNpmComponents.keys()];
  const npmComponents = [...runtimeNpmComponents.values()].filter(({ name }) => name === "npm");
  if (npmComponents.length !== 1) throw new Error(`CycloneDX runtime partition must contain exactly one npm package; found ${npmComponents.length}.`);
  const npmComponent = npmComponents[0];
  const npmPurl = npmComponent.purl;
  const npmRef = npmComponent["bom-ref"];
  const dependencyRecords = Array.isArray(cyclonedx.dependencies) ? cyclonedx.dependencies : [];
  const dependencyRefs = dependencyRecords.map(({ ref }) => ref);
  if (new Set(dependencyRefs).size !== dependencyRefs.length) throw new Error("CycloneDX dependency graph contains duplicate ref records.");
  for (const { ref, dependsOn } of dependencyRecords) {
    if (!Array.isArray(dependsOn) || new Set(dependsOn).size !== dependsOn.length) throw new Error(`CycloneDX dependency graph contains duplicate or invalid targets for ${ref}.`);
  }
  const dependencyMap = new Map(dependencyRecords.map(({ ref, dependsOn }) => [ref, dependsOn ?? []]));
  assertExactValues(dependencyMap.keys(), [rootRef, runtimeRef, ...componentByRef.keys()], "CycloneDX dependency graph refs");
  const applicationRefs = new Set([...applicationComponents.values()].map((component) => component["bom-ref"]));
  const runtimeNpmRefs = new Set([...runtimeNpmComponents.values()].map((component) => component["bom-ref"]));
  const rootTargets = dependencyMap.get(rootRef) ?? [];
  if (!rootTargets.includes(runtimeRef) || rootTargets.some((target) => target !== runtimeRef && !applicationRefs.has(target))) {
    throw new Error("CycloneDX root dependencies must contain only direct application packages plus the bundled Node runtime.");
  }
  const directApplicationRefs = rootTargets.filter((target) => target !== runtimeRef);
  assertExactValues(dependencyMap.get(runtimeRef) ?? [], [npmRef], "CycloneDX Node runtime dependency partition");
  for (const [partition, references] of [[sbomPartitions.application, applicationRefs], [sbomPartitions.runtimeNpm, runtimeNpmRefs]]) {
    for (const reference of references) {
      const targets = dependencyMap.get(reference) ?? [];
      if (targets.some((target) => !references.has(target))) throw new Error(`CycloneDX ${partition} dependency escapes its partition: ${reference}`);
    }
  }

  const spdxPackages = Array.isArray(spdx?.packages) ? spdx.packages : [];
  const spdxRoots = spdxPackages.filter(({ SPDXID }) => SPDXID === "SPDXRef-RootPackage");
  const spdxRuntimes = spdxPackages.filter(({ SPDXID }) => SPDXID === "SPDXRef-BundledNodeRuntime");
  if (spdxRoots.length !== 1 || spdxRuntimes.length !== 1) throw new Error("SPDX partition model must contain exactly one root package and one bundled runtime package.");
  const [spdxRoot] = spdxRoots;
  const [spdxRuntime] = spdxRuntimes;
  const spdxByPartition = new Map(Object.values(sbomPartitions).map((partition) => [partition, new Map()]));
  const spdxIds = new Set();
  for (const { SPDXID } of spdxPackages) {
    if (spdxIds.has(SPDXID)) throw new Error(`SPDX package identifier is duplicated: ${SPDXID}`);
    spdxIds.add(SPDXID);
  }
  for (const item of spdxPackages.filter(({ SPDXID }) => ![spdxRoot.SPDXID, spdxRuntime.SPDXID].includes(SPDXID))) {
    const purlReferences = item.externalRefs?.filter(({ referenceType }) => referenceType === "purl") ?? [];
    const partitionReferences = item.externalRefs?.filter(({ referenceType }) => referenceType === "blockwright-distribution-partition") ?? [];
    if (purlReferences.length !== 1 || partitionReferences.length !== 1) throw new Error(`SPDX npm package must declare exactly one purl and one distribution partition: ${item.name}@${item.versionInfo}`);
    const purl = purlReferences[0].referenceLocator;
    const partition = partitionReferences[0].referenceLocator;
    const expectedPurl = npmPackagePurl(item.name, item.versionInfo);
    if (purl !== expectedPurl) throw new Error(`SPDX npm package does not use its canonical purl: ${item.name}@${item.versionInfo}`);
    if (!Object.values(sbomPartitions).includes(partition)) throw new Error(`SPDX npm package has an invalid distribution partition: ${purl}`);
    const partitionMap = spdxByPartition.get(partition);
    if (partitionMap.has(purl)) throw new Error(`SPDX npm package is duplicated in ${partition}: ${purl}`);
    partitionMap.set(purl, item);
  }
  for (const partition of Object.values(sbomPartitions)) {
    assertExactValues(spdxByPartition.get(partition).keys(), componentByPartition.get(partition).keys(), `CycloneDX/SPDX ${partition} npm package inventory`);
  }
  const relationshipTargets = (source, type) => (spdx.relationships ?? []).filter(({ spdxElementId, relationshipType }) => spdxElementId === source && relationshipType === type).map(({ relatedSpdxElement }) => relatedSpdxElement);
  const spdxForComponentRef = (reference) => {
    const component = componentByRef.get(reference);
    if (!component) throw new Error(`CycloneDX dependency references an unknown component: ${reference}`);
    const partition = component.properties.find(({ name }) => name === "blockwright:distribution-partitions").value;
    return spdxByPartition.get(partition).get(component.purl);
  };
  const directApplicationSpdxIds = directApplicationRefs.map((reference) => spdxForComponentRef(reference).SPDXID);
  const runtimeSpdxIds = runtimeNpmPurls.map((purl) => spdxByPartition.get(sbomPartitions.runtimeNpm).get(purl).SPDXID);
  assertExactValues(relationshipTargets(spdxRoot.SPDXID, "DEPENDS_ON"), [...directApplicationSpdxIds, spdxRuntime.SPDXID], "SPDX application direct dependencies");
  assertExactValues(relationshipTargets(spdxRuntime.SPDXID, "CONTAINS"), runtimeSpdxIds, "SPDX Node runtime containment partition");
  for (const [reference, component] of componentByRef) {
    const sourceId = spdxForComponentRef(reference).SPDXID;
    const expectedTargets = (dependencyMap.get(reference) ?? []).map((target) => spdxForComponentRef(target).SPDXID);
    assertExactValues(relationshipTargets(sourceId, "DEPENDS_ON"), expectedTargets, `SPDX dependencies for ${component.purl}`);
  }
  return {
    applicationPurls: [...applicationPurls].sort(),
    runtimeNpmPurls: [...runtimeNpmPurls].sort(),
    directApplicationPurls: directApplicationRefs.map((reference) => componentByRef.get(reference).purl).sort(),
    npmPurl,
    npmRef,
    runtimeRef,
  };
}

export function packagesFromLock(lock, { productionOnly = true } = {}) {
  const deduplicated = new Map();
  for (const [packagePath, entry] of Object.entries(lock?.packages ?? {})) {
    if (productionOnly && entry?.dev === true) continue;
    const identity = packageIdentity(packagePath, entry);
    if (!identity) continue;
    const key = `${identity.name}@${identity.version}`;
    if (!deduplicated.has(key)) deduplicated.set(key, identity);
  }
  return [...deduplicated.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function inventoryFromInstalledTree(nodeModulesRoot, { rootManifest } = {}) {
  const root = resolve(nodeModulesRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Installed production dependency tree is missing: ${root}`);
  const deduplicated = new Map();
  const instances = [];
  const visitedNodeModules = new Set();

  const visitPackage = (packageRoot) => {
    const manifestPath = resolve(packageRoot, "package.json");
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new Error(`Installed package manifest is missing: ${manifestPath}`);
    const manifest = readJson(manifestPath);
    if (typeof manifest.name !== "string" || !manifest.name || typeof manifest.version !== "string" || !manifest.version) {
      throw new Error(`Installed package manifest is missing name/version: ${manifestPath}`);
    }
    const identity = {
      path: packageRoot,
      name: manifest.name,
      version: manifest.version,
      license: normalizePackageLicense(manifest.license),
    };
    const key = `${identity.name}@${identity.version}`;
    const existing = deduplicated.get(key);
    if (existing) {
      if (existing.license === "NOASSERTION" && identity.license !== "NOASSERTION") existing.license = identity.license;
      else if (identity.license !== "NOASSERTION" && existing.license !== identity.license) {
        throw new Error(`Conflicting installed licenses for ${key}: ${existing.license} versus ${identity.license}.`);
      }
    } else {
      deduplicated.set(key, identity);
    }
    instances.push({ root: resolve(packageRoot), manifest, ref: npmPackagePurl(identity.name, identity.version) });
    const nested = resolve(packageRoot, "node_modules");
    if (existsSync(nested) && statSync(nested).isDirectory()) visitNodeModules(nested);
  };

  const visitNodeModules = (directory) => {
    const canonical = resolve(directory);
    if (visitedNodeModules.has(canonical)) return;
    visitedNodeModules.add(canonical);
    for (const entry of readdirSync(canonical, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const entryPath = resolve(canonical, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory() && !scopedEntry.name.startsWith(".")) visitPackage(resolve(entryPath, scopedEntry.name));
        }
      } else {
        visitPackage(entryPath);
      }
    }
  };

  visitNodeModules(root);
  const normalizePath = (path) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  const instancesByRoot = new Map(instances.map((instance) => [normalizePath(instance.root), instance]));
  const treeContainer = dirname(root);
  const dependencyMap = new Map([...deduplicated.values()].map(({ name, version }) => [npmPackagePurl(name, version), new Set()]));
  const dependencySegments = (name) => name.startsWith("@") ? name.split("/") : [name];
  const resolveInstalledDependency = (packageRoot, dependencyName) => {
    let cursor = resolve(packageRoot);
    while (true) {
      const candidate = instancesByRoot.get(normalizePath(resolve(cursor, "node_modules", ...dependencySegments(dependencyName))));
      if (candidate) return candidate;
      if (normalizePath(cursor) === normalizePath(treeContainer)) return null;
      const parent = dirname(cursor);
      const boundary = relative(treeContainer, parent);
      if (parent === cursor || boundary.startsWith("..") || isAbsolute(boundary)) return null;
      cursor = parent;
    }
  };
  for (const instance of instances) {
    const dependencyNames = new Set([
      ...Object.keys(instance.manifest.dependencies ?? {}),
      ...Object.keys(instance.manifest.optionalDependencies ?? {}),
      ...Object.keys(instance.manifest.peerDependencies ?? {}),
      ...((instance.manifest.bundleDependencies ?? instance.manifest.bundledDependencies ?? []).filter((name) => typeof name === "string")),
    ]);
    for (const dependencyName of dependencyNames) {
      const target = resolveInstalledDependency(instance.root, dependencyName);
      if (target && target.ref !== instance.ref) dependencyMap.get(instance.ref).add(target.ref);
    }
  }
  const directDependencies = [];
  if (rootManifest !== undefined) {
    if (!rootManifest || typeof rootManifest !== "object" || Array.isArray(rootManifest)) throw new Error("Installed-tree root manifest must be an object.");
    const optionalNames = new Set(Object.keys(rootManifest.optionalDependencies ?? {}));
    const requiredNames = new Set(Object.keys(rootManifest.dependencies ?? {}).filter((name) => !optionalNames.has(name)));
    const bundledNames = new Set((rootManifest.bundleDependencies ?? rootManifest.bundledDependencies ?? []).filter((name) => typeof name === "string"));
    for (const dependencyName of [...new Set([...requiredNames, ...optionalNames, ...bundledNames])].sort()) {
      const target = resolveInstalledDependency(treeContainer, dependencyName);
      if (!target) {
        if (requiredNames.has(dependencyName) || bundledNames.has(dependencyName)) throw new Error(`Installed direct dependency is missing: ${dependencyName}`);
        continue;
      }
      directDependencies.push(target.ref);
    }
  }
  const packages = [...deduplicated.values()].sort((a, b) => npmPackagePurl(a.name, a.version).localeCompare(npmPackagePurl(b.name, b.version)));
  const dependencies = [...dependencyMap.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  return { packages, dependencies, directDependencies: [...new Set(directDependencies)].sort() };
}

export function packagesFromInstalledTree(nodeModulesRoot) {
  return inventoryFromInstalledTree(nodeModulesRoot).packages;
}

function normalizePluginReference(value, label) {
  if (typeof value !== "string" || !value.startsWith("./")) throw new Error(`${label} must be a repository-relative path beginning with ./`);
  const relativePath = value.slice(2).replaceAll("\\", "/").replace(/\/+$/, "");
  if (!relativePath || relativePath.split("/").includes("..")) throw new Error(`${label} is empty or contains traversal.`);
  return relativePath;
}

export function pluginManifestReferences(manifest) {
  const values = [
    [manifest?.skills, "plugin skills"],
    [manifest?.mcpServers, "plugin MCP configuration"],
    [manifest?.interface?.composerIcon, "plugin composer icon"],
    [manifest?.interface?.logo, "plugin logo"],
    [manifest?.interface?.logoDark, "plugin dark logo"],
    ...((manifest?.interface?.screenshots ?? []).map((value, index) => [value, `plugin screenshot ${index + 1}`])),
  ].filter(([value]) => value !== undefined);
  return [...new Set(values.map(([value, label]) => normalizePluginReference(value, label)))];
}

export function copyPluginManifestPayload(sourceRoot, stageRoot) {
  const source = resolve(sourceRoot);
  const stage = resolve(stageRoot);
  const pluginDirectory = resolve(source, ".codex-plugin");
  const manifestPath = resolve(pluginDirectory, "plugin.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new Error(`Plugin manifest is missing: ${manifestPath}`);
  cpSync(pluginDirectory, resolve(stage, ".codex-plugin"), { recursive: true });
  const manifest = readJson(manifestPath);
  const references = pluginManifestReferences(manifest);
  for (const reference of references) {
    const sourcePath = assertChildPath(source, resolve(source, reference), `Plugin manifest reference ${reference}`);
    if (!existsSync(sourcePath)) throw new Error(`Plugin manifest reference is missing from source: ${reference}`);
    const destinationPath = assertChildPath(stage, resolve(stage, reference), `Staged plugin manifest reference ${reference}`);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath, { recursive: statSync(sourcePath).isDirectory() });
  }
  return references;
}

export function assertPluginManifestReferences(packageRoot) {
  const root = resolve(packageRoot);
  const manifestPath = resolve(root, ".codex-plugin", "plugin.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new Error(`Staged plugin manifest is missing: ${manifestPath}`);
  const references = pluginManifestReferences(readJson(manifestPath));
  const missing = references.filter((reference) => !existsSync(assertChildPath(root, resolve(root, reference), `Staged plugin manifest reference ${reference}`)));
  if (missing.length) throw new Error(`Staged plugin manifest references missing payload paths: ${missing.join(", ")}`);
  return references;
}

export function createSboms({
  lock,
  packages: suppliedPackages,
  applicationInventory: suppliedApplicationInventory,
  applicationPackages: suppliedApplicationPackages,
  runtimeNpmInventory: suppliedRuntimeNpmInventory,
  runtimeNpmPackages: suppliedRuntimeNpmPackages,
  name,
  version,
  license = "NOASSERTION",
  bundledRuntime,
  serial = `urn:uuid:00000000-0000-4000-8000-000000000000`,
}) {
  const applicationPackages = suppliedApplicationInventory?.packages ?? suppliedApplicationPackages ?? suppliedPackages ?? packagesFromLock(lock);
  if (bundledRuntime && suppliedRuntimeNpmInventory === undefined && suppliedRuntimeNpmPackages === undefined) throw new Error("Bundled runtime SBOM generation requires the installed runtime npm package tree.");
  const runtimeNpmPackages = suppliedRuntimeNpmInventory?.packages ?? suppliedRuntimeNpmPackages ?? [];
  if (!bundledRuntime && runtimeNpmPackages.length) throw new Error("Runtime npm packages require bundled runtime metadata.");
  const packages = partitionPackages(applicationPackages, runtimeNpmPackages).map((item) => ({
    ...item,
    purl: npmPackagePurl(item.name, item.version),
    ref: partitionComponentRef(item.partition, item.name, item.version),
  }));
  const rootLicense = normalizePackageLicense(license);
  const rootRef = npmPackagePurl(name, version);
  const runtimeRef = bundledRuntime ? `pkg:generic/${encodeURIComponent(bundledRuntime.name)}@${encodeURIComponent(bundledRuntime.version)}` : null;
  const packagesByPartition = new Map(Object.values(sbomPartitions).map((partition) => [
    partition,
    new Map(packages.filter((item) => item.partition === partition).map((item) => [item.purl, item])),
  ]));
  const applicationPackageMap = packagesByPartition.get(sbomPartitions.application);
  const runtimeNpmPackageMap = packagesByPartition.get(sbomPartitions.runtimeNpm);
  const buildDependencyMap = (inventory, packageMap, label) => {
    const dependencyMap = new Map([...packageMap.values()].map(({ ref }) => [ref, new Set()]));
    if (inventory?.dependencies === undefined) return dependencyMap;
    if (!Array.isArray(inventory.dependencies)) throw new Error(`${label} installed dependency graph must be an array.`);
    assertExactValues(inventory.dependencies.map(({ ref }) => ref), packageMap.keys(), `${label} installed dependency graph refs`);
    for (const { ref, dependsOn } of inventory.dependencies) {
      const source = packageMap.get(ref);
      if (!source || !Array.isArray(dependsOn)) throw new Error(`${label} installed dependency record is invalid: ${ref ?? "missing ref"}`);
      const targets = dependencyMap.get(source.ref);
      for (const targetPurl of dependsOn) {
        const target = packageMap.get(targetPurl);
        if (!target) throw new Error(`${label} installed dependency escapes its inventory: ${ref} -> ${targetPurl}`);
        if (target.ref !== source.ref) targets.add(target.ref);
      }
    }
    return dependencyMap;
  };
  const applicationDependencyMap = buildDependencyMap(suppliedApplicationInventory, applicationPackageMap, "Application");
  const runtimeDependencyMap = buildDependencyMap(suppliedRuntimeNpmInventory, runtimeNpmPackageMap, "Runtime npm");
  const directApplicationPurls = suppliedApplicationInventory?.directDependencies === undefined
    ? [...applicationPackageMap.keys()]
    : suppliedApplicationInventory.directDependencies;
  if (!Array.isArray(directApplicationPurls)) throw new Error("Installed application direct dependencies must be an array.");
  assertExactValues(directApplicationPurls, new Set(directApplicationPurls), "Installed application direct dependencies");
  const directApplicationRefs = directApplicationPurls.map((purl) => {
    const item = applicationPackageMap.get(purl);
    if (!item) throw new Error(`Installed application direct dependency is outside the application inventory: ${purl}`);
    return item.ref;
  }).sort();
  const dependencyComponents = packages.map((item) => {
    const properties = [{ name: "blockwright:distribution-partitions", value: item.partition }];
    if (runtimeRef && item.partition === sbomPartitions.runtimeNpm) properties.push({ name: "blockwright:contained-by", value: runtimeRef });
    return Object.fromEntries(Object.entries({
      type: "library",
      "bom-ref": item.ref,
      name: item.name,
      version: item.version,
      licenses: cyclonedxLicense(item.license) ? [cyclonedxLicense(item.license)] : undefined,
      purl: item.purl,
      properties,
    }).filter(([, value]) => value !== undefined));
  });
  const npmPackages = [...runtimeNpmPackageMap.values()].filter(({ name: packageName }) => packageName === "npm");
  if (bundledRuntime && npmPackages.length !== 1) throw new Error(`Bundled runtime npm tree must contain exactly one npm package; found ${npmPackages.length}.`);
  const npmRef = npmPackages[0]?.ref;
  if (suppliedRuntimeNpmInventory?.dependencies === undefined && npmRef) {
    for (const { ref } of runtimeNpmPackageMap.values()) if (ref !== npmRef) runtimeDependencyMap.get(npmRef).add(ref);
  }
  const runtimeComponent = bundledRuntime ? {
    type: "platform",
    "bom-ref": runtimeRef,
    name: bundledRuntime.name,
    version: bundledRuntime.version,
    purl: runtimeRef,
    licenses: cyclonedxLicense(bundledRuntime.license) ? [cyclonedxLicense(bundledRuntime.license)] : undefined,
    hashes: [{ alg: "SHA-256", content: normalizeSha256(bundledRuntime.archiveSha256, "bundled runtime archive SHA-256") }],
    externalReferences: [{ type: "distribution", url: bundledRuntime.source }],
    properties: [{ name: "blockwright:distribution-role", value: "bundled-private-runtime" }],
  } : null;
  if (runtimeComponent && runtimeComponent.licenses === undefined) delete runtimeComponent.licenses;
  const components = runtimeComponent ? [...dependencyComponents, runtimeComponent] : dependencyComponents;
  const cyclonedx = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: serial,
    version: 1,
    metadata: { component: { type: "application", "bom-ref": rootRef, name, version, licenses: rootLicense === "NOASSERTION" ? undefined : [{ license: { id: rootLicense } }] } },
    components,
    dependencies: [
      { ref: rootRef, dependsOn: [...new Set([...directApplicationRefs, ...(runtimeRef ? [runtimeRef] : [])])] },
      ...(runtimeRef ? [{ ref: runtimeRef, dependsOn: [npmRef] }] : []),
      ...[...applicationDependencyMap.entries()].map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
      ...[...runtimeDependencyMap.entries()].map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
    ],
  };
  if (cyclonedx.metadata.component.licenses === undefined) delete cyclonedx.metadata.component.licenses;

  const spdxPackages = packages.map((item, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: item.license,
    externalRefs: [
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: item.purl },
      { referenceCategory: "OTHER", referenceType: "blockwright-distribution-partition", referenceLocator: item.partition },
    ],
    partition: item.partition,
    componentRef: item.ref,
  }));
  const spdxByComponentRef = new Map(spdxPackages.map((item) => [item.componentRef, item]));
  const outputSpdxPackages = spdxPackages.map(({ partition: _partition, componentRef: _componentRef, ...item }) => item);
  const relationships = [];
  const relationshipKeys = new Set();
  const addRelationship = (spdxElementId, relationshipType, relatedSpdxElement) => {
    const key = `${spdxElementId}\0${relationshipType}\0${relatedSpdxElement}`;
    if (relationshipKeys.has(key)) return;
    relationshipKeys.add(key);
    relationships.push({ spdxElementId, relationshipType, relatedSpdxElement });
  };
  for (const reference of directApplicationRefs) addRelationship("SPDXRef-RootPackage", "DEPENDS_ON", spdxByComponentRef.get(reference).SPDXID);
  if (bundledRuntime) {
    addRelationship("SPDXRef-RootPackage", "DEPENDS_ON", "SPDXRef-BundledNodeRuntime");
    for (const { ref } of runtimeNpmPackageMap.values()) addRelationship("SPDXRef-BundledNodeRuntime", "CONTAINS", spdxByComponentRef.get(ref).SPDXID);
    for (const [source, targets] of applicationDependencyMap) {
      for (const target of targets) addRelationship(spdxByComponentRef.get(source).SPDXID, "DEPENDS_ON", spdxByComponentRef.get(target).SPDXID);
    }
    for (const [source, targets] of runtimeDependencyMap) {
      for (const target of targets) addRelationship(spdxByComponentRef.get(source).SPDXID, "DEPENDS_ON", spdxByComponentRef.get(target).SPDXID);
    }
  } else {
    for (const [source, targets] of applicationDependencyMap) {
      for (const target of targets) addRelationship(spdxByComponentRef.get(source).SPDXID, "DEPENDS_ON", spdxByComponentRef.get(target).SPDXID);
    }
  }
  const spdx = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${name}-${version}`,
    documentNamespace: `https://github.com/gildaltar/Blockwright/sbom/${encodeURIComponent(version)}`,
    creationInfo: { created: "1970-01-01T00:00:00Z", creators: ["Tool: Blockwright release tooling"] },
    packages: [
      { SPDXID: "SPDXRef-RootPackage", name, versionInfo: version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: rootLicense, licenseDeclared: rootLicense },
      ...outputSpdxPackages,
      ...(bundledRuntime ? [{
        SPDXID: "SPDXRef-BundledNodeRuntime",
        name: bundledRuntime.name,
        versionInfo: bundledRuntime.version,
        downloadLocation: bundledRuntime.source,
        filesAnalyzed: false,
        licenseConcluded: normalizePackageLicense(bundledRuntime.license),
        licenseDeclared: normalizePackageLicense(bundledRuntime.license),
        checksums: [{ algorithm: "SHA256", checksumValue: normalizeSha256(bundledRuntime.archiveSha256, "bundled runtime archive SHA-256") }],
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: runtimeRef }],
      }] : []),
    ],
    relationships,
  };
  return { cyclonedx, spdx };
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function releaseCandidateOutputNames(version) {
  const normalizedVersion = semverFromTag(version);
  return [
    `Blockwright-${normalizedVersion}-windows-x64-setup.exe`,
    `Blockwright-${normalizedVersion}-windows-x64-portable.zip`,
    `blockwright-${normalizedVersion}-cyclonedx.json`,
    `blockwright-${normalizedVersion}-spdx.json`,
    `blockwright-${normalizedVersion}-signature-status.json`,
    "authenticode-proof.json",
    "latest.json",
    "SHA256SUMS.txt",
  ];
}

export function clearReleaseCandidateOutputs(directory, version) {
  const root = resolve(directory);
  const targets = releaseCandidateOutputNames(version).map((name) => ({
    name,
    path: assertChildPath(root, resolve(root, name), `Release candidate output ${name}`),
  })).filter(({ path }) => existsSync(path));
  for (const { path } of targets) {
    if (!statSync(path).isFile()) throw new Error(`Release candidate output is not a file and will not be removed: ${path}`);
  }
  for (const { path } of targets) {
    rmSync(path, { force: true });
  }
  return targets.map(({ name }) => name);
}

export function releaseFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name !== "SHA256SUMS" && name !== "SHA256SUMS.txt")
    .map((name) => resolve(directory, name))
    .filter((path) => statSync(path).isFile() && [".exe", ".zip", ".json"].includes(extname(path).toLowerCase()))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export function writeChecksums(directory, paths = releaseFiles(directory)) {
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Cannot checksum missing release file: ${path}`);
  }
  const lines = paths.map((path) => `${sha256File(path)}  ${basename(path)}`);
  const output = resolve(directory, "SHA256SUMS.txt");
  writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
  return { output, entries: paths.length };
}

export function parseChecksums(text) {
  const values = new Map();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+\*?([^\\/]+)$/i.exec(line);
    if (!match) throw new Error(`Invalid checksum line: ${rawLine}`);
    if (values.has(match[2])) throw new Error(`Duplicate checksum entry: ${match[2]}`);
    values.set(match[2], match[1].toLowerCase());
  }
  return values;
}

export function semverFromTag(tag) {
  // Windows ProductVersion and Inno Setup's VersionInfoVersion are numeric.
  // Keep the Windows release channel on stable x.y.z versions so metadata,
  // installer resources, and updater comparisons cannot disagree.
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(String(tag ?? "").trim());
  if (!match) throw new Error(`Release tag must be a semantic version such as v0.6.0; received ${tag}.`);
  return match[1];
}
