import JSZip from "jszip";
import { createHash } from "node:crypto";
import { exportSchematic } from "./schematic.js";
import type { BuildRecord, Placement } from "./types.js";

export type ExportFormat = "json" | "csv" | "java_mcfunction" | "bedrock_mcfunction" | "bedrock_mcpack" | "blueprint" | "schem" | "litematic" | "bundle";

function serializeJavaState(placement: Placement) {
  const entries = Object.entries(placement.state ?? {});
  if (!entries.length) return "";
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`;
}

function bedrockStateEntries(placement: Placement) {
  const state = placement.state ?? {};
  const entries: Array<[string, string | number | boolean]> = [];
  const doorDirection: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 };
  const stairDirection: Record<string, number> = { east: 0, west: 1, south: 2, north: 3 };
  if (placement.block.endsWith("_stairs")) {
    entries.push(["upside_down_bit", state.half === "top"]);
    entries.push(["weirdo_direction", stairDirection[String(state.facing ?? "north")] ?? 3]);
  } else if (placement.block.endsWith("_door") && !placement.block.endsWith("_trapdoor")) {
    entries.push(["direction", doorDirection[String(state.facing ?? "north")] ?? 2]);
    entries.push(["door_hinge_bit", state.hinge === "right"]);
    entries.push(["open_bit", Boolean(state.open)]);
    entries.push(["upper_block_bit", state.half === "upper"]);
  } else if (placement.block.endsWith("_trapdoor")) {
    entries.push(["direction", doorDirection[String(state.facing ?? "north")] ?? 2]);
    entries.push(["open_bit", Boolean(state.open)]);
    entries.push(["upside_down_bit", state.half === "top"]);
  } else if (placement.block.endsWith("_slab")) {
    entries.push(["minecraft:vertical_half", state.type === "top" ? "top" : "bottom"]);
  } else if (/(^|:)lantern$|soul_lantern$/.test(placement.block)) {
    entries.push(["hanging_bit", Boolean(state.hanging)]);
  } else if (typeof state.axis === "string") {
    entries.push(["pillar_axis", state.axis]);
  }
  return entries;
}

function serializeBedrockState(placement: Placement) {
  const entries = bedrockStateEntries(placement);
  if (!entries.length) return "";
  return ` [${entries.map(([key, value]) => `\"${key}\"=${typeof value === "string" ? `\"${value}\"` : value}`).join(",")}]`;
}

export function bedrockPlacementCommand(placement: Placement) {
  return `setblock ${placement.x} ${placement.y} ${placement.z} ${placement.block}${serializeBedrockState(placement)} replace`;
}

export function optimizedBedrockCommands(build: BuildRecord) {
  const byRow = new Map<string, Placement[]>();
  for (const placement of build.placements) {
    const stateKey = serializeBedrockState(placement);
    const key = `${placement.y}|${placement.z}|${placement.block}|${stateKey}`;
    const row = byRow.get(key) ?? [];
    row.push(placement);
    byRow.set(key, row);
  }
  const commands: string[] = [];
  for (const row of [...byRow.values()].sort((a, b) => a[0].y - b[0].y || a[0].z - b[0].z || a[0].block.localeCompare(b[0].block))) {
    row.sort((a, b) => a.x - b.x);
    let start = row[0]; let previous = row[0];
    const flush = () => {
      const length = previous.x - start.x + 1;
      const stateText = serializeBedrockState(start);
      if (length >= 3 && !stateText) for (let x = start.x; x <= previous.x; x += 64) {
        const endX = Math.min(previous.x, x + 63);
        if (endX - x + 1 >= 3) commands.push(`fill ${x} ${start.y} ${start.z} ${endX} ${previous.y} ${previous.z} ${start.block} replace`);
        else for (let exactX = x; exactX <= endX; exactX += 1) commands.push(bedrockPlacementCommand({ ...start, x: exactX }));
      }
      else for (let x = start.x; x <= previous.x; x += 1) commands.push(bedrockPlacementCommand({ ...start, x }));
    };
    for (let index = 1; index < row.length; index += 1) {
      const placement = row[index];
      if (placement.x === previous.x + 1) previous = placement;
      else { flush(); start = placement; previous = placement; }
    }
    flush();
  }
  return commands;
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
  return build.placements.map((p) => edition === "java"
    ? `setblock ${p.x} ${p.y} ${p.z} ${p.block}${serializeJavaState(p)} replace`
    : bedrockPlacementCommand(p)).join("\n");
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
