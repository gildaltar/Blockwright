import { mkdirSync, resolve } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSboms, readJson, repositoryRoot, writeJson } from "./release-lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const packagePath = resolve(argument("--package", resolve(repositoryRoot, "app", "package.json")));
const lockPath = resolve(argument("--lock", resolve(repositoryRoot, "app", "package-lock.json")));
const outputDirectory = resolve(argument("--out-dir", resolve(repositoryRoot, "release", "windows")));
const manifest = readJson(packagePath);
const lock = readJson(lockPath);
mkdirSync(outputDirectory, { recursive: true });
const { cyclonedx, spdx } = createSboms({ lock, name: manifest.name, version: manifest.version, serial: `urn:uuid:${randomUUID()}` });
const cyclonedxPath = resolve(outputDirectory, `blockwright-${manifest.version}-cyclonedx.json`);
const spdxPath = resolve(outputDirectory, `blockwright-${manifest.version}-spdx.json`);
writeJson(cyclonedxPath, cyclonedx);
writeJson(spdxPath, spdx);
console.log(`Wrote CycloneDX and SPDX SBOMs for ${manifest.name} ${manifest.version}.`);
