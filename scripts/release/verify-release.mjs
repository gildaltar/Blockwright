import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseChecksums, readJson, repositoryRoot, sha256File } from "./release-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const directory = resolve(argument("--dir", resolve(repositoryRoot, "release", "windows")));
const requireSigned = process.argv.includes("--require-signed");
const requireGitHubAttestation = process.argv.includes("--require-github-attestation");
const checksumsPath = resolve(directory, "SHA256SUMS.txt");
if (!existsSync(checksumsPath)) throw new Error(`Release checksum file is missing: ${checksumsPath}`);
const checksums = parseChecksums(readFileSync(checksumsPath, "utf8"));
if (checksums.size < 3) throw new Error("Release checksum evidence must cover the distributable and both SBOM formats.");
for (const [name, expected] of checksums) {
  const path = resolve(directory, name);
  if (!existsSync(path)) throw new Error(`Checksummed artifact is missing: ${name}`);
  const actual = sha256File(path);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}. Expected ${expected}; received ${actual}.`);
}

const cyclonedxName = [...checksums.keys()].find((name) => name.endsWith("-cyclonedx.json"));
const spdxName = [...checksums.keys()].find((name) => name.endsWith("-spdx.json"));
const statusName = [...checksums.keys()].find((name) => name.endsWith("-signature-status.json"));
if (!cyclonedxName || readJson(resolve(directory, cyclonedxName)).bomFormat !== "CycloneDX") throw new Error("CycloneDX SBOM evidence is missing or invalid.");
if (!spdxName || readJson(resolve(directory, spdxName)).spdxVersion !== "SPDX-2.3") throw new Error("SPDX SBOM evidence is missing or invalid.");
if (!statusName) throw new Error("Signed-artifact status evidence is missing.");
const status = readJson(resolve(directory, statusName));

if (requireSigned) {
  if (status.status !== "signed" || status.satisfiesSignedReleaseGate !== true) throw new Error("Release is explicitly unsigned and cannot satisfy --require-signed.");
  const installers = [...checksums.keys()].filter((name) => name.toLowerCase().endsWith(".exe"));
  if (installers.length !== 1) throw new Error("A signed release must contain exactly one checksummed installer executable.");
  if (process.platform !== "win32") throw new Error("Authenticode release verification must run on Windows.");
  const command = `$s=Get-AuthenticodeSignature -LiteralPath $args[0]; if($s.Status -ne 'Valid'){throw \"Invalid Authenticode status: $($s.Status)\"}; [pscustomobject]@{status=[string]$s.Status;thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command, resolve(directory, installers[0])], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`Authenticode verification failed for ${installers[0]}: ${(result.stderr || result.stdout).trim()}`);
}
if (requireGitHubAttestation) {
  if (!requireSigned) throw new Error("GitHub provenance verification for the public channel also requires --require-signed.");
  const repository = argument("--repository", process.env.GITHUB_REPOSITORY);
  const sourceDigest = argument("--source-digest", process.env.GITHUB_SHA);
  const sourceRef = argument("--source-ref", process.env.GITHUB_REF);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("--repository must be an owner/repository identity for provenance verification.");
  if (!/^[a-f0-9]{40}$/i.test(sourceDigest ?? "")) throw new Error("--source-digest must be the validated 40-character release commit.");
  if (!/^refs\/tags\/v\d+\.\d+\.\d+$/.test(sourceRef ?? "")) throw new Error("--source-ref must be the validated qualified stable release tag.");
  const signerWorkflow = `${repository}/.github/workflows/windows-release.yml`;
  const subjects = [...checksums.keys()].map((name) => resolve(directory, name));
  subjects.push(checksumsPath);
  for (const subject of subjects) {
    const result = spawnSync("gh", [
      "attestation", "verify", subject,
      "--repo", repository,
      "--signer-workflow", signerWorkflow,
      "--source-digest", sourceDigest,
      "--source-ref", sourceRef,
      "--deny-self-hosted-runners",
    ], { encoding: "utf8", windowsHide: true });
    if (result.error) throw new Error(`GitHub CLI could not verify provenance for ${basename(subject)}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`GitHub provenance verification failed for ${basename(subject)}: ${(result.stderr || result.stdout).trim()}`);
  }
}
console.log(`Verified ${checksums.size} release files in ${directory}; signature status is ${status.status}.`);
