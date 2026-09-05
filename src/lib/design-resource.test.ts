import { describe, expect, it } from "vitest";
import { estimateDesignPlacementAttempts } from "./design-resource.js";
import type { DesignProgram } from "./types.js";

function program(elements: DesignProgram["elements"]): DesignProgram {
  return { schemaVersion: 1, description: "resource fixture", requirements: [], elements };
}

describe("Design IR resource estimation", () => {
  it("counts repeated operations even when all offsets overlap", () => {
    const estimate = estimateDesignPlacementAttempts(program([{
      id: "overlap",
      intent: "overlapping fills",
      requirementIds: [],
      kind: "fill",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 99, y: 99, z: 99 },
      material: "wall",
      offsets: Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0 })),
    }]));
    expect(estimate).toBe(10_000_000);
  });

  it("bounds sweep cross-sections and support columns without sampling the path", () => {
    const estimate = estimateDesignPlacementAttempts(program([{
      id: "route",
      intent: "supported route",
      requirementIds: [],
      kind: "sweep",
      points: [{ x: 0, y: 50, z: 0 }, { x: 100, y: 10, z: 100 }],
      crossSection: "tube",
      material: "wall",
      innerMaterial: "water",
      width: 8,
      height: 6,
      supports: { material: "frame", interval: 8, toY: 0, radius: 1 },
    }]));
    expect(estimate).toBeGreaterThan(50_000);
  });
});
