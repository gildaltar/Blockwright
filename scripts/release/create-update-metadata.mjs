import { existsSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  normalizeSha256,
  normalizeThumbprint,
  readJson,
  semverFromTag,
  sha256File,
  writeJson,
} from "./release-lib.mjs";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const artifactPath = resolve(requiredArgument("--artifact"));
const artifactUrl = new URL(requiredArgument("--artifact-url"));
const proofPath = resolve(requiredArgument("--signature-proof"));
const outputPath = resolve(requiredArgument("--out"));
const version = semverFromTag(requiredArgument("--version"));
if (artifactUrl.protocol !== "https:") throw new Error("Updater artifacts must use HTTPS.");
if (!existsSync(artifactPath)) throw new Error(`Installer artifact is missing: ${artifactPath}`);
if (!artifactPath.toLowerCase().endsWith(".exe")) throw new Error("The updater accepts an Authenticode-verifiable .exe installer only.");

const proof = readJson(proofPath);
const artifactHash = sha256File(artifactPath);
const artifactSize = statSync(artifactPath).size;
if (!Number.isSafeInteger(artifactSize) || artifactSize < 1 || artifactSize > 536_870_912) {
  throw new Error("Installer artifact size is outside the updater's 512 MiB acceptance limit.");
}
if (String(proof.status).toLowerCase() !== "valid") throw new Error("Signature proof does not report a Valid Authenticode signature.");
if (normalizeSha256(proof.sha256, "signature proof SHA-256") !== artifactHash) throw new Error("Signature proof does not describe the installer artifact being published.");
const thumbprint = normalizeThumbprint(proof.signerThumbprint, "signature proof signer thumbprint");
if (basename(proof.file ?? "") !== basename(artifactPath)) throw new Error("Signature proof filename does not match the installer artifact.");

writeJson(outputPath, {
  schemaVersion: 1,
  product: "Blockwright",
  version,
  publishedAt: new Date().toISOString(),
  artifact: {
    file: basename(artifactPath),
    url: artifactUrl.href,
    sha256: artifactHash,
    sizeBytes: artifactSize,
    signature: { required: true, status: "signed", signerThumbprint: thumbprint },
  },
});
console.log(`Created fail-closed update metadata at ${outputPath}.`);
