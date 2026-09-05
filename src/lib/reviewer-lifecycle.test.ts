import { describe, expect, it } from "vitest";
import {
  createReviewerLease,
  isForeignReviewerLease,
  reviewer3dEnabled,
  summarizeReviewerMaterials,
} from "./reviewer-lifecycle.js";

describe("reviewer lifecycle containment", () => {
  it("enables placement loading only after explicit activation in fullscreen", () => {
    expect(reviewer3dEnabled(false, "inline")).toBe(false);
    expect(reviewer3dEnabled(true, "inline")).toBe(false);
    expect(reviewer3dEnabled(false, "fullscreen")).toBe(false);
    expect(reviewer3dEnabled(true, "fullscreen")).toBe(true);
  });

  it("recognizes only a different valid reviewer lease", () => {
    const lease = createReviewerLease("new-viewer", 123);
    expect(isForeignReviewerLease(lease, "old-viewer")).toBe(true);
    expect(isForeignReviewerLease(lease, "new-viewer")).toBe(false);
    expect(isForeignReviewerLease({ ...lease, activatedAt: Number.NaN }, "old-viewer")).toBe(false);
    expect(isForeignReviewerLease({ type: lease.type }, "old-viewer")).toBe(false);
  });

  it("keeps an exact material count while bounding the inline summary", () => {
    const materialCounts = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`minecraft:material_${index}`, index + 1]));
    const summary = summarizeReviewerMaterials(materialCounts, 4);
    expect(summary.materialCount).toBe(300);
    expect(summary.visible).toHaveLength(4);
    expect(summary.visible.map(([block]) => block)).toEqual([
      "minecraft:material_299",
      "minecraft:material_298",
      "minecraft:material_297",
      "minecraft:material_296",
    ]);
    expect(summary.hiddenCount).toBe(296);
    expect(Object.keys(materialCounts)).toHaveLength(300);
  });
});
