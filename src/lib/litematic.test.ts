import { gunzipSync, gzipSync } from "node:zlib";
import { parseUncompressed, simplify, writeUncompressed, type NBT } from "prismarine-nbt";
import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { exportLitematic, importLitematic, LITEMATIC_COMPATIBILITY } from "./litematic.js";
import type { Placement } from "./types.js";

const input = {
  name: "Litematic Interop Fixture",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 13, depth: 11, height: 12 },
  origin: { x: -31, y: 68, z: 47 },
  blockBudget: 20_000,
  seed: "litematic-round-trip",
  features: [],
};

function unsignedLong(value: unknown) {
  if (typeof value === "bigint") return BigInt.asUintN(64, value);
  if (Array.isArray(value) && value.length === 2) return BigInt.asUintN(64, (BigInt(value[0]) << 32n) | BigInt((value[1] as number) >>> 0));
  throw new Error("not a long");
}

// Deliberately independent from Blockwright's decoder: this mirrors the public
// Litematica linear-index/bit-offset equations directly in the test.
function independentlyDecode(rawLongs: unknown[], count: number, paletteSize: number) {
  const bits = Math.max(2, Math.ceil(Math.log2(paletteSize)));
  const mask = (1n << BigInt(bits)) - 1n;
  const longs = rawLongs.map(unsignedLong);
  return Array.from({ length: count }, (_, index) => {
    const bit = index * bits;
    const first = Math.floor(bit / 64);
    const last = Math.floor(((index + 1) * bits - 1) / 64);
    const offset = bit % 64;
    const joined = first === last ? longs[first] >> BigInt(offset) : (longs[first] >> BigInt(offset)) | (longs[last] << BigInt(64 - offset));
    return Number(joined & mask);
  });
}

function canonical(placement: Pick<Placement, "x" | "y" | "z" | "block" | "state">) {
  const properties = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const state = properties.length ? `[${properties.map(([key, value]) => `${key}=${String(value)}`).join(",")}]` : "";
  return `${placement.x},${placement.y},${placement.z}:${placement.block}${state}`;
}

describe("Litematic v7 Java interop", () => {
  it("writes documented root/metadata/region fields and independently decodable packed indices", () => {
    const build = compileBuild(input);
    const origin = { x: -100, y: 32, z: 10 };
    const exported = exportLitematic(build, {
      origin,
      author: "Blockwright Test",
      description: "Independent structural decode fixture",
      timeCreated: 1_725_470_400_000,
      timeModified: 1_725_470_460_000,
    });
    const root = simplify(parseUncompressed(gunzipSync(exported.bytes), "big")) as Record<string, any>;
    expect(root.Version).toBe(7);
    expect(root.SubVersion).toBe(1);
    expect(root.MinecraftDataVersion).toBe(build.registry.worldVersion);
    expect(root.Metadata.Name).toBe(input.name);
    expect(root.Metadata.Author).toBe("Blockwright Test");
    expect(root.Metadata.RegionCount).toBe(1);
    expect(root.Metadata.TotalBlocks).toBe(build.placements.length);
    expect(root.Blockwright.Origin).toEqual(origin);
    expect(root.Blockwright.BuildHash).toBe(build.hash);
    expect(root.Blockwright.CompatibilityStatus).toBe("unverified");

    const region = root.Regions.Blockwright;
    expect(region.Position).toEqual({
      x: build.bounds.min.x - origin.x,
      y: build.bounds.min.y - origin.y,
      z: build.bounds.min.z - origin.z,
    });
    expect(region.Size).toEqual({ x: build.bounds.dimensions.width, y: build.bounds.dimensions.height, z: build.bounds.dimensions.depth });
    expect(region.BlockStatePalette[0]).toEqual({ Name: "minecraft:air" });
    const count = region.Size.x * region.Size.y * region.Size.z;
    const decoded = independentlyDecode(region.BlockStates, count, region.BlockStatePalette.length);
    expect(decoded.every((index) => index >= 0 && index < region.BlockStatePalette.length)).toBe(true);
    expect(decoded.filter((index) => index !== 0)).toHaveLength(build.placements.length);
    expect(region.BlockStates.length).toBe(Math.ceil(count * Math.max(2, Math.ceil(Math.log2(region.BlockStatePalette.length))) / 64));
  });

  it("round-trips coordinates, states, origin, bounds, metadata, and timestamps through the Blockwright parser", () => {
    const build = compileBuild(input);
    const exported = exportLitematic(build, {
      origin: input.origin,
      author: "Ezra",
      timeCreated: 1_725_470_400_000,
      timeModified: 1_725_470_460_000,
    });
    const imported = importLitematic(exported.bytes);
    expect(imported.version).toBe(7);
    expect(imported.subVersion).toBe(1);
    expect(imported.origin).toEqual(input.origin);
    expect(imported.bounds).toEqual(build.bounds);
    expect(imported.buildHash).toBe(build.hash);
    expect(imported.metadata.author).toBe("Ezra");
    expect(imported.metadata.timeCreated).toBe(1_725_470_400_000);
    expect(imported.metadata.timeModified).toBe(1_725_470_460_000);
    expect(imported.placements.map(canonical).sort()).toEqual(build.placements.map(canonical).sort());
    expect(imported.compatibility).toEqual(LITEMATIC_COMPATIBILITY);
    expect(imported.compatibility.status).toBe("unverified");
  });

  it("interprets negative region sizes using Litematica's inclusive-corner convention", () => {
    const build = compileBuild(input);
    const exported = exportLitematic(build, { origin: input.origin, timeCreated: 1, timeModified: 1 });
    const parsed = parseUncompressed(gunzipSync(exported.bytes), "big") as NBT;
    const root = parsed.value as any;
    const region = root.Regions.value.Blockwright.value;
    const sizeX = region.Size.value.x.value;
    region.Position.value.x.value += sizeX - 1;
    region.Size.value.x.value = -sizeX;
    const reversedBytes = gzipSync(writeUncompressed(parsed, "big"));
    const imported = importLitematic(reversedBytes);
    expect(imported.regions[0].size.x).toBe(-sizeX);
    expect(imported.bounds).toEqual(build.bounds);
    expect(imported.placements.map(canonical).sort()).toEqual(build.placements.map(canonical).sort());
  });

  it("enforces Java-only export, gzip input, and bounded expansion", () => {
    const java = compileBuild(input);
    const bedrock = { ...java, input: { ...java.input, edition: "bedrock" as const } };
    expect(() => exportLitematic(bedrock)).toThrow(/Java Edition/);
    const { worldVersion: _worldVersion, ...registryWithoutDataVersion } = java.registry;
    expect(() => exportLitematic({ ...java, registry: registryWithoutDataVersion })).toThrow(/exact positive Minecraft DataVersion/);
    expect(() => importLitematic(Buffer.from("not gzip"))).toThrow(/gzip-compressed/);
    const bytes = exportLitematic(java, { timeCreated: 1, timeModified: 1 }).bytes;
    expect(() => importLitematic(bytes, { maximumCompressedBytes: 8 })).toThrow(/compressed limit/);
    expect(() => importLitematic(bytes, { maximumExpandedBytes: 64 })).toThrow();
  });
});
