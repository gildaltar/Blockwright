import { gzipSync } from "node:zlib";
import { parse, simplify, writeUncompressed, type NBT } from "prismarine-nbt";
import type { BuildRecord, Placement, Vec3 } from "./types.js";

type Rotation = 0 | 90 | 180 | 270;
type Mirror = "none" | "x" | "z";

export type SchematicOptions = {
  offset?: Vec3;
  rotation?: Rotation;
  mirror?: Mirror;
  includeAir?: boolean;
  replacements?: Record<string, string>;
  name?: string;
  author?: string;
};

type Tag = { type: string; value: unknown; name?: string };
const tag = {
  byte: (value: number): Tag => ({ type: "byte", value }),
  short: (value: number): Tag => ({ type: "short", value }),
  int: (value: number): Tag => ({ type: "int", value }),
  long: (value: bigint): Tag => ({ type: "long", value }),
  string: (value: string): Tag => ({ type: "string", value }),
  byteArray: (value: number[]): Tag => ({ type: "byteArray", value }),
  intArray: (value: number[]): Tag => ({ type: "intArray", value }),
  compound: (value: Record<string, Tag>, name?: string): Tag => ({ type: "compound", value, ...(name !== undefined ? { name } : {}) }),
  list: (type: string, value: unknown[]): Tag => ({ type: "list", value: { type, value } }),
};

function serializeBlockState(placement: Pick<Placement, "block" | "state">) {
  const entries = Object.entries(placement.state ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? `${placement.block}[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]` : placement.block;
}

function parseBlockState(value: string) {
  const bracket = value.indexOf("[");
  if (bracket < 0) return { block: value };
  const state = Object.fromEntries(value.slice(bracket + 1, -1).split(",").filter(Boolean).map((entry) => {
    const [key, raw] = entry.split("="); return [key, raw];
  }));
  return { block: value.slice(0, bracket), state };
}

export function encodeVarints(values: number[]) {
  const bytes: number[] = [];
  for (const value of values) {
    let current = value >>> 0;
    do {
      let byte = current & 0x7f; current >>>= 7;
      if (current) byte |= 0x80;
      bytes.push(byte > 127 ? byte - 256 : byte);
    } while (current);
  }
  return bytes;
}

export function decodeVarints(bytes: number[], expected: number) {
  const values: number[] = []; let value = 0; let shift = 0;
  for (const signed of bytes) {
    const byte = signed & 0xff; value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) { values.push(value >>> 0); value = 0; shift = 0; }
    else { shift += 7; if (shift > 35) throw new Error("Invalid schematic varint data."); }
  }
  if (shift !== 0 || values.length !== expected) throw new Error(`Schematic block data contains ${values.length} values; expected ${expected}.`);
  return values;
}

function primitiveTag(value: unknown): Tag {
  if (typeof value === "string") return tag.string(value);
  if (typeof value === "boolean") return tag.byte(value ? 1 : 0);
  if (typeof value === "bigint") return tag.long(value);
  if (typeof value === "number") return Number.isInteger(value) ? tag.int(value) : { type: "double", value };
  if (Array.isArray(value)) {
    if (value.every(Number.isInteger)) return tag.intArray(value as number[]);
    if (!value.length) return tag.list("end", []);
    const items = value.map(primitiveTag); return tag.list(items[0].type, items.map((item) => item.value));
  }
  if (value && typeof value === "object") return tag.compound(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, primitiveTag(item)])));
  return tag.string("");
}

function transformPlacements(placements: Placement[], rotation: Rotation, mirror: Mirror) {
  const minX = Math.min(...placements.map((p) => p.x)); const minZ = Math.min(...placements.map((p) => p.z));
  return placements.map((placement) => {
    let x = placement.x - minX; let z = placement.z - minZ;
    if (mirror === "x") x = -x;
    if (mirror === "z") z = -z;
    const transformed = rotation === 90 ? { x: -z, z: x } : rotation === 180 ? { x: -x, z: -z } : rotation === 270 ? { x: z, z: -x } : { x, z };
    return { ...placement, x: transformed.x, z: transformed.z };
  });
}

export function createSchematicNbt(build: BuildRecord, options: SchematicOptions = {}) {
  if (build.input.edition !== "java") throw new Error("Sponge .schem export is available for Java Edition builds only.");
  const transformed = transformPlacements(build.placements, options.rotation ?? 0, options.mirror ?? "none");
  const min = { x: Math.min(...transformed.map((p) => p.x)), y: Math.min(...transformed.map((p) => p.y)), z: Math.min(...transformed.map((p) => p.z)) };
  const max = { x: Math.max(...transformed.map((p) => p.x)), y: Math.max(...transformed.map((p) => p.y)), z: Math.max(...transformed.map((p) => p.z)) };
  const width = max.x - min.x + 1; const height = max.y - min.y + 1; const length = max.z - min.z + 1;
  if ([width, height, length].some((value) => value > 65_535)) throw new Error("Sponge schematic dimensions exceed unsigned-short limits.");
  const paletteStates = ["minecraft:air", ...new Set(transformed.map((placement) => serializeBlockState({ ...placement, block: options.replacements?.[placement.block] ?? placement.block })))];
  const blockPalette = Object.fromEntries(paletteStates.map((state, index) => [state, index]));
  const data = new Array<number>(width * height * length).fill(0);
  const blockEntities: Record<string, Tag>[] = [];
  for (const placement of transformed) {
    const x = placement.x - min.x; const y = placement.y - min.y; const z = placement.z - min.z;
    const state = serializeBlockState({ ...placement, block: options.replacements?.[placement.block] ?? placement.block });
    data[x + z * width + y * width * length] = blockPalette[state];
    if (placement.blockEntity) blockEntities.push({ Pos: tag.intArray([x, y, z]), Id: tag.string(placement.blockEntity.id), Data: primitiveTag(placement.blockEntity.data ?? {}) });
  }
  const schematic = tag.compound({
    Version: tag.int(3), DataVersion: tag.int(build.registry.worldVersion ?? 0),
    Metadata: tag.compound({ Name: tag.string(options.name ?? build.input.name), Author: tag.string(options.author ?? "Blockwright") }),
    Width: tag.short(width), Height: tag.short(height), Length: tag.short(length),
    Offset: tag.intArray([options.offset?.x ?? 0, options.offset?.y ?? 0, options.offset?.z ?? 0]),
    Blocks: tag.compound({
      Palette: tag.compound(Object.fromEntries(Object.entries(blockPalette).map(([state, index]) => [state, tag.int(index)]))),
      Data: tag.byteArray(encodeVarints(data)),
      BlockEntities: tag.list("compound", blockEntities.map((entry) => Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, item.value])))),
    }),
  });
  const root = tag.compound({ Schematic: schematic }, "") as NBT;
  return { root, width, height, length, paletteSize: paletteStates.length, blockCount: transformed.length };
}

export function exportSchematic(build: BuildRecord, options: SchematicOptions = {}) {
  const created = createSchematicNbt(build, options);
  const raw = writeUncompressed(created.root, "big");
  return { ...created, bytes: gzipSync(raw, { level: 9 }) };
}

export async function importSchematic(bytes: Uint8Array, origin: Vec3 = { x: 0, y: 0, z: 0 }) {
  const { parsed, type } = await parse(Buffer.from(bytes), "big");
  if (type !== "big") throw new Error("Sponge schematics must use Java big-endian NBT.");
  const value = simplify(parsed) as Record<string, any>; const schematic = value.Schematic;
  if (!schematic || schematic.Version !== 3) throw new Error("Only Sponge Schematic v3 files are supported.");
  const width = schematic.Width & 0xffff; const height = schematic.Height & 0xffff; const length = schematic.Length & 0xffff;
  if (![width, height, length].every((number) => Number.isInteger(number) && number > 0)) throw new Error("Schematic dimensions are invalid.");
  const paletteByIndex = Object.fromEntries(Object.entries(schematic.Blocks?.Palette ?? {}).map(([state, index]) => [Number(index), state]));
  const data = decodeVarints(Array.from(schematic.Blocks?.Data ?? []), width * height * length);
  const placements: Placement[] = [];
  const entitiesByPosition = new Map<string, any>((schematic.Blocks?.BlockEntities ?? []).map((entity: any) => [entity.Pos.join(","), entity]));
  for (let y = 0; y < height; y += 1) for (let z = 0; z < length; z += 1) for (let x = 0; x < width; x += 1) {
    const stateString = paletteByIndex[data[x + z * width + y * width * length]];
    if (!stateString) throw new Error("Schematic block palette index is missing.");
    const state = parseBlockState(stateString);
    if (state.block === "minecraft:air") continue;
    const entity = entitiesByPosition.get(`${x},${y},${z}`);
    placements.push({ x: x + origin.x, y: y + origin.y, z: z + origin.z, ...state, phase: "imported", ...(entity ? { blockEntity: { id: entity.Id, data: entity.Data } } : {}) });
  }
  return {
    format: "sponge_schematic_v3" as const, version: 3, dataVersion: schematic.DataVersion,
    metadata: schematic.Metadata ?? {}, dimensions: { width, height, depth: length },
    offset: { x: schematic.Offset?.[0] ?? 0, y: schematic.Offset?.[1] ?? 0, z: schematic.Offset?.[2] ?? 0 },
    paletteSize: Object.keys(paletteByIndex).length, placements,
  };
}
