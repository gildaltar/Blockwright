import { describe, expect, it } from "vitest";
import { estimateBuild, preflightConfirmationToken } from "./preflight.js";
import { normalizeBuildInput } from "./input-normalization.js";
import { compileBuild } from "./compiler.js";
import type { BuildInput, DesignProgram } from "./types.js";

const base: BuildInput = {
  name: "Resource fixture",
  edition: "bedrock",
  version: "stable",
  style: "custom",
  dimensions: { width: 100, height: 100, depth: 100 },
  sourceBrief: "One exact bounded volume.",
  features: [],
  blockBudget: 2_000_000,
};

function withDesign(elements: DesignProgram["elements"]): BuildInput {
  return { ...base, design: { schemaVersion: 1, description: "fixture", requirements: [], elements } };
}

describe("preflight request binding and Design IR resources", () => {
  it("binds confirmations to design, materials, origin, and budget rather than only the envelope", () => {
    const first = withDesign([{ id: "a", intent: "a", requirementIds: [], kind: "fill", min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 }, material: "minecraft:stone" }]);
    const changed = { ...first, origin: { x: 8, y: 64, z: 2 }, blockBudget: 99, materialLibrary: { accent: "minecraft:gold_block" }, design: { ...first.design!, elements: [{ ...first.design!.elements[0], max: { x: 2, y: 1, z: 1 } }] } };
    expect(preflightConfirmationToken(first)).not.toBe(preflightConfirmationToken(changed));
    expect(preflightConfirmationToken({ ...first, confirmationToken: "old" })).toBe(preflightConfirmationToken(first));
    expect(preflightConfirmationToken(first)).toBe(preflightConfirmationToken(normalizeBuildInput(first)));
  });

  it("rejects huge fills before materializing their coordinates", () => {
    const input = withDesign([{ id: "huge", intent: "huge", requirementIds: [], kind: "fill", min: { x: 0, y: 0, z: 0 }, max: { x: 299, y: 49, z: 299 }, material: "minecraft:stone" }]);
    input.dimensions = { width: 300, height: 50, depth: 300 };
    const result = estimateBuild(input);
    expect(result.estimatedPlacementAttempts).toBe(4_500_000);
    expect(result.estimatedOccupiedBlocks).toBe(4_500_000);
    expect(result.requiresConfirmation).toBe(true);
    expect(() => compileBuild(input)).toThrow(/BUILD_MUST_BE_SPLIT/);
  });

  it("counts overlapping repeated offsets even when the final coordinate set is small", () => {
    const input = withDesign([{
      id: "overlap",
      intent: "overlap",
      requirementIds: [],
      kind: "fill",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 99, y: 99, z: 99 },
      material: "minecraft:stone",
      offsets: Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0 })),
    }]);
    const result = estimateBuild(input);
    expect(result.estimatedOccupiedBlocks).toBe(1_000_000);
    expect(result.estimatedPlacementAttempts).toBe(10_000_000);
    expect(result.warnings.join(" ")).toMatch(/coordinate operations/i);
    expect(() => compileBuild(input)).toThrow(/DESIGN_OPERATION_LIMIT_EXCEEDED/);
  });

  it("enforces the retained-map cap while generating as defense in depth", () => {
    const input = withDesign([{
      id: "bounded",
      intent: "bounded",
      requirementIds: [],
      kind: "fill",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 2, z: 2 },
      material: "minecraft:stone",
    }]);
    expect(() => compileBuild(input, { maximumPlacements: 10, maximumPlacementAttempts: 100 }))
      .toThrow(/BUILD_PLACEMENT_LIMIT_EXCEEDED/);
  });
});
