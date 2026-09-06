import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeThumbprint, parseChecksums, readJson, readReleaseConfig, releaseFiles, repositoryRoot, sha256File, validateSbomPartitions } from "./release-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function assertExactNames(actualNames, expectedNames, label) {
  const actual = new Set(actualNames);
  const expected = new Set(expectedNames);
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));
  if (missing.length || unexpected.length) {
    throw new Error(`${label} does not match the exact release artifact set. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`);
  }
}

function normalizeEvidenceHash(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

const authenticodePreamble = "$ErrorActionPreference='Stop'; Import-Module -Name (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; ";

function validateSboms({ cyclonedx, spdx, packageManifest, version, releaseConfig }) {
  if (packageManifest.name !== "blockwright") throw new Error("package.json must identify the Blockwright release package.");
  if (packageManifest.license !== "GPL-2.0-only") throw new Error("package.json must declare the Blockwright root license as GPL-2.0-only.");

  const rootComponent = cyclonedx?.metadata?.component;
  if (cyclonedx?.bomFormat !== "CycloneDX" || cyclonedx?.specVersion !== "1.6" || !Array.isArray(cyclonedx?.components)) {
    throw new Error("CycloneDX SBOM evidence is missing or invalid.");
  }
  if (rootComponent?.name !== packageManifest.name || rootComponent?.version !== version) throw new Error("CycloneDX root package name/version does not match package.json.");
  if (!rootComponent?.licenses?.some(({ license }) => license?.id === "GPL-2.0-only")) throw new Error("CycloneDX root package must declare GPL-2.0-only.");
  const runtimeComponent = cyclonedx.components.find((component) => component?.name === releaseConfig.runtime.name && component?.version === releaseConfig.runtime.version && component?.properties?.some(({ name, value }) => name === "blockwright:distribution-role" && value === "bundled-private-runtime"));
  if (!runtimeComponent) throw new Error("CycloneDX SBOM does not describe the pinned bundled Node runtime.");
  if (!runtimeComponent.licenses?.some(({ license }) => license?.id === "MIT")) throw new Error("CycloneDX bundled Node runtime must declare its MIT license.");
  if (!runtimeComponent.hashes?.some(({ alg, content }) => alg === "SHA-256" && String(content).toLowerCase() === releaseConfig.runtime.sha256.toLowerCase())) throw new Error("CycloneDX bundled runtime hash does not match the pinned runtime archive.");
  if (!runtimeComponent.externalReferences?.some(({ type, url }) => type === "distribution" && url === releaseConfig.runtime.url)) throw new Error("CycloneDX bundled runtime source does not match the pinned runtime archive.");
  const launcherComponents = cyclonedx.components.filter((component) => component?.properties?.some(({ name, value }) => name === "blockwright:distribution-role" && value === "native-windows-launcher"));
  if (launcherComponents.length !== 1) throw new Error("CycloneDX SBOM must describe exactly one native Blockwright Windows launcher.");
  const launcherComponent = launcherComponents[0];
  if (launcherComponent.name !== "Blockwright Windows Launcher" || launcherComponent.version !== version) throw new Error("CycloneDX native launcher name/version does not match the release.");
  if (!launcherComponent.licenses?.some(({ license }) => license?.id === "GPL-2.0-only")) throw new Error("CycloneDX native launcher must declare GPL-2.0-only.");
  if (!launcherComponent.properties?.some(({ name, value }) => name === "blockwright:installed-path" && value === "Blockwright.exe")) throw new Error("CycloneDX native launcher installed path is invalid.");
  const launcherHash = normalizeEvidenceHash(launcherComponent.hashes?.find(({ alg }) => alg === "SHA-256")?.content, "CycloneDX native launcher SHA-256");
  if (spdx?.spdxVersion !== "SPDX-2.3" || !Array.isArray(spdx?.packages) || !Array.isArray(spdx?.relationships)) throw new Error("SPDX SBOM evidence is missing or invalid.");
  const spdxRoot = spdx.packages.find(({ SPDXID }) => SPDXID === "SPDXRef-RootPackage");
  if (spdxRoot?.name !== packageManifest.name || spdxRoot?.versionInfo !== version) throw new Error("SPDX root package name/version does not match package.json.");
  if (spdxRoot.licenseDeclared !== "GPL-2.0-only" || spdxRoot.licenseConcluded !== "GPL-2.0-only") throw new Error("SPDX root package must declare and conclude GPL-2.0-only.");
  const spdxRuntime = spdx.packages.find(({ SPDXID }) => SPDXID === "SPDXRef-BundledNodeRuntime");
  if (spdxRuntime?.name !== releaseConfig.runtime.name || spdxRuntime?.versionInfo !== releaseConfig.runtime.version || spdxRuntime?.downloadLocation !== releaseConfig.runtime.url) throw new Error("SPDX SBOM does not describe the pinned bundled Node runtime.");
  if (spdxRuntime.licenseDeclared !== "MIT" || spdxRuntime.licenseConcluded !== "MIT") throw new Error("SPDX bundled Node runtime must declare and conclude its MIT license.");
  if (!spdxRuntime.checksums?.some(({ algorithm, checksumValue }) => algorithm === "SHA256" && String(checksumValue).toLowerCase() === releaseConfig.runtime.sha256.toLowerCase())) throw new Error("SPDX bundled runtime hash does not match the pinned runtime archive.");
  const spdxLaunchers = spdx.packages.filter(({ SPDXID }) => SPDXID === "SPDXRef-BlockwrightWindowsLauncher");
  if (spdxLaunchers.length !== 1) throw new Error("SPDX SBOM must describe exactly one native Blockwright Windows launcher.");
  const spdxLauncher = spdxLaunchers[0];
  if (spdxLauncher.name !== "Blockwright Windows Launcher" || spdxLauncher.versionInfo !== version) throw new Error("SPDX native launcher name/version does not match the release.");
  if (spdxLauncher.licenseDeclared !== "GPL-2.0-only" || spdxLauncher.licenseConcluded !== "GPL-2.0-only") throw new Error("SPDX native launcher must declare and conclude GPL-2.0-only.");
  if (!spdxLauncher.checksums?.some(({ algorithm, checksumValue }) => algorithm === "SHA256" && normalizeEvidenceHash(checksumValue, "SPDX native launcher SHA-256") === launcherHash)) throw new Error("SPDX native launcher hash does not match CycloneDX.");

  validateSbomPartitions({
    cyclonedx,
    spdx,
    rootName: packageManifest.name,
    rootVersion: version,
    runtimeName: releaseConfig.runtime.name,
    runtimeVersion: releaseConfig.runtime.version,
  });
  return { launcherHash };
}

function verifyUnsignedAuthenticode(installerPath, installerName, spawnProcess) {
  const command = `${authenticodePreamble}$signature=Get-AuthenticodeSignature -LiteralPath $env:BLOCKWRIGHT_AUTHENTICODE_ARTIFACT; [string]$signature.Status`;
  const result = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, BLOCKWRIGHT_AUTHENTICODE_ARTIFACT: installerPath },
  });
  if (result.error) throw new Error(`Authenticode inspection could not run for ${installerName}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Authenticode inspection failed for ${installerName}: ${String(result.stderr || result.stdout).trim()}`);
  const actual = String(result.stdout ?? "").trim();
  if (actual !== "NotSigned") throw new Error(`Unsigned evidence disagrees with Authenticode for ${installerName}: expected NotSigned; received ${actual || "no status"}.`);
}

function verifySignedAuthenticode(installerPath, installerName, spawnProcess) {
  const command = `${authenticodePreamble}$s=Get-AuthenticodeSignature -LiteralPath $env:BLOCKWRIGHT_AUTHENTICODE_ARTIFACT; if($s.Status -ne 'Valid'){throw "Invalid Authenticode status: $($s.Status)"}; if($null -eq $s.SignerCertificate){throw "Valid Authenticode result did not expose a signer certificate."}; if($null -eq $s.TimeStamperCertificate){throw "Valid Authenticode signature is missing a timestamp certificate."}; [pscustomobject]@{status=[string]$s.Status;thumbprint=[string]$s.SignerCertificate.Thumbprint;signerSubject=[string]$s.SignerCertificate.Subject;timestampCertificateSubject=[string]$s.TimeStamperCertificate.Subject}|ConvertTo-Json -Compress`;
  const result = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, BLOCKWRIGHT_AUTHENTICODE_ARTIFACT: installerPath },
  });
  if (result.error) throw new Error(`Authenticode verification could not run for ${installerName}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Authenticode verification failed for ${installerName}: ${String(result.stderr || result.stdout).trim()}`);
  let evidence;
  try {
    evidence = JSON.parse(String(result.stdout ?? "").trim());
  } catch (error) {
    throw new Error(`Authenticode verification returned invalid JSON for ${installerName}: ${error.message}`);
  }
  if (evidence?.status !== "Valid") throw new Error(`Authenticode verification did not return Valid status for ${installerName}.`);
  return {
    thumbprint: normalizeThumbprint(evidence.thumbprint, `Actual Authenticode signer thumbprint for ${installerName}`),
    signerSubject: requireNonEmptyString(evidence.signerSubject, `Actual Authenticode signer subject for ${installerName}`),
    timestampCertificateSubject: requireNonEmptyString(evidence.timestampCertificateSubject, `Actual Authenticode timestamp certificate subject for ${installerName}`),
  };
}

function verifyPackagedLauncher({ portablePath, portableName, version, expectedStatus, expectedThumbprint, spawnProcess }) {
  const script = resolve(repositoryRoot, "scripts", "release", "Test-BlockwrightPortableLauncher.ps1");
  const args = [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
    "-PortableZip", portablePath, "-Version", version, "-ExpectedAuthenticodeStatus", expectedStatus,
  ];
  if (expectedThumbprint) args.push("-ExpectedThumbprint", expectedThumbprint, "-RequireTimestamp");
  const result = spawnProcess("powershell.exe", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`Packaged launcher verification could not run for ${portableName}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Packaged launcher verification failed for ${portableName}: ${String(result.stderr || result.stdout).trim()}`);
  try {
    return JSON.parse(String(result.stdout ?? "").trim());
  } catch (error) {
    throw new Error(`Packaged launcher verification returned invalid JSON for ${portableName}: ${error.message}`);
  }
}

function validateSignedEvidence({ releaseDirectory, names, checksums, statusArtifact, embeddedLauncher, version, repository, sourceRef, expectedThumbprint }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("Signed release verification requires --repository as an owner/repository identity.");
  }
  const expectedSourceRef = `refs/tags/v${version}`;
  if (sourceRef !== expectedSourceRef) throw new Error(`Signed release verification requires --source-ref ${expectedSourceRef}.`);
  const expectedSignerThumbprint = normalizeThumbprint(expectedThumbprint, "--expected-thumbprint");
  const installerPath = resolve(releaseDirectory, names.installer);
  const installerHash = checksums.get(names.installer);
  const installerSize = statSync(installerPath).size;
  if (!Number.isSafeInteger(installerSize) || installerSize < 1 || installerSize > 536_870_912) throw new Error("Signed installer size is outside the updater's 512 MiB acceptance limit.");

  const proof = readJson(resolve(releaseDirectory, names.proof));
  if (proof?.schemaVersion !== 1) throw new Error("Authenticode proof must use schemaVersion 1.");
  if (proof.file !== names.installer) throw new Error("Authenticode proof filename does not match the exact installer.");
  if (normalizeEvidenceHash(proof.sha256, "Authenticode proof SHA-256") !== installerHash) throw new Error("Authenticode proof hash does not match the exact installer.");
  if (proof.status !== "Valid") throw new Error("Authenticode proof must report Valid status.");
  const proofSignerThumbprint = normalizeThumbprint(proof.signerThumbprint, "Authenticode proof signer thumbprint");
  const proofSignerSubject = requireNonEmptyString(proof.signerSubject, "Authenticode proof signer subject");
  const proofTimestampSubject = requireNonEmptyString(proof.timestampCertificateSubject, "Authenticode proof timestamp certificate subject");
  if (!proof.launcher || proof.launcher.file !== "Blockwright.exe" || proof.launcher.container !== names.portable) throw new Error("Authenticode proof does not identify the packaged native launcher.");
  if (normalizeEvidenceHash(proof.launcher.sha256, "Authenticode proof launcher SHA-256") !== embeddedLauncher.sha256) throw new Error("Authenticode proof launcher hash does not match signature-status evidence.");
  if (proof.launcher.status !== "Valid") throw new Error("Authenticode proof launcher must report Valid status.");
  const proofLauncherThumbprint = normalizeThumbprint(proof.launcher.signerThumbprint, "Authenticode proof launcher signer thumbprint");
  requireNonEmptyString(proof.launcher.timestampCertificateSubject, "Authenticode proof launcher timestamp certificate subject");

  const update = readJson(resolve(releaseDirectory, names.update));
  if (update?.schemaVersion !== 1) throw new Error("Update metadata must use schemaVersion 1.");
  if (update.product !== "Blockwright") throw new Error("Update metadata product must be Blockwright.");
  if (update.version !== version) throw new Error(`Update metadata version ${update.version ?? "missing"} does not match package.json ${version}.`);
  if (typeof update.publishedAt !== "string" || Number.isNaN(Date.parse(update.publishedAt))) throw new Error("Update metadata publishedAt must be a valid timestamp.");
  if (!update.artifact || typeof update.artifact !== "object" || Array.isArray(update.artifact)) throw new Error("Update metadata artifact must be an object.");
  if (update.artifact.file !== names.installer) throw new Error("Update metadata filename does not match the exact installer.");
  if (normalizeEvidenceHash(update.artifact.sha256, "Update metadata SHA-256") !== installerHash) throw new Error("Update metadata hash does not match the exact installer.");
  if (!Number.isSafeInteger(update.artifact.sizeBytes) || update.artifact.sizeBytes !== installerSize) throw new Error("Update metadata size does not match the exact installer.");
  const expectedArtifactUrl = `https://github.com/${repository}/releases/download/v${version}/${names.installer}`;
  if (update.artifact.url !== expectedArtifactUrl) throw new Error(`Update metadata URL must be the exact tagged HTTPS release URL ${expectedArtifactUrl}.`);
  if (update.artifact.signature?.required !== true || update.artifact.signature?.status !== "signed") {
    throw new Error("Update metadata must require a signed installer.");
  }
  const updateSignerThumbprint = normalizeThumbprint(update.artifact.signature.signerThumbprint, "Update metadata signer thumbprint");
  const statusSignerThumbprint = normalizeThumbprint(statusArtifact.signerThumbprint, "Signature-status signer thumbprint");
  for (const [label, thumbprint] of [
    ["signature-status", statusSignerThumbprint],
    ["Authenticode proof", proofSignerThumbprint],
    ["embedded launcher status", normalizeThumbprint(embeddedLauncher.signerThumbprint, "Signature-status launcher signer thumbprint")],
    ["embedded launcher proof", proofLauncherThumbprint],
    ["update metadata", updateSignerThumbprint],
  ]) {
    if (thumbprint !== expectedSignerThumbprint) throw new Error(`${label} signer thumbprint does not match --expected-thumbprint.`);
  }
  return {
    expectedSignerThumbprint,
    proofSignerSubject,
    proofTimestampSubject,
  };
}

export function verifyReleaseEvidence({
  directory,
  requireSigned = false,
  requireGitHubAttestation = false,
  repository,
  sourceDigest,
  sourceRef,
  expectedThumbprint,
  packagePath = resolve(repositoryRoot, "package.json"),
  platform = process.platform,
  spawnProcess = spawnSync,
} = {}) {
  const releaseDirectory = resolve(directory ?? resolve(repositoryRoot, "release", "windows"));
  const packageManifest = readJson(packagePath);
  const version = String(packageManifest.version ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json has an invalid stable release version: ${version || "missing"}.`);
  const releaseConfig = readReleaseConfig();
  const names = {
    installer: `Blockwright-${version}-windows-x64-setup.exe`,
    portable: `Blockwright-${version}-windows-x64-portable.zip`,
    cyclonedx: `blockwright-${version}-cyclonedx.json`,
    spdx: `blockwright-${version}-spdx.json`,
    status: `blockwright-${version}-signature-status.json`,
    proof: "authenticode-proof.json",
    update: "latest.json",
  };
  const checksumsPath = resolve(releaseDirectory, "SHA256SUMS.txt");
  if (!existsSync(checksumsPath)) throw new Error(`Release checksum file is missing: ${checksumsPath}`);
  const checksums = parseChecksums(readFileSync(checksumsPath, "utf8"));
  const caseInsensitiveNames = new Set();
  for (const name of checksums.keys()) {
    if (basename(name) !== name || /[:*?"<>|]/.test(name)) throw new Error(`Checksummed artifact has an unsafe filename: ${name}`);
    const folded = name.toLowerCase();
    if (caseInsensitiveNames.has(folded)) throw new Error(`Checksummed artifact names collide on Windows: ${name}`);
    caseInsensitiveNames.add(folded);
  }
  for (const requiredName of [names.installer, names.portable, names.cyclonedx, names.spdx, names.status]) {
    if (!checksums.has(requiredName)) throw new Error(`Release checksum evidence is missing the exact ${requiredName} artifact.`);
  }
  const actualCandidateNames = releaseFiles(releaseDirectory).map((path) => basename(path));
  assertExactNames(actualCandidateNames, checksums.keys(), "Top-level release candidate files versus SHA256SUMS.txt");
  for (const [name, expected] of checksums) {
    const path = resolve(releaseDirectory, name);
    if (!existsSync(path)) throw new Error(`Checksummed artifact is missing: ${name}`);
    const actual = sha256File(path);
    if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}. Expected ${expected}; received ${actual}.`);
  }

  const cyclonedx = readJson(resolve(releaseDirectory, names.cyclonedx));
  const spdx = readJson(resolve(releaseDirectory, names.spdx));
  const sbomEvidence = validateSboms({ cyclonedx, spdx, packageManifest, version, releaseConfig });

  const status = readJson(resolve(releaseDirectory, names.status));
  if (status?.schemaVersion !== 1) throw new Error("Signature-status evidence must use schemaVersion 1.");
  if (status.version !== version) throw new Error(`Signature-status version ${status.version ?? "missing"} does not match package.json ${version}.`);
  if (typeof status.generatedAt !== "string" || Number.isNaN(Date.parse(status.generatedAt))) throw new Error("Signature-status generatedAt must be a valid timestamp.");
  if (!["unsigned", "signed"].includes(status.status)) throw new Error(`Signature-status state is invalid: ${status.status ?? "missing"}.`);
  const expectedGate = status.status === "signed";
  if (status.satisfiesSignedReleaseGate !== expectedGate) throw new Error(`Signature-status ${status.status} must set satisfiesSignedReleaseGate to ${expectedGate}.`);
  if (!Array.isArray(status.artifacts)) throw new Error("Signature-status artifacts must be an array.");
  if (!Array.isArray(status.embeddedArtifacts)) throw new Error("Signature-status embeddedArtifacts must be an array.");

  const statusArtifacts = new Map();
  for (const artifact of status.artifacts) {
    if (!artifact || typeof artifact.file !== "string" || basename(artifact.file) !== artifact.file) throw new Error("Signature-status artifact has an invalid filename.");
    if (statusArtifacts.has(artifact.file)) throw new Error(`Signature-status artifact is duplicated: ${artifact.file}`);
    const expectedHash = checksums.get(artifact.file);
    if (!expectedHash) throw new Error(`Signature-status artifact is not checksummed: ${artifact.file}`);
    const statusHash = normalizeEvidenceHash(artifact.sha256, `Signature-status hash for ${artifact.file}`);
    if (statusHash !== expectedHash) throw new Error(`Signature-status hash for ${artifact.file} does not match SHA256SUMS.txt.`);
    statusArtifacts.set(artifact.file, artifact);
  }
  if (status.embeddedArtifacts.length !== 1) throw new Error("Signature-status must describe exactly one embedded native launcher.");
  const embeddedLauncher = status.embeddedArtifacts[0];
  if (embeddedLauncher?.file !== "Blockwright.exe" || embeddedLauncher.container !== names.portable) throw new Error("Signature-status embedded launcher identity is invalid.");
  embeddedLauncher.sha256 = normalizeEvidenceHash(embeddedLauncher.sha256, "Signature-status embedded launcher SHA-256");
  if (embeddedLauncher.sha256 !== sbomEvidence.launcherHash) throw new Error("Signature-status embedded launcher hash does not match the SBOMs.");

  let signedEvidence = null;
  if (status.status === "unsigned") {
    assertExactNames(checksums.keys(), [names.installer, names.portable, names.cyclonedx, names.spdx, names.status], "Unsigned checksum evidence");
    assertExactNames(statusArtifacts.keys(), [names.installer, names.portable], "Unsigned signature-status artifacts");
    if (statusArtifacts.get(names.installer)?.authenticode !== "not-signed") throw new Error("Unsigned installer status must record authenticode as not-signed.");
    if (statusArtifacts.get(names.portable)?.authenticode !== "not-applicable") throw new Error("Unsigned portable ZIP status must record authenticode as not-applicable.");
    if (embeddedLauncher.authenticode !== "not-signed" || embeddedLauncher.signerThumbprint !== null) throw new Error("Unsigned embedded Blockwright.exe must be explicitly untrusted and not signed.");
    if (typeof status.reason !== "string" || !status.reason.trim()) throw new Error("Unsigned signature-status evidence must explain why the artifacts are unsigned.");
    if (platform === "win32") verifyUnsignedAuthenticode(resolve(releaseDirectory, names.installer), names.installer, spawnProcess);
  } else {
    for (const signedOnlyName of [names.proof, names.update]) {
      if (!checksums.has(signedOnlyName)) throw new Error(`Signed release checksum evidence is missing ${signedOnlyName}.`);
    }
    assertExactNames(checksums.keys(), [names.installer, names.portable, names.cyclonedx, names.spdx, names.status, names.proof, names.update], "Signed checksum evidence");
    assertExactNames(statusArtifacts.keys(), [names.installer], "Signed signature-status artifacts");
    if (statusArtifacts.get(names.installer)?.authenticode !== "valid") throw new Error("Signed installer status must record authenticode as valid.");
    if (embeddedLauncher.authenticode !== "valid") throw new Error("Signed release status must record the embedded Blockwright.exe Authenticode signature as valid.");
    signedEvidence = validateSignedEvidence({
      releaseDirectory,
      names,
      checksums,
      statusArtifact: statusArtifacts.get(names.installer),
      embeddedLauncher,
      version,
      repository,
      sourceRef,
      expectedThumbprint,
    });
  }

  if (requireSigned) {
    if (status.status !== "signed") throw new Error("Release is explicitly unsigned and cannot satisfy --require-signed.");
    if (platform !== "win32") throw new Error("Authenticode release verification must run on Windows.");
    const actualSignature = verifySignedAuthenticode(resolve(releaseDirectory, names.installer), names.installer, spawnProcess);
    if (actualSignature.thumbprint !== signedEvidence.expectedSignerThumbprint) throw new Error("Actual Authenticode signer thumbprint does not match --expected-thumbprint.");
    if (actualSignature.signerSubject !== signedEvidence.proofSignerSubject) throw new Error("Actual Authenticode signer subject does not match authenticode-proof.json.");
    if (actualSignature.timestampCertificateSubject !== signedEvidence.proofTimestampSubject) throw new Error("Actual Authenticode timestamp certificate subject does not match authenticode-proof.json.");
  }
  if (platform === "win32") {
    const expectedLauncherStatus = status.status === "signed" ? "Valid" : "NotSigned";
    const expectedLauncherThumbprint = status.status === "signed" ? signedEvidence.expectedSignerThumbprint : null;
    const packagedLauncher = verifyPackagedLauncher({
      portablePath: resolve(releaseDirectory, names.portable),
      portableName: names.portable,
      version,
      expectedStatus: expectedLauncherStatus,
      expectedThumbprint: expectedLauncherThumbprint,
      spawnProcess,
    });
    if (normalizeEvidenceHash(packagedLauncher.sha256, "Actual packaged launcher SHA-256") !== embeddedLauncher.sha256) throw new Error("Actual packaged Blockwright.exe hash does not match release evidence.");
  }
  if (requireGitHubAttestation) {
    if (!requireSigned) throw new Error("GitHub provenance verification for the public channel also requires --require-signed.");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("--repository must be an owner/repository identity for provenance verification.");
    if (!/^[a-f0-9]{40}$/i.test(sourceDigest ?? "")) throw new Error("--source-digest must be the validated 40-character release commit.");
    if (!/^refs\/tags\/v\d+\.\d+\.\d+$/.test(sourceRef ?? "")) throw new Error("--source-ref must be the validated qualified stable release tag.");
    const signerWorkflow = `${repository}/.github/workflows/windows-release.yml`;
    const subjects = [...checksums.keys()].map((name) => resolve(releaseDirectory, name));
    subjects.push(checksumsPath);
    for (const subject of subjects) {
      const result = spawnProcess("gh", [
        "attestation", "verify", subject,
        "--repo", repository,
        "--signer-workflow", signerWorkflow,
        "--source-digest", sourceDigest,
        "--source-ref", sourceRef,
        "--deny-self-hosted-runners",
      ], { encoding: "utf8", windowsHide: true });
      if (result.error) throw new Error(`GitHub CLI could not verify provenance for ${basename(subject)}: ${result.error.message}`);
      if (result.status !== 0) throw new Error(`GitHub provenance verification failed for ${basename(subject)}: ${String(result.stderr || result.stdout).trim()}`);
    }
  }
  return { directory: releaseDirectory, files: checksums.size, assets: actualCandidateNames.length + 1, status: status.status, version };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
const isMain = process.platform === "win32" ? invokedPath.toLowerCase() === modulePath.toLowerCase() : invokedPath === modulePath;
if (isMain) {
  const result = verifyReleaseEvidence({
    directory: argument("--dir", resolve(repositoryRoot, "release", "windows")),
    requireSigned: process.argv.includes("--require-signed"),
    requireGitHubAttestation: process.argv.includes("--require-github-attestation"),
    repository: argument("--repository", process.env.GITHUB_REPOSITORY),
    sourceDigest: argument("--source-digest", process.env.GITHUB_SHA),
    sourceRef: argument("--source-ref", process.env.GITHUB_REF),
    expectedThumbprint: argument("--expected-thumbprint", process.env.BLOCKWRIGHT_SIGNING_THUMBPRINT),
  });
  console.log(`Verified ${result.assets} release assets (${result.files} checksummed files plus SHA256SUMS.txt) in ${result.directory}; signature status is ${result.status}.`);
}
