import type { SemanticBuildAudit } from "./contract.js";
import type { BuildCertificate, BuildContractResult, BuildRecord, Placement, Vec3 } from "./types.js";

export type ReviewCategory = "change" | "fix" | "remove" | "liked";

export type ReviewBounds = { min: Vec3; max: Vec3 };

export type ReviewAnnotation = {
  id: string;
  category: ReviewCategory;
  note: string;
  bounds: ReviewBounds;
  blockCount: number;
  pickedBlock?: string;
  pickedState?: Placement["state"];
  createdAt: string;
  resolved?: boolean;
  updatedAt?: string;
};

export const REVIEW_CATEGORIES = ["change", "fix", "remove", "liked"] as const satisfies readonly ReviewCategory[];
export const MAX_REVIEW_IMPORT_BYTES = 1_000_000;
export const MAX_REVIEW_ANNOTATIONS = 500;
export const MAX_REVIEW_NOTE_LENGTH = 4_000;
export const MAX_REVIEW_VALIDATION_WORK = 12_000_000;
export const MAX_REVIEW_SEARCH_RESULTS = 500;
export const MAX_REVIEW_STATE_STRING_LENGTH = 256;
export const MIN_REVIEW_TEXT_SEARCH_LENGTH = 2;

export type ReviewStateBuildStatus = "unbound" | "current" | "different";

export type ReviewBoundsMetrics = {
  width: number;
  height: number;
  depth: number;
  volume: number;
  blockCount: number;
  density: number;
};

export type ReviewMeasurement = {
  dx: number;
  dy: number;
  dz: number;
  horizontal: number;
  direct: number;
  manhattan: number;
};

export type AuditFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  total: number;
  coordinates: Vec3[];
};

export type BuildAudit = {
  buildId: string;
  hash: string;
  scannedPlacements: number;
  statefulPlacements: number;
  findings: AuditFinding[];
  totals: { errors: number; warnings: number; info: number; affectedPlacements: number };
  checks: string[];
  semantic: SemanticBuildAudit;
  contract: BuildContractResult;
  certificate: BuildCertificate;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerVec3(value: unknown): value is Vec3 {
  return isRecord(value) && [value.x, value.y, value.z].every((part) => typeof part === "number" && Number.isSafeInteger(part));
}

function isWithinBounds(point: Vec3, bounds: ReviewBounds) {
  return point.x >= bounds.min.x && point.x <= bounds.max.x
    && point.y >= bounds.min.y && point.y <= bounds.max.y
    && point.z >= bounds.min.z && point.z <= bounds.max.z;
}

function isOrderedBounds(bounds: ReviewBounds) {
  return bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}

function stateSignature(state: Placement["state"]) {
  return JSON.stringify(Object.entries(state ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

function validState(value: unknown): value is NonNullable<Placement["state"]> {
  return isRecord(value)
    && Object.keys(value).length <= 64
    && Object.entries(value).every(([key, part]) => key.length > 0
      && key.length <= 100
      && (typeof part === "boolean"
        || (typeof part === "number" && Number.isFinite(part))
        || (typeof part === "string" && part.length <= MAX_REVIEW_STATE_STRING_LENGTH)));
}

function validDate(value: unknown) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function invalidReview(message: string): never {
  throw new Error(`Invalid review: ${message}`);
}

export function countPlacementsWithin(build: BuildRecord, bounds: ReviewBounds) {
  return build.placements.reduce((total, placement) => total + (isWithinBounds(placement, bounds) ? 1 : 0), 0);
}

export function getReviewBoundsMetrics(bounds: ReviewBounds, blockCount: number): ReviewBoundsMetrics {
  const width = bounds.max.x - bounds.min.x + 1;
  const height = bounds.max.y - bounds.min.y + 1;
  const depth = bounds.max.z - bounds.min.z + 1;
  const volume = Math.max(0, width * height * depth);
  return { width, height, depth, volume, blockCount, density: volume ? blockCount / volume : 0 };
}

export function getReviewMeasurement(bounds: ReviewBounds): ReviewMeasurement {
  const dx = bounds.max.x - bounds.min.x;
  const dy = bounds.max.y - bounds.min.y;
  const dz = bounds.max.z - bounds.min.z;
  return {
    dx,
    dy,
    dz,
    horizontal: Math.hypot(dx, dz),
    direct: Math.hypot(dx, dy, dz),
    manhattan: Math.abs(dx) + Math.abs(dy) + Math.abs(dz),
  };
}

export function parseReviewCoordinate(query: string): Vec3 | undefined {
  const text = query.trim();
  const coordinate = text.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)
    ?? text.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)
    ?? text.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);
  if (!coordinate) return undefined;
  const [x, y, z] = coordinate.slice(1).map(Number);
  return [x, y, z].every(Number.isSafeInteger) ? { x, y, z } : undefined;
}

export function searchReviewPlacements(placements: Placement[], query: string) {
  const normalized = query.trim().toLowerCase().replace(/^minecraft:/, "");
  if (normalized.length < MIN_REVIEW_TEXT_SEARCH_LENGTH) return { matches: [] as Placement[], capped: false, tooShort: Boolean(normalized) };
  const matches: Placement[] = [];
  let capped = false;
  for (const placement of placements) {
    const blockName = placement.block.replace("minecraft:", "");
    const state = Object.entries(placement.state ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => `${key}=${String(part)}`).join(" ");
    const searchable = `${blockName} ${blockName.replaceAll("_", " ")} ${placement.phase} ${state}`.toLowerCase();
    if (!searchable.includes(normalized)) continue;
    if (matches.length === MAX_REVIEW_SEARCH_RESULTS) { capped = true; break; }
    matches.push(placement);
  }
  return { matches, capped, tooShort: false };
}

/**
 * Classify persisted view state before any build-bound values are rendered.
 * Older reviewer state has no identity and is migrated separately; a partial
 * identity is treated as different so an interrupted write cannot leak state.
 */
export function getReviewStateBuildStatus(
  state: { reviewBuildId?: unknown; reviewBuildHash?: unknown },
  build: Pick<BuildRecord, "id" | "hash">,
): ReviewStateBuildStatus {
  const hasId = typeof state.reviewBuildId === "string";
  const hasHash = typeof state.reviewBuildHash === "string";
  if (!hasId && !hasHash) return "unbound";
  if (!hasId || !hasHash) return "different";
  return state.reviewBuildId === build.id && state.reviewBuildHash === build.hash ? "current" : "different";
}

/**
 * Produce an import-safe annotation id and deterministically disambiguate the
 * candidate against every id already in the review. The optional candidate is
 * useful for deterministic callers and tests; normal UI callers use a UUID.
 */
export function createReviewAnnotationId(existingIds: Iterable<string>, candidate?: string) {
  const generated = candidate
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  const token = generated.replace(/[^A-Za-z0-9._:]/g, "_").slice(0, 96) || "annotation";
  const base = `review_${token}`;
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** Return a new newest-first collection, or undefined at the hard limit. */
export function prependReviewAnnotation(
  annotations: readonly ReviewAnnotation[],
  annotation: Omit<ReviewAnnotation, "id">,
  idCandidate?: string,
) {
  if (annotations.length >= MAX_REVIEW_ANNOTATIONS) return undefined;
  const id = createReviewAnnotationId(annotations.map((item) => item.id), idCandidate);
  return [{ ...annotation, id }, ...annotations];
}

/**
 * Validate a portable review before it can replace persisted annotations.
 * Schema version 1 remains unchanged; `resolved` and `updatedAt` are optional,
 * so review files produced before annotation resolution was added still import.
 */
export function validateReviewDocument(value: unknown, build: BuildRecord): ReviewAnnotation[] {
  if (!isRecord(value)) invalidReview("the JSON root must be an object.");
  if (value.type !== "blockwright-review" || value.schemaVersion !== 1) invalidReview("unsupported type or schema version.");
  if (!isRecord(value.build) || value.build.hash !== build.hash) invalidReview("the immutable build hash does not match this build.");
  if (typeof value.build.id !== "string" || value.build.id !== build.id) invalidReview("the build id does not match this build.");
  if (!Array.isArray(value.annotations)) invalidReview("annotations must be an array.");
  if (value.annotations.length > MAX_REVIEW_ANNOTATIONS) invalidReview(`at most ${MAX_REVIEW_ANNOTATIONS} annotations may be imported at once.`);
  if (value.annotations.length * build.placements.length > MAX_REVIEW_VALIDATION_WORK) invalidReview("this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.");

  const seenIds = new Set<string>();
  return value.annotations.map((candidate, index) => {
    const label = `annotation ${index + 1}`;
    if (!isRecord(candidate)) invalidReview(`${label} must be an object.`);
    if (typeof candidate.id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id)) invalidReview(`${label} has an invalid id.`);
    if (seenIds.has(candidate.id)) invalidReview(`${label} repeats id ${candidate.id}.`);
    seenIds.add(candidate.id);
    if (typeof candidate.category !== "string" || !REVIEW_CATEGORIES.includes(candidate.category as ReviewCategory)) invalidReview(`${label} has an unsupported category.`);
    if (typeof candidate.note !== "string" || candidate.note.length > MAX_REVIEW_NOTE_LENGTH) invalidReview(`${label} has an invalid or oversized note.`);
    if (!validDate(candidate.createdAt)) invalidReview(`${label} has an invalid createdAt timestamp.`);
    if (candidate.updatedAt !== undefined && !validDate(candidate.updatedAt)) invalidReview(`${label} has an invalid updatedAt timestamp.`);
    if (candidate.resolved !== undefined && typeof candidate.resolved !== "boolean") invalidReview(`${label} has an invalid resolved flag.`);
    if (!isRecord(candidate.bounds) || !isIntegerVec3(candidate.bounds.min) || !isIntegerVec3(candidate.bounds.max)) invalidReview(`${label} bounds must contain exact integer coordinates.`);
    const bounds = { min: { ...candidate.bounds.min }, max: { ...candidate.bounds.max } };
    if (!isOrderedBounds(bounds)) invalidReview(`${label} bounds are reversed.`);
    if (!isWithinBounds(bounds.min, build.bounds) || !isWithinBounds(bounds.max, build.bounds)) invalidReview(`${label} is outside the immutable build bounds.`);
    const canonicalCount = countPlacementsWithin(build, bounds);
    if (typeof candidate.blockCount !== "number" || !Number.isSafeInteger(candidate.blockCount) || candidate.blockCount !== canonicalCount) invalidReview(`${label} block count does not match the canonical build.`);
    if (candidate.pickedBlock !== undefined && (typeof candidate.pickedBlock !== "string" || candidate.pickedBlock.length > 200)) invalidReview(`${label} has an invalid picked block.`);
    if (candidate.pickedState !== undefined && !validState(candidate.pickedState)) invalidReview(`${label} has an invalid picked state.`);
    if (candidate.pickedState !== undefined && candidate.pickedBlock === undefined) invalidReview(`${label} has block state without a picked block.`);
    if (candidate.pickedBlock !== undefined) {
      const expectedState = candidate.pickedState === undefined ? undefined : stateSignature(candidate.pickedState as Placement["state"]);
      const hasCanonicalPlacement = build.placements.some((placement) => isWithinBounds(placement, bounds)
        && placement.block === candidate.pickedBlock
        && (expectedState === undefined || stateSignature(placement.state) === expectedState));
      if (!hasCanonicalPlacement) invalidReview(`${label} picked block or state is not canonical within its bounds.`);
    }
    return {
      id: candidate.id,
      category: candidate.category as ReviewCategory,
      note: candidate.note,
      bounds,
      blockCount: candidate.blockCount,
      ...(candidate.pickedBlock !== undefined ? { pickedBlock: candidate.pickedBlock } : {}),
      ...(candidate.pickedState !== undefined ? { pickedState: { ...candidate.pickedState } as Placement["state"] } : {}),
      createdAt: candidate.createdAt as string,
      ...(candidate.resolved !== undefined ? { resolved: candidate.resolved } : {}),
      ...(candidate.updatedAt !== undefined ? { updatedAt: candidate.updatedAt as string } : {}),
    };
  });
}

export function isRoofPlacement(placement: Placement, build?: BuildRecord) {
  const paletteRoof = build?.input.rolePalette?.roof;
  return placement.block === paletteRoof
    || /roof|eave|ridge|gable|tile|finial|soffit/i.test(placement.phase)
    || /roof_tile/.test(placement.block);
}
