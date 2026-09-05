import { beforeAll, describe, expect, it } from "vitest";
import { compileDesignProgram } from "../src/lib/design-kernel.js";
import {
  AQUA_MERIDIAN_MATERIALS,
  generateAquaMeridian,
  type AquaMeridianResult,
} from "./generate-aqua-meridian.js";

function faceConnectedComponentCount(points: readonly { x: number; y: number; z: number }[]) {
  const key = ({ x, y, z }: { x: number; y: number; z: number }) => `${x},${y},${z}`;
  const remaining = new Set(points.map(key));
  let components = 0;
  for (const start of points) {
    const startKey = key(start);
    if (!remaining.delete(startKey)) continue;
    components += 1;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = queue[cursor];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const neighbor = { x: point.x + dx, y: point.y + dy, z: point.z + dz };
        if (remaining.delete(key(neighbor))) queue.push(neighbor);
      }
    }
  }
  return components;
}

describe("Aqua Meridian generic-design acceptance build", () => {
  let result: AquaMeridianResult;

  beforeAll(async () => {
    result = await generateAquaMeridian();
  }, 20_000);

  it("preserves all five exact sector envelopes and every original feature string", () => {
    expect(result.builds).toHaveLength(5);
    expect(result.report.featureEvidence).toHaveLength(34);
    for (const [index, build] of result.builds.entries()) {
      const fixture = result.fixture.builds[index];
      expect(build.input.origin).toEqual(fixture.origin);
      expect(build.input.dimensions).toEqual(fixture.dimensions);
      expect([...build.input.features].sort()).toEqual([...fixture.features].sort());
      expect(build.bounds.min).toEqual(fixture.origin);
      expect(build.contract.status).toBe("valid");
      expect(build.certificate.buildHash).toBe(build.hash);
      expect(build.placements.length).toBeLessThanOrEqual(150_000);
      expect(build.input.design.requirements.every(({ claims, assertions }) =>
        claims.length > 0
        && claims.every(({ status }) => status === "asserted")
        && claims.every(({ id }) => assertions.some(({ claimId }) => claimId === id))
      )).toBe(true);
    }
  });

  it("uses an open-ended palette and measures diversity from actual placements", () => {
    expect(Object.keys(AQUA_MERIDIAN_MATERIALS).length).toBeGreaterThan(60);
    expect(result.report.actualProjectMaterials).toBeGreaterThan(30);
    expect(result.report.actualMaterialIds).toContain("minecraft:water");
    for (const sector of result.report.sectors) expect(sector.actualMaterials).toBeGreaterThan(16);
  });

  it("uses generic primitives instead of a waterpark object catalog or Nordic fallback", () => {
    const kinds = new Set(result.builds.flatMap(({ input }) => input.design.elements.map(({ kind }) => kind)));
    expect(kinds).toEqual(new Set(["fill", "shell", "carve", "cylinder", "basin", "sweep", "stairs", "ramp"]));
    expect(result.builds.every(({ input }) => input.style === "modern")).toBe(true);
    expect(result.builds.every(({ input }) => input.design.elements.some(({ offsets }) => (offsets?.length ?? 0) > 1))).toBe(true);
  });

  it("materializes four distinct descending flume paths with support evidence", () => {
    const thrill = result.builds[1];
    const flumes = ["thrill-flume-a", "thrill-flume-b", "thrill-flume-c", "thrill-flume-d"].map((elementId) => {
      const placements = thrill.placements.filter((placement) => placement.elementId === elementId);
      expect(placements.length).toBeGreaterThan(100);
      expect(placements.some(({ phase }) => /support/.test(phase))).toBe(true);
      const ys = placements.map(({ y }) => y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(30);
      return `${Math.min(...placements.map(({ x }) => x))}:${Math.max(...placements.map(({ x }) => x))}:${Math.min(...placements.map(({ z }) => z))}:${Math.max(...placements.map(({ z }) => z))}`;
    });
    expect(new Set(flumes).size).toBe(4);
    const quantified = thrill.input.design.requirements.find(({ text }) => /^Four distinct/.test(text))!;
    expect(quantified.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "path_geometry", minimumPaths: 4, supportsRequired: true }),
    ]));

    const [flumeB, flumeD] = ["thrill-flume-b", "thrill-flume-d"].map((id) => thrill.input.design.elements.find((element) => element.id === id)!);
    const isolatedCoordinates = [flumeB, flumeD].map((element) => new Set(compileDesignProgram({
      schemaVersion: 1,
      description: `${element.id} strict non-intersection check`,
      requirements: [],
      elements: [{ ...element, requirementIds: [] }],
    }, {
      dimensions: thrill.input.dimensions,
      origin: thrill.input.origin,
      edition: thrill.input.edition,
      rolePalette: thrill.input.rolePalette,
      materialLibrary: thrill.input.materialLibrary,
    }).placements.map(({ x, y, z }) => `${x},${y},${z}`)));
    expect([...isolatedCoordinates[0]].filter((coordinate) => isolatedCoordinates[1].has(coordinate)), "Flumes B and D must not share shell, support, or water coordinates").toHaveLength(0);
  });

  it("puts canonical water inside every open and enclosed slide route", () => {
    const expectedSlides = [
      [1, "thrill-flume-a"],
      [1, "thrill-flume-b"],
      [1, "thrill-flume-c"],
      [1, "thrill-flume-d"],
      [3, "family-small-slide-a"],
      [3, "family-small-slide-b"],
    ] as const;
    for (const [sectorIndex, elementId] of expectedSlides) {
      const water = result.builds[sectorIndex].placements.filter((placement) =>
        placement.elementId === elementId && placement.block === "minecraft:water"
      );
      expect(water.length, `${elementId} must contain generated water`).toBeGreaterThan(0);
      expect(faceConnectedComponentCount(water), `${elementId} water must remain face-connected after every later design element`).toBe(1);
    }
  });

  it("keeps the family lazy-river water in one face-connected component", () => {
    const riverWater = result.builds[3].placements.filter(({ block, elementId }) =>
      block === "minecraft:water" && elementId === "family-river"
    );
    expect(riverWater.length).toBeGreaterThan(1_000);
    expect(faceConnectedComponentCount(riverWater)).toBe(1);
  });

  it("binds numeric height and repeated-instance phrases to their exact source spans", () => {
    const tower = result.builds[1].input.design.requirements.find(({ text }) => /^Fifty-block-high/.test(text))!;
    expect(tower.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "axis_span", axis: "y", minimum: 50 }),
    ]));
    const kiosks = result.builds[4].input.design.requirements.find(({ text }) => /^Two snack kiosks/.test(text))!;
    expect(kiosks.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "element_instances", minimum: 2, elementIds: ["service-kiosks"] }),
    ]));
    for (const requirement of [tower, kiosks]) for (const assertion of requirement.assertions) {
      expect(requirement.text.slice(assertion.sourceSpan.start, assertion.sourceSpan.end)).toBe(assertion.sourceSpan.text);
    }
  });

  it("retains canonical water in every water-dependent sector and stays inside the project envelope", () => {
    for (const sectorIndex of [1, 2, 3]) expect(result.report.sectors[sectorIndex].waterBlocks).toBeGreaterThan(1_000);
    const { minimum, maximum } = result.fixture.project.overallBounds;
    expect(result.builds.every((build) => build.placements.every((placement) =>
      placement.x >= minimum.x && placement.x <= maximum.x
      && placement.y >= minimum.y && placement.y <= maximum.y
      && placement.z >= minimum.z && placement.z <= maximum.z
    ))).toBe(true);
  });

  it("passes the physical reviewer with clear boundary entrances and paired Bedrock doors", () => {
    expect(result.report.physicalAudits).toHaveLength(5);
    for (const audit of result.report.physicalAudits) {
      expect(audit.totals.errors).toBe(0);
      expect(audit.findings).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "NO_BOUNDARY_ENTRANCE" }),
        expect.objectContaining({ code: "BLOCKED_ENTRANCE_CLEARANCE" }),
        expect.objectContaining({ code: "INVALID_BEDROCK_DOOR_PAIR" }),
      ]));
    }
    for (const build of result.builds) {
      const doors = build.placements.filter(({ block }) => block === "minecraft:iron_door");
      const lower = doors.filter(({ state }) => state?.upper_block_bit === false || state?.upper_block_bit === 0);
      const upper = doors.filter(({ state }) => state?.upper_block_bit === true || state?.upper_block_bit === 1);
      expect(lower.length).toBeGreaterThan(0);
      expect(upper).toHaveLength(lower.length);
    }
  });
});
