import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertChildPath,
  createSboms,
  normalizeSha256,
  normalizeThumbprint,
  parseChecksums,
  packagesFromLock,
  readReleaseConfig,
  repositoryRoot,
  semverFromTag,
  writeChecksums,
} from "./release-lib.mjs";
import { assertNoRedistributionRestrictedResourceArchives } from "./resource-archive-policy.mjs";

test("release configuration primitives fail closed", () => {
  assert.equal(semverFromTag("v0.6.0"), "0.6.0");
  assert.throws(() => semverFromTag("v0.6.0-rc.1"), /semantic version/);
  assert.throws(() => semverFromTag("latest"), /semantic version/);
  assert.equal(normalizeSha256("A".repeat(64)), "a".repeat(64));
  assert.equal(normalizeThumbprint("aa bb cc dd ee ff 00 11 22 33 44 55 66 77 88 99 aa bb cc dd"), "AABBCCDDEEFF00112233445566778899AABBCCDD");
  assert.throws(() => normalizeThumbprint("unsigned"), /invalid/);
  const releaseConfig = readReleaseConfig();
  assert.equal(releaseConfig.runtime.sizeBytes, 41368195);
  assert.ok(releaseConfig.runtime.maxSizeBytes >= releaseConfig.runtime.sizeBytes);
  assert.ok(releaseConfig.runtime.timeoutSeconds > 0);
  assert.equal(releaseConfig.innoSetup.version, "6.7.1");
  assert.equal(releaseConfig.innoSetup.sizeBytes, 10619024);
  assert.equal(releaseConfig.innoSetup.sha256, "4d11e8050b6185e0d49bd9e8cc661a7a59f44959a621d31d11033124c4e8a7b0");
  assert.equal(releaseConfig.innoSetup.compilerSizeBytes, 1455248);
  assert.equal(releaseConfig.innoSetup.compilerSha256, "eb6f4410c8db367a5f74127e8025ad2ccacc0afabbe783959d237df3050f97fb");
  assert.equal(releaseConfig.innoSetup.publisherThumbprint, "E0AB19C8D38CBF9C44709925122A7A02F8C70CB7");
});

test("child path guard rejects equality and traversal", () => {
  const root = resolve(tmpdir(), "blockwright-release-guard");
  assert.equal(assertChildPath(root, resolve(root, "child")), resolve(root, "child"));
  assert.throws(() => assertChildPath(root, root), /must be a child/);
  assert.throws(() => assertChildPath(root, resolve(root, "..", "outside")), /must be a child/);
});

test("SBOM generation deduplicates lockfile package identities", () => {
  const lock = { packages: {
    "node_modules/example": { version: "1.2.3", license: "MIT" },
    "node_modules/nested/node_modules/example": { version: "1.2.3", license: "MIT" },
    "node_modules/@scope/tool": { version: "4.5.6", license: "Apache-2.0" },
  } };
  assert.equal(packagesFromLock(lock).length, 2);
  const { cyclonedx, spdx } = createSboms({ lock, name: "blockwright", version: "0.6.0" });
  assert.equal(cyclonedx.bomFormat, "CycloneDX");
  assert.equal(cyclonedx.components.length, 2);
  assert.equal(spdx.spdxVersion, "SPDX-2.3");
  assert.equal(spdx.packages.length, 3);
});

test("checksums round-trip and reject malformed records", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "blockwright-release-test-"));
  try {
    const artifact = resolve(directory, "artifact.zip");
    writeFileSync(artifact, "release evidence", "utf8");
    const result = writeChecksums(directory, [artifact]);
    const parsed = parseChecksums(readFileSync(result.output, "utf8"));
    assert.equal(parsed.size, 1);
    assert.match(parsed.get("artifact.zip"), /^[a-f0-9]{64}$/);
    assert.throws(() => parseChecksums("not-a-checksum artifact.zip"), /Invalid checksum/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signed release workflow is manual-only and cannot auto-run on an unsigned tag", () => {
  const workflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-release.yml"), "utf8");
  const triggerBlock = workflow.match(/^on:\r?\n([\s\S]*?)^permissions:/m);
  assert.ok(triggerBlock, "Windows release workflow must have a bounded trigger block");
  const triggers = [...triggerBlock[1].matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(triggers, ["workflow_dispatch"]);
  assert.match(triggerBlock[1], /release_tag:[\s\S]+required: true[\s\S]+type: string/);
  assert.doesNotMatch(triggerBlock[1], /^ {2}push:/m);
  assert.doesNotMatch(triggerBlock[1], /tags:\s*\[?\s*["']?v\*/);
  assert.match(workflow, /REQUESTED_TAG: \$\{\{ inputs\.release_tag \}\}[\s\S]+\$tag = \(\[string\]\$env:REQUESTED_TAG\)\.Trim\(\)/);
  assert.doesNotMatch(workflow, /github\.(?:event_name|ref_name)|EVENT_(?:NAME|REF_NAME)/);
});

test("Windows lifecycle pull-request triggers cover every staged payload and build input", () => {
  const workflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-installer-ci.yml"), "utf8");
  for (const path of [
    ".codex-plugin/**",
    ".mcp.json",
    "alpic.json",
    "app/**",
    "assets/github/**",
    "data/java/**",
    "installer/windows/**",
    "LICENSE",
    "mcp/**",
    "package.json",
    "package-lock.json",
    "README.md",
    "scripts/benchmark-v060.ts",
    "scripts/diagnose.mjs",
    "scripts/package-plugin.mjs",
    "scripts/release/**",
    "scripts/windows/**",
    "skills/**",
    "src/**",
    "standalone/**",
    "tsconfig.json",
    "vite.config.ts",
    "vite.standalone.config.ts",
  ]) {
    assert.ok(workflow.includes(`- "${path}"`), `Windows lifecycle trigger is missing ${path}`);
  }
});

test("public release workflow binds a qualified tag and requires artifact provenance", () => {
  const workflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-release.yml"), "utf8");
  const publishWorkflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-publish-release.yml"), "utf8");
  assert.match(workflow, /validate-release-ref:[\s\S]+qualified_ref:[\s\S]+refs\/tags\/\$tag/);
  assert.match(workflow, /rev-parse "\$env:QUALIFIED_REF\^\{commit\}"/);
  assert.match(workflow, /rev-parse "FETCH_HEAD\^\{commit\}"/);
  assert.match(workflow, /TRIGGER_REF: \$\{\{ github\.ref \}\}[\s\S]+TRIGGER_SHA: \$\{\{ github\.sha \}\}[\s\S]+\$env:TRIGGER_REF -ne \$env:QUALIFIED_REF[\s\S]+\$triggerCommit -ne \$headCommit/);
  assert.match(workflow, /needs: validate-release-ref[\s\S]+environment: windows-signing/);
  assert.match(workflow, /concurrency:[\s\S]+group: windows-release-\$\{\{ needs\.validate-release-ref\.outputs\.release_tag \}\}[\s\S]+cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /ref:\s*\$\{\{[^\n]*inputs\.release_tag/);
  assert.match(workflow, /actions\/attest@[a-f0-9]{40}/);
  assert.match(workflow, /--require-github-attestation/);
  assert.match(workflow, /--source-digest \$env:RELEASE_COMMIT --source-ref \$env:RELEASE_REF/);
  assert.match(workflow, /Create draft GitHub release[\s\S]+git fetch --force --no-recurse-submodules origin \$env:QUALIFIED_REF[\s\S]+rev-parse "FETCH_HEAD\^\{commit\}"[\s\S]+\$fetchedCommit -ne \$env:EXPECTED_COMMIT/);
  assert.match(workflow, /gh release create \$tag --verify-tag --draft[\s\S]+\$releaseId = \[long\]\$draft\.id[\s\S]+uploads\.github\.com[\s\S]+releases\/\$releaseId\/assets/);
  assert.match(workflow, /catch \{[\s\S]+Remove-CandidateDraft -ReleaseId \$releaseId[\s\S]+Remove-MarkedCandidateDraft -Tag \$tag -Marker \$runMarker/);
  assert.ok(workflow.includes('$uploadEndpoint = "https://uploads.github.com/repos/$env:RELEASE_REPOSITORY/releases/$releaseId/assets?name=$encodedName"'));
  assert.doesNotMatch(workflow, /--hostname uploads\.github\.com/);
  assert.match(workflow, /git fetch --force --no-recurse-submodules origin \$env:QUALIFIED_REF[\s\S]+\$postCreateFetchedCommit -ne \$env:EXPECTED_COMMIT/);
  assert.doesNotMatch(workflow, /gh release create[^\n]+release\\windows/);
  assert.doesNotMatch(workflow, /gh release create[^\n]+--target/);
  assert.match(workflow, /npm test[\s\S]+if \(\$LASTEXITCODE -ne 0\)[\s\S]+npm run benchmark:v060[\s\S]+if \(\$LASTEXITCODE -ne 0\)/);
  assert.doesNotMatch(workflow, /draft\s*=\s*\$false|--draft=false/);
  assert.match(publishWorkflow, /workflow_dispatch:[\s\S]+release_id:[\s\S]+release_tag:[\s\S]+release_commit:/);
  assert.match(publishWorkflow, /environment: windows-release-publish/);
  assert.match(publishWorkflow, /publish-exact-draft:[\s\S]+ref: \$\{\{ needs\.validate-publish-boundary\.outputs\.release_commit \}\}/);
  assert.match(publishWorkflow, /TRIGGER_REF: \$\{\{ github\.ref \}\}[\s\S]+TRIGGER_SHA: \$\{\{ github\.sha \}\}[\s\S]+\$env:TRIGGER_REF -ne \$env:QUALIFIED_REF/);
  assert.match(publishWorkflow, /Get-ExactRelease -ReleaseId \$releaseId[\s\S]+gh release download \$tag[\s\S]+--require-signed --require-github-attestation/);
  assert.match(publishWorkflow, /git rev-parse HEAD[\s\S]+git fetch --force --no-recurse-submodules origin \$env:QUALIFIED_REF[\s\S]+refusing to execute repository release verification[\s\S]+node scripts\/release\/verify-release\.mjs/);
  assert.match(publishWorkflow, /Get-AssetFingerprint -Release \$unchangedDraft[\s\S]+git fetch --force --no-recurse-submodules origin \$env:QUALIFIED_REF[\s\S]+rev-parse "FETCH_HEAD\^\{commit\}"/);
  assert.match(publishWorkflow, /\$publishBody \| gh api --method PATCH "repos\/\$env:RELEASE_REPOSITORY\/releases\/\$releaseId" --input -/);
  assert.doesNotMatch(publishWorkflow, /^\s+push:/m);
});

test("Windows workflows acquire and invoke only the byte-pinned Inno toolchain", () => {
  const releaseWorkflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-release.yml"), "utf8");
  const lifecycleWorkflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-installer-ci.yml"), "utf8");
  const workflows = `${releaseWorkflow}\n${lifecycleWorkflow}`;
  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  const acquisition = readFileSync(resolve(repositoryRoot, "scripts", "release", "Install-PinnedInnoSetup.ps1"), "utf8");
  const compilerWrapper = readFileSync(resolve(repositoryRoot, "scripts", "release", "Invoke-PinnedInnoCompile.ps1"), "utf8");
  assert.doesNotMatch(workflows, /choco(?:latey)?\s+install\s+innosetup/i);
  assert.match(releaseWorkflow, /Install-PinnedInnoSetup\.ps1/);
  assert.match(lifecycleWorkflow, /Install-PinnedInnoSetup\.ps1/);
  assert.match(lifecycleWorkflow, /Invoke-PinnedInnoCompile\.ps1/);
  assert.match(builder, /Invoke-PinnedInnoCompile\.ps1/);
  assert.doesNotMatch(builder, /run\(isccPath/);
  for (const required of ["SHA256", "Get-AuthenticodeSignature", "publisherThumbprint", "publisherSubject", "ExpectedBytes", "maxSizeBytes", "timeoutSeconds", "InfiniteTimeSpan"]) {
    assert.match(acquisition, new RegExp(required));
  }
  assert.match(compilerWrapper, /Test-PinnedInnoSetup\.ps1/);
  assert.match(compilerWrapper, /& \$resolvedCompiler/);
  assert.doesNotMatch(acquisition, /\[string\]\$ConfigPath/);
  assert.doesNotMatch(compilerWrapper, /\[string\]\$ConfigPath/);
});

test("installer never elevates and validates lifecycle-only root overrides before execution", () => {
  const installer = readFileSync(resolve(repositoryRoot, "installer", "windows", "Blockwright.iss"), "utf8");
  assert.match(installer, /^PrivilegesRequired=lowest$/m);
  assert.doesNotMatch(installer, /^PrivilegesRequiredOverridesAllowed=/m);
  assert.match(installer, /^SetupIconFile=assets\\blockwright-v060\.ico$/m);
  assert.match(installer, /^UninstallDisplayIcon=\{app\}\\assets\\blockwright-v060\.ico$/m);
  assert.doesNotMatch(installer, /^\[UninstallRun\]$/m);
  assert.match(installer, /GetValidatedLifecycleTestRoot[\s\S]+ExpandFileName\(RawValue\)/);
  assert.match(installer, /TemporaryRoot := RemoveBackslashUnlessRoot\(ExpandFileName\(GetTempDir\)\)/);
  assert.match(installer, /Pos\('"', RawValue\)[\s\S]+Pos\(#13, RawValue\)[\s\S]+Pos\(#10, RawValue\)/);
  assert.match(installer, /Blockwright Installer Lifecycle [\s\S]+Length\(Suffix\) <> 32[\s\S]+IsHexCharacter/);
  assert.match(installer, /GetValidatedLifecycleTestRoot\('BLOCKWRIGHT_INSTALLER_TEST_STATE_ROOT', 'state'\)/);
  assert.match(installer, /GetValidatedLifecycleTestRoot\('BLOCKWRIGHT_INSTALLER_TEST_ROAMING_ROOT', 'roaming'\)/);
  const codexRemoval = installer.indexOf("Register-BlockwrightCodex.ps1");
  const associationRemoval = installer.indexOf("Set-BlockwrightSchematicAssociation.ps1", codexRemoval + 1);
  const stateRemoval = installer.indexOf("Remove-BlockwrightOwnedState.ps1", associationRemoval + 1);
  assert.ok(codexRemoval >= 0 && associationRemoval > codexRemoval && stateRemoval > associationRemoval);
});

test("Windows release staging refuses redistribution-restricted Minecraft resource archives", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "blockwright-windows-commercial-boundary-"));
  try {
    const nested = resolve(temporary, "app", "data", "java");
    mkdirSync(nested, { recursive: true });
    assert.doesNotThrow(() => assertNoRedistributionRestrictedResourceArchives(temporary));
    writeFileSync(resolve(nested, "26.2-VANILLA-RESOURCES.ZIP"), "derived Mojang resources");
    assert.throws(
      () => assertNoRedistributionRestrictedResourceArchives(temporary),
      /Windows distribution staging refused redistribution-restricted.*26\.2-VANILLA-RESOURCES\.ZIP/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const builder = readFileSync(resolve(repositoryRoot, "scripts", "release", "build-windows-release.mjs"), "utf8");
  assert.match(builder, /assertNoRedistributionRestrictedResourceArchives\(stageRoot\)/);
});
