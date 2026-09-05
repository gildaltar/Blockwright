import { describe, expect, it } from "vitest";
import type { BuildRecord } from "./types.js";
import {
  createReviewAnnotationId,
  getReviewBoundsMetrics,
  getReviewMeasurement,
  getReviewStateBuildStatus,
  MAX_REVIEW_ANNOTATIONS,
  MAX_REVIEW_SEARCH_RESULTS,
  MAX_REVIEW_STATE_STRING_LENGTH,
  MAX_REVIEW_VALIDATION_WORK,
  parseReviewCoordinate,
  prependReviewAnnotation,
  searchReviewPlacements,
  validateReviewDocument,
} from "./reviewer.js";

const build = {
  id: "build_review_fixture",
  hash: "a".repeat(64),
  bounds: { min: { x: -2, y: 64, z: 4 }, max: { x: 2, y: 66, z: 7 }, dimensions: { width: 5, height: 3, depth: 4 } },
  placements: [
    { x: -2, y: 64, z: 4, block: "minecraft:stone", phase: "foundation" },
    { x: -1, y: 64, z: 4, block: "minecraft:oak_stairs", phase: "entry", state: { facing: "north", half: "bottom" } },
    { x: 2, y: 66, z: 7, block: "minecraft:lantern", phase: "lighting", state: { hanging: true } },
  ],
} as BuildRecord;

const legacyAnnotation = {
  id: "review_legacy_1",
  category: "fix",
  note: "Repeat this support rule anywhere the same condition occurs.",
  bounds: { min: { x: -2, y: 64, z: 4 }, max: { x: -1, y: 64, z: 4 } },
  blockCount: 2,
  pickedBlock: "minecraft:oak_stairs",
  pickedState: { half: "bottom", facing: "north" },
  createdAt: "2026-09-04T06:00:00.000Z",
};

function documentWith(annotations: unknown[]) {
  return {
    schemaVersion: 1,
    type: "blockwright-review",
    build: { id: build.id, hash: build.hash },
    annotations,
  };
}

describe("reviewer navigation helpers", () => {
  it("parses exact coordinate, labeled coordinate, and teleport inputs", () => {
    expect(parseReviewCoordinate("-2, 64, 4")).toEqual({ x: -2, y: 64, z: 4 });
    expect(parseReviewCoordinate("x=-2 y=64 z=4")).toEqual({ x: -2, y: 64, z: 4 });
    expect(parseReviewCoordinate("/tp @s -2 64 4")).toEqual({ x: -2, y: 64, z: 4 });
    expect(parseReviewCoordinate("stone -2 64 4")).toBeUndefined();
  });

  it("reports inclusive selection dimensions and explicit center distances", () => {
    const bounds = { min: { x: -2, y: 64, z: 4 }, max: { x: 2, y: 66, z: 7 } };
    expect(getReviewBoundsMetrics(bounds, 3)).toEqual({ width: 5, height: 3, depth: 4, volume: 60, blockCount: 3, density: .05 });
    expect(getReviewMeasurement(bounds)).toEqual({ dx: 4, dy: 2, dz: 3, horizontal: 5, direct: Math.sqrt(29), manhattan: 9 });
  });

  it("requires meaningful text and caps collected placement search results", () => {
    expect(searchReviewPlacements(build.placements, "s")).toMatchObject({ matches: [], capped: false, tooShort: true });
    const placements = Array.from({ length: MAX_REVIEW_SEARCH_RESULTS + 25 }, (_, index) => ({ x: index, y: 64, z: 4, block: "minecraft:stone", phase: "foundation" }));
    const result = searchReviewPlacements(placements, "stone");
    expect(result.matches).toHaveLength(MAX_REVIEW_SEARCH_RESULTS);
    expect(result.capped).toBe(true);
  });

  it("binds persisted review state to both immutable build identifiers", () => {
    expect(getReviewStateBuildStatus({}, build)).toBe("unbound");
    expect(getReviewStateBuildStatus({ reviewBuildId: build.id, reviewBuildHash: build.hash }, build)).toBe("current");
    expect(getReviewStateBuildStatus({ reviewBuildId: "different", reviewBuildHash: build.hash }, build)).toBe("different");
    expect(getReviewStateBuildStatus({ reviewBuildId: build.id, reviewBuildHash: "different" }, build)).toBe("different");
    expect(getReviewStateBuildStatus({ reviewBuildId: build.id }, build)).toBe("different");
  });

  it("disambiguates generated annotation ids and enforces the hard collection limit", () => {
    expect(createReviewAnnotationId(["review_fixed", "review_fixed_2"], "fixed")).toBe("review_fixed_3");
    expect(createReviewAnnotationId([], "unsafe uuid/value")).toMatch(/^review_[A-Za-z0-9._:]+$/);

    const { id: _id, ...annotation } = legacyAnnotation;
    const almostFull = Array.from({ length: MAX_REVIEW_ANNOTATIONS - 1 }, (_, index) => ({ ...legacyAnnotation, id: `review_existing_${index}` }));
    const full = prependReviewAnnotation(almostFull, annotation, "fixed");
    expect(full).toHaveLength(MAX_REVIEW_ANNOTATIONS);
    expect(prependReviewAnnotation(full!, annotation, "fixed")).toBeUndefined();
  });
});

describe("portable review validation", () => {
  it("keeps schema-v1 annotations backward-compatible and accepts optional resolution", () => {
    const imported = validateReviewDocument(documentWith([
      legacyAnnotation,
      {
        ...legacyAnnotation,
        id: "review_resolved_2",
        bounds: { min: { x: 2, y: 66, z: 7 }, max: { x: 2, y: 66, z: 7 } },
        blockCount: 1,
        pickedBlock: "minecraft:lantern",
        pickedState: { hanging: true },
        resolved: true,
        updatedAt: "2026-09-04T06:30:00.000Z",
      },
    ]), build);
    expect(imported[0].resolved).toBeUndefined();
    expect(imported[1].resolved).toBe(true);
    expect(imported[0].pickedState).toEqual({ facing: "north", half: "bottom" });
  });

  it("rejects a different immutable build before replacing annotations", () => {
    expect(() => validateReviewDocument({ ...documentWith([]), build: { id: build.id, hash: "different" } }, build)).toThrow(/immutable build hash/i);
  });

  it.each([
    ["fractional coordinates", { ...legacyAnnotation, bounds: { min: { x: -1.5, y: 64, z: 4 }, max: { x: -1, y: 64, z: 4 } } }, /integer coordinates/i],
    ["out-of-bounds coordinates", { ...legacyAnnotation, bounds: { min: { x: -3, y: 64, z: 4 }, max: { x: -1, y: 64, z: 4 } } }, /outside/i],
    ["reversed bounds", { ...legacyAnnotation, bounds: { min: { x: -1, y: 64, z: 4 }, max: { x: -2, y: 64, z: 4 } } }, /reversed/i],
    ["stale block count", { ...legacyAnnotation, blockCount: 1 }, /block count/i],
    ["noncanonical state", { ...legacyAnnotation, pickedState: { facing: "south", half: "bottom" } }, /not canonical/i],
    ["unknown category", { ...legacyAnnotation, category: "maybe" }, /category/i],
  ])("rejects %s", (_label, annotation, message) => {
    expect(() => validateReviewDocument(documentWith([annotation]), build)).toThrow(message as RegExp);
  });

  it("rejects duplicate ids and bounded-import abuse", () => {
    expect(() => validateReviewDocument(documentWith([legacyAnnotation, legacyAnnotation]), build)).toThrow(/repeats id/i);
    expect(() => validateReviewDocument(documentWith(Array.from({ length: MAX_REVIEW_ANNOTATIONS + 1 }, () => legacyAnnotation)), build)).toThrow(/at most/i);
  });

  it("accepts exactly 500 imported annotations but cannot append a 501st", () => {
    const fullImport = validateReviewDocument(documentWith(Array.from({ length: MAX_REVIEW_ANNOTATIONS }, (_, index) => ({ ...legacyAnnotation, id: `review_imported_${index}` }))), build);
    const { id: _id, ...annotation } = legacyAnnotation;
    expect(fullImport).toHaveLength(MAX_REVIEW_ANNOTATIONS);
    expect(prependReviewAnnotation(fullImport, annotation, "new_note")).toBeUndefined();
    expect(fullImport.map((item) => item.id === fullImport[0].id ? { ...item, note: "Edited at the limit." } : item)).toHaveLength(MAX_REVIEW_ANNOTATIONS);
  });

  it("rejects annotation/build combinations that exceed bounded canonical validation work", () => {
    const annotations = Array.from({ length: MAX_REVIEW_ANNOTATIONS }, (_, index) => ({ ...legacyAnnotation, id: `review_work_${index}` }));
    const placements = Array.from({ length: Math.floor(MAX_REVIEW_VALIDATION_WORK / MAX_REVIEW_ANNOTATIONS) + 1 }, () => build.placements[0]);
    expect(() => validateReviewDocument(documentWith(annotations), { ...build, placements })).toThrow(/too large to validate safely/i);
  });

  it("bounds imported state text and validates dense coordinate matches safely", () => {
    const denseBuild = {
      ...build,
      placements: Array.from({ length: 1_000 }, () => ({ ...build.placements[1], state: { custom: "x".repeat(MAX_REVIEW_STATE_STRING_LENGTH) } })),
    } as BuildRecord;
    const denseAnnotation = {
      ...legacyAnnotation,
      bounds: { min: { x: -1, y: 64, z: 4 }, max: { x: -1, y: 64, z: 4 } },
      blockCount: 1_000,
      pickedState: { custom: "x".repeat(MAX_REVIEW_STATE_STRING_LENGTH) },
    };
    expect(validateReviewDocument(documentWith([denseAnnotation]), denseBuild)).toHaveLength(1);
    expect(() => validateReviewDocument(documentWith([{ ...denseAnnotation, pickedState: { custom: "x".repeat(MAX_REVIEW_STATE_STRING_LENGTH + 1) } }]), denseBuild)).toThrow(/picked state/i);
  });
});
