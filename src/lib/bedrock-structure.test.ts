import { createHash } from "node:crypto";
import JSZip from "jszip";
import { parse, simplify } from "prismarine-nbt";
import { describe, expect, it } from "vitest";
import {
  BEDROCK_STABLE_VERSION,
  createBedrockMcpack,
  createBedrockStructureTiles,
  resolveBedrockBlockPermutation,
} from "./bedrock-structure.js";
import { calculateBuildHash, validateBuildContract } from "./contract.js";
import type { BuildRecord, Placement, Vec3 } from "./types.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundsOf(placements: readonly Placement[]) {
  const xs = placements.map(({ x }) => x);
  const ys = placements.map(({ y }) => y);
  const zs = placements.map(({ z }) => z);
  const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) };
  const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };
  return { min, max, dimensions: { width: max.x - min.x + 1, height: max.y - min.y + 1, depth: max.z - min.z + 1 } };
}

function makeBuild(id: string, name: string, placements: Placement[]): BuildRecord {
  const bounds = boundsOf(placements);
  const materialCounts = Object.fromEntries([...new Set(placements.map(({ block }) => block))]
    .sort().map((block) => [block, placements.filter((placement) => placement.block === block).length]));
  const phases = [...new Set(placements.map(({ phase }) => phase))].sort()
    .map((phase) => ({ name: phase, count: placements.filter((placement) => placement.phase === phase).length }));
  const input: BuildRecord["input"] = {
    name,
    edition: "bedrock",
    version: "stable",
    style: "test",
    dimensions: bounds.dimensions,
    sourceBrief: "Bedrock mcstructure test fixture",
    palette: Object.keys(materialCounts),
    rolePalette: {},
    materialLibrary: {},
    design: { schemaVersion: 1, description: "Test fixture", requirements: [], elements: [] },
    origin: bounds.min,
    features: [],
    blockBudget: placements.length + 100,
    seed: id,
    buildingType: "hall",
    confirmationToken: "fixture-confirmed",
  };
  const buildHash = calculateBuildHash(input, placements);
  const buildId = `bw_${buildHash.slice(0, 12)}`;
  const draft = {
    schemaVersion: 2,
    id: buildId,
    hash: buildHash,
    input,
    plan: {
      schemaVersion: 1,
      seed: id,
      program: { buildingType: "hall", spaces: ["fixture"] },
      footprint: { kind: "rectangle", width: bounds.dimensions.width, depth: bounds.dimensions.depth, inset: 0 },
      massing: { volumes: [{ id: "fixture", min: bounds.min, max: bounds.max, purpose: "test" }], asymmetry: 0 },
      roomGraph: { rooms: [{ id: "fixture", purpose: "test", floor: 0 }], links: [] },
      circulation: { primary: "fixture", vertical: "none", exterior: [] },
      floorHeights: [bounds.dimensions.height],
      facadeBays: [],
      structuralFrame: { system: "fixture", bayWidth: 1, supports: [] },
      roofGrammar: { type: "flat", pitch: 0, overhang: 0, tiers: 1 },
      entrances: [{ side: "north", width: 1, emphasis: "fixture" }],
      windows: { pattern: "none", sill: 0, height: 0 },
      details: [],
      landscaping: [],
      fingerprint: hash(id),
    },
    preflight: {
      dimensions: bounds.dimensions,
      totalVolume: bounds.dimensions.width * bounds.dimensions.height * bounds.dimensions.depth,
      estimatedOccupiedBlocks: placements.length,
      estimatedPlacementAttempts: placements.length,
      estimatedUniqueMaterials: Object.keys(materialCounts).length,
      chunksTouched: 1,
      estimatedCommandCount: placements.length,
      estimatedExportBytes: placements.length * 32,
      estimatedMemoryBytes: placements.length * 64,
      estimatedGenerationMs: 1,
      minecraftRisk: "green",
      worldEditRisk: "green",
      overallRisk: "green",
      requiresConfirmation: false,
      warnings: [],
      choices: ["continue", "cancel"],
      regionSize: 32,
      estimatedRegions: 1,
    },
    structuralFingerprint: hash(`${id}:structure`),
    bounds,
    placements,
    regions: [{ id: "fixture", chunkMin: { x: 0, z: 0 }, chunkMax: { x: 0, z: 0 }, bounds, placementCount: placements.length }],
    materialCounts,
    layerCounts: Object.fromEntries([...new Set(placements.map(({ y }) => y))].sort((left, right) => left - right)
      .map((y) => [String(y), placements.filter((placement) => placement.y === y).length])),
    phases,
    validation: { valid: true, blockingIssues: 0, warnings: 0, issues: [], attemptedCollisions: 0 },
    registry: {
      edition: "bedrock",
      requestedVersion: "stable",
      resolvedVersion: BEDROCK_STABLE_VERSION,
      coverageVersion: BEDROCK_STABLE_VERSION,
      source: "minecraft-data",
      sourceUrl: "https://github.com/PrismarineJS/minecraft-data",
      syncedAt: "2026-09-05T00:00:00.000Z",
    },
    createdAt: "2026-09-05T00:00:00.000Z",
  } satisfies Omit<BuildRecord, "contract" | "certificate">;
  const contract = validateBuildContract(draft);
  expect(contract.status, contract.certificate.text).toBe("valid");
  return { ...draft, contract, certificate: contract.certificate };
}

function at(origin: Vec3, x: number, y: number, z: number, block: string, state?: Placement["state"]): Placement {
  return { x: origin.x + x, y: origin.y + y, z: origin.z + z, block, state, phase: "fixture" };
}

const asymmetricOrigin = { x: 10, y: 64, z: -2 };
const asymmetricPlacements: Placement[] = [
  at(asymmetricOrigin, 0, 0, 0, "minecraft:stone"),
  at(asymmetricOrigin, 0, 0, 1, "minecraft:gray_concrete"),
  at(asymmetricOrigin, 0, 1, 2, "minecraft:water", { liquid_depth: 3 }),
  at(asymmetricOrigin, 0, 2, 3, "minecraft:air"),
  at(asymmetricOrigin, 1, 0, 0, "minecraft:smooth_quartz", { pillar_axis: "x" }),
  {
    ...at(asymmetricOrigin, 1, 1, 1, "minecraft:barrel"),
    blockEntity: { id: "Barrel", data: { CustomName: "Fixture", isMovable: true } },
  },
  at(asymmetricOrigin, 1, 2, 3, "minecraft:iron_door", {
    door_hinge_bit: true,
    "minecraft:cardinal_direction": "north",
    open_bit: true,
    upper_block_bit: false,
  }),
];

describe("Bedrock block-state registry lowering", () => {
  it("fills exact Bedrock defaults and preserves state NBT types", () => {
    const resolved = resolveBedrockBlockPermutation({ block: "minecraft:iron_door", state: { open_bit: true } });
    expect(resolved.name).toBe("minecraft:iron_door");
    expect(resolved.states.open_bit).toEqual({ type: "byte", value: 1 });
    expect(resolved.states.door_hinge_bit).toEqual({ type: "byte", value: 0 });
    expect(resolved.states["minecraft:cardinal_direction"]).toEqual({ type: "string", value: "south" });
    expect(resolved.version).toBeGreaterThan(0);
  });

  it("fails closed for Java-shaped, mistyped, impossible, and unknown states", () => {
    expect(() => resolveBedrockBlockPermutation({ block: "minecraft:gray_concrete", state: { axis: "y" } })).toThrow(/no Bedrock.*state named axis/i);
    expect(() => resolveBedrockBlockPermutation({ block: "minecraft:water", state: { liquid_depth: "0" } })).toThrow(/integer value/i);
    expect(() => resolveBedrockBlockPermutation({ block: "minecraft:water", state: { liquid_depth: 99 } })).toThrow(/no Bedrock.*permutation/i);
    expect(() => resolveBedrockBlockPermutation({ block: "minecraft:not_a_real_block" })).toThrow(/unknown Bedrock/i);
    expect(() => resolveBedrockBlockPermutation({ block: "gray_concrete" })).toThrow(/namespaced block identifier/i);
  });
});

describe("Bedrock .mcstructure tiling", () => {
  it("writes a complete little-endian asymmetric structure and round-trips every coordinate independently", async () => {
    const build = makeBuild("asymmetric", "Asymmetric Fixture", asymmetricPlacements);
    const [tile] = createBedrockStructureTiles(build, { tileDimensions: { width: 2, height: 3, depth: 4 } });
    expect(tile.origin).toEqual(asymmetricOrigin);
    expect(tile.size).toEqual({ width: 2, height: 3, depth: 4 });
    expect(tile.placementCount).toBe(asymmetricPlacements.length);
    expect(tile.explicitAirCount).toBe(1);
    expect(tile.sparseCellCount).toBe(24 - asymmetricPlacements.length);

    const checked = await parse(Buffer.from(tile.bytes), "little");
    expect([...tile.bytes.slice(0, 2)]).not.toEqual([0x1f, 0x8b]);
    expect(checked.type).toBe("little");
    expect(checked.metadata.size).toBe(tile.bytes.byteLength);
    const parsed = checked.parsed as any;
    expect(parsed.name).toBe("");
    expect(parsed.value.format_version).toEqual({ type: "int", value: 1 });
    const simple = simplify(parsed) as any;
    expect(simple.size).toEqual([2, 3, 4]);
    expect(simple.structure_world_origin).toEqual([10, 64, -2]);
    const [primary, secondary] = simple.structure.block_indices;
    expect(primary).toHaveLength(24);
    expect(secondary).toEqual(new Array(24).fill(-1));
    const rawLayers = parsed.value.structure.value.block_indices;
    expect(rawLayers.value.type).toBe("list");
    expect(rawLayers.value.value.map((layer: any) => layer.type)).toEqual(["int", "int"]);
    expect(parsed.value.structure.value.entities.value.type).toBe("end");

    const palette = simple.structure.palette.default.block_palette as { name: string; states: Record<string, unknown> }[];
    const expectedByLocalCoordinate = new Map(asymmetricPlacements.map((placement) => [
      `${placement.x - asymmetricOrigin.x},${placement.y - asymmetricOrigin.y},${placement.z - asymmetricOrigin.z}`,
      placement,
    ]));
    for (let x = 0; x < 2; x += 1) for (let y = 0; y < 3; y += 1) for (let z = 0; z < 4; z += 1) {
      const index = ((x * 3) + y) * 4 + z;
      const placement = expectedByLocalCoordinate.get(`${x},${y},${z}`);
      if (!placement) {
        expect(primary[index], `sparse ${x},${y},${z}`).toBe(-1);
        continue;
      }
      expect(primary[index], `placed ${x},${y},${z}`).toBeGreaterThanOrEqual(0);
      const paletteEntry = palette[primary[index]];
      const resolved = resolveBedrockBlockPermutation(placement);
      expect(paletteEntry.name).toBe(resolved.name);
      expect(paletteEntry.states).toEqual(Object.fromEntries(Object.entries(resolved.states).map(([key, state]) => [key, state.value])));
    }

    const rawPalette = parsed.value.structure.value.palette.value.default.value.block_palette.value.value as any[];
    const rawDoor = rawPalette.find((entry) => entry.name.value === "minecraft:iron_door");
    expect(rawDoor.states.value.open_bit.type).toBe("byte");
    expect(rawDoor.states.value["minecraft:cardinal_direction"].type).toBe("string");
    const rawWater = rawPalette.find((entry) => entry.name.value === "minecraft:water");
    expect(rawWater.states.value.liquid_depth.type).toBe("int");
    const barrelIndex = ((1 * 3) + 1) * 4 + 1;
    const positionData = parsed.value.structure.value.palette.value.default.value.block_position_data.value;
    expect(positionData[String(barrelIndex)].value.block_entity_data.value.id.value).toBe("Barrel");
    expect(positionData[String(barrelIndex)].value.block_entity_data.value.isMovable.type).toBe("byte");
  });

  it("keeps sparse cells as -1 and makes explicit-air carving an explicit policy", async () => {
    const build = makeBuild("air-policy", "Air Policy", asymmetricPlacements);
    const withAir = createBedrockStructureTiles(build, { tileDimensions: { width: 2, height: 3, depth: 4 } })[0];
    const overlay = createBedrockStructureTiles(build, { tileDimensions: { width: 2, height: 3, depth: 4 }, includeExplicitAir: false })[0];
    const withAirSimple = simplify((await parse(Buffer.from(withAir.bytes), "little")).parsed) as any;
    const overlaySimple = simplify((await parse(Buffer.from(overlay.bytes), "little")).parsed) as any;
    const explicitAirIndex = ((0 * 3) + 2) * 4 + 3;
    expect(withAirSimple.structure.block_indices[0][explicitAirIndex]).toBeGreaterThanOrEqual(0);
    expect(withAirSimple.structure.palette.default.block_palette[withAirSimple.structure.block_indices[0][explicitAirIndex]].name).toBe("minecraft:air");
    expect(overlaySimple.structure.block_indices[0][explicitAirIndex]).toBe(-1);
    expect(overlay.palette.some(({ name }) => name === "minecraft:air")).toBe(false);
  });

  it("has no palette-cardinality cap", async () => {
    const blocks = [
      "stone", "dirt", "grass_block", "cobblestone", "oak_planks", "spruce_planks", "birch_planks",
      "white_concrete", "orange_concrete", "magenta_concrete", "light_blue_concrete", "yellow_concrete",
      "lime_concrete", "pink_concrete", "gray_concrete", "light_gray_concrete", "cyan_concrete",
      "purple_concrete", "blue_concrete", "brown_concrete", "green_concrete", "red_concrete", "black_concrete",
    ];
    const placements = blocks.map((block, x) => ({ x, y: 70, z: 0, block: `minecraft:${block}`, phase: "palette" }));
    const build = makeBuild("open-palette", "Open Palette", placements);
    const [tile] = createBedrockStructureTiles(build, { tileDimensions: { width: 32, height: 1, depth: 1 } });
    expect(tile.palette).toHaveLength(blocks.length);
    const simple = simplify((await parse(Buffer.from(tile.bytes), "little")).parsed) as any;
    expect(simple.structure.palette.default.block_palette).toHaveLength(blocks.length);
  });

  it("rejects stale audit artifacts and overlapping project sectors", async () => {
    const first = makeBuild("first", "First", [at({ x: 0, y: 64, z: 0 }, 0, 0, 0, "minecraft:stone"), at({ x: 0, y: 64, z: 0 }, 2, 1, 2, "minecraft:stone")]);
    const stale = { ...first, certificate: { ...first.certificate, buildHash: hash("stale") } };
    await expect(createBedrockMcpack(stale)).rejects.toThrow(/stale hash-bound|does not match/i);

    const overlapping = makeBuild("overlapping", "Overlapping", [at({ x: 1, y: 64, z: 1 }, 0, 0, 0, "minecraft:stone"), at({ x: 1, y: 64, z: 1 }, 3, 1, 3, "minecraft:stone")]);
    await expect(createBedrockMcpack([first, overlapping])).rejects.toThrow(/bounds overlap/i);
  });

  it("rejects a placement mutated after its hash and certificate were issued", async () => {
    const build = makeBuild("tamper-probe", "Tamper Probe", [
      at({ x: 0, y: 64, z: 0 }, 0, 0, 0, "minecraft:stone"),
      at({ x: 0, y: 64, z: 0 }, 1, 0, 0, "minecraft:stone"),
    ]);
    const tampered = structuredClone(build);
    tampered.placements[0].block = "minecraft:diamond_block";
    await expect(createBedrockMcpack(tampered)).rejects.toThrow(/do not match its immutable build hash/i);
  });
});

describe("multi-build Bedrock .mcpack", () => {
  it("cannot cascade across the 128-to-129 controller page boundary", async () => {
    const placements = Array.from({ length: 129 }, (_, index) => ({
      x: index * 32,
      y: 64,
      z: 0,
      block: "minecraft:stone",
      phase: "paged",
    }));
    const build = makeBuild("page-boundary", "Page Boundary", placements);
    const pack = await createBedrockMcpack(build, {
      namespace: "page_boundary",
      packId: "page-boundary-regression",
      tileDimensions: { width: 32, height: 1, depth: 1 },
    });
    expect(pack.tiles).toHaveLength(129);
    const zip = await JSZip.loadAsync(pack.bytes);
    const controller = await zip.file("functions/page_boundary/controller.mcfunction")!.async("text");
    const controllerLines = controller.trim().split("\n");
    expect(controllerLines.map((line) => line.match(/matches (\d+)\.\.(\d+)/)!.slice(1).map(Number))).toEqual([[129, 129], [1, 128]]);

    async function executeOneTick(initialScore: number) {
      let score = initialScore;
      let loads = 0;
      for (const controllerLine of controllerLines) {
        const controllerMatch = /matches (\d+)\.\.(\d+) run function (\S+)$/.exec(controllerLine)!;
        const [, first, last, pageId] = controllerMatch;
        if (score < Number(first) || score > Number(last)) continue;
        const page = await zip.file(`functions/${pageId}.mcfunction`)!.async("text");
        for (const pageLine of page.trim().split("\n")) {
          const pageMatch = /matches (\d+) run function (\S+)$/.exec(pageLine)!;
          const [, stage, loadId] = pageMatch;
          if (score !== Number(stage)) continue;
          loads += 1;
          const load = await zip.file(`functions/${loadId}.mcfunction`)!.async("text");
          if (/scoreboard players add @s \S+ 1/.test(load)) score += 1;
          if (/scoreboard players set @s \S+ 0/.test(load)) score = 0;
        }
      }
      return { score, loads };
    }

    await expect(executeOneTick(128)).resolves.toEqual({ score: 129, loads: 1 });
    await expect(executeOneTick(129)).resolves.toEqual({ score: 0, loads: 1 });
  });

  it("packages non-overlapping absolute sectors deterministically with structure-load delivery and complete checksums", async () => {
    const first = makeBuild("sector-a", "Sector A", asymmetricPlacements);
    const secondOrigin = { x: 100, y: 80, z: 200 };
    const second = makeBuild("sector-b", "Sector B", [
      at(secondOrigin, 0, 0, 0, "minecraft:sea_lantern"),
      at(secondOrigin, 1, 0, 0, "minecraft:iron_bars"),
      at(secondOrigin, 2, 1, 1, "minecraft:cyan_concrete"),
    ]);
    const project = { schemaVersion: 1 as const, name: "Five Sector Ready", packId: "aqua-meridian", builds: [second, first] };
    const options = { namespace: "aqua_meridian", tileDimensions: { width: 32, height: 32, depth: 32 } };
    const one = await createBedrockMcpack(project, options);
    const two = await createBedrockMcpack(project, options);
    expect(Buffer.compare(Buffer.from(one.bytes), Buffer.from(two.bytes))).toBe(0);
    expect(one.fileName).toBe("five_sector_ready.mcpack");
    expect(one.manifest.format_version).toBe(2);
    expect(one.manifest.header.uuid).not.toBe(one.manifest.modules[0].uuid);
    expect(one.manifest.header.min_engine_version.join(".")).toBe(BEDROCK_STABLE_VERSION);
    expect(one.metadata.builds.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(one.metadata.builds.map(({ origin }) => origin)).toEqual([asymmetricOrigin, secondOrigin]);
    expect(one.metadata.delivery.usesPermanentTickingAreas).toBe(false);
    expect(one.metadata.delivery.iphoneRuntime).toBe("unverified");

    const zip = await JSZip.loadAsync(one.bytes);
    expect(JSON.parse(await zip.file("manifest.json")!.async("text"))).toEqual(one.manifest);
    expect(JSON.parse(await zip.file("blockwright/project.json")!.async("text"))).toEqual(one.metadata);
    for (const build of [first, second]) {
      const metadata = one.metadata.builds.find(({ id }) => id === build.id)!;
      expect(JSON.parse(await zip.file(metadata.buildPath)!.async("text"))).toEqual(build);
      expect(JSON.parse(await zip.file(metadata.contractPath)!.async("text"))).toEqual(build.contract);
      expect(JSON.parse(await zip.file(metadata.certificatePath)!.async("text"))).toEqual(build.certificate);
    }

    const structureEntries = Object.keys(zip.files).filter((path) => path.endsWith(".mcstructure"));
    expect(structureEntries).toHaveLength(one.tiles.length);
    for (const tile of one.tiles) {
      const bytes = await zip.file(tile.filePath)!.async("uint8array");
      const parsed = await parse(Buffer.from(bytes), "little");
      expect(parsed.metadata.size).toBe(bytes.byteLength);
      expect((simplify(parsed.parsed) as any).structure_world_origin).toEqual([tile.origin.x, tile.origin.y, tile.origin.z]);
    }

    const functionEntries = Object.keys(zip.files).filter((path) => path.endsWith(".mcfunction"));
    const functions = (await Promise.all(functionEntries.map(async (path) => zip.file(path)!.async("text")))).join("\n").toLowerCase();
    expect(functions).not.toContain("setblock");
    expect(functions).not.toContain("tickingarea");
    expect(functions.match(/structure load/g)).toHaveLength(one.tiles.length);
    expect(await zip.file("functions/tick.json")!.async("text")).toContain("aqua_meridian/tick");
    for (const action of ["install", "cancel", "status", "cleanup"] as const) {
      expect(zip.file(`functions/${one.metadata.delivery.functions[action]}.mcfunction`)).not.toBeNull();
    }

    const checksumText = await zip.file("blockwright/checksums.sha256")!.async("text");
    const checksumLines = checksumText.trim().split("\n");
    expect(checksumLines).toHaveLength(Object.keys(zip.files).filter((path) => path !== "blockwright/checksums.sha256").length);
    for (const line of checksumLines) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line)!;
      const content = await zip.file(match[2])!.async("uint8array");
      expect(createHash("sha256").update(content).digest("hex")).toBe(match[1]);
    }
  });
});
