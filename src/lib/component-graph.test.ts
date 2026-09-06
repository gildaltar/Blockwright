import { describe, expect, it } from "vitest";
import { ComponentCache } from "./component-cache.js";
import { compileBuild } from "./compiler.js";
import { compileDesignProgram, type ComponentOperationCacheEntry } from "./design-kernel.js";
import type { DesignProgramV2, DesignRepetition, DesignRequirement, RolePalette } from "./types.js";

const roles: RolePalette = {
  foundation: "minecraft:stone", wall: "minecraft:white_concrete", frame: "minecraft:gray_concrete",
  roof: "minecraft:quartz_block", trim: "minecraft:cyan_concrete", glazing: "minecraft:glass",
  lighting: "minecraft:sea_lantern", doors: "minecraft:iron_door", railings: "minecraft:iron_bars",
  accents: "minecraft:yellow_concrete", landscaping: "minecraft:moss_block",
};

function requirement(elementIds: string[]): DesignRequirement {
  const text = "component geometry";
  const sourceSpan = { start: 0, end: text.length, text };
  return {
    id: "shape",
    text,
    elementIds,
    claims: [{ id: "shape-claim", sourceSpan, predicate: "quantity", status: "asserted" }],
    assertions: [
      { kind: "placement_count", claimId: "shape-claim", sourceSpan, minimum: 1 },
      { kind: "distinct_elements", claimId: "shape-claim", sourceSpan, minimum: 1 },
    ],
  };
}

const options = {
  dimensions: { width: 12, depth: 5, height: 5 },
  origin: { x: 100, y: 64, z: 200 },
  edition: "java" as const,
  rolePalette: roles,
};

describe("Design IR v2 component compilation", () => {
  it("expands referenced templates and merges independent components by phase then stable ID", () => {
    const design: DesignProgramV2 = {
      schemaVersion: 2,
      description: "component ordering and repetition",
      requirements: [requirement(["base", "pillar", "cut", "override"])],
      elements: [
        { id: "base", kind: "fill", intent: "base", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "foundation" },
        { id: "pillar", kind: "fill", intent: "pillar", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "frame" },
        { id: "cut", kind: "carve", intent: "opening", requirementIds: ["shape"], min: { x: 3, y: 0, z: 0 }, max: { x: 3, y: 0, z: 0 } },
        { id: "override", kind: "fill", intent: "override", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "accents" },
      ],
      templates: [{ id: "pillar_template", elementIds: ["pillar"] }],
      components: [
        { id: "override", name: "Override", type: "finish", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, dependencies: [], elementIds: ["override"], seed: "o", operationPhase: "explicit_overrides", revision: { revision: 1 } },
        { id: "opening", name: "Opening", type: "cut", bounds: { min: { x: 3, y: 0, z: 0 }, max: { x: 3, y: 0, z: 0 } }, dependencies: [], elementIds: ["cut"], seed: "x", operationPhase: "cuts_openings", revision: { revision: 1 } },
        { id: "columns", name: "Columns", type: "structure", bounds: { min: { x: 1, y: 0, z: 0 }, max: { x: 5, y: 0, z: 0 } }, dependencies: [], elementIds: [], templateInstances: [{ id: "row", templateId: "pillar_template", origin: { x: 1, y: 0, z: 0 }, repetition: { kind: "linear", count: 3, step: { x: 2, y: 0, z: 0 } } }], seed: "c", operationPhase: "structure", revision: { revision: 1 } },
        { id: "foundation", name: "Foundation", type: "foundation", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, dependencies: [], elementIds: ["base"], seed: "f", operationPhase: "terrain_foundation", revision: { revision: 1 } },
      ],
    };
    const cache = new ComponentCache<ComponentOperationCacheEntry>({ maxEntries: 10, maxWeight: 100 });
    const first = compileDesignProgram(design, { ...options, componentCache: cache });
    expect(first.componentGraph?.order).toEqual(["foundation", "columns", "opening", "override"]);
    expect(first.placements.filter(({ componentId }) => componentId === "columns").map(({ x }) => x)).toEqual([101, 105]);
    expect(first.placements.find(({ x }) => x === 100)?.block).toBe("minecraft:yellow_concrete");
    expect(first.compileReport?.conflicts).toContainEqual(expect.objectContaining({
      coordinate: { x: 103, y: 64, z: 200 },
      kind: "removal",
      previous: expect.objectContaining({ componentId: "columns" }),
      incoming: expect.objectContaining({ componentId: "opening" }),
    }));
    expect(first.compileReport?.conflicts).toContainEqual(expect.objectContaining({
      coordinate: { x: 100, y: 64, z: 200 },
      kind: "replacement",
      previous: expect.objectContaining({ componentId: "foundation" }),
      incoming: expect.objectContaining({ componentId: "override" }),
    }));

    const second = compileDesignProgram(design, { ...options, componentCache: cache, previousComponentGraph: first.componentGraph });
    expect(second.placements).toEqual(first.placements);
    expect(second.componentGraph?.graphHash).toBe(first.componentGraph?.graphHash);
    expect(second.compileReport).toMatchObject({ changed: [], rebuilt: [], reused: ["foundation", "columns", "opening", "override"], cacheHits: 4 });
    second.placements[0].block = "minecraft:poisoned_cache_probe";
    const third = compileDesignProgram(design, { ...options, componentCache: cache, previousComponentGraph: first.componentGraph });
    expect(third.placements).toEqual(first.placements);
  });

  it("rebuilds a changed component and its dependents while reusing an unrelated component", () => {
    const makeDesign = (foundationMaxX: number): DesignProgramV2 => ({
      schemaVersion: 2,
      description: "incremental graph",
      requirements: [requirement(["foundation_op", "wall_op", "tree_op"])],
      elements: [
        { id: "foundation_op", kind: "fill", intent: "foundation", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: foundationMaxX, y: 0, z: 0 }, material: "foundation" },
        { id: "wall_op", kind: "fill", intent: "wall", requirementIds: ["shape"], min: { x: 3, y: 0, z: 0 }, max: { x: 3, y: 1, z: 0 }, material: "wall" },
        { id: "tree_op", kind: "fill", intent: "tree", requirementIds: ["shape"], min: { x: 6, y: 0, z: 0 }, max: { x: 6, y: 0, z: 0 }, material: "landscaping" },
      ],
      templates: [],
      components: [
        { id: "walls", name: "Walls", type: "walls", bounds: { min: { x: 3, y: 0, z: 0 }, max: { x: 3, y: 1, z: 0 } }, dependencies: ["foundation"], elementIds: ["wall_op"], seed: "w", operationPhase: "walls", revision: { revision: 1 } },
        { id: "landscape", name: "Landscape", type: "landscape", bounds: { min: { x: 6, y: 0, z: 0 }, max: { x: 6, y: 0, z: 0 } }, dependencies: [], elementIds: ["tree_op"], seed: "l", operationPhase: "landscaping", revision: { revision: 1 } },
        { id: "foundation", name: "Foundation", type: "foundation", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } }, dependencies: [], elementIds: ["foundation_op"], seed: "f", operationPhase: "terrain_foundation", revision: { revision: 1 } },
      ],
    });
    const cache = new ComponentCache<ComponentOperationCacheEntry>({ maxEntries: 20, maxWeight: 100 });
    const first = compileDesignProgram(makeDesign(0), { ...options, componentCache: cache });
    const revised = compileDesignProgram(makeDesign(1), { ...options, componentCache: cache, previousComponentGraph: first.componentGraph });
    expect(revised.compileReport?.changed).toEqual(["foundation"]);
    expect(revised.compileReport?.rebuilt).toEqual(["foundation", "walls"]);
    expect(revised.compileReport?.reused).toEqual(["landscape"]);

    const recolored = compileDesignProgram(makeDesign(0), {
      ...options,
      rolePalette: { ...roles, landscaping: "minecraft:oak_leaves" },
      componentCache: cache,
      previousComponentGraph: first.componentGraph,
    });
    expect(recolored.compileReport?.changed).toEqual(["landscape"]);
    expect(recolored.compileReport?.rebuilt).toEqual(["landscape"]);
    expect(recolored.compileReport?.reused).toEqual(["foundation", "walls"]);
    const oldLandscape = first.componentGraph?.components.find(({ id }) => id === "landscape")!;
    const newLandscape = recolored.componentGraph?.components.find(({ id }) => id === "landscape")!;
    expect(newLandscape.geometryHash).toBe(oldLandscape.geometryHash);
    expect(newLandscape.materialHash).not.toBe(oldLandscape.materialHash);

    const unrelatedPaletteChange = compileDesignProgram(makeDesign(0), {
      ...options,
      rolePalette: { ...roles, roof: "minecraft:deepslate_tiles" },
      componentCache: cache,
      previousComponentGraph: first.componentGraph,
    });
    expect(unrelatedPaletteChange.compileReport?.changed).toEqual([]);
    expect(unrelatedPaletteChange.compileReport?.rebuilt).toEqual([]);
    expect(unrelatedPaletteChange.compileReport?.reused).toEqual(["foundation", "walls", "landscape"]);
  });

  it.each<Array<[string, DesignRepetition, string[]]>>([
    ["grid", { kind: "grid", count: { x: 2, y: 1, z: 2 }, step: { x: 2, y: 0, z: 2 } }, ["1,1", "1,3", "3,1", "3,3"]],
    ["radial", { kind: "radial", count: 4, center: { x: 5, y: 0, z: 5 }, radius: 2 }, ["4,6", "6,4", "6,8", "8,6"]],
    ["mirrored", { kind: "mirrored", axis: "x", coordinate: 5 }, ["3,1", "7,1"]],
    ["alternating", { kind: "alternating", count: 3, step: { x: 2, y: 0, z: 0 }, alternateOffset: { x: 0, y: 0, z: 1 } }, ["1,1", "3,2", "5,1"]],
    ["position-list", { kind: "position_list", positions: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }, ["1,1", "3,1"]],
  ])("supports %s template repetition without copying the template definition", (_name, repetition, expected) => {
    const design: DesignProgramV2 = {
      schemaVersion: 2,
      description: "typed repetition",
      requirements: [requirement(["unit"])],
      elements: [{ id: "unit", kind: "fill", intent: "unit", requirementIds: ["shape"], min: { x: 1, y: 0, z: 1 }, max: { x: 1, y: 0, z: 1 }, material: "frame" }],
      templates: [{ id: "unit_template", elementIds: ["unit"] }],
      components: [{
        id: "repeated", name: "Repeated", type: "detail",
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 11, y: 0, z: 11 } },
        dependencies: [], elementIds: [], seed: "repeat", operationPhase: "detail", revision: { revision: 1 },
        templateInstances: [{
          id: "instances", templateId: "unit_template",
          origin: repetition.kind === "mirrored" ? { x: 2, y: 0, z: 0 } : undefined,
          repetition,
          materialOverrides: { frame: "trim" },
        }],
      }],
    };
    const result = compileDesignProgram(design, { ...options, dimensions: { width: 12, depth: 12, height: 5 } });
    expect(result.placements.map(({ x, z }) => `${x - options.origin.x},${z - options.origin.z}`).sort()).toEqual([...expected].sort());
    expect(result.placements.every(({ block }) => block === roles.trim)).toBe(true);
    expect(design.templates[0].elementIds).toEqual(["unit"]);
  });

  it("rejects dependency cycles with component attribution", () => {
    const design: DesignProgramV2 = {
      schemaVersion: 2,
      description: "cycle",
      requirements: [requirement(["block"])],
      elements: [{ id: "block", kind: "fill", intent: "block", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "wall" }],
      templates: [],
      components: [
        { id: "a", name: "A", type: "part", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, dependencies: ["b"], elementIds: ["block"], seed: "a", operationPhase: "walls", revision: { revision: 1 } },
        { id: "b", name: "B", type: "part", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, dependencies: ["a"], elementIds: ["block"], seed: "b", operationPhase: "walls", revision: { revision: 1 } },
      ],
    };
    expect(() => compileDesignProgram(design, options)).toThrow(/DESIGN_COMPONENT_DEPENDENCY_CYCLE.*a.*b/);
  });
});

describe("component cache", () => {
  it("evicts least-recently-used entries within both entry and weight bounds", () => {
    const cache = new ComponentCache<string>({ maxEntries: 2, maxWeight: 3 });
    cache.set("a", "A", 1);
    cache.set("b", "B", 1);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
    expect(cache.stats()).toMatchObject({ entries: 2, weight: 3, evictions: 1 });
  });
});

describe("component compiler integration", () => {
  it("attaches the graph and incremental report to v2 BuildRecords", () => {
    const design: DesignProgramV2 = {
      schemaVersion: 2,
      description: "single component",
      requirements: [requirement(["voxel"])],
      elements: [{ id: "voxel", kind: "fill", intent: "single component", requirementIds: ["shape"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "foundation" }],
      templates: [],
      components: [{ id: "foundation", name: "Foundation", type: "foundation", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, dependencies: [], elementIds: ["voxel"], seed: "fixed", operationPhase: "terrain_foundation", revision: { revision: 1 } }],
    };
    const componentCache = new ComponentCache<ComponentOperationCacheEntry>({ maxEntries: 4, maxWeight: 20 });
    const build = compileBuild({
      name: "Component Integration",
      edition: "java",
      version: "26.2",
      style: "nordic",
      sourceBrief: "single component",
      dimensions: { width: 5, depth: 5, height: 5 },
      design,
    }, { componentCache });
    expect(build.componentGraph?.order).toEqual(["foundation"]);
    expect(build.compileReport).toMatchObject({ rebuilt: ["foundation"], reused: [], cacheHits: 0, cacheMisses: 1 });
    expect(build.placements[0]).toMatchObject({ componentId: "foundation", operationPhase: "terrain_foundation" });
  });
});
