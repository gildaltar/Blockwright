import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertChildPath,
  createSboms,
  inventoryFromInstalledTree,
  probeExecutableVersion,
  readJson,
  readReleaseConfig,
  repositoryRoot,
  sha256File,
  writeJson,
} from "./release-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const stageArgument = argument("--stage-root", null);
if (!stageArgument) throw new Error("SBOM generation requires --stage-root for the exact staged Windows package tree.");
const stageRoot = resolve(stageArgument);
const packagePath = assertChildPath(stageRoot, resolve(stageRoot, "app", "package.json"), "Staged runtime package manifest");
const releaseManifestPath = assertChildPath(stageRoot, resolve(stageRoot, "release-manifest.json"), "Staged release manifest");
const applicationNodeModules = assertChildPath(stageRoot, resolve(stageRoot, "app", "node_modules"), "Staged application dependency tree");
const runtimeNodeModules = assertChildPath(stageRoot, resolve(stageRoot, "runtime", "node", "node_modules"), "Staged Node runtime dependency tree");
const runtimeExecutable = resolve(stageRoot, "runtime", "node", "node.exe");
const runtimeNpmWrapper = resolve(stageRoot, "runtime", "node", "npm.cmd");
const runtimeNpmManifest = resolve(runtimeNodeModules, "npm", "package.json");
const runtimeNpmCli = resolve(runtimeNodeModules, "npm", "bin", "npm-cli.js");
const launcherExecutable = resolve(stageRoot, "Blockwright.exe");
for (const requiredFile of [
  packagePath,
  releaseManifestPath,
  runtimeExecutable,
  runtimeNpmWrapper,
  resolve(stageRoot, "runtime", "node", "LICENSE"),
  runtimeNpmManifest,
  runtimeNpmCli,
  launcherExecutable,
  resolve(runtimeNodeModules, "npm", "LICENSE"),
]) {
  if (!existsSync(requiredFile) || !statSync(requiredFile).isFile()) throw new Error(`Exact staged runtime file is missing: ${requiredFile}`);
}

const manifest = readJson(packagePath);
const stagedRelease = readJson(releaseManifestPath);
const releaseConfig = readReleaseConfig();
const stagedRuntime = stagedRelease.packagedRuntime;
const stagedLauncher = stagedRelease.launcher;
if (stagedRelease.schemaVersion !== 1 || stagedRelease.version !== manifest.version) throw new Error("Staged release manifest does not match the staged application version.");
if (stagedRuntime?.private !== true
  || stagedRuntime.name !== releaseConfig.runtime.name
  || stagedRuntime.version !== releaseConfig.runtime.version
  || stagedRuntime.source !== releaseConfig.runtime.url
  || String(stagedRuntime.archiveSha256 ?? "").toLowerCase() !== releaseConfig.runtime.sha256.toLowerCase()) {
  throw new Error("Staged release manifest does not match the pinned private Node runtime.");
}
if (stagedLauncher?.path !== "Blockwright.exe"
  || stagedLauncher.fileVersion !== `${manifest.version}.0`
  || String(stagedLauncher.sha256 ?? "").toLowerCase() !== sha256File(launcherExecutable)) {
  throw new Error("Staged release manifest does not match the exact native Blockwright.exe launcher.");
}
const npmWrapper = readFileSync(runtimeNpmWrapper, "utf8");
if (!/node\.exe/i.test(npmWrapper) || !/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js/i.test(npmWrapper)) {
  throw new Error("Staged npm.cmd does not launch the private Node runtime's npm CLI.");
}
// The release builder authenticates the pinned archive before staging it. These bounded
// probes are the standalone generator's narrower layout/version check, not provenance proof.
probeExecutableVersion({ executable: runtimeExecutable, args: ["--version"], expected: `v${stagedRuntime.version}`, label: "Staged private Node runtime" });
probeExecutableVersion({ executable: runtimeExecutable, args: [runtimeNpmCli, "--version"], expected: readJson(runtimeNpmManifest).version, label: "Staged private npm CLI" });

const applicationInventory = inventoryFromInstalledTree(applicationNodeModules, { rootManifest: manifest });
const runtimeNpmInventory = inventoryFromInstalledTree(runtimeNodeModules);
const outputDirectory = resolve(argument("--out-dir", resolve(repositoryRoot, "release", "windows")));
mkdirSync(outputDirectory, { recursive: true });
const { cyclonedx, spdx } = createSboms({
  applicationInventory,
  runtimeNpmInventory,
  name: manifest.name,
  version: manifest.version,
  license: manifest.license,
  bundledRuntime: {
    name: stagedRuntime.name,
    version: stagedRuntime.version,
    source: stagedRuntime.source,
    archiveSha256: stagedRuntime.archiveSha256,
    license: "MIT",
  },
  bundledLauncher: {
    name: "Blockwright Windows Launcher",
    version: manifest.version,
    sha256: stagedLauncher.sha256,
    license: manifest.license,
    path: stagedLauncher.path,
  },
  serial: `urn:uuid:${randomUUID()}`,
});
const cyclonedxPath = resolve(outputDirectory, `blockwright-${manifest.version}-cyclonedx.json`);
const spdxPath = resolve(outputDirectory, `blockwright-${manifest.version}-spdx.json`);
writeJson(cyclonedxPath, cyclonedx);
writeJson(spdxPath, spdx);
console.log(`Wrote CycloneDX and SPDX SBOMs for ${manifest.name} ${manifest.version} from the exact staged app and Node/npm trees.`);
