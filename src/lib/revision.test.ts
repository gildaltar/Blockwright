import { describe, expect, it } from "vitest";
import { calculateBuildHash } from "./contract.js";
import { compileBuild } from "./compiler.js";
import { calculatePlacementBounds, reviseSelectedRegion } from "./revision.js";

const input = {
  name: "Regional Revision Fixture",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 13, depth: 11, height: 11 },
  origin: { x: -20, y: 70, z: 35 },
  blockBudget: 20_000,
  seed: "region-revision",
  features: [],
};

describe("selected-region revision", () => {
  it("calculates bounds without spread-argument failure for release-scale placement arrays", () => {
    const placements = Array.from({ length: 150_000 }, (_, x) => ({ x, y: 64, z: -5, block: "minecraft:stone", phase: "stress" }));
    expect(calculatePlacementBounds(placements)).toEqual({
      min: { x: 0, y: 64, z: -5 },
      max: { x: 149_999, y: 64, z: -5 },
      dimensions: { width: 150_000, depth: 1, height: 1 },
    });
  });

  it("preserves every placement outside the inclusive cuboid and reissues hash-bound audit artifacts", () => {
    const base = compileBuild(input);
    expect(base.contract.status).toBe("valid");
    const target = base.placements.find((placement) => (
      placement.x > base.bounds.min.x && placement.x < base.bounds.max.x
      && placement.z > base.bounds.min.z && placement.z < base.bounds.max.z
    ))!;
    const region = { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } };
    const replacement = { ...structuredClone(target), phase: `${target.phase}: client revision` };
    const result = reviseSelectedRegion(base, region, [replacement]);
    const outside = base.placements.filter((placement) => (
      placement.x !== target.x || placement.y !== target.y || placement.z !== target.z
    ));
    const revisedOutside = result.build.placements.filter((placement) => (
      placement.x !== target.x || placement.y !== target.y || placement.z !== target.z
    ));

    expect(new Set(revisedOutside.map((placement) => JSON.stringify(placement)))).toEqual(new Set(outside.map((placement) => JSON.stringify(placement))));
    expect(result.preservedOutsideCount).toBe(outside.length);
    expect(result.parentHash).toBe(base.hash);
    expect(result.build.hash).toBe(calculateBuildHash(result.build.input, result.build.placements));
    expect(result.build.hash).not.toBe(base.hash);
    expect(result.build.contract.status).toBe("valid");
    expect(result.build.contract.buildHash).toBe(result.build.hash);
    expect(result.build.certificate.buildHash).toBe(result.build.hash);
    expect(result.build.certificate).not.toEqual(base.certificate);
    expect(result.diff.changed).toHaveLength(1);
    expect(result.diff.added).toHaveLength(0);
    expect(result.diff.removed).toHaveLength(0);
  });

  it("normalizes reversed bounds but rejects replacements outside the selected region", () => {
    const base = compileBuild(input);
    const placement = base.placements[Math.floor(base.placements.length / 2)];
    const reversed = {
      min: { x: placement.x + 1, y: placement.y + 1, z: placement.z + 1 },
      max: { x: placement.x, y: placement.y, z: placement.z },
    };
    expect(() => reviseSelectedRegion(base, reversed, [{ ...placement, x: placement.x + 2 }])).toThrow(/outside the inclusive selected region/);
  });

  it("fails closed when the edit violates an implicit locked hard clause", () => {
    const base = compileBuild(input);
    const minimumXPlane = {
      min: { x: base.bounds.min.x, y: base.bounds.min.y, z: base.bounds.min.z },
      max: { x: base.bounds.min.x, y: base.bounds.max.y, z: base.bounds.max.z },
    };
    expect(() => reviseSelectedRegion(base, minimumXPlane, [])).toThrow(/LOCKED_REQUIREMENTS_VIOLATED/);
  });

  it("rejects duplicate replacement coordinates", () => {
    const base = compileBuild(input);
    const target = base.placements[0];
    const region = { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } };
    expect(() => reviseSelectedRegion(base, region, [target, target])).toThrow(/duplicate coordinate/);
  });

  it("requires an evaluator for caller-supplied locked requirements outside the canonical contract", () => {
    const base = compileBuild(input);
    const target = base.placements[0];
    const region = { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } };
    expect(() => reviseSelectedRegion(base, region, [target], { lockedRequirementIds: ["client-custom-lock"] })).toThrow(/LOCKED_REQUIREMENTS_UNVERIFIED/);
  });
});
