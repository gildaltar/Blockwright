import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  assertPluginManifestReferences,
  clearReleaseCandidateOutputs,
  copyPluginManifestPayload,
  createSboms,
  inventoryFromInstalledTree,
  npmPackagePurl,
  packagesFromInstalledTree,
  packagesFromLock,
  pluginManifestReferences,
  probeExecutableVersion,
  readReleaseConfig,
  releaseCandidateOutputNames,
  repositoryRoot,
  sbomPartitions,
  validateSbomPartitions,
} from "./release-lib.mjs";

function writeFixtureFile(root, path, value = "fixture\n") {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function writeFixtureJson(root, path, value) {
  writeFixtureFile(root, path, `${JSON.stringify(value)}\n`);
}

test("all release package identities declare the GPL-2.0-only project license", () => {
  const repositoryVersion = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).version;
  assert.match(repositoryVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "package.json version");
  for (const path of ["package.json", "app/package.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
    assert.equal(manifest.version, repositoryVersion, path);
    assert.equal(manifest.license, "GPL-2.0-only", path);
  }
  for (const path of ["package-lock.json", "app/package-lock.json"]) {
    const lock = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
    assert.equal(lock.packages[""].version, repositoryVersion, path);
    assert.equal(lock.packages[""].license, "GPL-2.0-only", path);
  }
});

test("release assembly clears only exact generated candidate outputs", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-release-clean-boundary-"));
  const knownNames = releaseCandidateOutputNames("0.6.0");
  try {
    for (const name of knownNames) writeFixtureFile(temporary, name, `stale ${name}\n`);
    writeFixtureFile(temporary, "operator-notes.json", "preserve me\n");
    writeFixtureFile(temporary, "Blockwright-0.5.0-windows-x64-setup.exe", "preserve prior version\n");
    assert.deepEqual(new Set(clearReleaseCandidateOutputs(temporary, "0.6.0")), new Set(knownNames));
    for (const name of knownNames) assert.equal(existsSync(resolve(temporary, name)), false, name);
    assert.equal(readFileSync(resolve(temporary, "operator-notes.json"), "utf8"), "preserve me\n");
    assert.equal(readFileSync(resolve(temporary, "Blockwright-0.5.0-windows-x64-setup.exe"), "utf8"), "preserve prior version\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const collisionRoot = mkdtempSync(resolve(tmpdir(), "blockwright-release-clean-collision-"));
  try {
    writeFixtureFile(collisionRoot, knownNames[0], "must remain after preflight failure\n");
    mkdirSync(resolve(collisionRoot, "latest.json"));
    assert.throws(() => clearReleaseCandidateOutputs(collisionRoot, "0.6.0"), /not a file and will not be removed/);
    assert.equal(existsSync(resolve(collisionRoot, knownNames[0])), true);
  } finally {
    rmSync(collisionRoot, { recursive: true, force: true });
  }

  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  assert.match(builder, /clearReleaseCandidateOutputs\(outputDirectory, version\)/);
});

test("release builder locates npm when invoked directly with node on Windows", () => {
  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  assert.match(builder, /process\.env\.npm_execpath/);
  assert.match(builder, /resolve\(dirname\(process\.execPath\), "node_modules", "npm", "bin", "npm-cli\.js"\)/);
});

test("Windows staging copies and revalidates every plugin-manifest payload reference", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-plugin-payload-"));
  const source = resolve(temporary, "source");
  const stage = resolve(temporary, "stage");
  const manifest = {
    name: "blockwright",
    version: "0.6.0",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      composerIcon: "./assets/icon.png",
      logo: "./assets/icon.png",
      logoDark: "./assets/icon-dark.png",
      screenshots: ["./assets/landing.png", "./assets/reviewer.png"],
    },
  };
  try {
    writeFixtureJson(source, ".codex-plugin/plugin.json", manifest);
    writeFixtureJson(source, ".mcp.json", { mcpServers: {} });
    writeFixtureFile(source, "skills/blockwright/SKILL.md");
    for (const name of ["icon.png", "icon-dark.png", "landing.png", "reviewer.png"]) writeFixtureFile(source, `assets/${name}`);

    const expected = pluginManifestReferences(manifest);
    assert.deepEqual(copyPluginManifestPayload(source, stage), expected);
    assert.deepEqual(assertPluginManifestReferences(stage), expected);
    for (const reference of expected) assert.equal(existsSync(resolve(stage, reference)), true, reference);

    rmSync(resolve(stage, "assets", "reviewer.png"));
    assert.throws(() => assertPluginManifestReferences(stage), /assets\/reviewer\.png/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  assert.match(builder, /copyPluginManifestPayload\(repositoryRoot, stageRoot\)/);
  assert.match(builder, /assertPluginManifestReferences\(stageRoot\)/);
});

test("plugin staging fails closed when a manifest path is missing or escapes the source", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-plugin-reference-failure-"));
  try {
    writeFixtureJson(temporary, ".codex-plugin/plugin.json", { name: "blockwright", skills: "./skills/", interface: { screenshots: ["./assets/missing.png"] } });
    writeFixtureFile(temporary, "skills/blockwright/SKILL.md");
    assert.throws(() => copyPluginManifestPayload(temporary, resolve(temporary, "stage")), /assets\/missing\.png/);
    assert.throws(() => pluginManifestReferences({ skills: "../outside" }), /beginning with \./);
    assert.throws(() => pluginManifestReferences({ skills: "./skills/../outside" }), /traversal/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("SBOM input is the installed production closure and excludes lockfile-only dev packages", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-installed-sbom-"));
  const applicationRoot = resolve(temporary, "app");
  const nodeModules = resolve(applicationRoot, "node_modules");
  const runtimeNodeModules = resolve(temporary, "runtime", "node", "node_modules");
  try {
    const applicationManifest = {
      name: "blockwright",
      version: "0.6.0",
      license: "GPL-2.0-only",
      dependencies: { "@scope/tool": "3.0.0", "prod-a": "1.0.0", "prod-expression": "4.0.0" },
    };
    writeFixtureJson(applicationRoot, "package.json", applicationManifest);
    writeFixtureJson(nodeModules, "prod-a/package.json", { name: "prod-a", version: "1.0.0", license: "MIT", dependencies: { "prod-b": "2.0.0" } });
    writeFixtureJson(nodeModules, "prod-a/node_modules/prod-b/package.json", { name: "prod-b", version: "2.0.0" });
    writeFixtureJson(nodeModules, "prod-expression/package.json", { name: "prod-expression", version: "4.0.0", license: "(MIT OR CC0-1.0)", dependencies: { "prod-b": "2.0.0" } });
    writeFixtureJson(nodeModules, "prod-expression/node_modules/prod-b/package.json", { name: "prod-b", version: "2.0.0", license: "Apache-2.0" });
    writeFixtureJson(nodeModules, "@scope/tool/package.json", { name: "@scope/tool", version: "3.0.0", license: { type: "BSD-2-Clause" } });
    writeFixtureFile(nodeModules, ".bin/ignored.cmd");
    writeFixtureJson(runtimeNodeModules, "npm/package.json", { name: "npm", version: "11.19.0", license: "Artistic-2.0", dependencies: { "@npmcli/agent": "4.0.2" } });
    writeFixtureJson(runtimeNodeModules, "npm/node_modules/@npmcli/agent/package.json", { name: "@npmcli/agent", version: "4.0.2", license: "ISC" });
    writeFixtureJson(runtimeNodeModules, "npm/node_modules/prod-a/package.json", { name: "prod-a", version: "1.0.0", license: "MIT" });

    const applicationInventory = inventoryFromInstalledTree(nodeModules, { rootManifest: applicationManifest });
    const runtimeNpmInventory = inventoryFromInstalledTree(runtimeNodeModules);
    const applicationPackages = applicationInventory.packages;
    const runtimeNpmPackages = runtimeNpmInventory.packages;
    assert.deepEqual(applicationPackages.map(({ name, version }) => `${name}@${version}`), ["@scope/tool@3.0.0", "prod-a@1.0.0", "prod-b@2.0.0", "prod-expression@4.0.0"]);
    assert.deepEqual(runtimeNpmPackages.map(({ name, version }) => `${name}@${version}`), ["@npmcli/agent@4.0.2", "npm@11.19.0", "prod-a@1.0.0"]);
    assert.equal(applicationPackages.find(({ name }) => name === "@scope/tool").license, "BSD-2-Clause");
    assert.equal(applicationPackages.find(({ name }) => name === "prod-b").license, "Apache-2.0");
    assert.deepEqual(applicationInventory.directDependencies, ["pkg:npm/%40scope/tool@3.0.0", "pkg:npm/prod-a@1.0.0", "pkg:npm/prod-expression@4.0.0"]);

    const conflictingTree = resolve(temporary, "conflicting-node-modules");
    writeFixtureJson(conflictingTree, "parent-a/package.json", { name: "parent-a", version: "1.0.0" });
    writeFixtureJson(conflictingTree, "parent-a/node_modules/shared/package.json", { name: "shared", version: "1.0.0", license: "MIT" });
    writeFixtureJson(conflictingTree, "parent-b/package.json", { name: "parent-b", version: "1.0.0" });
    writeFixtureJson(conflictingTree, "parent-b/node_modules/shared/package.json", { name: "shared", version: "1.0.0", license: "Apache-2.0" });
    assert.throws(() => packagesFromInstalledTree(conflictingTree), /Conflicting installed licenses for shared@1\.0\.0/);

    const lock = { packages: {
      "node_modules/prod-a": { version: "1.0.0", license: "MIT" },
      "node_modules/dev-only": { version: "9.9.9", license: "MIT", dev: true },
    } };
    assert.deepEqual(packagesFromLock(lock).map(({ name }) => name), ["prod-a"]);
    assert.deepEqual(packagesFromLock(lock, { productionOnly: false }).map(({ name }) => name), ["dev-only", "prod-a"]);

    const runtimeHash = "a".repeat(64);
    const runtimeUrl = "https://nodejs.org/dist/v26.8.1/node-v26.8.1-win-x64.zip";
    const { cyclonedx, spdx } = createSboms({
      applicationInventory,
      runtimeNpmInventory,
      name: "blockwright",
      version: "0.6.0",
      license: "GPL-2.0-only",
      bundledRuntime: { name: "node", version: "26.8.1", source: runtimeUrl, archiveSha256: runtimeHash, license: "MIT" },
    });

    assert.deepEqual(cyclonedx.metadata.component.licenses, [{ license: { id: "GPL-2.0-only" } }]);
    assert.deepEqual(cyclonedx.components.map(({ name }) => name).sort(), ["@npmcli/agent", "@scope/tool", "node", "npm", "prod-a", "prod-a", "prod-b", "prod-expression"]);
    const nodeComponent = cyclonedx.components.find(({ name }) => name === "node");
    assert.deepEqual(nodeComponent.licenses, [{ license: { id: "MIT" } }]);
    assert.deepEqual(nodeComponent.hashes, [{ alg: "SHA-256", content: runtimeHash }]);
    assert.deepEqual(cyclonedx.components.find(({ name }) => name === "prod-b").licenses, [{ license: { id: "Apache-2.0" } }]);
    assert.deepEqual(cyclonedx.components.find(({ name }) => name === "prod-expression").licenses, [{ expression: "(MIT OR CC0-1.0)" }]);
    assert.equal(nodeComponent.externalReferences[0].url, runtimeUrl);
    const scopedComponent = cyclonedx.components.find(({ name }) => name === "@scope/tool");
    const runtimeScopedComponent = cyclonedx.components.find(({ name }) => name === "@npmcli/agent");
    assert.equal(scopedComponent.purl, "pkg:npm/%40scope/tool@3.0.0");
    assert.equal(runtimeScopedComponent.purl, "pkg:npm/%40npmcli/agent@4.0.2");
    assert.doesNotMatch(scopedComponent.purl, /%2F/i);
    const applicationComponent = (packageName) => cyclonedx.components.find(({ name, properties }) => name === packageName && properties?.some(({ name: propertyName, value }) => propertyName === "blockwright:distribution-partitions" && value === sbomPartitions.application));
    const runtimeComponent = (packageName) => cyclonedx.components.find(({ name, properties }) => name === packageName && properties?.some(({ name: propertyName, value }) => propertyName === "blockwright:distribution-partitions" && value === sbomPartitions.runtimeNpm));
    assert.deepEqual(applicationComponent("prod-a").properties, [
      { name: "blockwright:distribution-partitions", value: sbomPartitions.application },
    ]);
    assert.deepEqual(runtimeComponent("prod-a").properties, [
      { name: "blockwright:distribution-partitions", value: sbomPartitions.runtimeNpm },
      { name: "blockwright:contained-by", value: "pkg:generic/node@26.8.1" },
    ]);
    assert.notEqual(applicationComponent("prod-a")["bom-ref"], runtimeComponent("prod-a")["bom-ref"], "the same package/version in two installed trees must retain partition-specific dependency identity");
    const partitionSummary = validateSbomPartitions({ cyclonedx, spdx, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: "node", runtimeVersion: "26.8.1" });
    assert.deepEqual(partitionSummary.applicationPurls, applicationPackages.map(({ name, version }) => npmPackagePurl(name, version)).sort());
    assert.deepEqual(partitionSummary.runtimeNpmPurls, runtimeNpmPackages.map(({ name, version }) => npmPackagePurl(name, version)).sort());
    assert.deepEqual(partitionSummary.directApplicationPurls, applicationInventory.directDependencies);
    assert.equal(partitionSummary.npmPurl, "pkg:npm/npm@11.19.0");
    const rootDependency = cyclonedx.dependencies.find(({ ref }) => ref === cyclonedx.metadata.component["bom-ref"]);
    assert.deepEqual(new Set(rootDependency.dependsOn), new Set([
      applicationComponent("@scope/tool")["bom-ref"],
      applicationComponent("prod-a")["bom-ref"],
      applicationComponent("prod-expression")["bom-ref"],
      "pkg:generic/node@26.8.1",
    ]));
    assert.ok(!rootDependency.dependsOn.includes(applicationComponent("prod-b")["bom-ref"]), "a transitive app package must not be emitted as a direct root dependency");
    const appProdDependency = cyclonedx.dependencies.find(({ ref }) => ref === applicationComponent("prod-a")["bom-ref"]);
    assert.deepEqual(appProdDependency.dependsOn, [applicationComponent("prod-b")["bom-ref"]]);
    const npmDependency = cyclonedx.dependencies.find(({ ref }) => ref === partitionSummary.npmRef);
    assert.deepEqual(npmDependency.dependsOn, [runtimeScopedComponent["bom-ref"]]);
    assert.ok(!npmDependency.dependsOn.includes(runtimeComponent("prod-a")["bom-ref"]), "an installed runtime package that npm does not declare must not be emitted as a direct npm dependency");

    const spdxRoot = spdx.packages.find(({ SPDXID }) => SPDXID === "SPDXRef-RootPackage");
    const spdxNode = spdx.packages.find(({ SPDXID }) => SPDXID === "SPDXRef-BundledNodeRuntime");
    assert.equal(spdxRoot.licenseDeclared, "GPL-2.0-only");
    assert.equal(spdxRoot.licenseConcluded, "GPL-2.0-only");
    assert.equal(spdxNode.versionInfo, "26.8.1");
    assert.equal(spdxNode.licenseDeclared, "MIT");
    assert.deepEqual(spdxNode.checksums, [{ algorithm: "SHA256", checksumValue: runtimeHash }]);
    assert.ok(spdx.relationships.some(({ spdxElementId, relationshipType, relatedSpdxElement }) => spdxElementId === "SPDXRef-RootPackage" && relationshipType === "DEPENDS_ON" && relatedSpdxElement === "SPDXRef-BundledNodeRuntime"));
    assert.equal(spdx.packages.filter(({ name }) => name === "prod-a").length, 2);
    assert.ok(spdx.relationships.some(({ spdxElementId, relationshipType }) => spdxElementId === "SPDXRef-BundledNodeRuntime" && relationshipType === "CONTAINS"));
    const npmSpdxId = spdx.packages.find(({ name }) => name === "npm").SPDXID;
    const agentSpdxId = spdx.packages.find(({ name }) => name === "@npmcli/agent").SPDXID;
    const prodASpdxId = spdx.packages.find(({ name, externalRefs }) => name === "prod-a" && externalRefs.some(({ referenceType, referenceLocator }) => referenceType === "blockwright-distribution-partition" && referenceLocator === sbomPartitions.runtimeNpm)).SPDXID;
    assert.ok(spdx.relationships.some(({ spdxElementId, relationshipType, relatedSpdxElement }) => spdxElementId === npmSpdxId && relationshipType === "DEPENDS_ON" && relatedSpdxElement === agentSpdxId));
    assert.ok(!spdx.relationships.some(({ spdxElementId, relationshipType, relatedSpdxElement }) => spdxElementId === npmSpdxId && relationshipType === "DEPENDS_ON" && relatedSpdxElement === prodASpdxId));

    const duplicatePartition = structuredClone(cyclonedx);
    duplicatePartition.components.find(({ name }) => name === "prod-a").properties[0].value += `,${sbomPartitions.application}`;
    assert.throws(() => validateSbomPartitions({ cyclonedx: duplicatePartition, spdx, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: "node", runtimeVersion: "26.8.1" }), /invalid distribution partition/);
    const duplicateDependency = structuredClone(cyclonedx);
    duplicateDependency.dependencies.push(structuredClone(duplicateDependency.dependencies[0]));
    assert.throws(() => validateSbomPartitions({ cyclonedx: duplicateDependency, spdx, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: "node", runtimeVersion: "26.8.1" }), /duplicate ref records/);
    const duplicateTarget = structuredClone(cyclonedx);
    duplicateTarget.dependencies[0].dependsOn.push(duplicateTarget.dependencies[0].dependsOn[0]);
    assert.throws(() => validateSbomPartitions({ cyclonedx: duplicateTarget, spdx, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: "node", runtimeVersion: "26.8.1" }), /duplicate or invalid targets/);
    const duplicateRoot = structuredClone(spdx);
    duplicateRoot.packages.push(structuredClone(duplicateRoot.packages.find(({ SPDXID }) => SPDXID === "SPDXRef-RootPackage")));
    assert.throws(() => validateSbomPartitions({ cyclonedx, spdx: duplicateRoot, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: "node", runtimeVersion: "26.8.1" }), /exactly one root package/);
    assert.throws(() => createSboms({ applicationPackages, name: "blockwright", version: "0.6.0", bundledRuntime: { name: "node", version: "26.8.1", source: runtimeUrl, archiveSha256: runtimeHash } }), /requires the installed runtime npm package tree/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  assert.match(builder, /inventoryFromInstalledTree\(resolve\(stageRoot, "app", "node_modules"\), \{ rootManifest: stagedApplicationManifest \}\)/);
  assert.match(builder, /inventoryFromInstalledTree\(resolve\(stageRoot, "runtime", "node", "node_modules"\)\)/);
  assert.match(builder, /applicationInventory,[\s\S]+runtimeNpmInventory,/);
  assert.doesNotMatch(builder, /createSboms\(\{\s*lock/);
});

test("standalone SBOM generation requires and inventories an exact staged runtime tree", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-staged-sbom-"));
  const stage = resolve(temporary, "stage");
  const output = resolve(temporary, "output");
  const config = readReleaseConfig();
  try {
    assert.equal(process.version, `v${config.runtime.version}`, "release SBOM integration tests require the pinned Node runtime version");
    writeFixtureJson(stage, "app/package.json", { name: "blockwright", version: "0.6.0", license: "GPL-2.0-only", dependencies: { "@scope/app": "1.0.0" } });
    writeFixtureJson(stage, "app/node_modules/@scope/app/package.json", { name: "@scope/app", version: "1.0.0", license: "MIT" });
    const stagedNode = resolve(stage, "runtime", "node", "node.exe");
    mkdirSync(dirname(stagedNode), { recursive: true });
    copyFileSync(process.execPath, stagedNode);
    writeFixtureFile(stage, "runtime/node/LICENSE", "Node.js test license fixture\n");
    writeFixtureFile(stage, "runtime/node/npm.cmd", '@echo off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\npm\\bin\\npm-cli.js" %*\r\n');
    writeFixtureJson(stage, "runtime/node/node_modules/npm/package.json", { name: "npm", version: "11.19.0", license: "Artistic-2.0", dependencies: { "@npmcli/agent": "4.0.2" } });
    writeFixtureFile(stage, "runtime/node/node_modules/npm/LICENSE", "npm test license fixture\n");
    writeFixtureFile(stage, "runtime/node/node_modules/npm/bin/npm-cli.js", 'console.log("11.19.0");\n');
    writeFixtureJson(stage, "runtime/node/node_modules/npm/node_modules/@npmcli/agent/package.json", { name: "@npmcli/agent", version: "4.0.2", license: "ISC" });
    writeFixtureJson(stage, "release-manifest.json", {
      schemaVersion: 1,
      version: "0.6.0",
      packagedRuntime: { name: config.runtime.name, version: config.runtime.version, source: config.runtime.url, archiveSha256: config.runtime.sha256, private: true },
    });
    const generator = resolve(repositoryRoot, "scripts", "release", "generate-sbom.mjs");
    const missingStage = spawnSync(process.execPath, [generator], { encoding: "utf8" });
    assert.notEqual(missingStage.status, 0);
    assert.match(missingStage.stderr, /requires --stage-root/);
    const generated = spawnSync(process.execPath, [generator, "--stage-root", stage, "--out-dir", output], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const cyclonedx = JSON.parse(readFileSync(resolve(output, "blockwright-0.6.0-cyclonedx.json"), "utf8"));
    const spdx = JSON.parse(readFileSync(resolve(output, "blockwright-0.6.0-spdx.json"), "utf8"));
    const summary = validateSbomPartitions({ cyclonedx, spdx, rootName: "blockwright", rootVersion: "0.6.0", runtimeName: config.runtime.name, runtimeVersion: config.runtime.version });
    assert.deepEqual(summary.applicationPurls, ["pkg:npm/%40scope/app@1.0.0"]);
    assert.deepEqual(summary.directApplicationPurls, ["pkg:npm/%40scope/app@1.0.0"]);
    assert.deepEqual(summary.runtimeNpmPurls, ["pkg:npm/%40npmcli/agent@4.0.2", "pkg:npm/npm@11.19.0"]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("staged runtime version probes are bounded and fail closed", () => {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 0, stdout: "v26.8.1\n", stderr: "" };
  };
  assert.equal(probeExecutableVersion({ executable: "node.exe", args: ["--version"], expected: "v26.8.1", label: "Node", spawnProcess, timeoutMs: 3210 }), "v26.8.1");
  assert.equal(calls[0].options.timeout, 3210);
  assert.equal(calls[0].options.maxBuffer, 1_048_576);
  assert.throws(() => probeExecutableVersion({ executable: "node.exe", args: ["--version"], expected: "v26.8.1", label: "Node", spawnProcess: () => ({ error: new Error("timed out"), status: null }), timeoutMs: 10 }), /within 10 ms: timed out/);
  assert.throws(() => probeExecutableVersion({ executable: "node.exe", args: ["--version"], expected: "v26.8.1", label: "Node", spawnProcess: () => ({ status: 0, stdout: "v99.0.0\n", stderr: "" }) }), /version mismatch/);
});
