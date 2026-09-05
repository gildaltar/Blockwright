import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
  return { path: packagePath, name, version: String(entry.version), license: String(entry.license ?? "NOASSERTION") };
}

export function packagesFromLock(lock) {
  const deduplicated = new Map();
  for (const [packagePath, entry] of Object.entries(lock?.packages ?? {})) {
    const identity = packageIdentity(packagePath, entry);
    if (!identity) continue;
    const key = `${identity.name}@${identity.version}`;
    if (!deduplicated.has(key)) deduplicated.set(key, identity);
  }
  return [...deduplicated.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function createSboms({ lock, name, version, serial = `urn:uuid:00000000-0000-4000-8000-000000000000` }) {
  const packages = packagesFromLock(lock);
  const rootRef = `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  const components = packages.map((item) => ({
    type: "library",
    "bom-ref": `pkg:npm/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`,
    name: item.name,
    version: item.version,
    licenses: item.license === "NOASSERTION" ? undefined : [{ license: { id: item.license } }],
    purl: `pkg:npm/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`,
  })).map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
  const cyclonedx = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: serial,
    version: 1,
    metadata: { component: { type: "application", "bom-ref": rootRef, name, version } },
    components,
    dependencies: [{ ref: rootRef, dependsOn: components.map((item) => item["bom-ref"]) }],
  };

  const spdxPackages = packages.map((item, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: item.license,
    externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:npm/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}` }],
  }));
  const spdx = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${name}-${version}`,
    documentNamespace: `https://github.com/gildaltar/Blockwright/sbom/${encodeURIComponent(version)}`,
    creationInfo: { created: "1970-01-01T00:00:00Z", creators: ["Tool: Blockwright release tooling"] },
    packages: [{ SPDXID: "SPDXRef-RootPackage", name, versionInfo: version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION" }, ...spdxPackages],
    relationships: spdxPackages.map((item) => ({ spdxElementId: "SPDXRef-RootPackage", relationshipType: "DEPENDS_ON", relatedSpdxElement: item.SPDXID })),
  };
  return { cyclonedx, spdx };
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
