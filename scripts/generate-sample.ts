import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileBuild } from "../src/lib/compiler.js";
import { createBundle, toBlueprint, toCsv, toJson, toMcfunction } from "../src/lib/exports.js";

const build = compileBuild({
  name: "Nordic Hearth Lodge",
  edition: "java",
  version: "26.2",
  style: "nordic",
  dimensions: { width: 17, depth: 13, height: 14 },
  origin: { x: 0, y: 64, z: 0 },
  features: ["covered porch", "hearth", "storage loft"],
  blockBudget: 12000,
});

const output = join(process.cwd(), "examples", "nordic-hearth-lodge");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(join(output, "build.json"), toJson(build)),
  writeFile(join(output, "coordinates.csv"), toCsv(build)),
  writeFile(join(output, "build-java.mcfunction"), toMcfunction(build, "java")),
  writeFile(join(output, "blueprint.txt"), toBlueprint(build)),
  writeFile(join(output, "blockwright-bundle.zip"), await createBundle(build)),
]);
console.log(JSON.stringify({ buildId: build.id, hash: build.hash, blocks: build.placements.length, bounds: build.bounds, output }, null, 2));
