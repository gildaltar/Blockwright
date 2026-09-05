import { calculateBuildHash, validateBuildContract } from "./contract.js";
import { diffBuildRecords, type BuildDiff } from "./projects.js";
import type { BuildRecord, BuildRegion, Placement, ValidationIssue, Vec3 } from "./types.js";

export type InclusiveCuboid = { min: Vec3; max: Vec3 };

export type RevisedBuildRecord = BuildRecord & {
  parentHash: string;
  revision: {
    kind: "selected_region";
    region: InclusiveCuboid;
    lockedRequirementIds: string[];
  };
};

export type RegionRevisionOptions = {
  lockedRequirementIds?: string[];
  validateLockedRequirements?: (candidate: RevisedBuildRecord, requirementIds: string[]) => {
    valid: boolean;
    issues?: ValidationIssue[];
  };
};

export type RegionRevisionResult = {
  build: RevisedBuildRecord;
  parentHash: string;
  region: InclusiveCuboid;
  diff: BuildDiff;
  preservedOutsideCount: number;
};

function normalizeCuboid(region: InclusiveCuboid): InclusiveCuboid {
  const values = [region.min.x, region.min.y, region.min.z, region.max.x, region.max.y, region.max.z];
  if (!values.every(Number.isSafeInteger)) throw new Error("Selected-region bounds must be safe integers.");
  return {
    min: {
      x: Math.min(region.min.x, region.max.x),
      y: Math.min(region.min.y, region.max.y),
      z: Math.min(region.min.z, region.max.z),
    },
    max: {
      x: Math.max(region.min.x, region.max.x),
      y: Math.max(region.min.y, region.max.y),
      z: Math.max(region.min.z, region.max.z),
    },
  };
}

function inside(point: Vec3, region: InclusiveCuboid) {
  return point.x >= region.min.x && point.x <= region.max.x
    && point.y >= region.min.y && point.y <= region.max.y
    && point.z >= region.min.z && point.z <= region.max.z;
}

function coordinateKey(point: Vec3) {
  return `${point.x},${point.y},${point.z}`;
}

function placementOrder(left: Placement, right: Placement) {
  return left.y - right.y || left.z - right.z || left.x - right.x || left.block.localeCompare(right.block);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function calculatePlacementBounds(placements: Placement[]) {
  const first = placements[0];
  if (!first) throw new Error("Cannot calculate bounds for an empty placement set.");
  const min = { x: first.x, y: first.y, z: first.z };
  const max = { x: first.x, y: first.y, z: first.z };
  for (let index = 1; index < placements.length; index += 1) {
    const placement = placements[index];
    min.x = Math.min(min.x, placement.x);
    min.y = Math.min(min.y, placement.y);
    min.z = Math.min(min.z, placement.z);
    max.x = Math.max(max.x, placement.x);
    max.y = Math.max(max.y, placement.y);
    max.z = Math.max(max.z, placement.z);
  }
  return {
    min,
    max,
    dimensions: { width: max.x - min.x + 1, depth: max.z - min.z + 1, height: max.y - min.y + 1 },
  };
}

function groupRegions(placements: Placement[], size: number): BuildRegion[] {
  const regionSize = Number.isSafeInteger(size) && size > 0 ? size : 32;
  const groups = new Map<string, Placement[]>();
  for (const placement of placements) {
    const rx = Math.floor(placement.x / regionSize);
    const rz = Math.floor(placement.z / regionSize);
    const key = `${rx},${rz}`;
    const group = groups.get(key) ?? [];
    group.push(placement);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const bounds = calculatePlacementBounds(group);
    return {
      id: `region-${id}`,
      chunkMin: { x: Math.floor(bounds.min.x / 16), z: Math.floor(bounds.min.z / 16) },
      chunkMax: { x: Math.floor(bounds.max.x / 16), z: Math.floor(bounds.max.z / 16) },
      bounds: { min: bounds.min, max: bounds.max },
      placementCount: group.length,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function summarizePlacements(placements: Placement[]) {
  const materialCounts: Record<string, number> = {};
  const layerCounts: Record<string, number> = {};
  const phaseCounts: Record<string, number> = {};
  for (const placement of placements) {
    materialCounts[placement.block] = (materialCounts[placement.block] ?? 0) + 1;
    layerCounts[String(placement.y)] = (layerCounts[String(placement.y)] ?? 0) + 1;
    phaseCounts[placement.phase] = (phaseCounts[placement.phase] ?? 0) + 1;
  }
  return {
    materialCounts,
    layerCounts,
    phases: Object.entries(phaseCounts).sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ name, count })),
  };
}

export function reviseSelectedRegion(
  base: BuildRecord,
  requestedRegion: InclusiveCuboid,
  replacementPlacements: Placement[],
  options: RegionRevisionOptions = {},
): RegionRevisionResult {
  const region = normalizeCuboid(requestedRegion);
  const contractHardIds = base.contract.normalizedClauses.filter(({ severity }) => severity === "hard").map(({ id }) => id);
  const declaredHardIds = new Set(contractHardIds);
  const additionalLockedIds = [...new Set((options.lockedRequirementIds ?? []).map((id) => id.trim()).filter((id) => id && !declaredHardIds.has(id)))].sort();
  if (additionalLockedIds.length && !options.validateLockedRequirements) {
    throw new Error(`LOCKED_REQUIREMENTS_UNVERIFIED: no validator was supplied for ${additionalLockedIds.join(", ")}.`);
  }
  const lockedRequirementIds = [...new Set([...(options.lockedRequirementIds ?? []), ...contractHardIds].map((id) => id.trim()).filter(Boolean))].sort();

  const baseCoordinates = new Set<string>();
  for (const placement of base.placements) {
    const key = coordinateKey(placement);
    if (baseCoordinates.has(key)) throw new Error(`Base build contains duplicate placement coordinate ${key}.`);
    baseCoordinates.add(key);
  }

  const replacements = cloneJson(replacementPlacements);
  const replacementCoordinates = new Set<string>();
  for (const placement of replacements) {
    if (![placement.x, placement.y, placement.z].every(Number.isSafeInteger)) throw new Error("Replacement placements must use safe integer coordinates.");
    if (!inside(placement, region)) throw new Error(`Replacement at ${coordinateKey(placement)} lies outside the inclusive selected region.`);
    const key = coordinateKey(placement);
    if (replacementCoordinates.has(key)) throw new Error(`Replacement placements contain duplicate coordinate ${key}.`);
    replacementCoordinates.add(key);
  }

  const preserved = base.placements.filter((placement) => !inside(placement, region)).map(cloneJson);
  const placements = [...preserved, ...replacements].sort(placementOrder);
  if (!placements.length) throw new Error("A selected-region revision cannot produce an empty build.");

  const summary = summarizePlacements(placements);
  const hash = calculateBuildHash(base.input, placements);
  const { contract: _oldContract, certificate: _oldCertificate, ...baseWithoutAudit } = cloneJson(base);
  const draft: Omit<RevisedBuildRecord, "contract" | "certificate"> = {
    ...baseWithoutAudit,
    id: `bw_${hash.slice(0, 12)}`,
    hash,
    parentHash: base.hash,
    revision: { kind: "selected_region", region, lockedRequirementIds },
    bounds: calculatePlacementBounds(placements),
    placements,
    regions: groupRegions(placements, base.preflight.regionSize),
    ...summary,
    validation: { valid: false, blockingIssues: 0, warnings: 0, issues: [], attemptedCollisions: base.validation.attemptedCollisions },
    createdAt: "deterministic",
  };

  const inheritedOverrideClauses = base.contract.normalizedClauses
    .filter(({ source }) => source === "override")
    .map(({ sourceText: requirement, severity }) => ({ requirement, severity }));
  const contract = validateBuildContract(draft, inheritedOverrideClauses.length ? { clauses: inheritedOverrideClauses } : undefined);
  const failedHardRequirements = contract.hardResults.filter(({ status }) => status !== "pass");
  if (failedHardRequirements.length) {
    throw new Error(`LOCKED_REQUIREMENTS_VIOLATED: ${failedHardRequirements.map((result) => `${result.clauseId} (${result.status}): ${result.message}`).join("; ")}`);
  }
  const warningIssues: ValidationIssue[] = contract.warnings.map((result) => ({
    code: `CONTRACT_${(result.evaluator ?? result.clauseId).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_WARNING`,
    severity: "warning",
    message: result.message,
    ...(result.coordinates?.length ? { coordinates: result.coordinates } : {}),
  }));
  const build: RevisedBuildRecord = {
    ...draft,
    validation: {
      valid: true,
      blockingIssues: 0,
      warnings: warningIssues.length,
      issues: warningIssues,
      attemptedCollisions: draft.validation.attemptedCollisions,
    },
    contract,
    certificate: contract.certificate,
  };

  if (options.validateLockedRequirements) {
    const validation = options.validateLockedRequirements(cloneJson(build), lockedRequirementIds);
    if (!validation.valid) {
      const detail = validation.issues?.map(({ code, message }) => `${code}: ${message}`).join("; ") || "validator returned invalid";
      throw new Error(`LOCKED_REQUIREMENTS_VIOLATED: ${detail}`);
    }
  }

  return {
    build,
    parentHash: base.hash,
    region,
    diff: diffBuildRecords(base, build),
    preservedOutsideCount: preserved.length,
  };
}
