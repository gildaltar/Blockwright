import { describe, expect, it } from "vitest";
import {
  analyzeTerrainFit,
  confirmTerrainFitPreview,
  verifyTerrainFitPreview,
  type TerrainFitBuild,
  type TerrainFitOptions,
  type TerrainWorldRegion,
} from "./terrain-fit.js";

function matrix<T>(width: number, depth: number, value: T | ((x: number, z: number) => T)) {
  return Array.from({ length: depth }, (_, z) => Array.from({ length: width }, (_, x) => typeof value === "function" ? (value as (x: number, z: number) => T)(x, z) : value));
}

function build(): TerrainFitBuild {
  return {
    id: "bw_terrain_fixture",
    hash: "a".repeat(64),
    input: {
      edition: "java",
      version: "26.2",
      origin: { x: 0, y: 0, z: 0 },
      style: "japanese",
      seed: "terrain-fixture",
    },
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 4, y: 4, z: 4 },
      dimensions: { width: 5, depth: 5, height: 5 },
    },
    placements: [],
    plan: { entrances: [{ side: "south", width: 3, emphasis: "gate" }] },
  };
}

function region(overrides: Partial<TerrainWorldRegion> = {}): TerrainWorldRegion {
  return {
    edition: "java",
    version: "26.2",
    origin: { x: 0, y: 0, z: 0 },
    dimensions: { width: 15, depth: 15, height: 32 },
    heightMap: matrix(15, 15, 4),
    biomeMap: matrix(15, 15, "minecraft:plains"),
    surfaceBlocks: matrix(15, 15, "minecraft:grass_block"),
    ...overrides,
  };
}

function options(overrides: Partial<TerrainFitOptions> = {}): TerrainFitOptions {
  return {
    targetAnchor: { x: 5, y: 5, z: 5 },
    maximumHorizontalOffset: 0,
    rotations: [0],
    maximumCandidates: 16,
    terrainInterface: {
      strategy: "flat_pad",
      maxCutDepth: 3,
      maxFillHeight: 5,
      allowRetainingWalls: true,
      allowTerraces: true,
      blendRadius: 2,
      waterPolicy: "preserve",
    },
    ...overrides,
  };
}

describe("TerrainFit analysis and confirmation", () => {
  it("keeps a flat matching site unchanged and produces a confirmable immutable preview", () => {
    const preview = analyzeTerrainFit(build(), region(), options());

    expect(preview.risk).toBe("green");
    expect(preview.cutVolume).toBe(0);
    expect(preview.fillVolume).toBe(0);
    expect(preview.changedTerrainArea).toBe(0);
    expect(preview.selected.anchor).toEqual({ x: 5, y: 5, z: 5 });
    expect(verifyTerrainFitPreview(preview)).toBe(true);

    const confirmed = confirmTerrainFitPreview(preview, preview.hash);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.installationBoundary).toBe("procedural_plan_only");
    expect(confirmed.operations).toEqual(preview.operations);
  });

  it("is deterministic for the same build, region, and seed", () => {
    const first = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x, z) => 2 + Math.floor((x + z) / 5)),
    }), options({ maximumHorizontalOffset: 2, rotations: [0, 90] }));
    const second = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x, z) => 2 + Math.floor((x + z) / 5)),
    }), options({ maximumHorizontalOffset: 2, rotations: [0, 90] }));

    expect(second.hash).toBe(first.hash);
    expect(second.selected).toEqual(first.selected);
    expect(second.operations).toEqual(first.operations);
  });

  it("computes cut and fill across hill and valley columns", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x, z) => x < 7 ? 7 : z > 7 ? 1 : 4),
    }), options({
      terrainInterface: {
        ...options().terrainInterface,
        maxCutDepth: 10,
        maxFillHeight: 10,
        blendRadius: 0,
      },
    }));

    expect(preview.cutVolume).toBeGreaterThan(0);
    expect(preview.fillVolume).toBeGreaterThan(0);
    expect(preview.operations.some(({ op }) => op === "grade_surface")).toBe(true);
  });

  it("marks a cliff placement red when cut or fill limits are exceeded", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x) => x < 7 ? 14 : 0),
    }), options({
      terrainInterface: {
        ...options().terrainInterface,
        maxCutDepth: 2,
        maxFillHeight: 2,
        blendRadius: 0,
      },
    }));

    expect(preview.risk).toBe("red");
    expect(preview.warnings.some((warning) => /cut depth|fill height/.test(warning))).toBe(true);
    expect(() => confirmTerrainFitPreview(preview, preview.hash)).toThrow(/TERRAIN_FIT_BLOCKED/);
  });

  it("fails closed for water under preserve and permits an explicit bridge policy", () => {
    const wet = region({ waterCoordinates: [{ x: 7, y: 4, z: 7 }] });
    const preserved = analyzeTerrainFit(build(), wet, options());
    const bridged = analyzeTerrainFit(build(), wet, options({
      terrainInterface: { ...options().terrainInterface, waterPolicy: "bridge" },
    }));

    expect(preserved.risk).toBe("red");
    expect(preserved.waterConflicts).toHaveLength(1);
    expect(bridged.risk).not.toBe("red");
    expect(bridged.operations).toContainEqual(expect.objectContaining({ op: "water_interface", policy: "bridge" }));
  });

  it("reports protected-coordinate and structure conflicts", () => {
    const preview = analyzeTerrainFit(build(), region({
      protectedCoordinates: [{ x: 6, y: 6, z: 6 }],
      structures: [{
        name: "protected shrine",
        bounds: { min: { x: 8, y: 4, z: 8 }, max: { x: 10, y: 10, z: 10 } },
      }],
    }), options());

    expect(preview.risk).toBe("red");
    expect(preview.protectedConflicts).toContainEqual({ x: 6, y: 6, z: 6 });
    expect(preview.structureConflicts).toEqual(["protected shrine"]);
  });

  it("connects the inferred entrance to a nearby path without crossing protected water", () => {
    const preview = analyzeTerrainFit(build(), region({
      pathCoordinates: [{ x: 12, y: 4, z: 9 }],
      waterCoordinates: [{ x: 10, y: 4, z: 9 }],
    }), options({
      terrainInterface: { ...options().terrainInterface, waterPolicy: "preserve" },
    }));

    expect(preview.pathConnection.status).toBe("connected");
    expect(preview.pathConnection.to).toMatchObject({ x: 12, z: 9 });
    expect(preview.pathConnection.crossesWater).toBe(0);
    expect(preview.operations.some(({ op }) => op === "connect_path")).toBe(true);
  });

  it("creates style-aware retaining structures for steep foundation edges", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x, z) => x === 5 || z === 5 ? 0 : 4),
    }), options({
      retainingThreshold: 2,
      terrainInterface: {
        ...options().terrainInterface,
        maxFillHeight: 10,
        blendRadius: 0,
      },
    }));
    const retaining = preview.operations.find(({ op }) => op === "retaining_structure");

    expect(preview.retainingWalls.required).toBe(true);
    expect(retaining).toEqual(expect.objectContaining({
      op: "retaining_structure",
      material: "minecraft:stone_bricks",
      accentMaterial: "minecraft:mossy_stone_bricks",
    }));
  });

  it("fails closed when retaining support is required but disabled", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, (x) => x === 5 ? 0 : 4),
    }), options({
      retainingThreshold: 2,
      terrainInterface: {
        ...options().terrainInterface,
        maxFillHeight: 10,
        allowRetainingWalls: false,
        blendRadius: 0,
      },
    }));

    expect(preview.risk).toBe("red");
    expect(preview.warnings).toContain("Retaining support is required but disabled.");
    expect(preview.operations.some(({ op }) => op === "retaining_structure")).toBe(false);
  });

  it("samples native desert materials and reconstructs biome strata", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, 1),
      biomeMap: matrix(15, 15, "minecraft:desert"),
      surfaceBlocks: matrix(15, 15, "minecraft:sand"),
    }), options({
      lockTargetY: true,
      terrainInterface: {
        ...options().terrainInterface,
        maxFillHeight: 10,
        blendRadius: 3,
      },
    }));
    const grading = preview.operations.find(({ op }) => op === "grade_surface");

    expect(preview.sampledBiomes[0]).toEqual({ biome: "minecraft:desert", count: expect.any(Number) });
    expect(preview.sampledNativeMaterials[0]).toEqual({ block: "minecraft:sand", count: expect.any(Number) });
    expect(grading).toEqual(expect.objectContaining({
      op: "grade_surface",
      strataByBiome: expect.objectContaining({
        "minecraft:desert": ["minecraft:sand", "minecraft:sand", "minecraft:sandstone", "minecraft:stone"],
      }),
    }));
  });

  it("prefers observed shallow geology over biome defaults when samples are supplied", () => {
    const preview = analyzeTerrainFit(build(), region({
      heightMap: matrix(15, 15, 2),
      subsurfaceBlocks: matrix(15, 15, () => ["minecraft:coarse_dirt", "minecraft:granite", "minecraft:tuff"]),
    }), options({
      lockTargetY: true,
      terrainInterface: {
        ...options().terrainInterface,
        maxFillHeight: 10,
        blendRadius: 3,
      },
    }));
    const grading = preview.operations.find(({ op }) => op === "grade_surface");

    expect(grading).toEqual(expect.objectContaining({
      op: "grade_surface",
      strataByBiome: expect.objectContaining({
        "minecraft:plains": ["minecraft:coarse_dirt", "minecraft:granite", "minecraft:tuff"],
      }),
    }));
    expect(preview.sampledNativeMaterials).toEqual(expect.arrayContaining([
      expect.objectContaining({ block: "minecraft:granite" }),
      expect.objectContaining({ block: "minecraft:tuff" }),
    ]));
  });

  it("rejects altered previews, stale confirmation hashes, and edition/version mismatch", () => {
    const preview = analyzeTerrainFit(build(), region(), options());
    const altered = structuredClone(preview);
    altered.selected.anchor.x += 1;

    expect(() => verifyTerrainFitPreview(altered)).toThrow(/TERRAIN_FIT_PREVIEW_INTEGRITY/);
    expect(() => confirmTerrainFitPreview(preview, "b".repeat(64))).toThrow(/TERRAIN_FIT_CONFIRMATION_MISMATCH/);
    expect(() => analyzeTerrainFit(build(), region({ version: "26.1" }), options())).toThrow(/TERRAIN_FIT_VERSION_MISMATCH/);
    expect(() => analyzeTerrainFit(build(), region({ edition: "bedrock" }), options())).toThrow(/TERRAIN_FIT_EDITION_MISMATCH/);
  });
});
