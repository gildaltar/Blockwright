import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { exportSchematic, importSchematic } from "./schematic.js";

const build = compileBuild({
  name: "Bounded schematic fixture",
  edition: "java",
  version: "26.2",
  style: "nordic",
  dimensions: { width: 9, depth: 9, height: 9 },
  origin: { x: 0, y: 64, z: 0 },
  blockBudget: 20_000,
  seed: "bounded-schematic-fixture",
});

describe("bounded Sponge schematic import", () => {
  it("round-trips within explicit compressed, expanded, and volume limits", async () => {
    const exported = exportSchematic(build);
    const imported = await importSchematic(exported.bytes, build.input.origin, {
      maximumCompressedBytes: exported.bytes.byteLength,
      maximumExpandedBytes: 4 * 1024 * 1024,
      maximumVolume: 1_000,
    });
    expect(imported.placements).toHaveLength(build.placements.length);
  });

  it("rejects a compressed payload before decompression when its byte limit is exceeded", async () => {
    const exported = exportSchematic(build);
    await expect(importSchematic(exported.bytes, build.input.origin, {
      maximumCompressedBytes: exported.bytes.byteLength - 1,
    })).rejects.toThrow(/compressed limit/i);
  });

  it("rejects gzip expansion before NBT parsing", async () => {
    const compressed = gzipSync(Buffer.alloc(32_768, 0x41));
    await expect(importSchematic(compressed, build.input.origin, {
      maximumCompressedBytes: compressed.byteLength,
      maximumExpandedBytes: 128,
    })).rejects.toThrow();
  });

  it("rejects declared build volume above the configured limit", async () => {
    const exported = exportSchematic(build);
    await expect(importSchematic(exported.bytes, build.input.origin, {
      maximumExpandedBytes: 4 * 1024 * 1024,
      maximumVolume: 100,
    })).rejects.toThrow(/volume exceeds/i);
  });
});
