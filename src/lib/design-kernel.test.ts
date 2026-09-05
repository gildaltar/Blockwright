import { describe, expect, it } from "vitest";
import { compileDesignProgram } from "./design-kernel.js";
import type { DesignAssertion, DesignAtomicClaim, DesignProgram, DesignRequirement, RolePalette } from "./types.js";

type AssertionSpec = DesignAssertion extends infer Assertion
  ? Assertion extends DesignAssertion ? Omit<Assertion, "claimId" | "sourceSpan"> : never
  : never;

function requirement(id: string, text: string, elementIds: string[], predicate: DesignAtomicClaim["predicate"], assertions: AssertionSpec[]): DesignRequirement {
  const sourceSpan = { start: 0, end: text.length, text };
  const claimId = `${id}-claim`;
  return {
    id,
    text,
    elementIds,
    claims: [{ id: claimId, sourceSpan, predicate, status: "asserted" }],
    assertions: assertions.map((assertion) => ({ ...assertion, claimId, sourceSpan })) as DesignAssertion[],
  };
}

const roles: RolePalette = {
  foundation: "minecraft:stone", wall: "minecraft:white_concrete", frame: "minecraft:gray_concrete",
  roof: "minecraft:quartz_block", trim: "minecraft:cyan_concrete", glazing: "minecraft:glass",
  lighting: "minecraft:sea_lantern", doors: "minecraft:iron_door", railings: "minecraft:iron_bars",
  accents: "minecraft:yellow_concrete", landscaping: "minecraft:moss_block",
};

describe("generic design kernel", () => {
  it("turns mapped generic basin and sweep elements into concrete evidence", () => {
    const design: DesignProgram = {
      schemaVersion: 1,
      description: "Generic channel flowing to a contained basin",
      requirements: [
        requirement("channel", "A descending open channel", ["route"], "path", [
          { kind: "placement_count", minimum: 20 },
          { kind: "path_geometry", minimumPaths: 1, minimumControlPointsPerPath: 3, minimumVerticalDrop: 9, supportsRequired: true },
        ]),
        requirement("pool", "A contained water basin", ["landing"], "containment", [
          { kind: "placement_count", minimum: 20 },
          { kind: "element_kind", elementKind: "basin", minimum: 1 },
          { kind: "axis_span", axis: "x", minimum: 12 },
        ]),
      ],
      elements: [
        { id: "route", kind: "sweep", intent: "descending channel", phase: "ride route", requirementIds: ["channel"], points: [{ x: 4, y: 12, z: 4 }, { x: 12, y: 7, z: 12 }, { x: 20, y: 3, z: 20 }], crossSection: "open_channel", width: 5, height: 3, thickness: 1, material: "slide", innerMaterial: "water", supports: { material: "support", interval: 4, toY: 0 } },
        { id: "landing", kind: "basin", intent: "splash basin", phase: "pool", requirementIds: ["pool"], min: { x: 17, y: 0, z: 17 }, max: { x: 28, y: 4, z: 28 }, wallMaterial: "basin", rimMaterial: "rim", liquidMaterial: "water", liquidLevel: 3 },
      ],
    };
    const result = compileDesignProgram(design, {
      dimensions: { width: 32, depth: 32, height: 16 }, origin: { x: 100, y: 64, z: 200 }, rolePalette: roles,
      materialLibrary: { slide: "minecraft:cyan_concrete", water: "minecraft:water", support: "minecraft:gray_concrete", basin: "minecraft:light_blue_concrete", rim: "minecraft:smooth_quartz" },
    });
    expect(result.placements.some((placement) => placement.block === "minecraft:water")).toBe(true);
    expect(result.placements.every((placement) => placement.x >= 100 && placement.y >= 64 && placement.z >= 200)).toBe(true);
    expect(result.elementCounts.route).toBeGreaterThan(20);
    expect(result.requirementCounts.pool).toBeGreaterThan(20);
  });

  it("supports an open-ended material library without truncating late entries", () => {
    const materials = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`detail_${index}`, `minecraft:test_${index}`]));
    const design: DesignProgram = {
      schemaVersion: 1, description: "material coverage", requirements: [requirement("detail", "detail", ["late"], "quantity", [
        { kind: "element_kind", elementKind: "fill", minimum: 1 },
        { kind: "element_instances", minimum: 1 },
        { kind: "distinct_materials", minimum: 1 },
      ])],
      elements: [{ id: "late", kind: "fill", intent: "late material", requirementIds: ["detail"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "detail_119" }],
    };
    const result = compileDesignProgram(design, { dimensions: { width: 5, depth: 5, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles, materialLibrary: materials });
    expect(result.placements[0].block).toBe("minecraft:test_119");
  });

  it("fails closed for missing requirement mappings and out-of-bounds geometry", () => {
    const missing: DesignProgram = { schemaVersion: 1, description: "bad", requirements: [requirement("required", "required", ["missing"], "surface", [
      { kind: "element_kind", elementKind: "fill", minimum: 1 }, { kind: "axis_span", axis: "x", minimum: 2 },
    ])], elements: [] };
    expect(() => compileDesignProgram(missing, { dimensions: { width: 5, depth: 5, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles })).toThrow(/DESIGN_EMPTY|UNMAPPED/);
    const outside: DesignProgram = { schemaVersion: 1, description: "bad", requirements: [requirement("required", "required", ["outside"], "surface", [
      { kind: "element_kind", elementKind: "fill", minimum: 1 }, { kind: "axis_span", axis: "x", minimum: 2 },
    ])], elements: [{ id: "outside", kind: "fill", intent: "outside", requirementIds: ["required"], min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 0, z: 0 }, material: "wall" }] };
    expect(() => compileDesignProgram(outside, { dimensions: { width: 5, depth: 5, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles })).toThrow(/DESIGN_OUT_OF_BOUNDS/);
  });

  it("honors exact odd, even, and one-block path widths", () => {
    const compileWidth = (kind: "sweep" | "stairs", width: number) => {
      const element = kind === "sweep"
        ? { id: "path", kind, intent: "width probe", requirementIds: ["width"], points: [{ x: 5, y: 1, z: 1 }, { x: 5, y: 1, z: 4 }], crossSection: "solid" as const, width, height: 1, material: "wall" }
        : { id: "path", kind, intent: "width probe", requirementIds: ["width"], from: { x: 5, y: 1, z: 1 }, to: { x: 5, y: 1, z: 4 }, width, material: "wall" };
      const widthRequirement = kind === "sweep"
        ? requirement("width", "exact width", ["path"], "path", [{ kind: "path_geometry", minimumPaths: 1, minimumControlPointsPerPath: 2 }])
        : requirement("width", "exact width", ["path"], "access", [{ kind: "element_kind", elementKind: "stairs", minimum: 1 }, { kind: "axis_span", axis: "z", minimum: 4 }]);
      return compileDesignProgram({ schemaVersion: 1, description: "exact width", requirements: [widthRequirement], elements: [element] } as DesignProgram, {
        dimensions: { width: 12, depth: 8, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles,
      });
    };
    for (const width of [1, 2, 4]) for (const kind of ["sweep", "stairs"] as const) {
      const result = compileWidth(kind, width);
      const crossSection = new Set(result.placements.filter(({ z }) => z === 1).map(({ x }) => x));
      expect(crossSection.size, `${kind} width ${width}`).toBe(width);
    }
  });

  it("translates nested local liquid and support elevations for repeated y offsets", () => {
    const text = "offset geometry";
    const design: DesignProgram = {
      schemaVersion: 1,
      description: text,
      requirements: [requirement("offset", text, ["basin", "route"], "quantity", [
        { kind: "element_kind", elementKind: "basin", minimum: 1 },
        { kind: "distinct_elements", minimum: 2 },
      ])],
      elements: [
        { id: "basin", kind: "basin", intent: "offset basin", requirementIds: ["offset"], min: { x: 1, y: 1, z: 1 }, max: { x: 5, y: 4, z: 5 }, wallMaterial: "wall", liquidMaterial: "water", liquidLevel: 3, offsets: [{ x: 0, y: 6, z: 0 }] },
        { id: "route", kind: "sweep", intent: "offset route", requirementIds: ["offset"], points: [{ x: 8, y: 5, z: 1 }, { x: 8, y: 5, z: 5 }], crossSection: "solid", width: 1, height: 1, material: "wall", supports: { material: "frame", interval: 1, toY: 1 }, offsets: [{ x: 0, y: 6, z: 0 }] },
      ],
    };
    const result = compileDesignProgram(design, { dimensions: { width: 12, depth: 8, height: 16 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles, materialLibrary: { water: "minecraft:water" } });
    const waterYs = result.placements.filter(({ block }) => block === "minecraft:water").map(({ y }) => y);
    const supportYs = result.placements.filter(({ phase }) => /support$/.test(phase)).map(({ y }) => y);
    expect(Math.max(...waterYs)).toBe(9);
    expect(Math.min(...supportYs)).toBe(7);
    expect(new Set(result.placements.map(({ elementInstanceId }) => elementInstanceId))).toEqual(new Set(["basin#1", "route#1"]));
  });

  it("caps both retained placements and overlapping put/remove attempts", () => {
    const text = "bounded repeated surface";
    const base: DesignProgram = {
      schemaVersion: 1,
      description: text,
      requirements: [requirement("bounded", text, ["surface"], "surface", [
        { kind: "element_kind", elementKind: "fill", minimum: 1 },
        { kind: "axis_span", axis: "x", minimum: 10 },
      ])],
      elements: [{
        id: "surface", kind: "fill", intent: text, requirementIds: ["bounded"],
        min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 0, z: 9 }, material: "wall",
        offsets: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
      }],
    };
    expect(() => compileDesignProgram(base, {
      dimensions: { width: 12, depth: 12, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles,
      maximumPlacements: 200, maximumPlacementAttempts: 150,
    })).toThrow(/DESIGN_OPERATION_LIMIT_EXCEEDED/);
    expect(() => compileDesignProgram({ ...base, elements: [{ ...base.elements[0], offsets: undefined }] }, {
      dimensions: { width: 12, depth: 12, height: 5 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles,
      maximumPlacements: 50, maximumPlacementAttempts: 200,
    })).toThrow(/BUILD_PLACEMENT_LIMIT_EXCEEDED/);
  });

  it("fills the interior of a tube sweep when innerMaterial is supplied", () => {
    const text = "contained routed tube";
    const design: DesignProgram = {
      schemaVersion: 1,
      description: text,
      requirements: [requirement("tube", text, ["tube"], "path", [
        { kind: "path_geometry", minimumPaths: 1, minimumControlPointsPerPath: 2 },
        { kind: "material_tag_count", tag: "liquid", minimumPlacements: 1 },
      ])],
      elements: [{
        id: "tube", kind: "sweep", intent: text, requirementIds: ["tube"],
        points: [{ x: 4, y: 4, z: 2 }, { x: 4, y: 4, z: 8 }], crossSection: "tube", width: 7, height: 7,
        thickness: 1, material: "wall", innerMaterial: "water",
      }],
    };
    const result = compileDesignProgram(design, {
      dimensions: { width: 10, depth: 12, height: 10 }, origin: { x: 0, y: 0, z: 0 }, rolePalette: roles,
      materialLibrary: { water: { block: "minecraft:water", tags: ["liquid"] } },
    });
    expect(result.placements.some(({ block, phase }) => block === "minecraft:water" && /tube contents$/.test(phase))).toBe(true);
    expect(result.placements.some(({ block, phase }) => block === "minecraft:white_concrete" && /tube shell$/.test(phase))).toBe(true);
  });
});
