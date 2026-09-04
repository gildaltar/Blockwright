import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileBuild } from "../src/lib/compiler.js";
import { exportSchematic } from "../src/lib/schematic.js";

const output = resolve(process.argv[2] || resolve(process.cwd(), "examples", "worldedit-smoke.schem"));
const build = compileBuild({
  name: "Blockwright WorldEdit Smoke", edition: "java", version: "26.2", style: "japanese", buildingType: "temple",
  dimensions: { width: 25, depth: 21, height: 16 }, origin: { x: 0, y: 64, z: 0 }, seed: "worldedit-7.4.4-smoke", blockBudget: 100_000,
});
const schematic = exportSchematic(build, { offset: { x: -12, y: 0, z: -10 } });
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, schematic.bytes);
console.log(JSON.stringify({ output, bytes: schematic.bytes.byteLength, blocks: schematic.blockCount, dataVersion: build.registry.worldVersion, hash: build.hash }, null, 2));
