import { describe, expect, it } from "vitest";
import { ComponentCache } from "./component-cache.js";
import { compileDesignProgram, type ComponentOperationCacheEntry } from "./design-kernel.js";
import { resolveProceduralMaterial } from "./material-distribution.js";
import { compileProceduralGeometry } from "./procedural-geometry.js";
import type { DesignPrimitive, DesignProgramV2, DesignRequirement, ProceduralMaterialDefinition, RolePalette } from "./types.js";

const roles: RolePalette = {
  foundation: "minecraft:stone", wall: "minecraft:white_concrete", frame: "minecraft:gray_concrete",
  roof: "minecraft:quartz_block", trim: "minecraft:cyan_concrete", glazing: "minecraft:glass",
  lighting: "minecraft:sea_lantern", doors: "minecraft:iron_door", railings: "minecraft:iron_bars",
  accents: "minecraft:yellow_concrete", landscaping: "minecraft:moss_block",
};

function requirement(elementIds: string[]): DesignRequirement {
  const text = "procedural geometry";
  const sourceSpan = { start: 0, end: text.length, text };
  return {
    id: "shape", text, elementIds,
    claims: [{ id: "shape-claim", sourceSpan, predicate: "quantity", status: "asserted" }],
    assertions: [
      { kind: "placement_count", claimId: "shape-claim", sourceSpan, minimum: 1 },
      { kind: "distinct_elements", claimId: "shape-claim", sourceSpan, minimum: 1 },
    ],
  };
}

const options = {
  dimensions: { width: 16, depth: 16, height: 16 },
  origin: { x: 100, y: 64, z: 200 },
  edition: "java" as const,
  rolePalette: roles,
};

describe("procedural primitive rasterization", () => {
  const profile = { plane: "xy" as const, points: [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 1, v: 2 }] };
  const primitives: Array<[string, DesignPrimitive]> = [
    ["line", { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 2, z: 1 } }],
    ["plane", { type: "plane", min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 0, z: 3 } }],
    ["circle", { type: "circle", center: { x: 4, y: 4, z: 4 }, radius: 3 }],
    ["ellipse", { type: "ellipse", center: { x: 4, y: 4, z: 4 }, radiusU: 3, radiusV: 2, axis: "x", filled: true }],
    ["sphere", { type: "sphere", center: { x: 4, y: 4, z: 4 }, radius: 3, hollow: true }],
    ["cone", { type: "cone", baseCenter: { x: 4, y: 1, z: 4 }, radius: 3, height: 5, hollow: true }],
    ["pyramid", { type: "pyramid", min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 4, z: 6 } }],
    ["polygon", { type: "polygon", points: [{ x: 0, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 2, y: 2, z: 4 }] }],
    ["rounded rectangle", { type: "rounded_rectangle", min: { x: 0, y: 1, z: 0 }, max: { x: 6, y: 1, z: 4 }, radius: 2 }],
    ["rounded square", { type: "rounded_square", min: { x: 0, y: 1, z: 0 }, max: { x: 6, y: 1, z: 6 }, radius: 2, filled: true }],
    ["extrusion", { type: "extrusion", origin: { x: 1, y: 1, z: 1 }, profile, offset: { x: 0, y: 0, z: 4 } }],
    ["profile extrusion", { type: "profile_extrusion", profile, path: [{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 5 }, { x: 4, y: 1, z: 5 }] }],
    ["roof plane", { type: "roof_plane", min: { x: 0, y: 2, z: 0 }, max: { x: 5, y: 5, z: 3 }, slopeAxis: "x" }],
    ["roof ridge", { type: "roof_ridge", min: { x: 0, y: 2, z: 0 }, max: { x: 5, y: 5, z: 6 }, ridgeAxis: "x" }],
    ["terrain surface", { type: "terrain_surface", min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 6, z: 5 }, baseY: 3, amplitude: 2, scale: 3, seed: "terrain", fillToY: 0 }],
  ];

  it.each(primitives)("rasterizes %s deterministically without implicit air", (_name, primitive) => {
    const first = compileProceduralGeometry(primitive);
    const second = compileProceduralGeometry(primitive);
    expect(first.points.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(first.points.every(({ point }) => Object.values(point).every(Number.isSafeInteger))).toBe(true);
  });

  it("combines clip and positive/inverted masks as sparse geometry", () => {
    const result = compileProceduralGeometry(
      { type: "plane", min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 0, z: 6 } },
      {
        clip: { min: { x: 1, y: 0, z: 1 }, max: { x: 5, y: 0, z: 5 } },
        masks: [
          { primitive: { type: "circle", center: { x: 3, y: 0, z: 3 }, radius: 3, filled: true } },
          { primitive: { type: "circle", center: { x: 3, y: 0, z: 3 }, radius: 1, filled: true }, invert: true },
        ],
      },
    );
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.some(({ point }) => point.x === 3 && point.z === 3)).toBe(false);
    expect(result.points.every(({ point }) => point.x >= 1 && point.x <= 5 && point.z >= 1 && point.z <= 5)).toBe(true);
  });
});

describe("procedural materials and boolean operations", () => {
  it("resolves every distribution deterministically and preserves exact IDs and states", () => {
    const materials: Record<string, ProceduralMaterialDefinition> = {
      exact: { block: "minecraft:oak_stairs", state: { facing: "east", half: "top" } },
      random: { distribution: "weighted_random", seed: "r", blocks: [{ material: "exact", weight: 1 }, { id: "minecraft:stone", weight: 2 }] },
      noise: { distribution: "weighted_noise", seed: "n", scale: 3, blocks: [{ id: "minecraft:stone", weight: 1 }, { id: "minecraft:dirt", weight: 1 }] },
      clustered: { distribution: "clustered_noise", seed: "c", scale: 2, blocks: [{ id: "minecraft:stone", weight: 1 }, { id: "minecraft:moss_block", weight: 1 }] },
      gradient: { distribution: "gradient", axis: "y", stops: [{ at: 0, material: "exact" }, { at: 0.5, material: { id: "minecraft:quartz_block" } }] },
      checker: { distribution: "checker", size: { x: 1, y: 1, z: 1 }, materials: ["exact", { id: "minecraft:black_concrete" }] },
      pattern: { distribution: "pattern", axis: "x", stride: 2, materials: [{ id: "minecraft:red_concrete" }, { id: "minecraft:blue_concrete" }] },
      weathered: { distribution: "weathering", seed: "w", amount: 0, base: "exact", weathered: { id: "minecraft:mossy_cobblestone" }, edge: { weight: 1, exposedAxesAtLeast: 2 }, height: { minY: 8, weight: 0.2 }, surfaceDirection: { directions: ["up"], weight: 0.2 } },
    };
    const context = { coordinate: { x: 2, y: 8, z: 4 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 8, z: 8 } }, componentSeed: "component", surfaceDirections: ["up", "east"] as const };
    const resolveAll = () => Object.keys(materials).map((reference) => resolveProceduralMaterial(reference, { materials, rolePalette: roles }, context, true));
    expect(resolveAll()).toEqual(resolveAll());
    expect(resolveAll()[0]).toEqual({ block: "minecraft:oak_stairs", state: { facing: "east", half: "top" } });
    expect(resolveAll().every(({ block }) => block.startsWith("minecraft:"))).toBe(true);
    expect(resolveAll().at(-1)?.block).toBe("minecraft:mossy_cobblestone");
  });

  it("applies intersect then cut in declared order without emitting air placements", () => {
    const design: DesignProgramV2 = {
      schemaVersion: 2, description: "boolean order", requirements: [requirement(["base", "keep", "cut"])], materials: {}, templates: [],
      elements: [
        { id: "base", kind: "procedural", intent: "base", requirementIds: ["shape"], primitive: { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 0, z: 0 } }, material: "foundation" },
        { id: "keep", kind: "procedural", intent: "intersection", requirementIds: ["shape"], operation: "intersect", primitive: { type: "line", from: { x: 1, y: 0, z: 0 }, to: { x: 3, y: 0, z: 0 } } },
        { id: "cut", kind: "procedural", intent: "cut", requirementIds: ["shape"], operation: "cut", primitive: { type: "line", from: { x: 2, y: 0, z: 0 }, to: { x: 2, y: 0, z: 0 } } },
      ],
      components: [
        { id: "mass", name: "Mass", type: "mass", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 0, z: 0 } }, dependencies: [], elementIds: ["base"], seed: "m", operationPhase: "primary_mass", revision: { revision: 1 } },
        { id: "boolean", name: "Boolean", type: "cut", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 0, z: 0 } }, dependencies: ["mass"], elementIds: ["keep", "cut"], seed: "b", operationPhase: "cuts_openings", revision: { revision: 1 } },
      ],
    };
    const result = compileDesignProgram(design, options);
    expect(result.placements.map(({ x }) => x - options.origin.x)).toEqual([1, 3]);
    expect(result.placements.some(({ block }) => block.includes("air"))).toBe(false);
    expect(result.compileReport?.conflicts.filter(({ kind }) => kind === "removal")).toHaveLength(3);
  });

  it("invalidates cache only when a referenced distributed material changes", () => {
    const makeDesign = (used: string, unused: string): DesignProgramV2 => ({
      schemaVersion: 2, description: "material cache", requirements: [requirement(["surface"])], templates: [],
      materials: {
        finish: { distribution: "checker", size: { x: 1, y: 1, z: 1 }, materials: [{ id: used }, { id: "minecraft:stone" }] },
        unused: { block: unused },
      },
      elements: [{ id: "surface", kind: "procedural", intent: "surface", requirementIds: ["shape"], primitive: { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 3, y: 0, z: 0 } }, material: "finish" }],
      components: [{ id: "surface", name: "Surface", type: "finish", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 0, z: 0 } }, dependencies: [], elementIds: ["surface"], seed: "fixed", operationPhase: "detail", revision: { revision: 1 } }],
    });
    const cache = new ComponentCache<ComponentOperationCacheEntry>({ maxEntries: 10, maxWeight: 100 });
    const first = compileDesignProgram(makeDesign("minecraft:white_concrete", "minecraft:dirt"), { ...options, componentCache: cache });
    const unrelated = compileDesignProgram(makeDesign("minecraft:white_concrete", "minecraft:grass_block"), { ...options, componentCache: cache, previousComponentGraph: first.componentGraph });
    expect(unrelated.compileReport).toMatchObject({ changed: [], rebuilt: [], reused: ["surface"] });
    const referenced = compileDesignProgram(makeDesign("minecraft:black_concrete", "minecraft:grass_block"), { ...options, componentCache: cache, previousComponentGraph: unrelated.componentGraph });
    expect(referenced.compileReport).toMatchObject({ changed: ["surface"], rebuilt: ["surface"], reused: [] });
  });
});
