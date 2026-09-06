import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createSboms, readJson, readReleaseConfig, repositoryRoot, sha256File, writeChecksums, writeJson } from "./release-lib.mjs";
import { verifyReleaseEvidence } from "./verify-release.mjs";

const signedRepository = "gildaltar/Blockwright";
const signedSourceRef = "refs/tags/v0.6.0";
const signedThumbprint = "A".repeat(40);
const signedSubject = "CN=Blockwright Release Signing";
const timestampSubject = "CN=Blockwright Timestamp Authority";
const launcherHash = "e".repeat(64);

function createUnsignedFixture(releaseDirectoryName = "release") {
  const root = mkdtempSync(resolve(tmpdir(), "blockwright-verify-unsigned-"));
  const directory = resolve(root, releaseDirectoryName);
  const packagePath = resolve(root, "package.json");
  const version = "0.6.0";
  const config = readReleaseConfig();
  const names = {
    installer: `Blockwright-${version}-windows-x64-setup.exe`,
    portable: `Blockwright-${version}-windows-x64-portable.zip`,
    cyclonedx: `blockwright-${version}-cyclonedx.json`,
    spdx: `blockwright-${version}-spdx.json`,
    status: `blockwright-${version}-signature-status.json`,
  };
  mkdirSync(directory, { recursive: true });
  writeJson(packagePath, { name: "blockwright", version, license: "GPL-2.0-only" });
  writeFileSync(resolve(directory, names.installer), "unsigned installer fixture", "utf8");
  writeFileSync(resolve(directory, names.portable), "portable fixture", "utf8");
  const { cyclonedx, spdx } = createSboms({
    applicationPackages: [{ name: "production-only", version: "1.0.0", license: "MIT", path: "node_modules/production-only" }],
    runtimeNpmPackages: [
      { name: "npm", version: "11.19.0", license: "Artistic-2.0" },
      { name: "@scope/runtime-tool", version: "2.0.0", license: "MIT" },
    ],
    name: "blockwright",
    version,
    license: "GPL-2.0-only",
    bundledRuntime: { name: config.runtime.name, version: config.runtime.version, source: config.runtime.url, archiveSha256: config.runtime.sha256, license: "MIT" },
    bundledLauncher: { name: "Blockwright Windows Launcher", version, sha256: launcherHash, license: "GPL-2.0-only", path: "Blockwright.exe" },
  });
  writeJson(resolve(directory, names.cyclonedx), cyclonedx);
  writeJson(resolve(directory, names.spdx), spdx);
  const status = {
    schemaVersion: 1,
    version,
    generatedAt: "2026-09-05T00:00:00.000Z",
    status: "unsigned",
    satisfiesSignedReleaseGate: false,
    reason: "No signing identity was supplied.",
    artifacts: [
      { file: names.portable, sha256: sha256File(resolve(directory, names.portable)), authenticode: "not-applicable" },
      { file: names.installer, sha256: sha256File(resolve(directory, names.installer)), authenticode: "not-signed" },
    ],
    embeddedArtifacts: [{ file: "Blockwright.exe", container: names.portable, sha256: launcherHash, authenticode: "not-signed", signerThumbprint: null }],
  };
  writeJson(resolve(directory, names.status), status);
  const artifactPaths = Object.values(names).map((name) => resolve(directory, name));
  writeChecksums(directory, artifactPaths);
  return { root, directory, packagePath, names, status, artifactPaths };
}

function rewriteEvidence(fixture, name, value) {
  writeJson(resolve(fixture.directory, name), value);
  writeChecksums(fixture.directory, fixture.artifactPaths);
}

function verifyUnsigned(fixture, authenticodeStatus = "NotSigned") {
  const calls = [];
  const result = verifyReleaseEvidence({
    directory: fixture.directory,
    packagePath: fixture.packagePath,
    platform: "win32",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      if (args.some((value) => String(value).endsWith("Test-BlockwrightPortableLauncher.ps1"))) {
        return { status: 0, stdout: `${JSON.stringify({ sha256: launcherHash, authenticode: "not-signed" })}\n`, stderr: "" };
      }
      return { status: 0, stdout: `${authenticodeStatus}\n`, stderr: "" };
    },
  });
  return { result, calls };
}

function createSignedFixture() {
  const fixture = createUnsignedFixture();
  const installerPath = resolve(fixture.directory, fixture.names.installer);
  const installerHash = sha256File(installerPath);
  const proofPath = resolve(fixture.directory, "authenticode-proof.json");
  const updatePath = resolve(fixture.directory, "latest.json");
  const statusPath = resolve(fixture.directory, fixture.names.status);
  const proof = {
    schemaVersion: 1,
    file: fixture.names.installer,
    sha256: installerHash,
    status: "Valid",
    signerThumbprint: signedThumbprint,
    signerSubject: signedSubject,
    timestampCertificateSubject: timestampSubject,
    launcher: {
      file: "Blockwright.exe",
      container: fixture.names.portable,
      sha256: launcherHash,
      status: "Valid",
      signerThumbprint: signedThumbprint,
      signerSubject: signedSubject,
      timestampCertificateSubject: timestampSubject,
    },
  };
  const update = {
    schemaVersion: 1,
    product: "Blockwright",
    version: "0.6.0",
    publishedAt: "2026-09-05T00:00:00.000Z",
    artifact: {
      file: fixture.names.installer,
      url: `https://github.com/${signedRepository}/releases/download/v0.6.0/${fixture.names.installer}`,
      sha256: installerHash,
      sizeBytes: statSync(installerPath).size,
      signature: { required: true, status: "signed", signerThumbprint: signedThumbprint },
    },
  };
  const status = {
    schemaVersion: 1,
    version: "0.6.0",
    generatedAt: "2026-09-05T00:00:00.000Z",
    status: "signed",
    satisfiesSignedReleaseGate: true,
    artifacts: [{
      file: fixture.names.installer,
      sha256: installerHash,
      authenticode: "valid",
      signerThumbprint: signedThumbprint,
    }],
    embeddedArtifacts: [{ file: "Blockwright.exe", container: fixture.names.portable, sha256: launcherHash, authenticode: "valid", signerThumbprint: signedThumbprint }],
  };
  writeJson(proofPath, proof);
  writeJson(updatePath, update);
  writeJson(statusPath, status);
  const signedArtifactPaths = [...fixture.artifactPaths, proofPath, updatePath];
  writeChecksums(fixture.directory, signedArtifactPaths);
  return { ...fixture, proof, proofPath, update, updatePath, signedStatus: status, statusPath, signedArtifactPaths };
}

function rewriteSignedJson(fixture, path, value) {
  writeJson(path, value);
  writeChecksums(fixture.directory, fixture.signedArtifactPaths);
}

function verifySigned(fixture, {
  requireSigned = true,
  requireGitHubAttestation = false,
  expectedThumbprint = signedThumbprint,
  actualThumbprint = signedThumbprint,
  actualSignerSubject = signedSubject,
  actualTimestampSubject = timestampSubject,
  actualOutput,
  sourceDigest = "c".repeat(40),
  spawnResult,
} = {}) {
  const calls = [];
  const result = verifyReleaseEvidence({
    directory: fixture.directory,
    packagePath: fixture.packagePath,
    requireSigned,
    requireGitHubAttestation,
    platform: "win32",
    repository: signedRepository,
    sourceDigest,
    sourceRef: signedSourceRef,
    expectedThumbprint,
    spawnProcess(command, args, options) {
      const call = { command, args, options };
      calls.push(call);
      const overridden = spawnResult?.(call);
      if (overridden) return overridden;
      if (command === "gh") return { status: 0, stdout: "verified\n", stderr: "" };
      if (args.some((value) => String(value).endsWith("Test-BlockwrightPortableLauncher.ps1"))) {
        return { status: 0, stdout: `${JSON.stringify({ sha256: launcherHash, authenticode: "valid", signerThumbprint: actualThumbprint })}\n`, stderr: "" };
      }
      return {
        status: 0,
        stdout: actualOutput ?? `${JSON.stringify({
          status: "Valid",
          thumbprint: actualThumbprint,
          signerSubject: actualSignerSubject,
          timestampCertificateSubject: actualTimestampSubject,
        })}\n`,
        stderr: "",
      };
    },
  });
  return { result, calls };
}

test("unsigned release evidence binds package version, exact artifacts, hashes, SBOMs, and real NotSigned status", () => {
  const fixture = createUnsignedFixture();
  try {
    const { result, calls } = verifyUnsigned(fixture);
    assert.deepEqual(result, { directory: fixture.directory, files: 5, assets: 6, status: "unsigned", version: "0.6.0" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "powershell.exe");
    assert.match(calls[0].args.join(" "), /Get-AuthenticodeSignature/);
    assert.equal(calls[0].options.env.BLOCKWRIGHT_AUTHENTICODE_ARTIFACT, resolve(fixture.directory, fixture.names.installer));
    assert.match(calls[1].args.join(" "), /Test-BlockwrightPortableLauncher\.ps1/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Windows Authenticode subprocess treats an installer path with spaces as literal data", { skip: process.platform !== "win32" }, () => {
  const fixture = createUnsignedFixture("release path with spaces");
  try {
    const installerPath = resolve(fixture.directory, fixture.names.installer);
    rmSync(installerPath, { force: true });
    const compile = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -TypeDefinition 'public static class Program { public static void Main() {} }' -OutputType ConsoleApplication -OutputAssembly $env:BLOCKWRIGHT_TEST_UNSIGNED_EXE",
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, BLOCKWRIGHT_TEST_UNSIGNED_EXE: installerPath },
    });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    fixture.status.artifacts.find(({ file }) => file === fixture.names.installer).sha256 = sha256File(installerPath);
    rewriteEvidence(fixture, fixture.names.status, fixture.status);
    const result = verifyReleaseEvidence({
      directory: fixture.directory,
      packagePath: fixture.packagePath,
      platform: "win32",
      spawnProcess(command, args, options) {
        if (args.some((value) => String(value).endsWith("Test-BlockwrightPortableLauncher.ps1"))) {
          return { status: 0, stdout: `${JSON.stringify({ sha256: launcherHash, authenticode: "not-signed" })}\n`, stderr: "" };
        }
        return spawnSync(command, args, options);
      },
    });
    assert.equal(result.status, "unsigned");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("signed workflow evidence remains valid when proof and update metadata are checksummed", () => {
  const fixture = createSignedFixture();
  try {
    const { result, calls } = verifySigned(fixture);
    assert.deepEqual(result, { directory: fixture.directory, files: 7, assets: 8, status: "signed", version: "0.6.0" });
    assert.equal(calls.length, 2);
    assert.match(calls[0].args.join(" "), /TimeStamperCertificate/);
    assert.match(calls[1].args.join(" "), /Test-BlockwrightPortableLauncher\.ps1/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("signed GitHub provenance covers every checksummed candidate plus SHA256SUMS with exact policy arguments", () => {
  const fixture = createSignedFixture();
  try {
    const sourceDigest = "d".repeat(40);
    const { result, calls } = verifySigned(fixture, { requireGitHubAttestation: true, sourceDigest });
    assert.deepEqual(result, { directory: fixture.directory, files: 7, assets: 8, status: "signed", version: "0.6.0" });
    assert.equal(calls.length, 10);
    assert.equal(calls[0].command, "powershell.exe");
    assert.match(calls[1].args.join(" "), /Test-BlockwrightPortableLauncher\.ps1/);
    const attestationCalls = calls.slice(2);
    assert.ok(attestationCalls.every(({ command }) => command === "gh"));
    const expectedSubjects = [...fixture.signedArtifactPaths, resolve(fixture.directory, "SHA256SUMS.txt")].sort();
    assert.deepEqual(attestationCalls.map(({ args }) => args[2]).sort(), expectedSubjects);
    for (const { args } of attestationCalls) {
      assert.deepEqual(args.slice(0, 2), ["attestation", "verify"]);
      assert.deepEqual(args.slice(3), [
        "--repo", signedRepository,
        "--signer-workflow", `${signedRepository}/.github/workflows/windows-release.yml`,
        "--source-digest", sourceDigest,
        "--source-ref", signedSourceRef,
        "--deny-self-hosted-runners",
      ]);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GitHub provenance requires the signed gate and propagates CLI failures", async (context) => {
  await context.test("requires --require-signed", () => {
    const fixture = createSignedFixture();
    try {
      assert.throws(
        () => verifySigned(fixture, { requireSigned: false, requireGitHubAttestation: true }),
        /also requires --require-signed/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("propagates a GitHub CLI command error", () => {
    const fixture = createSignedFixture();
    try {
      assert.throws(
        () => verifySigned(fixture, {
          requireGitHubAttestation: true,
          spawnResult({ command }) {
            return command === "gh" ? { status: null, stdout: "", stderr: "", error: new Error("gh unavailable") } : null;
          },
        }),
        /GitHub CLI could not verify provenance.*gh unavailable/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("propagates a nonzero GitHub CLI result", () => {
    const fixture = createSignedFixture();
    try {
      assert.throws(
        () => verifySigned(fixture, {
          requireGitHubAttestation: true,
          spawnResult({ command }) {
            return command === "gh" ? { status: 1, stdout: "", stderr: "attestation rejected" } : null;
          },
        }),
        /GitHub provenance verification failed.*attestation rejected/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("signed workflow rejects an extra checksummed candidate that a publish glob would capture", () => {
  const fixture = createSignedFixture();
  try {
    const stalePath = resolve(fixture.directory, "stale-release.json");
    writeJson(stalePath, { stale: true });
    writeChecksums(fixture.directory, [...fixture.signedArtifactPaths, stalePath]);
    assert.throws(
      () => verifySigned(fixture),
      /Signed checksum evidence.*stale-release\.json/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("signed verifier rejects malformed or unbound proof and update metadata", async (context) => {
  const cases = [
    {
      name: "proof schema drift",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.proofPath, { ...fixture.proof, schemaVersion: 2 }); },
      error: /Authenticode proof must use schemaVersion 1/,
    },
    {
      name: "proof hash drift",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.proofPath, { ...fixture.proof, sha256: "b".repeat(64) }); },
      error: /Authenticode proof hash does not match/,
    },
    {
      name: "missing timestamp proof",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.proofPath, { ...fixture.proof, timestampCertificateSubject: null }); },
      error: /timestamp certificate subject must be a non-empty string/,
    },
    {
      name: "update version drift",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.updatePath, { ...fixture.update, version: "0.6.1" }); },
      error: /Update metadata version 0\.6\.1 does not match/,
    },
    {
      name: "update hash drift",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.updatePath, { ...fixture.update, artifact: { ...fixture.update.artifact, sha256: "c".repeat(64) } }); },
      error: /Update metadata hash does not match/,
    },
    {
      name: "update size drift",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.updatePath, { ...fixture.update, artifact: { ...fixture.update.artifact, sizeBytes: fixture.update.artifact.sizeBytes + 1 } }); },
      error: /Update metadata size does not match/,
    },
    {
      name: "update URL is not the exact tagged release",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.updatePath, { ...fixture.update, artifact: { ...fixture.update.artifact, url: `https://github.com/${signedRepository}/releases/latest/download/${fixture.names.installer}` } }); },
      error: /exact tagged HTTPS release URL/,
    },
  ];
  for (const value of cases) {
    await context.test(value.name, () => {
      const fixture = createSignedFixture();
      try {
        value.mutate(fixture);
        assert.throws(() => verifySigned(fixture), value.error);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("signed verifier requires one explicit signer identity across every evidence layer", async (context) => {
  const otherThumbprint = "B".repeat(40);
  const cases = [
    {
      name: "missing explicit expected thumbprint",
      mutate() {},
      verify(fixture) { return verifySigned(fixture, { expectedThumbprint: null }); },
      error: /--expected-thumbprint is missing or invalid/,
    },
    {
      name: "signature-status thumbprint mismatch",
      mutate(fixture) {
        const artifacts = fixture.signedStatus.artifacts.map((artifact) => ({ ...artifact, signerThumbprint: otherThumbprint }));
        rewriteSignedJson(fixture, fixture.statusPath, { ...fixture.signedStatus, artifacts });
      },
      error: /signature-status signer thumbprint does not match/,
    },
    {
      name: "proof thumbprint mismatch",
      mutate(fixture) { rewriteSignedJson(fixture, fixture.proofPath, { ...fixture.proof, signerThumbprint: otherThumbprint }); },
      error: /Authenticode proof signer thumbprint does not match/,
    },
    {
      name: "update thumbprint mismatch",
      mutate(fixture) {
        rewriteSignedJson(fixture, fixture.updatePath, {
          ...fixture.update,
          artifact: { ...fixture.update.artifact, signature: { ...fixture.update.artifact.signature, signerThumbprint: otherThumbprint } },
        });
      },
      error: /update metadata signer thumbprint does not match/,
    },
    {
      name: "actual Authenticode thumbprint mismatch",
      mutate() {},
      verify(fixture) { return verifySigned(fixture, { actualThumbprint: otherThumbprint }); },
      error: /Actual Authenticode signer thumbprint does not match/,
    },
    {
      name: "actual Authenticode output is not JSON",
      mutate() {},
      verify(fixture) { return verifySigned(fixture, { actualOutput: "not-json" }); },
      error: /Authenticode verification returned invalid JSON/,
    },
    {
      name: "actual timestamp subject mismatch",
      mutate() {},
      verify(fixture) { return verifySigned(fixture, { actualTimestampSubject: "CN=Different Timestamp Authority" }); },
      error: /timestamp certificate subject does not match authenticode-proof\.json/,
    },
  ];
  for (const value of cases) {
    await context.test(value.name, () => {
      const fixture = createSignedFixture();
      try {
        value.mutate(fixture);
        assert.throws(() => (value.verify ? value.verify(fixture) : verifySigned(fixture)), value.error);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("every signed verification workflow passes the protected expected thumbprint", () => {
  const releaseWorkflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-release.yml"), "utf8");
  const publishWorkflow = readFileSync(resolve(repositoryRoot, ".github", "workflows", "windows-publish-release.yml"), "utf8");
  const proofScript = readFileSync(resolve(repositoryRoot, "scripts", "release", "Test-BlockwrightAuthenticode.ps1"), "utf8");
  assert.equal((releaseWorkflow.match(/--expected-thumbprint \$env:SIGNING_THUMBPRINT/g) ?? []).length, 2);
  assert.equal((publishWorkflow.match(/--expected-thumbprint \$env:SIGNING_THUMBPRINT/g) ?? []).length, 1);
  assert.match(releaseWorkflow, /SIGNING_THUMBPRINT: \$\{\{ vars\.BLOCKWRIGHT_SIGNING_THUMBPRINT \}\}/);
  assert.match(publishWorkflow, /SIGNING_THUMBPRINT: \$\{\{ vars\.BLOCKWRIGHT_SIGNING_THUMBPRINT \}\}/);
  assert.match(proofScript, /missing required timestamp-certificate proof/);
});

test("unsigned verifier rejects schema, gate, artifact hash, version, and Authenticode inconsistencies", async (context) => {
  await context.test("wrong status schema", () => {
    const fixture = createUnsignedFixture();
    try {
      rewriteEvidence(fixture, fixture.names.status, { ...fixture.status, schemaVersion: 2 });
      assert.throws(() => verifyUnsigned(fixture), /schemaVersion 1/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("unsigned state claiming the signed gate", () => {
    const fixture = createUnsignedFixture();
    try {
      rewriteEvidence(fixture, fixture.names.status, { ...fixture.status, satisfiesSignedReleaseGate: true });
      assert.throws(() => verifyUnsigned(fixture), /satisfiesSignedReleaseGate to false/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("status artifact hash does not match exact distributable", () => {
    const fixture = createUnsignedFixture();
    try {
      const artifacts = fixture.status.artifacts.map((artifact) => artifact.file === fixture.names.installer ? { ...artifact, sha256: "b".repeat(64) } : artifact);
      rewriteEvidence(fixture, fixture.names.status, { ...fixture.status, artifacts });
      assert.throws(() => verifyUnsigned(fixture), /does not match SHA256SUMS\.txt/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("package version does not match release filenames", () => {
    const fixture = createUnsignedFixture();
    try {
      writeJson(fixture.packagePath, { name: "blockwright", version: "0.6.1", license: "GPL-2.0-only" });
      assert.throws(() => verifyUnsigned(fixture), /missing the exact Blockwright-0\.6\.1-windows-x64-setup\.exe/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("status omits the exact portable artifact", () => {
    const fixture = createUnsignedFixture();
    try {
      rewriteEvidence(fixture, fixture.names.status, { ...fixture.status, artifacts: fixture.status.artifacts.filter(({ file }) => file !== fixture.names.portable) });
      assert.throws(() => verifyUnsigned(fixture), /Unsigned signature-status artifacts.*portable\.zip/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("actual Authenticode state is not NotSigned", () => {
    const fixture = createUnsignedFixture();
    try {
      assert.throws(() => verifyUnsigned(fixture, "Valid"), /expected NotSigned; received Valid/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("unsigned verifier rejects stale signed-only evidence and incorrect SBOM root licensing", async (context) => {
  await context.test("unchecksummed stale signed metadata", () => {
    const fixture = createUnsignedFixture();
    try {
      writeJson(resolve(fixture.directory, "latest.json"), { schemaVersion: 1 });
      assert.throws(() => verifyUnsigned(fixture), /Top-level release candidate files versus SHA256SUMS\.txt.*latest\.json/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("unexpected checksummed signed metadata", () => {
    const fixture = createUnsignedFixture();
    try {
      const extra = resolve(fixture.directory, "latest.json");
      writeJson(extra, { schemaVersion: 1 });
      writeChecksums(fixture.directory, [...fixture.artifactPaths, extra]);
      assert.throws(() => verifyUnsigned(fixture), /Unsigned checksum evidence.*latest\.json/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("CycloneDX root license drift", () => {
    const fixture = createUnsignedFixture();
    try {
      const sbom = readJson(resolve(fixture.directory, fixture.names.cyclonedx));
      sbom.metadata.component.licenses = [{ license: { id: "NOASSERTION" } }];
      rewriteEvidence(fixture, fixture.names.cyclonedx, sbom);
      assert.throws(() => verifyUnsigned(fixture), /CycloneDX root package must declare GPL-2\.0-only/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("runtime npm component missing its Node containment marker", () => {
    const fixture = createUnsignedFixture();
    try {
      const sbom = readJson(resolve(fixture.directory, fixture.names.cyclonedx));
      const runtimePackage = sbom.components.find(({ name }) => name === "@scope/runtime-tool");
      runtimePackage.properties = runtimePackage.properties.filter(({ name }) => name !== "blockwright:contained-by");
      rewriteEvidence(fixture, fixture.names.cyclonedx, sbom);
      assert.throws(() => verifyUnsigned(fixture), /runtime npm component is missing its containment property/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("signed verifier rejects a noncanonical scoped npm purl", () => {
  const fixture = createSignedFixture();
  try {
    const sbom = readJson(resolve(fixture.directory, fixture.names.cyclonedx));
    const runtimePackage = sbom.components.find(({ name }) => name === "@scope/runtime-tool");
    runtimePackage.purl = "pkg:npm/%40scope%2Fruntime-tool@2.0.0";
    runtimePackage["bom-ref"] = runtimePackage.purl;
    rewriteSignedJson(fixture, resolve(fixture.directory, fixture.names.cyclonedx), sbom);
    assert.throws(() => verifySigned(fixture), /npm component does not use its canonical purl/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
