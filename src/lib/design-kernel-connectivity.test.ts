import { describe, expect, it } from "vitest";
import { compileDesignProgram } from "./design-kernel.js";
import type { DesignProgram, Placement, RolePalette, Vec3 } from "./types.js";

const rolePalette: RolePalette = {
  foundation: "minecraft:stone",
  wall: "minecraft:white_concrete",
  frame: "minecraft:gray_concrete",
  roof: "minecraft:quartz_block",
  trim: "minecraft:cyan_concrete",
  glazing: "minecraft:glass",
  lighting: "minecraft:sea_lantern",
  doors: "minecraft:iron_door",
  railings: "minecraft:iron_bars",
  accents: "minecraft:yellow_concrete",
  landscaping: "minecraft:moss_block",
};

const coordinateKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const faceOffsets: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function bounds(placements: Placement[]) {
  return {
    min: {
      x: Math.min(...placements.map(({ x }) => x)),
      y: Math.min(...placements.map(({ y }) => y)),
      z: Math.min(...placements.map(({ z }) => z)),
    },
    max: {
      x: Math.max(...placements.map(({ x }) => x)),
      y: Math.max(...placements.map(({ y }) => y)),
      z: Math.max(...placements.map(({ z }) => z)),
    },
  };
}

function components(placements: Placement[]) {
  const remaining = new Map(placements.map((placement) => [coordinateKey(placement), placement]));
  const connected: Placement[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as Placement;
    const pending = [first];
    remaining.delete(coordinateKey(first));
    const component: Placement[] = [];
    while (pending.length) {
      const placement = pending.pop()!;
      component.push(placement);
      for (const offset of faceOffsets) {
        const key = coordinateKey({
          x: placement.x + offset.x,
          y: placement.y + offset.y,
          z: placement.z + offset.z,
        });
        const neighbor = remaining.get(key);
        if (!neighbor) continue;
        remaining.delete(key);
        pending.push(neighbor);
      }
    }
    connected.push(component);
  }
  return connected.sort((a, b) => b.length - a.length);
}

describe("generic sweep connectivity", () => {
  it("keeps a diagonal width-7 tube shell and inner material face-connected", () => {
    const text = "A descending enclosed route";
    const sourceSpan = { start: 0, end: text.length, text };
    const design: DesignProgram = {
      schemaVersion: 1,
      description: "Regression geometry from the Aqua Meridian magenta flume",
      requirements: [{
        id: "route",
        text,
        elementIds: ["tube"],
        claims: [{ id: "route-path", sourceSpan, predicate: "path", status: "asserted" }],
        assertions: [{
          claimId: "route-path",
          sourceSpan,
          elementIds: ["tube"],
          kind: "path_geometry",
          minimumPaths: 1,
          minimumControlPointsPerPath: 5,
          minimumVerticalDrop: 43,
        }],
      }],
      elements: [{
        id: "tube",
        kind: "sweep",
        intent: "magenta enclosed corkscrew flume",
        phase: "tube flume",
        requirementIds: ["route"],
        points: [
          { x: 47, y: 47, z: 28 },
          { x: 65, y: 42, z: 35 },
          { x: 80, y: 33, z: 50 },
          { x: 76, y: 20, z: 69 },
          { x: 68, y: 4, z: 94 },
        ],
        crossSection: "tube",
        material: "flume_magenta",
        width: 7,
        height: 7,
        thickness: 1,
        innerMaterial: "water",
        supports: { material: "support", interval: 6, toY: 1 },
      }],
    };

    const options = {
      dimensions: { width: 112, depth: 112, height: 72 },
      origin: { x: 0, y: 0, z: 0 },
      rolePalette,
      materialLibrary: {
        flume_magenta: "minecraft:magenta_concrete",
        water: { block: "minecraft:water", tags: ["liquid"] },
        support: "minecraft:gray_concrete",
      },
    };
    const result = compileDesignProgram(design, options);
    const repeated = compileDesignProgram(design, options);
    const occupied = new Set(result.placements.map(coordinateKey));
    const isolated = result.placements.filter((placement) => (
      placement.block !== "minecraft:water"
      && !faceOffsets.some((offset) => occupied.has(coordinateKey({
        x: placement.x + offset.x,
        y: placement.y + offset.y,
        z: placement.z + offset.z,
      })))
    ));
    const innerMaterial = result.placements.filter(({ block }) => block === "minecraft:water");
    const innerComponents = components(innerMaterial);
    const innerComponentSizes = innerComponents.map(({ length }) => length);
    const pockets = innerComponents.filter(({ length }) => length === 1).flat();

    expect(isolated, `${isolated.length} isolated tube voxels: ${isolated.slice(0, 20).map(coordinateKey).join(" ")}`).toEqual([]);
    expect(innerMaterial.length).toBeGreaterThan(500);
    expect(innerComponentSizes, `inner-material component sizes: ${innerComponentSizes.join(", ")}; pockets: ${pockets.map(coordinateKey).join(" ")}`).toEqual([innerMaterial.length]);
    expect(pockets).toEqual([]);
    expect(repeated.placements).toEqual(result.placements);
    expect(result.placements.length).toBeGreaterThan(1_000);
    expect(result.placements.length).toBeLessThan(5_000);
    expect(bounds(result.placements)).toEqual({
      min: { x: 46, y: 1, z: 25 },
      max: { x: 83, y: 50, z: 95 },
    });
  });
});
