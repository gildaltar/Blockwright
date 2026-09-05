import JSZip from "jszip";
import { createHash } from "node:crypto";
import { exportSchematic } from "./schematic.js";
import type { BuildRecord, Placement } from "./types.js";

export type ExportFormat = "json" | "csv" | "java_mcfunction" | "bedrock_mcfunction" | "blueprint" | "schem" | "bundle";

function serializeState(placement: Placement, edition: "java" | "bedrock") {
  const entries = Object.entries(placement.state ?? {});
  if (!entries.length) return "";
  if (edition === "java") return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`;
  return ` [${entries.map(([key, value]) => `\"${key}\"=${typeof value === "string" ? `\"${value}\"` : value}`).join(",")}]`;
}

export function toJson(build: BuildRecord) {
  return JSON.stringify(build, null, 2);
}

function csvTextCell(value: string) {
  const neutralized = /^[\t\r]|^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function toCsv(build: BuildRecord) {
  const rows = ["x,y,z,block,state,phase"];
  for (const p of build.placements) {
    rows.push(`${p.x},${p.y},${p.z},${p.block},${csvTextCell(JSON.stringify(p.state ?? {}))},${csvTextCell(p.phase)}`);
  }
  return rows.join("\n");
}

export function toMcfunction(build: BuildRecord, edition: "java" | "bedrock") {
  return build.placements.map((p) => `setblock ${p.x} ${p.y} ${p.z} ${p.block}${serializeState(p, edition)} replace`).join("\n");
}

export function chunkMcfunction(build: BuildRecord, edition: "java" | "bedrock", chunkSize = 8000) {
  const commands = toMcfunction(build, edition).split("\n");
  const chunks: string[] = [];
  for (let i = 0; i < commands.length; i += chunkSize) chunks.push(commands.slice(i, i + chunkSize).join("\n"));
  return chunks;
}

export function toBlueprint(build: BuildRecord) {
  const lines: string[] = [`# ${build.input.name}`, `# ${build.bounds.dimensions.width}×${build.bounds.dimensions.depth}×${build.bounds.dimensions.height}`, ""];
  const minY = build.bounds.min.y;
  const maxY = build.bounds.max.y;
  const symbols = new Map<string, string>();
  const glyphs = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  Object.keys(build.materialCounts).forEach((block, index) => symbols.set(block, glyphs[index] ?? "?"));
  lines.push("Legend:");
  for (const [block, glyph] of symbols) lines.push(`${glyph} = ${block}`);
  for (let y = minY; y <= maxY; y += 1) {
    lines.push("", `Layer Y=${y}`);
    const layer = new Map(build.placements.filter((p) => p.y === y).map((p) => [`${p.x},${p.z}`, p]));
    for (let z = build.bounds.min.z; z <= build.bounds.max.z; z += 1) {
      let row = "";
      for (let x = build.bounds.min.x; x <= build.bounds.max.x; x += 1) row += layer.has(`${x},${z}`) ? symbols.get(layer.get(`${x},${z}`)!.block) : ".";
      lines.push(row);
    }
  }
  return lines.join("\n");
}

const checksum = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

export async function createBundle(build: BuildRecord) {
  const zip = new JSZip();
  const files: Record<string, string> = {
    "build.json": toJson(build),
    "coordinates.csv": toCsv(build),
    "build-java.mcfunction": toMcfunction(build, "java"),
    "build-bedrock.mcfunction": toMcfunction(build, "bedrock"),
    "blueprint.txt": toBlueprint(build),
  };
  const schematic = build.input.edition === "java" ? exportSchematic(build).bytes : undefined;
  const manifest = {
    schemaVersion: 2,
    buildId: build.id,
    buildHash: build.hash,
    files: [
      ...Object.entries(files).map(([name, content]) => ({ name, bytes: Buffer.byteLength(content), sha256: checksum(content) })),
      ...(schematic ? [{ name: "build.schem", bytes: schematic.byteLength, sha256: checksum(schematic) }] : []),
    ],
  };
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  if (schematic) zip.file("build.schem", schematic);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
