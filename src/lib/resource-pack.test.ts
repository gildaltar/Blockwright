import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { isValidJavaRegistrySnapshot, readJavaRegistry } from "./java-registry.js";
import { assertResourcePackZipDirectory, chooseModelReference, loadResourcePack, placementTextureKey } from "./resource-pack.js";

async function resourcePackBytes(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

async function resourcePack(files: Record<string, string | Uint8Array>) {
  const bytes = await resourcePackBytes(files);
  const blob = new Blob([bytes]) as Blob & { name?: string };
  blob.name = "fixture.zip";
  return blob;
}

function endOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("Fixture has no ZIP end record.");
}

function blobNamed(bytes: Uint8Array) {
  const blob = new Blob([bytes]) as Blob & { name?: string };
  blob.name = "fixture.zip";
  return blob;
}

function pngHeader(width: number, height: number) {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

describe("Java version registry", () => {
  it("loads the verified Java 26.2 blockstate index", () => {
    const registry = readJavaRegistry("26.2");
    expect(registry?.client.sha1).toBe("2dc72797acbc1b63fc16a11c4ac393605f453754");
    expect(registry?.protocolVersion).toBe(776);
    expect(registry?.resourcePackVersion.major).toBe(88);
    expect(registry?.blocks.some(({ id }) => id === "minecraft:spruce_planks")).toBe(true);
    expect(registry?.blockCount).toBe(1198);
  });

  it("rejects truncated, inconsistent, and duplicate Java registry snapshots", () => {
    const registry = readJavaRegistry("26.2");
    expect(registry).toBeDefined();
    expect(isValidJavaRegistrySnapshot(registry, "26.2")).toBe(true);
    expect(isValidJavaRegistrySnapshot({ schemaVersion: 1, edition: "java", version: "26.2" }, "26.2")).toBe(false);
    expect(isValidJavaRegistrySnapshot({ ...registry, blockCount: registry!.blockCount + 1 }, "26.2")).toBe(false);
    expect(isValidJavaRegistrySnapshot({ ...registry, blocks: [registry!.blocks[0], registry!.blocks[0]], blockCount: 2 }, "26.2")).toBe(false);
  });
});

describe("resource-pack resolution", () => {
  it("creates stable keys regardless of state property order", () => {
    expect(placementTextureKey("minecraft:spruce_stairs", { half: "bottom", facing: "east" }))
      .toBe(placementTextureKey("minecraft:spruce_stairs", { facing: "east", half: "bottom" }));
  });

  it("chooses a blockstate model compatible with the placement state", () => {
    const blockstate = {
      variants: {
        "facing=west,half=bottom,shape=straight": { model: "minecraft:block/west" },
        "facing=east,half=bottom,shape=straight": { model: "minecraft:block/east" },
      },
    };
    expect(chooseModelReference(blockstate, { facing: "east", half: "bottom" })).toBe("minecraft:block/east");
  });

  it("rejects input and per-entry expansion beyond explicit preview limits", async () => {
    const pack = await resourcePack({ "pack.mcmeta": JSON.stringify({ pack: { pack_format: 88 }, padding: "x".repeat(256) }) });
    await expect(loadResourcePack(pack, [], { maximumInputBytes: 1 })).rejects.toThrow(/input limit/);
    await expect(loadResourcePack(pack, [], { maximumJsonBytes: 32 })).rejects.toThrow(/JSON exceeds/);
  });

  it("counts central-directory records independently before enforcing the entry limit", async () => {
    const bytes = await resourcePackBytes({ "one.txt": "one", "two.txt": "two" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = endOfCentralDirectory(bytes);
    view.setUint16(endOffset + 8, 1, true);
    view.setUint16(endOffset + 10, 1, true);

    await expect(loadResourcePack(blobNamed(bytes), [], { maximumEntries: 1 })).rejects.toThrow(/entry limit/);
  });

  it("rejects malformed central-directory bounds before archive parsing", async () => {
    const bytes = await resourcePackBytes({ "pack.mcmeta": "{}" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = endOfCentralDirectory(bytes);
    view.setUint32(endOffset + 12, bytes.byteLength, true);

    await expect(loadResourcePack(blobNamed(bytes), [])).rejects.toThrow(/invalid ZIP central-directory metadata/);
  });

  it("accepts a bounded empty ZIP64 central directory", () => {
    const bytes = new Uint8Array(98);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x06064b50, true);
    view.setUint32(4, 44, true);
    view.setUint32(56, 0x07064b50, true);
    view.setUint32(72, 1, true);
    view.setUint32(76, 0x06054b50, true);
    view.setUint16(84, 0xffff, true);
    view.setUint16(86, 0xffff, true);
    view.setUint32(88, 0xffffffff, true);
    view.setUint32(92, 0xffffffff, true);

    expect(() => assertResourcePackZipDirectory(bytes, 1)).not.toThrow();
  });

  it("rejects cyclic model inheritance instead of recursing indefinitely", async () => {
    const pack = await resourcePack({
      "assets/minecraft/blockstates/stone.json": JSON.stringify({ variants: { "": { model: "minecraft:block/a" } } }),
      "assets/minecraft/models/block/a.json": JSON.stringify({ parent: "minecraft:block/b" }),
      "assets/minecraft/models/block/b.json": JSON.stringify({ parent: "minecraft:block/a" }),
    });
    await expect(loadResourcePack(pack, [{ x: 0, y: 0, z: 0, block: "minecraft:stone", phase: "fixture" }]))
      .rejects.toThrow(/inheritance cycle/);
  });

  it("rejects compressed PNGs whose decoded dimensions exceed the pixel budget", async () => {
    const png = pngHeader(100_000, 100_000);
    const pack = await resourcePack({
      "assets/minecraft/blockstates/stone.json": JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } } }),
      "assets/minecraft/models/block/stone.json": JSON.stringify({ textures: { all: "minecraft:block/stone" } }),
      "assets/minecraft/textures/block/stone.png": png,
    });
    await expect(loadResourcePack(pack, [{ x: 0, y: 0, z: 0, block: "minecraft:stone", phase: "fixture" }]))
      .rejects.toThrow(/texture dimensions exceed/);
  });

  it("caps aggregate decoded texture pixels across unique texture objects", async () => {
    const pack = await resourcePack({
      "assets/minecraft/blockstates/stone.json": JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } } }),
      "assets/minecraft/blockstates/dirt.json": JSON.stringify({ variants: { "": { model: "minecraft:block/dirt" } } }),
      "assets/minecraft/models/block/stone.json": JSON.stringify({ textures: { all: "minecraft:block/stone" } }),
      "assets/minecraft/models/block/dirt.json": JSON.stringify({ textures: { all: "minecraft:block/dirt" } }),
      "assets/minecraft/textures/block/stone.png": pngHeader(2, 2),
      "assets/minecraft/textures/block/dirt.png": pngHeader(2, 2),
    });
    await expect(loadResourcePack(pack, [
      { x: 0, y: 0, z: 0, block: "minecraft:stone", phase: "fixture" },
      { x: 1, y: 0, z: 0, block: "minecraft:dirt", phase: "fixture" },
    ], { maximumDecodedTexturePixels: 7 })).rejects.toThrow(/aggregate decoded limit/);
  });

  it("enforces one aggregate expanded-byte budget across requested entries", async () => {
    const pack = await resourcePack({
      "assets/minecraft/blockstates/stone.json": JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } }, padding: "x".repeat(80) }),
      "assets/minecraft/models/block/stone.json": JSON.stringify({ textures: { all: "minecraft:block/stone" }, padding: "x".repeat(80) }),
    });
    await expect(loadResourcePack(pack, [{ x: 0, y: 0, z: 0, block: "minecraft:stone", phase: "fixture" }], {
      maximumExpandedBytes: 200,
      maximumJsonBytes: 200,
    })).rejects.toThrow(/expanded limit/);
  });
});
