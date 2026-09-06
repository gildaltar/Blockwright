import type {
  ComponentCompileReport,
  ComponentConflict,
  ComponentConflictSource,
  ComponentGraphManifest,
  DesignAssertion,
  DesignElement,
  DesignMaterial,
  ProceduralMaterialDefinition,
  DesignProgram,
  DesignProgramV1,
  DesignProgramV2,
  DesignRequirement,
  Dimensions,
  Edition,
  Placement,
  RolePalette,
  Vec3,
} from "./types.js";
import { ComponentCache } from "./component-cache.js";
import { resolveComponentGraph } from "./component-graph.js";
import { resolveProceduralMaterial } from "./material-distribution.js";
import { compileProceduralGeometry } from "./procedural-geometry.js";

type MaterialLibrary = Record<string, DesignMaterial>;

export type DesignCompileResult = {
  placements: Placement[];
  attemptedCollisions: number;
  elementCounts: Record<string, number>;
  requirementCounts: Record<string, number>;
  componentGraph?: ComponentGraphManifest;
  compileReport?: ComponentCompileReport;
};

export type ComponentOperation =
  | { kind: "put"; placement: Placement }
  | { kind: "remove"; coordinate: Vec3; source: ComponentConflictSource }
  | { kind: "intersect"; coordinates: Vec3[]; bounds: { min: Vec3; max: Vec3 }; source: ComponentConflictSource };

export type ComponentOperationCacheEntry = {
  operations: ComponentOperation[];
  internalCollisions: number;
  attempts: number;
};

const defaultComponentCache = new ComponentCache<ComponentOperationCacheEntry>();

const coordinateKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const assertionKinds = new Set<DesignAssertion["kind"]>([
  "placement_count", "axis_span", "distinct_elements", "element_instances", "distinct_materials", "element_kind",
  "path_geometry", "material_tag_count", "support_count", "boundary_contact",
]);
const structuralAssertionKinds = new Set<DesignAssertion["kind"]>([
  "axis_span", "distinct_elements", "element_instances", "distinct_materials", "path_geometry",
  "material_tag_count", "support_count", "boundary_contact",
]);
const elementKinds = new Set<DesignElement["kind"]>(["fill", "shell", "carve", "cylinder", "basin", "sweep", "stairs", "ramp", "procedural"]);
const boundarySides = new Set(["north", "south", "east", "west", "top", "bottom"]);
const numberWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const numberToken = `(?:\\d+|${Object.keys(numberWords).join("|")})`;

function parsedNumber(value: string) {
  return /^\d+$/.test(value) ? Number(value) : numberWords[value.toLowerCase()];
}

function assertionCovers(assertion: DesignAssertion, start: number, end: number) {
  return assertion.sourceSpan.start <= start && assertion.sourceSpan.end >= end;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`DESIGN_ASSERTION_INVALID: ${label} must be a positive integer.`);
}

function validateAssertion(requirementText: string, requirementElementIds: Set<string>, assertion: DesignAssertion, index: number) {
  const label = `assertion ${index + 1}`;
  if (!assertionKinds.has(assertion.kind)) throw new Error(`DESIGN_ASSERTION_KIND_UNSUPPORTED: ${String((assertion as { kind?: unknown }).kind)}`);
  const { sourceSpan } = assertion;
  if (!sourceSpan || !Number.isSafeInteger(sourceSpan.start) || !Number.isSafeInteger(sourceSpan.end)
    || sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > requirementText.length
    || requirementText.slice(sourceSpan.start, sourceSpan.end) !== sourceSpan.text) {
    throw new Error(`DESIGN_ASSERTION_SOURCE_SPAN_INVALID: ${label} must cite an exact non-empty half-open span of its requirement text.`);
  }
  if (assertion.elementIds) {
    if (!assertion.elementIds.length || assertion.elementIds.some((id) => !requirementElementIds.has(id))) {
      throw new Error(`DESIGN_ASSERTION_SCOPE_INVALID: ${label} may reference only mapped element IDs.`);
    }
  }
  switch (assertion.kind) {
    case "placement_count":
    case "axis_span":
    case "distinct_elements":
    case "element_instances":
    case "distinct_materials":
      positiveInteger(assertion.minimum, `${label}.${assertion.kind}.minimum`);
      break;
    case "element_kind":
      positiveInteger(assertion.minimum, `${label}.element_kind.minimum`);
      if (!elementKinds.has(assertion.elementKind)) throw new Error(`DESIGN_ASSERTION_INVALID: ${label}.elementKind is unsupported.`);
      break;
    case "path_geometry": {
      const thresholds = [assertion.minimumPaths, assertion.minimumControlPointsPerPath, assertion.minimumVerticalDrop].filter((value) => value !== undefined);
      thresholds.forEach((value) => positiveInteger(value, `${label}.path_geometry threshold`));
      if (!thresholds.length && assertion.supportsRequired !== true) {
        throw new Error(`DESIGN_ASSERTION_INVALID: ${label}.path_geometry needs a numeric threshold or supportsRequired=true.`);
      }
      break;
    }
    case "material_tag_count":
      if (!assertion.tag.trim()) throw new Error(`DESIGN_ASSERTION_INVALID: ${label}.material_tag_count.tag must be non-empty.`);
      positiveInteger(assertion.minimumPlacements, `${label}.material_tag_count.minimumPlacements`);
      break;
    case "support_count":
      positiveInteger(assertion.minimumColumns, `${label}.support_count.minimumColumns`);
      break;
    case "boundary_contact":
      if (!assertion.sides.length || assertion.sides.some((side) => !boundarySides.has(side))) throw new Error(`DESIGN_ASSERTION_INVALID: ${label}.boundary_contact.sides is invalid.`);
      positiveInteger(assertion.minimumPlacementsPerSide, `${label}.boundary_contact.minimumPlacementsPerSide`);
      break;
  }
}

function validateQuantifiedLanguage(requirementText: string, assertions: DesignAssertion[]) {
  const heightPattern = new RegExp(`\\b(${numberToken})(?:\\s*-\\s*|\\s+)blocks?(?:\\s*-\\s*|\\s+)high\\b`, "gi");
  for (const match of requirementText.matchAll(heightPattern)) {
    const minimum = parsedNumber(match[1]);
    const start = match.index!;
    const end = start + match[0].length;
    if (!assertions.some((assertion) => assertion.kind === "axis_span" && assertion.axis === "y" && assertion.minimum >= minimum && assertionCovers(assertion, start, end))) {
      throw new Error(`DESIGN_NUMERIC_ASSERTION_REQUIRED: “${match[0]}” requires a source-spanning y-axis assertion of at least ${minimum} blocks.`);
    }
  }
  const distinctPattern = new RegExp(`\\b(${numberToken})\\s+distinct\\b`, "gi");
  for (const match of requirementText.matchAll(distinctPattern)) {
    const minimum = parsedNumber(match[1]);
    const start = match.index!;
    const end = start + match[0].length;
    if (!assertions.some((assertion) => (
      (assertion.kind === "distinct_elements" && assertion.minimum >= minimum)
      || (assertion.kind === "element_instances" && assertion.minimum >= minimum)
      || (assertion.kind === "path_geometry" && (assertion.minimumPaths ?? 0) >= minimum)
    ) && assertionCovers(assertion, start, end))) {
      throw new Error(`DESIGN_NUMERIC_ASSERTION_REQUIRED: “${match[0]}” requires at least ${minimum} distinct mapped elements or paths.`);
    }
  }
  const countPattern = new RegExp(`\\b(${numberToken})\\s+(?:(?:[a-z][a-z-]*)\\s+){0,3}([a-z][a-z-]*s)\\b`, "gi");
  for (const match of requirementText.matchAll(countPattern)) {
    if (/\bblocks?\b/i.test(match[2]) || /^zero$/i.test(match[1])) continue;
    const minimum = parsedNumber(match[1]);
    const start = match.index!;
    const end = start + match[0].length;
    if (!assertions.some((assertion) => (
      (assertion.kind === "distinct_elements" && assertion.minimum >= minimum)
      || (assertion.kind === "element_instances" && assertion.minimum >= minimum)
      || (assertion.kind === "path_geometry" && (assertion.minimumPaths ?? 0) >= minimum)
    ) && assertionCovers(assertion, start, end))) {
      throw new Error(`DESIGN_NUMERIC_ASSERTION_REQUIRED: “${match[0]}” requires at least ${minimum} distinct mapped elements or paths.`);
    }
  }
}

/** Validate claim strength and source grounding without generating any voxels. */
export function validateDesignRequirementAssertions(requirement: DesignRequirement, availableElementIds?: ReadonlySet<string>) {
  if (!requirement.assertions?.length) {
    throw new Error(`DESIGN_REQUIREMENT_ASSERTIONS_REQUIRED: ${requirement.id} needs source-grounded machine-checkable assertions.`);
  }
  if (/\b(?:working|functional|operational|powered|animated|rideable|self[- ]propelled)\b/i.test(requirement.text)) {
    throw new Error(`DESIGN_OPERATIONAL_CLAIM_UNSUPPORTED: ${requirement.id} contains an operational claim, but Design IR v1 has no operational predicate for it.`);
  }
  if (availableElementIds && requirement.elementIds.some((id) => !availableElementIds.has(id))) {
    throw new Error(`DESIGN_REQUIREMENT_UNMAPPED: ${requirement.id} must reference existing element IDs.`);
  }
  if (!requirement.claims?.length) throw new Error(`DESIGN_ATOMIC_CLAIMS_REQUIRED: ${requirement.id} must decompose its full prose into atomic claim spans.`);
  if (requirement.claims.every(({ predicate }) => predicate === "fixture")) {
    throw new Error(`DESIGN_FIXTURE_EVIDENCE_INSUFFICIENT: ${requirement.id} is only an asserted noun/fixture identity; decompose it into measurable geometric claims or mark it unsupported.`);
  }
  const claimIds = new Set<string>();
  const covered = Array.from({ length: requirement.text.length }, () => false);
  const orderedClaims = [...requirement.claims].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.sourceSpan.end - b.sourceSpan.end);
  let previousEnd = -1;
  for (const claim of orderedClaims) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(claim.id) || claimIds.has(claim.id)) throw new Error(`DESIGN_ATOMIC_CLAIM_ID_INVALID: ${claim.id}`);
    claimIds.add(claim.id);
    const { sourceSpan } = claim;
    if (!sourceSpan || !Number.isSafeInteger(sourceSpan.start) || !Number.isSafeInteger(sourceSpan.end)
      || sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > requirement.text.length
      || requirement.text.slice(sourceSpan.start, sourceSpan.end) !== sourceSpan.text) {
      throw new Error(`DESIGN_ATOMIC_CLAIM_SOURCE_SPAN_INVALID: ${claim.id} must cite an exact non-empty half-open span of its requirement text.`);
    }
    if (sourceSpan.start < previousEnd) throw new Error(`DESIGN_ATOMIC_CLAIM_OVERLAP: ${claim.id} overlaps another atomic claim.`);
    previousEnd = sourceSpan.end;
    if (/[,;]|\b(?:with|including|plus|along with|and)\b/i.test(sourceSpan.text)) {
      throw new Error(`DESIGN_ATOMIC_CLAIM_COMPOUND: ${claim.id} still contains compound-claim punctuation or a conjunction.`);
    }
    for (let index = sourceSpan.start; index < sourceSpan.end; index += 1) covered[index] = true;
    if (claim.status === "unsupported") {
      throw new Error(`DESIGN_ATOMIC_CLAIM_UNSUPPORTED: ${claim.id}${claim.reason?.trim() ? `: ${claim.reason.trim()}` : ""}`);
    }
    const claimAssertions = requirement.assertions.filter(({ claimId }) => claimId === claim.id);
    if (!claimAssertions.length) throw new Error(`DESIGN_ATOMIC_CLAIM_ASSERTION_REQUIRED: ${claim.id} has no machine-checkable assertion.`);
    if (!claimAssertions.some(({ kind }) => structuralAssertionKinds.has(kind))) {
      throw new Error(`DESIGN_ATOMIC_CLAIM_STRUCTURAL_ASSERTION_REQUIRED: ${claim.id} needs evidence stronger than placement count or an element-kind label.`);
    }
    for (const assertion of claimAssertions) {
      if (assertion.sourceSpan.start !== sourceSpan.start || assertion.sourceSpan.end !== sourceSpan.end || assertion.sourceSpan.text !== sourceSpan.text) {
        throw new Error(`DESIGN_ASSERTION_CLAIM_SPAN_MISMATCH: assertions for ${claim.id} must cite that exact atomic claim span.`);
      }
    }
    const has = (kind: DesignAssertion["kind"]) => claimAssertions.some((assertion) => assertion.kind === kind);
    const hasElementKind = (...kinds: DesignElement["kind"][]) => claimAssertions.some((assertion) => assertion.kind === "element_kind" && kinds.includes(assertion.elementKind));
    const validPredicate = claim.predicate === "extent" ? has("axis_span")
      : claim.predicate === "quantity" ? has("distinct_elements") || has("element_instances") || claimAssertions.some((assertion) => assertion.kind === "path_geometry" && Boolean(assertion.minimumPaths))
        : claim.predicate === "path" ? has("path_geometry")
          : claim.predicate === "containment" ? hasElementKind("basin") && has("axis_span")
            : claim.predicate === "enclosure" ? hasElementKind("shell") && has("axis_span")
              : claim.predicate === "access" ? (hasElementKind("stairs", "ramp", "fill", "shell") && has("axis_span")) || has("boundary_contact")
                : claim.predicate === "support" ? has("support_count") || claimAssertions.some((assertion) => assertion.kind === "path_geometry" && assertion.supportsRequired === true)
                  : claim.predicate === "boundary" ? has("boundary_contact")
                    : claim.predicate === "material" ? has("material_tag_count")
                      : claim.predicate === "surface" ? hasElementKind("fill", "basin", "ramp") && has("axis_span")
                        : claim.predicate === "fixture" ? has("element_kind") && (has("axis_span") || has("element_instances") || has("distinct_elements") || has("distinct_materials"))
                          : false;
    if (!validPredicate) throw new Error(`DESIGN_ATOMIC_CLAIM_PREDICATE_MISMATCH: ${claim.id} predicate ${String(claim.predicate)} lacks its required typed evidence.`);
    const axisAtLeast = (axis: "x" | "y" | "z", minimum: number) => claimAssertions.some((assertion) => assertion.kind === "axis_span" && assertion.axis === axis && assertion.minimum >= minimum);
    const horizontalAtLeast = (minimum: number) => axisAtLeast("x", minimum) || axisAtLeast("z", minimum);
    if (/\b(?:large|life[- ]sized)\b/i.test(sourceSpan.text) && (!axisAtLeast("x", 16) || !axisAtLeast("z", 16))) {
      throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses large/life-sized and needs x and z spans of at least 16.`);
    }
    if (/\b(?:large|life[- ]sized)\b/i.test(sourceSpan.text)) {
      const scopeKeys = new Set(claimAssertions.map((assertion) => assertion.elementIds?.length ? [...assertion.elementIds].sort().join("\u0000") : ""));
      const placementMinimum = claimAssertions.some((assertion) => assertion.kind === "placement_count" && assertion.minimum >= 64);
      const diverse = claimAssertions.some((assertion) => assertion.kind === "distinct_elements" && assertion.minimum >= 3)
        || claimAssertions.some((assertion) => assertion.kind === "distinct_materials" && assertion.minimum >= 2);
      if (scopeKeys.has("") || scopeKeys.size !== 1 || !axisAtLeast("y", 4) || !placementMinimum || !diverse) {
        throw new Error(`DESIGN_FIXTURE_EVIDENCE_INSUFFICIENT: ${claim.id} uses large/life-sized and needs one explicit shared element scope, y>=4, placement_count>=64, and either three elements or two materials.`);
      }
    }
    if (/\bgrand\b/i.test(sourceSpan.text) && (!horizontalAtLeast(12) || !axisAtLeast("y", 6))) {
      throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses grand and needs a horizontal span of at least 12 plus y span of at least 6.`);
    }
    if (/\bbroad\b/i.test(sourceSpan.text) && !horizontalAtLeast(16)) throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses broad and needs a horizontal span of at least 16.`);
    if (/\bwide\b/i.test(sourceSpan.text) && !horizontalAtLeast(5)) throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses wide and needs a horizontal span of at least 5.`);
    if (/\bdeep\b/i.test(sourceSpan.text) && !axisAtLeast("y", 4)) throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses deep and needs a y span of at least 4.`);
    if (/\bmulti[- ]level\b/i.test(sourceSpan.text) && !axisAtLeast("y", 6)) throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses multi-level and needs a y span of at least 6.`);
    if (/\blooping\b/i.test(sourceSpan.text) && !claimAssertions.some((assertion) => assertion.kind === "path_geometry" && (assertion.minimumControlPointsPerPath ?? 0) >= 4)) {
      throw new Error(`DESIGN_QUALITATIVE_ASSERTION_REQUIRED: ${claim.id} uses looping and needs at least four control points per path.`);
    }
    const pluralFixture = claim.predicate === "fixture" && /\b[a-z][a-z-]*s\b\s*$/i.test(sourceSpan.text) && !/\b(?:glass|access)\s*$/i.test(sourceSpan.text);
    if (pluralFixture && !claimAssertions.some((assertion) => assertion.kind === "element_instances" && assertion.minimum >= 2)) {
      throw new Error(`DESIGN_FIXTURE_EVIDENCE_INSUFFICIENT: ${claim.id} is an unquantified plural fixture and needs at least two scoped element instances.`);
    }
  }
  const uncovered = requirement.text.split("").map((character, index) => covered[index] ? " " : character).join("");
  const glue = new Set(["a", "an", "the", "and", "or", "with", "including", "plus", "along", "of", "to", "for", "from", "in", "on", "at", "into"]);
  const uncoveredTerms = (uncovered.match(/[a-z0-9]+/gi) ?? []).filter((term) => !glue.has(term.toLowerCase()));
  if (uncoveredTerms.length) throw new Error(`DESIGN_ATOMIC_CLAIM_COVERAGE_GAP: ${requirement.id} leaves substantive text uncovered: ${[...new Set(uncoveredTerms)].join(", ")}.`);
  const unknownClaimAssertions = requirement.assertions.filter(({ claimId }) => !claimIds.has(claimId));
  if (unknownClaimAssertions.length) throw new Error(`DESIGN_ASSERTION_CLAIM_UNKNOWN: ${unknownClaimAssertions[0].claimId}`);
  const mapped = new Set(requirement.elementIds);
  requirement.assertions.forEach((assertion, index) => validateAssertion(requirement.text, mapped, assertion, index));
  validateQuantifiedLanguage(requirement.text, requirement.assertions);
}

function normalizedBox(min: Vec3, max: Vec3) {
  return {
    min: { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y), z: Math.min(min.z, max.z) },
    max: { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y), z: Math.max(min.z, max.z) },
  };
}

function assertIntegerPoint(point: Vec3, label: string) {
  if (![point.x, point.y, point.z].every(Number.isSafeInteger)) throw new Error(`DESIGN_COORDINATE_INVALID: ${label} must contain integer coordinates.`);
}

function assertInside(point: Vec3, dimensions: Dimensions, elementId: string) {
  assertIntegerPoint(point, `${elementId} placement`);
  if (point.x < 0 || point.y < 0 || point.z < 0 || point.x >= dimensions.width || point.y >= dimensions.height || point.z >= dimensions.depth) {
    throw new Error(`DESIGN_OUT_OF_BOUNDS: element ${elementId} produced ${point.x},${point.y},${point.z} outside 0..${dimensions.width - 1},0..${dimensions.height - 1},0..${dimensions.depth - 1}.`);
  }
}

function materialValue(
  reference: string,
  library: MaterialLibrary,
  roles: RolePalette,
  options: Pick<DesignCompileOptions, "materials" | "componentSeed" | "materialContextBounds" | "allowMaterialDistributions">,
  coordinate: Vec3,
) {
  if (!options.allowMaterialDistributions) {
    const value = library[reference] ?? (reference in roles ? roles[reference as keyof RolePalette] : reference);
    return typeof value === "string"
      ? { block: value }
      : { block: value.block, ...(value.state ? { state: { ...value.state } } : {}), ...(value.tags ? { tags: [...value.tags] } : {}) };
  }
  const bounds = options.materialContextBounds ?? { min: coordinate, max: coordinate };
  return resolveProceduralMaterial(reference, { materials: options.materials, materialLibrary: library, rolePalette: roles }, {
    coordinate,
    bounds,
    componentSeed: options.componentSeed ?? "legacy-v1",
    surfaceDirections: surfaceDirectionsAt(coordinate, bounds),
  }, true);
}

function surfaceDirectionsAt(point: Vec3, bounds: { min: Vec3; max: Vec3 }) {
  return [
    ...(point.x === bounds.min.x ? ["west" as const] : []), ...(point.x === bounds.max.x ? ["east" as const] : []),
    ...(point.y === bounds.min.y ? ["down" as const] : []), ...(point.y === bounds.max.y ? ["up" as const] : []),
    ...(point.z === bounds.min.z ? ["north" as const] : []), ...(point.z === bounds.max.z ? ["south" as const] : []),
  ];
}

function offsets(element: DesignElement) {
  return element.offsets?.length ? element.offsets : [{ x: 0, y: 0, z: 0 }];
}

function centeredOffsets(requested: number) {
  const size = Math.max(1, Math.round(requested));
  const start = -Math.floor(size / 2);
  return Array.from({ length: size }, (_, index) => start + index);
}

function pointsAlong(points: Vec3[]) {
  const sampled: Array<{ point: Vec3; tangent: Vec3 }> = [];
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const from = points[segment];
    const to = points[segment + 1];
    const tangent = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const steps = Math.max(Math.abs(tangent.x), Math.abs(tangent.y), Math.abs(tangent.z), 1);
    for (let step = 0; step < steps; step += 1) {
      const ratio = step / steps;
      sampled.push({
        point: {
          x: Math.round(from.x + tangent.x * ratio),
          y: Math.round(from.y + tangent.y * ratio),
          z: Math.round(from.z + tangent.z * ratio),
        },
        tangent,
      });
    }
  }
  const last = points.at(-1)!;
  const previous = points.at(-2)!;
  sampled.push({ point: { ...last }, tangent: { x: last.x - previous.x, y: last.y - previous.y, z: last.z - previous.z } });
  const unique = sampled.filter(({ point }, index) => index === 0 || coordinateKey(point) !== coordinateKey(sampled[index - 1].point));
  const connected: typeof unique = [];
  for (const sample of unique) {
    const previousSample = connected.at(-1);
    if (!previousSample) {
      connected.push(sample);
      continue;
    }
    const cursor = { ...previousSample.point };
    // Rounded interpolation may change two or three axes at once. Expand each
    // such diagonal into deterministic face-adjacent steps so generated tubes,
    // channels, and their contents cannot acquire detached diagonal slices.
    for (const axis of ["x", "y", "z"] as const) {
      while (cursor[axis] !== sample.point[axis]) {
        cursor[axis] += Math.sign(sample.point[axis] - cursor[axis]);
        connected.push({ point: { ...cursor }, tangent: sample.tangent });
      }
    }
  }
  return connected;
}

export type DesignCompileOptions = {
  dimensions: Dimensions;
  origin: Vec3;
  edition?: Edition;
  rolePalette: RolePalette;
  materialLibrary?: MaterialLibrary;
  maximumPlacements?: number;
  maximumPlacementAttempts?: number;
  componentCache?: ComponentCache<ComponentOperationCacheEntry>;
  previousComponentGraph?: ComponentGraphManifest;
  /** Internal v2 material environment used while compiling isolated component elements. */
  materials?: Record<string, ProceduralMaterialDefinition>;
  componentSeed?: string;
  materialContextBounds?: { min: Vec3; max: Vec3 };
  allowMaterialDistributions?: boolean;
};

export function compileDesignProgram(
  design: DesignProgram,
  options: DesignCompileOptions,
): DesignCompileResult {
  if (design.schemaVersion !== 1 && design.schemaVersion !== 2) throw new Error(`DESIGN_SCHEMA_UNSUPPORTED: expected schemaVersion 1 or 2, received ${String((design as { schemaVersion?: unknown }).schemaVersion)}.`);
  if (!design.elements.length) throw new Error("DESIGN_EMPTY: a generic design program must contain at least one element.");
  const elementIds = new Set<string>();
  for (const element of design.elements) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(element.id)) throw new Error(`DESIGN_ELEMENT_ID_INVALID: ${element.id}`);
    if (elementIds.has(element.id)) throw new Error(`DESIGN_ELEMENT_ID_DUPLICATE: ${element.id}`);
    elementIds.add(element.id);
  }

  if (design.schemaVersion === 1 && design.elements.some(({ kind }) => kind === "procedural")) {
    throw new Error("DESIGN_PROCEDURAL_REQUIRES_V2: procedural primitives require component bounds, phase, and seed metadata.");
  }
  const requirementIds = new Set<string>();
  for (const requirement of design.requirements) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(requirement.id)) throw new Error(`DESIGN_REQUIREMENT_ID_INVALID: ${requirement.id}`);
    if (requirementIds.has(requirement.id)) throw new Error(`DESIGN_REQUIREMENT_ID_DUPLICATE: ${requirement.id}`);
    requirementIds.add(requirement.id);
    if (!requirement.elementIds.length || requirement.elementIds.some((id) => !elementIds.has(id))) {
      throw new Error(`DESIGN_REQUIREMENT_UNMAPPED: ${requirement.id} must reference existing element IDs.`);
    }
    validateDesignRequirementAssertions(requirement, elementIds);
  }
  for (const element of design.elements) {
    const missing = element.requirementIds.filter((id) => !requirementIds.has(id));
    if (missing.length) throw new Error(`DESIGN_ELEMENT_REQUIREMENT_UNKNOWN: ${element.id} references ${missing.join(", ")}.`);
  }

  if (design.schemaVersion === 2) return compileComponentDesignProgram(design, options);

  const library = options.materialLibrary ?? {};
  const map = new Map<string, Placement>();
  let attemptedCollisions = 0;
  let placementAttempts = 0;
  const maximumPlacements = Math.max(1, Math.round(options.maximumPlacements ?? 2_000_000));
  const maximumPlacementAttempts = Math.max(1, Math.round(options.maximumPlacementAttempts ?? 8_000_000));
  const countAttempt = () => {
    placementAttempts += 1;
    if (placementAttempts > maximumPlacementAttempts) throw new Error(`DESIGN_OPERATION_LIMIT_EXCEEDED: generic design exceeded ${maximumPlacementAttempts.toLocaleString()} put/remove attempts.`);
  };
  let activeElementInstanceId = "";
  const put = (local: Vec3, materialRef: string, element: DesignElement, phaseSuffix = "", stateOverride?: Placement["state"]) => {
    countAttempt();
    assertInside(local, options.dimensions, element.id);
    const resolved = materialValue(materialRef, library, options.rolePalette, options, local);
    const world = add(local, options.origin);
    const placement: Placement = {
      ...world,
      block: resolved.block,
      phase: [element.phase || element.intent || element.id, phaseSuffix].filter(Boolean).join(": "),
      elementId: element.id,
      elementInstanceId: activeElementInstanceId,
      requirementIds: [...element.requirementIds].sort(),
      ...((resolved.state || stateOverride) ? { state: { ...(resolved.state ?? {}), ...(stateOverride ?? {}) } } : {}),
    };
    const key = coordinateKey(world);
    if (map.has(key)) attemptedCollisions += 1;
    map.set(key, placement);
    if (map.size > maximumPlacements) throw new Error(`BUILD_PLACEMENT_LIMIT_EXCEEDED: generic design retained more than ${maximumPlacements.toLocaleString()} canonical placements.`);
  };
  const remove = (local: Vec3, element: DesignElement) => {
    countAttempt();
    assertInside(local, options.dimensions, element.id);
    map.delete(coordinateKey(add(local, options.origin)));
  };
  const box = (element: DesignElement, rawMin: Vec3, rawMax: Vec3, material: string, shellThickness?: number) => {
    const { min, max } = normalizedBox(rawMin, rawMax);
    const thickness = shellThickness === undefined ? undefined : Math.max(1, Math.round(shellThickness));
    for (let x = min.x; x <= max.x; x += 1) for (let y = min.y; y <= max.y; y += 1) for (let z = min.z; z <= max.z; z += 1) {
      if (thickness !== undefined) {
        const edge = Math.min(x - min.x, max.x - x, y - min.y, max.y - y, z - min.z, max.z - z);
        if (edge >= thickness) continue;
      }
      put({ x, y, z }, material, element);
    }
  };

  for (const element of design.elements) for (const [instanceIndex, offset] of offsets(element).entries()) {
    activeElementInstanceId = `${element.id}#${instanceIndex + 1}`;
    assertIntegerPoint(offset, `${element.id} offset`);
    if (element.kind === "fill" || element.kind === "shell") {
      box(element, add(element.min, offset), add(element.max, offset), element.material, element.kind === "shell" ? element.thickness ?? 1 : undefined);
      continue;
    }
    if (element.kind === "carve") {
      const { min, max } = normalizedBox(add(element.min, offset), add(element.max, offset));
      for (let x = min.x; x <= max.x; x += 1) for (let y = min.y; y <= max.y; y += 1) for (let z = min.z; z <= max.z; z += 1) remove({ x, y, z }, element);
      continue;
    }
    if (element.kind === "cylinder") {
      const center = add(element.center, offset);
      const radius = Math.max(1, Math.round(element.radius));
      const thickness = Math.max(1, Math.round(element.thickness ?? 1));
      const height = Math.max(1, Math.round(element.height));
      for (let y = 0; y < height; y += 1) for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > radius + 0.25) continue;
        if (element.hollow && distance < radius - thickness && (!element.cap || (y > 0 && y < height - 1))) continue;
        put({ x: center.x + dx, y: center.y + y, z: center.z + dz }, element.material, element);
      }
      continue;
    }
    if (element.kind === "basin") {
      const { min, max } = normalizedBox(add(element.min, offset), add(element.max, offset));
      const thickness = Math.max(1, Math.round(element.wallThickness ?? 1));
      const floor = element.floorMaterial ?? element.wallMaterial;
      for (let x = min.x; x <= max.x; x += 1) for (let z = min.z; z <= max.z; z += 1) {
        for (let y = min.y; y < min.y + thickness; y += 1) put({ x, y, z }, floor, element, "floor");
        const edge = Math.min(x - min.x, max.x - x, z - min.z, max.z - z);
        if (edge < thickness) for (let y = min.y + thickness; y <= max.y; y += 1) put({ x, y, z }, element.wallMaterial, element, "wall");
        if (element.liquidMaterial && edge >= thickness) {
          const liquidTop = Math.min(max.y, element.liquidLevel === undefined ? max.y - 1 : element.liquidLevel + offset.y);
          for (let y = min.y + thickness; y <= liquidTop; y += 1) put({ x, y, z }, element.liquidMaterial, element, "contained liquid", { liquid_depth: 0 });
        }
        if (element.rimMaterial && edge < thickness) put({ x, y: max.y, z }, element.rimMaterial, element, "rim");
      }
      continue;
    }
    if (element.kind === "sweep") {
      if (element.points.length < 2) throw new Error(`DESIGN_SWEEP_TOO_SHORT: ${element.id} needs at least two points.`);
      const samples = pointsAlong(element.points.map((point) => add(point, offset)));
      const width = Math.max(1, Math.round(element.width));
      const height = Math.max(1, Math.round(element.height ?? width));
      const thickness = Math.max(1, Math.round(element.thickness ?? 1));
      const lateralOffsets = centeredOffsets(width);
      const tubeContents: Vec3[] = [];
      samples.forEach(({ point, tangent }, sampleIndex) => {
        const horizontalLength = Math.hypot(tangent.x, tangent.z) || 1;
        const px = -tangent.z / horizontalLength;
        const pz = tangent.x / horizontalLength;
        if (element.crossSection === "solid") {
          for (const lateral of lateralOffsets) for (let dy = 0; dy < height; dy += 1) {
            put({ x: point.x + Math.round(px * lateral), y: point.y + dy, z: point.z + Math.round(pz * lateral) }, element.material, element, "sweep");
          }
        } else if (element.crossSection === "open_channel") {
          for (const [lateralIndex, lateral] of lateralOffsets.entries()) {
            for (let floorDepth = 0; floorDepth < thickness; floorDepth += 1) put({ x: point.x + Math.round(px * lateral), y: point.y - floorDepth, z: point.z + Math.round(pz * lateral) }, element.material, element, "channel floor");
            const wall = lateralIndex < thickness || lateralIndex >= lateralOffsets.length - thickness;
            if (wall) for (let dy = 1; dy < height; dy += 1) put({ x: point.x + Math.round(px * lateral), y: point.y + dy, z: point.z + Math.round(pz * lateral) }, element.material, element, "channel wall");
            if (element.innerMaterial && !wall) put({ x: point.x + Math.round(px * lateral), y: point.y + 1, z: point.z + Math.round(pz * lateral) }, element.innerMaterial, element, "channel contents", { liquid_depth: 0 });
          }
        } else {
          const verticalOffsets = centeredOffsets(height);
          const lateralRadius = Math.max(0.5, (width - 1) / 2);
          const verticalRadius = Math.max(0.5, (height - 1) / 2);
          const lateralCenter = (lateralOffsets[0] + lateralOffsets.at(-1)!) / 2;
          const verticalCenter = (verticalOffsets[0] + verticalOffsets.at(-1)!) / 2;
          for (const lateral of lateralOffsets) for (const dy of verticalOffsets) {
            const radial = Math.sqrt(((lateral - lateralCenter) / lateralRadius) ** 2 + ((dy - verticalCenter) / verticalRadius) ** 2);
            const innerRadius = Math.max(0, 1 - thickness / Math.max(lateralRadius, verticalRadius));
            const voxel = { x: point.x + Math.round(px * lateral), y: point.y + dy, z: point.z + Math.round(pz * lateral) };
            if (radial <= 1.08 && radial >= innerRadius) put(voxel, element.material, element, "tube shell");
            else if (element.innerMaterial && radial < innerRadius) tubeContents.push(voxel);
          }
        }
        if (element.supports && sampleIndex % Math.max(1, Math.round(element.supports.interval)) === 0) {
          const radius = Math.max(0, Math.round(element.supports.radius ?? 0));
          for (let y = Math.round(element.supports.toY + offset.y); y < point.y; y += 1) for (let dx = -radius; dx <= radius; dx += 1) for (let dz = -radius; dz <= radius; dz += 1) {
            if (dx * dx + dz * dz <= radius * radius + 0.25) put({ x: point.x + dx, y, z: point.z + dz }, element.supports.material, element, "support");
          }
        }
      });
      // A turn can rotate adjacent cross-sections enough that a shell voxel from
      // a later slice lands inside an earlier slice. Resolve the complete swept
      // interior after every shell and support candidate so traversal order can
      // never leave a plug or detach an inner-material pocket at a bend.
      if (element.crossSection === "tube" && element.innerMaterial) {
        for (const voxel of tubeContents) put(voxel, element.innerMaterial, element, "tube contents");
      }
      continue;
    }
    if (element.kind === "stairs" || element.kind === "ramp") {
      const from = add(element.from, offset);
      const to = add(element.to, offset);
      const dx = to.x - from.x; const dy = to.y - from.y; const dz = to.z - from.z;
      const steps = Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dy), 1);
      const horizontalLength = Math.hypot(dx, dz) || 1;
      const px = -dz / horizontalLength; const pz = dx / horizontalLength;
      const lateralOffsets = centeredOffsets(element.width);
      const facing = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? "east" : "west") : (dz >= 0 ? "south" : "north");
      for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps;
        const center = { x: Math.round(from.x + dx * ratio), y: Math.round(from.y + dy * ratio), z: Math.round(from.z + dz * ratio) };
        for (const [lateralIndex, lateral] of lateralOffsets.entries()) {
          const point = { x: center.x + Math.round(px * lateral), y: center.y, z: center.z + Math.round(pz * lateral) };
          const stairState: Placement["state"] = element.kind === "stairs"
            ? options.edition === "bedrock"
              ? { upside_down_bit: false, weirdo_direction: ({ east: 0, west: 1, south: 2, north: 3 } as const)[facing] }
              : { facing, half: "bottom", shape: "straight", waterlogged: false }
            : undefined;
          put(point, element.material, element, element.kind, stairState);
          if (element.railingMaterial && (lateralIndex === 0 || lateralIndex === lateralOffsets.length - 1)) put({ ...point, y: point.y + 1 }, element.railingMaterial, element, "railing");
        }
      }
    }
  }

  const placements = [...map.values()].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
  const elementCounts: Record<string, number> = {};
  const requirementCounts: Record<string, number> = {};
  for (const placement of placements) {
    if (placement.elementId) elementCounts[placement.elementId] = (elementCounts[placement.elementId] ?? 0) + 1;
    for (const requirementId of placement.requirementIds ?? []) requirementCounts[requirementId] = (requirementCounts[requirementId] ?? 0) + 1;
  }
  return { placements, attemptedCollisions, elementCounts, requirementCounts };
}

function compileComponentDesignProgram(design: DesignProgramV2, options: DesignCompileOptions): DesignCompileResult {
  const componentCache = options.componentCache ?? defaultComponentCache;
  const cacheStatsBefore = componentCache.stats();
  const graph = resolveComponentGraph(design, {
    edition: options.edition ?? "java",
    dimensions: options.dimensions,
    origin: options.origin,
    rolePalette: options.rolePalette,
    materialLibrary: options.materialLibrary ?? {},
    materials: design.materials,
  });
  const previousById = new Map((options.previousComponentGraph?.components ?? []).map((entry) => [entry.id, entry]));
  const changed = graph.components.filter(({ manifest }) => {
    const previous = previousById.get(manifest.id);
    return !previous || previous.geometryHash !== manifest.geometryHash || previous.materialHash !== manifest.materialHash
      || previous.revision.revision !== manifest.revision.revision;
  }).map(({ manifest }) => manifest.id);
  for (const previous of options.previousComponentGraph?.components ?? []) {
    if (!graph.manifest.components.some(({ id }) => id === previous.id)) changed.push(previous.id);
  }

  const rebuilt: string[] = [];
  const reused: string[] = [];
  const compiledComponents: Array<{ id: string; entry: ComponentOperationCacheEntry }> = [];
  for (const component of graph.components) {
    const cached = componentCache.get(component.manifest.cacheKey);
    let entry: ComponentOperationCacheEntry;
    if (cached) {
      entry = cloneComponentCacheEntry(cached);
      reused.push(component.manifest.id);
    }
    else {
      entry = compileComponentOperations(component.definition, component.elements, options, design.materials ?? {});
      componentCache.set(component.manifest.cacheKey, cloneComponentCacheEntry(entry), Math.max(1, operationWeight(entry.operations)));
      rebuilt.push(component.manifest.id);
    }
    compiledComponents.push({ id: component.manifest.id, entry });
  }

  const maximumPlacements = Math.max(1, Math.round(options.maximumPlacements ?? 2_000_000));
  const maximumPlacementAttempts = Math.max(1, Math.round(options.maximumPlacementAttempts ?? 8_000_000));
  const map = new Map<string, Placement>();
  const conflicts: ComponentConflict[] = [];
  let conflictCount = 0;
  let placementAttempts = 0;
  let attemptedCollisions = 0;
  for (const { entry } of compiledComponents) {
    placementAttempts += entry.attempts;
    attemptedCollisions += entry.internalCollisions;
    if (placementAttempts > maximumPlacementAttempts) throw new Error(`DESIGN_OPERATION_LIMIT_EXCEEDED: component compilation exceeded ${maximumPlacementAttempts.toLocaleString()} coordinate attempts.`);
    for (const operation of entry.operations) {
      if (operation.kind === "put") {
        const key = coordinateKey(operation.placement);
        const previous = map.get(key);
        if (previous) {
          attemptedCollisions += 1;
          conflictCount += 1;
          if (conflicts.length < 1_000) conflicts.push({
            coordinate: pointOf(operation.placement),
            kind: "replacement",
            previous: sourceForPlacement(previous),
            incoming: sourceForPlacement(operation.placement),
          });
        }
        map.set(key, operation.placement);
        if (map.size > maximumPlacements) throw new Error(`BUILD_PLACEMENT_LIMIT_EXCEEDED: component compilation retained more than ${maximumPlacements.toLocaleString()} canonical placements.`);
      } else if (operation.kind === "remove") {
        const key = coordinateKey(operation.coordinate);
        const previous = map.get(key);
        if (previous) {
          conflictCount += 1;
          if (conflicts.length < 1_000) conflicts.push({
            coordinate: { ...operation.coordinate },
            kind: "removal",
            previous: sourceForPlacement(previous),
            incoming: operation.source,
          });
        }
        map.delete(key);
      } else {
        const retained = new Set(operation.coordinates.map(coordinateKey));
        for (const [key, previous] of [...map.entries()]) {
          if (!insideBounds(previous, operation.bounds) || retained.has(key)) continue;
          conflictCount += 1;
          if (conflicts.length < 1_000) conflicts.push({
            coordinate: pointOf(previous),
            kind: "removal",
            previous: sourceForPlacement(previous),
            incoming: operation.source,
          });
          map.delete(key);
        }
      }
    }
  }

  const placements = [...map.values()].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
  const elementCounts: Record<string, number> = {};
  const requirementCounts: Record<string, number> = {};
  for (const placement of placements) {
    if (placement.elementId) elementCounts[placement.elementId] = (elementCounts[placement.elementId] ?? 0) + 1;
    for (const requirementId of placement.requirementIds ?? []) requirementCounts[requirementId] = (requirementCounts[requirementId] ?? 0) + 1;
  }
  const cacheStatsAfter = componentCache.stats();
  return {
    placements,
    attemptedCollisions,
    elementCounts,
    requirementCounts,
    componentGraph: graph.manifest,
    compileReport: {
      changed,
      rebuilt,
      reused,
      cacheHits: reused.length,
      cacheMisses: rebuilt.length,
      conflicts,
      conflictCount,
      evictions: cacheStatsAfter.evictions - cacheStatsBefore.evictions,
    },
  };
}

function compileComponentOperations(
  component: DesignProgramV2["components"][number],
  elements: Array<{ element: DesignElement; instancePrefix: string }>,
  options: DesignCompileOptions,
  materials: Record<string, ProceduralMaterialDefinition>,
): ComponentOperationCacheEntry {
  const operations: ComponentOperation[] = [];
  let internalCollisions = 0;
  let attempts = 0;
  for (const { element, instancePrefix } of elements) {
    if (element.kind === "procedural") {
      const operation = element.operation ?? "add";
      if ((operation === "add" || operation === "union") && !element.material) {
        throw new Error(`DESIGN_PROCEDURAL_MATERIAL_REQUIRED: ${element.id} needs a material for ${operation}.`);
      }
      for (const [offsetIndex, offset] of offsets(element).entries()) {
        assertIntegerPoint(offset, `${element.id} offset`);
        const generated = compileProceduralGeometry(element.primitive, {
          offset,
          clip: element.clip,
          masks: element.masks,
          maximumAttempts: options.maximumPlacementAttempts,
        });
        attempts += generated.attempts;
        internalCollisions += generated.collisions;
        const source: ComponentConflictSource = {
          componentId: component.id,
          elementId: element.id,
          elementInstanceId: `${instancePrefix}/${element.id}#${offsetIndex + 1}`,
          operationPhase: component.operationPhase,
        };
        for (const { point } of generated.points) {
          assertInside(point, options.dimensions, element.id);
          assertInsideComponent(point, component);
        }
        if (operation === "intersect") {
          operations.push({
            kind: "intersect",
            coordinates: generated.points.map(({ point }) => add(point, options.origin)),
            bounds: { min: add(component.bounds.min, options.origin), max: add(component.bounds.max, options.origin) },
            source,
          });
          continue;
        }
        for (const { point, surfaceDirections } of generated.points) {
          if (operation === "clear" || operation === "subtract" || operation === "cut") {
            operations.push({ kind: "remove", coordinate: add(point, options.origin), source });
            continue;
          }
          const resolved = resolveProceduralMaterial(element.material!, {
            materials,
            materialLibrary: options.materialLibrary ?? {},
            rolePalette: options.rolePalette,
          }, {
            coordinate: point,
            bounds: component.bounds,
            componentSeed: component.seed,
            surfaceDirections,
          }, true);
          operations.push({ kind: "put", placement: {
            ...add(point, options.origin),
            block: resolved.block,
            ...(resolved.state ? { state: resolved.state } : {}),
            phase: element.phase || element.intent || element.id,
            elementId: element.id,
            elementInstanceId: source.elementInstanceId,
            requirementIds: [...element.requirementIds].sort(),
            componentId: component.id,
            operationPhase: component.operationPhase,
          } });
        }
      }
      continue;
    }
    if (element.kind === "carve") {
      for (const [offsetIndex, offset] of offsets(element).entries()) {
        assertIntegerPoint(offset, `${element.id} offset`);
        const { min, max } = normalizedBox(add(element.min, offset), add(element.max, offset));
        for (let x = min.x; x <= max.x; x += 1) for (let y = min.y; y <= max.y; y += 1) for (let z = min.z; z <= max.z; z += 1) {
          const local = { x, y, z };
          assertInside(local, options.dimensions, element.id);
          assertInsideComponent(local, component);
          attempts += 1;
          operations.push({
            kind: "remove",
            coordinate: add(local, options.origin),
            source: {
              componentId: component.id,
              elementId: element.id,
              elementInstanceId: `${instancePrefix}/${element.id}#${offsetIndex + 1}`,
              operationPhase: component.operationPhase,
            },
          });
        }
      }
      continue;
    }
    const isolated = compileDesignProgram(isolatedProgram(element), {
      dimensions: options.dimensions,
      origin: options.origin,
      edition: options.edition,
      rolePalette: options.rolePalette,
      materialLibrary: options.materialLibrary,
      materials,
      componentSeed: component.seed,
      materialContextBounds: component.bounds,
      allowMaterialDistributions: true,
      maximumPlacements: options.maximumPlacements,
      maximumPlacementAttempts: options.maximumPlacementAttempts,
    });
    internalCollisions += isolated.attemptedCollisions;
    attempts += isolated.placements.length + isolated.attemptedCollisions;
    for (const placement of isolated.placements) {
      const local = { x: placement.x - options.origin.x, y: placement.y - options.origin.y, z: placement.z - options.origin.z };
      assertInsideComponent(local, component);
      operations.push({
        kind: "put",
        placement: {
          ...placement,
          componentId: component.id,
          operationPhase: component.operationPhase,
          elementInstanceId: `${instancePrefix}/${placement.elementInstanceId ?? element.id}`,
        },
      });
    }
  }
  return { operations, internalCollisions, attempts };
}

function isolatedProgram(element: DesignElement): DesignProgramV1 {
  const text = "component operation";
  const sourceSpan = { start: 0, end: text.length, text };
  const requirements: DesignRequirement[] = [...new Set(element.requirementIds)].map((id) => ({
    id,
    text,
    elementIds: [element.id],
    claims: [{ id: `${id}-component-claim`, sourceSpan, predicate: "quantity", status: "asserted" }],
    assertions: [
      { kind: "placement_count", claimId: `${id}-component-claim`, sourceSpan, minimum: 1 },
      { kind: "distinct_elements", claimId: `${id}-component-claim`, sourceSpan, minimum: 1 },
    ],
  }));
  return { schemaVersion: 1, description: `component operation ${element.id}`, requirements, elements: [element] };
}

function assertInsideComponent(point: Vec3, component: DesignProgramV2["components"][number]) {
  const { min, max } = component.bounds;
  if (point.x < min.x || point.y < min.y || point.z < min.z || point.x > max.x || point.y > max.y || point.z > max.z) {
    throw new Error(`DESIGN_COMPONENT_BOUNDS_VIOLATION: component ${component.id} produced ${point.x},${point.y},${point.z} outside its declared bounds.`);
  }
}

function sourceForPlacement(placement: Placement): ComponentConflictSource {
  return {
    componentId: placement.componentId ?? "legacy",
    elementId: placement.elementId,
    elementInstanceId: placement.elementInstanceId,
    operationPhase: placement.operationPhase ?? "detail",
  };
}

function pointOf(point: Vec3): Vec3 {
  return { x: point.x, y: point.y, z: point.z };
}

function insideBounds(point: Vec3, bounds: { min: Vec3; max: Vec3 }) {
  return point.x >= bounds.min.x && point.x <= bounds.max.x
    && point.y >= bounds.min.y && point.y <= bounds.max.y
    && point.z >= bounds.min.z && point.z <= bounds.max.z;
}

function operationWeight(operations: ComponentOperation[]) {
  return operations.reduce((total, operation) => total + (operation.kind === "intersect" ? operation.coordinates.length : 1), 0);
}

function cloneComponentCacheEntry(entry: ComponentOperationCacheEntry): ComponentOperationCacheEntry {
  return structuredClone(entry);
}
