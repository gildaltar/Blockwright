import { describe, expect, it } from "vitest";
import { toBlueprint } from "./exports.js";
import type { BuildRecord, Placement } from "./types.js";

describe("text blueprint material vocabulary", () => {
  it("assigns an unambiguous token to every material beyond a one-character alphabet", () => {
    const placements: Placement[] = Array.from({ length: 125 }, (_, index) => ({
      x: index,
      y: 64,
      z: 0,
      block: `test:material_${index + 1}`,
      phase: "fixture",
    }));
    const materialCounts = Object.fromEntries(placements.map(({ block }) => [block, 1]));
    const blueprint = toBlueprint({
      input: { name: "Open material vocabulary" },
      bounds: {
        min: { x: 0, y: 64, z: 0 },
        max: { x: 124, y: 64, z: 0 },
        dimensions: { width: 125, height: 1, depth: 1 },
      },
      placements,
      materialCounts,
    } as BuildRecord);

    const legendTokens = [...blueprint.matchAll(/^(M\d+) = test:material_\d+$/gm)].map((match) => match[1]);
    expect(legendTokens).toHaveLength(125);
    expect(new Set(legendTokens).size).toBe(125);
    expect(blueprint).toContain("M125 = test:material_125");
    expect(blueprint).not.toMatch(/^\? =/m);
    expect(blueprint.split("Layer Y=64\n")[1].trim().split(/\s+/)).toHaveLength(125);
  });
});
