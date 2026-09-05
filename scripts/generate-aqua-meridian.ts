import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBedrockMcpack } from "../src/lib/bedrock-pack.js";
import { compileBuild } from "../src/lib/compiler.js";

const outputDirectory = resolve(process.argv[2] ?? "release/aqua-meridian");
const build = compileBuild({
  name: "Aqua Meridian Waterpark",
  edition: "bedrock",
  version: "stable",
  style: "modern",
  buildingType: "waterpark",
  dimensions: { width: 256, depth: 240, height: 72 },
  origin: { x: 0, y: 64, z: 0 },
  blockBudget: 500_000,
  seed: "aqua-meridian-iphone-v2",
  features: [
    "wave pool",
    "lazy river",
    "three water slides",
    "splash pad",
    "locker room",
    "food court",
    "lifeguard stations",
    "distributed lighting",
  ],
});

if (!build.validation.valid || build.contract.status !== "valid" || build.certificate.status !== "valid") {
  throw new Error(`Aqua Meridian failed closed: ${JSON.stringify({ validation: build.validation, contract: build.contract.summary })}`);
}

const pack = await createBedrockMcpack(build, 32);
const filename = "Aqua-Meridian-Waterpark-iPhone-v2.mcpack";
const packHash = createHash("sha256").update(pack.bytes).digest("hex");
const report = {
  generatedAt: new Date().toISOString(),
  filename,
  packSha256: packHash,
  buildId: build.id,
  buildSha256: build.hash,
  contract: build.contract.summary,
  certificate: build.certificate.status,
  validation: {
    valid: build.validation.valid,
    blockingIssues: build.validation.blockingIssues,
    warnings: build.validation.warnings,
    issues: build.validation.issues,
  },
  bounds: build.bounds,
  materials: build.materialCounts,
  phases: build.phases,
  mobileInstaller: pack.inventory,
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, filename), pack.bytes),
  writeFile(resolve(outputDirectory, "Aqua-Meridian-Waterpark-iPhone-v2.qa.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

console.log(JSON.stringify(report, null, 2));
