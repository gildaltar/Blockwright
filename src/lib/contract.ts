import { createHash } from "node:crypto";
import type {
  BuildCertificate,
  BuildContractResult,
  BuildInput,
  BuildRecord,
  ContractCheckResult,
  ContractClause,
  ContractClauseSeverity,
  Placement,
  Vec3,
} from "./types.js";

export const CONTRACT_EVALUATOR_VERSION = "blockwright-contract/0.6.0";

export type ContractClauseInput = string | { requirement: string; severity?: ContractClauseSeverity };
export type BuildContractOverride = { features?: string[]; clauses?: ContractClauseInput[] };

export type SemanticAuditCheck = {
  id: string;
  category: "integrity" | "entrances" | "clearance" | "spawn" | "rooms" | "lighting" | "interior" | "support" | "palette" | "version" | "origin" | "budget";
  status: "pass" | "fail" | "warning" | "unevaluated";
  message: string;
  expected: string;
  actual: string;
  coordinates: Vec3[];
  total?: number;
};

export type SemanticBuildAudit = {
  evaluatorVersion: string;
  buildHash: string;
  checks: SemanticAuditCheck[];
  entranceWidths: Partial<Record<"north" | "south" | "east" | "west", number>>;
  lightCount: number;
  spawn: Vec3 | undefined;
};

type ContractEvaluableBuild = Pick<
  BuildRecord,
  "id" | "hash" | "input" | "plan" | "bounds" | "placements" | "registry" | "validation"
>;

type CardinalSide = "north" | "south" | "east" | "west";

const cardinalSides: CardinalSide[] = ["north", "south", "east", "west"];
const coordinateKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const boundedCoordinates = (coordinates: Vec3[]) => coordinates.slice(0, 250).map(({ x, y, z }) => ({ x, y, z }));

function canonicalValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

/** The immutable digest covers normalized design intent and every canonical placement. */
export function calculateBuildHash(input: Required<BuildInput>, placements: Placement[]) {
  const { confirmationToken: _confirmationToken, ...designInput } = input;
  const payload = {
    input: designInput,
    placements: placements.map(({ x, y, z, block, phase, state, blockEntity }) => ({
      x,
      y,
      z,
      block,
      phase,
      ...(state ? { state: canonicalValue(state) } : {}),
      ...(blockEntity ? { blockEntity: canonicalValue(blockEntity) } : {}),
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonicalValue(payload))).digest("hex");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

const understoodWords = new Set([
  "a", "an", "the", "with", "and", "on", "at", "of", "to", "for", "from", "in", "each", "every", "all", "four",
  "cardinal", "side", "sides", "north", "northern", "south", "southern", "east", "eastern", "west", "western",
  "way", "compass", "direction", "directions", "exactly",
  "entrance", "entrances", "exit", "exits", "door", "doors", "doorway", "doorways", "minimum", "least", "block", "blocks",
  "wide", "width", "clear", "cleared", "clearance", "cross", "corridor", "corridors", "path", "paths", "passage", "passages",
  "central", "center", "centred", "centered", "spawn", "safe", "safety", "pedestal", "platform", "lit", "light", "lights",
  "lighting", "illuminated", "well", "throughout", "interior", "interiors", "functional", "furnished", "usable", "room", "rooms",
  "accessible", "access", "support", "supported", "contact", "structural", "roof", "roofs", "covered", "porch", "hearth",
  "fireplace", "storage", "loft", "sea", "lantern", "lanterns", "glowstone", "torch", "torches", "minecraft", "x",
]);

function unknownWords(value: string) {
  return normalizeText(value)
    .replace(/minecraft:/g, "minecraft ")
    .replace(/[_-]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !/^\d+$/.test(token) && !/^\d+x\d+$/.test(token) && !understoodWords.has(token));
}

function featureSeverity(feature: string, explicit?: ContractClauseSeverity) {
  if (explicit) return { severity: explicit, text: feature.trim() };
  const match = feature.match(/^\s*(hard|warning|aesthetic)\s*:\s*(.+)$/i);
  return match
    ? { severity: match[1].toLowerCase() as ContractClauseSeverity, text: match[2].trim() }
    : { severity: "hard" as const, text: feature.trim() };
}

function clause(
  id: string,
  severity: ContractClauseSeverity,
  requirement: string,
  source: ContractClause["source"],
  sourceText: string,
  evaluator: string | undefined,
  parameters: ContractClause["parameters"] = {},
): ContractClause {
  return { id, severity, requirement, source, sourceText, evaluator, supported: Boolean(evaluator), parameters };
}

function requestedWidth(text: string, subject: "entrance" | "corridor") {
  const noun = subject === "entrance" ? "(?:entrances?|exits?|doors?|doorways?)" : "(?:corridors?|paths?|passages?)";
  const before = text.match(new RegExp(`(\\d+)[-\\s]*(?:blocks?[-\\s]*)?wide\\s+(?:(?:clear|cross)\\s+){0,2}${noun}`));
  const after = text.match(new RegExp(`${noun}\\s*(?:(?:with|of|at\\s+least|minimum)\\s*)?(\\d+)[-\\s]*(?:blocks?[-\\s]*)?wide`));
  return Number(before?.[1] ?? after?.[1] ?? 1);
}

function parseFeature(
  candidate: ContractClauseInput,
  source: "feature" | "override",
  sourceIndex: number,
): ContractClause[] {
  const input = typeof candidate === "string" ? candidate : candidate.requirement;
  const parsed = featureSeverity(input, typeof candidate === "string" ? undefined : candidate.severity);
  const text = normalizeText(parsed.text);
  const prefix = `${source}-${sourceIndex + 1}`;
  if (!text) return [clause(prefix, parsed.severity, "Non-empty requirement", source, input, undefined)];

  if (parsed.severity === "warning") {
    return [clause(prefix, "warning", text, source, input, "declared-warning")];
  }
  if (parsed.severity === "aesthetic") {
    return [clause(prefix, "aesthetic", text, source, input, "aesthetic-observation")];
  }

  const unrecognized = unknownWords(text);
  if (unrecognized.length) {
    return [clause(prefix, "hard", text, source, input, undefined, { unrecognized: [...new Set(unrecognized)].sort() })];
  }

  const clauses: ContractClause[] = [];
  const entranceWords = /\b(entrances?|exits?|doors?|doorways?)\b/;
  if (entranceWords.test(text)) {
    const allFour = /\b(?:four|4)\b|\ball\s+(?:(?:four|4)\s+)?(?:cardinal\s+)?sides?\b|\bfour\s+(?:compass\s+)?directions\b/.test(text)
      || cardinalSides.every((side) => text.includes(side));
    const sides = allFour
      ? cardinalSides
      : cardinalSides.filter((side) => new RegExp(`\\b${side}(?:ern)?\\b`).test(text));
    clauses.push(clause(
      `${prefix}-entrances`,
      "hard",
      `${sides.length ? sides.join(", ") : "declared"} entrance${sides.length === 1 ? "" : "s"} with at least ${requestedWidth(text, "entrance")} block(s) clear width`,
      source,
      input,
      "entrances",
      { sides: sides.length ? sides : ["south"], minimumWidth: requestedWidth(text, "entrance") },
    ));
  }

  if (/\b(corridors?|paths?|passages?|clearance)\b/.test(text)) {
    clauses.push(clause(
      `${prefix}-clearance`,
      "hard",
      `${requestedWidth(text, "corridor")}-block-wide ${/\bcross\b/.test(text) ? "cross-corridor" : "entrance corridor"} with two-block headroom`,
      source,
      input,
      "corridor-clearance",
      { minimumWidth: requestedWidth(text, "corridor"), cross: /\bcross\b/.test(text), headroom: 2 },
    ));
  }

  if (/\b(pedestal|spawn platform)\b/.test(text)) {
    const dimensions = text.match(/(\d+)\s*[x×]\s*(\d+)/);
    const size = dimensions ? Math.max(Number(dimensions[1]), Number(dimensions[2])) : 1;
    const material = /sea[- _]?lantern/.test(text) ? "minecraft:sea_lantern" : /glowstone/.test(text) ? "minecraft:glowstone" : "";
    clauses.push(clause(
      `${prefix}-spawn-pedestal`,
      "hard",
      `safe central ${size}x${size} spawn pedestal${material ? ` made from ${material}` : ""}`,
      source,
      input,
      "spawn-pedestal",
      { size, ...(material ? { material } : {}) },
    ));
  }

  if (/\bspawn\b/.test(text) && !/\b(pedestal|spawn platform)\b/.test(text)) {
    clauses.push(clause(`${prefix}-spawn-safety`, "hard", "safe central spawn with two-block headroom", source, input, "spawn-safety"));
  }

  if (/\b(lit|lights?|lighting|illuminated|lanterns?|torches?)\b/.test(text)) {
    const explicitCount = text.match(/(\d+)\s+(?:interior\s+)?(?:lights?|lanterns?|torches?)\b/);
    const spawnScoped = /\bspawn\b|\bpedestal\b/.test(text);
    clauses.push(clause(
      `${prefix}-lighting`,
      "hard",
      spawnScoped ? "lighting at the central spawn" : "distributed interior lighting",
      source,
      input,
      "lighting",
      { minimumCount: Number(explicitCount?.[1] ?? 1), scope: spawnScoped ? "spawn" : "interior", distributed: /\b(well|throughout)\b/.test(text) },
    ));
  }

  if (/\bcovered porch\b/.test(text)) clauses.push(clause(`${prefix}-covered-porch`, "hard", "covered porch", source, input, "covered-porch"));
  if (/\b(hearth|fireplace)\b/.test(text)) clauses.push(clause(`${prefix}-hearth`, "hard", "constructed hearth", source, input, "hearth"));
  if (/\bstorage loft\b|\bloft storage\b/.test(text)) clauses.push(clause(`${prefix}-storage-loft`, "hard", "constructed storage loft", source, input, "storage-loft"));
  if (/\b(functional|furnished|usable) interiors?\b/.test(text)) clauses.push(clause(`${prefix}-functional-interior`, "hard", "functional constructed interior", source, input, "functional-interior"));
  if (/\b(room access|rooms? accessible|accessible rooms?)\b/.test(text)) {
    clauses.push(clause(`${prefix}-room-access`, "hard", "geometrically accessible rooms", source, input, undefined, { reason: "room bounds and door associations are not present in schema v2" }));
  }
  if (/\b(supported roofs?|support|structural contact)\b/.test(text)) clauses.push(clause(`${prefix}-support`, "hard", "face-supported structural placements", source, input, "support-contact"));

  return clauses.length ? clauses : [clause(prefix, "hard", text, source, input, undefined)];
}

const implicitClauses: Array<Omit<ContractClause, "sourceText">> = [
  clause("implicit-hash", "hard", "canonical payload matches the immutable build hash", "implicit", "", "hash-integrity"),
  clause("implicit-grid", "hard", "placements use unique integer 1x1x1 coordinates", "implicit", "", "canonical-grid"),
  clause("implicit-edition", "hard", "registry edition matches the requested edition", "implicit", "", "edition"),
  clause("implicit-version", "hard", "exact requested-version registry compatibility", "implicit", "", "exact-version"),
  clause("implicit-dimensions", "hard", "all placements remain inside the requested dimensions", "implicit", "", "dimensions"),
  clause("implicit-origin", "hard", "occupied minimum corner matches the requested paste origin", "implicit", "", "paste-origin"),
  clause("implicit-palette", "hard", "every placement uses a validated role-palette identifier", "implicit", "", "palette-legality"),
  clause("implicit-budget", "hard", "canonical placement count stays within the block budget", "implicit", "", "block-budget"),
];

export function normalizeBuildContract(input: Required<BuildInput>, override?: BuildContractOverride): ContractClause[] {
  const clauses: ContractClause[] = implicitClauses.map((item) => ({ ...item, sourceText: item.requirement, parameters: { ...item.parameters } }));
  input.features.forEach((feature, index) => clauses.push(...parseFeature(feature, "feature", index)));
  const extra = [
    ...(override?.features ?? []),
    ...(override?.clauses ?? []),
  ];
  extra.forEach((item, index) => clauses.push(...parseFeature(item, "override", index)));
  const seen = new Set<string>();
  return clauses.filter((item) => {
    const key = `${item.severity}:${item.requirement}:${item.evaluator ?? "unsupported"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expectedEnvelope(build: ContractEvaluableBuild) {
  const { origin, dimensions } = build.input;
  return {
    min: { ...origin },
    max: { x: origin.x + dimensions.width - 1, y: origin.y + dimensions.height - 1, z: origin.z + dimensions.depth - 1 },
  };
}

function entranceSide(placement: Placement, envelope: ReturnType<typeof expectedEnvelope>): CardinalSide | undefined {
  // Generator convention: the minimum-z facade is called south throughout schema v2.
  if (placement.z === envelope.min.z) return "south";
  if (placement.z === envelope.max.z) return "north";
  if (placement.x === envelope.min.x) return "west";
  if (placement.x === envelope.max.x) return "east";
  return undefined;
}

function detectEntrances(build: ContractEvaluableBuild) {
  const envelope = expectedEnvelope(build);
  const coordinates: Record<CardinalSide, Placement[]> = { north: [], south: [], east: [], west: [] };
  for (const placement of build.placements) {
    if (!/_door$/.test(placement.block) || /_trapdoor$/.test(placement.block)) continue;
    if (String(placement.state?.half ?? "lower") !== "lower") continue;
    const side = entranceSide(placement, envelope);
    if (side) coordinates[side].push(placement);
  }
  const widths: Partial<Record<CardinalSide, number>> = {};
  for (const side of cardinalSides) {
    const values = [...new Set(coordinates[side].map((placement) => side === "north" || side === "south" ? placement.x : placement.z))].sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    let previous: number | undefined;
    for (const value of values) {
      run = previous !== undefined && value === previous + 1 ? run + 1 : 1;
      previous = value;
      longest = Math.max(longest, run);
    }
    if (longest) widths[side] = longest;
  }
  return { coordinates, widths };
}

function isInsideEnvelope(point: Vec3, envelope: ReturnType<typeof expectedEnvelope>) {
  return point.x >= envelope.min.x && point.x <= envelope.max.x
    && point.y >= envelope.min.y && point.y <= envelope.max.y
    && point.z >= envelope.min.z && point.z <= envelope.max.z;
}

function interiorLightingPlacements(build: ContractEvaluableBuild) {
  const paletteLight = build.input.rolePalette.lighting;
  return build.placements.filter((placement) => placement.block === paletteLight || /(?:^|:)(?:sea_lantern|lantern|soul_lantern|glowstone|shroomlight|ochre_froglight|verdant_froglight|pearlescent_froglight|torch|soul_torch|end_rod)$/.test(placement.block));
}

function findSafeSpawn(build: ContractEvaluableBuild, byCoordinate: Map<string, Placement>) {
  const envelope = expectedEnvelope(build);
  const x = Math.floor((envelope.min.x + envelope.max.x) / 2);
  const z = Math.floor((envelope.min.z + envelope.max.z) / 2);
  for (let y = envelope.min.y; y <= envelope.max.y - 2; y += 1) {
    if (!byCoordinate.has(`${x},${y},${z}`)) continue;
    if (!byCoordinate.has(`${x},${y + 1},${z}`) && !byCoordinate.has(`${x},${y + 2},${z}`)) return { x, y: y + 1, z };
  }
  return undefined;
}

function supportFailures(build: ContractEvaluableBuild, byCoordinate: Map<string, Placement>) {
  const deltas = [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  ];
  let total = 0;
  const coordinates: Vec3[] = [];
  for (const placement of build.placements) {
    if (/landscap|garden|foliage|path|terrain/i.test(placement.phase) || /grass|flower|leaves|vine|moss|carpet|snow/.test(placement.block)) continue;
    if (deltas.some((delta) => byCoordinate.has(`${placement.x + delta.x},${placement.y + delta.y},${placement.z + delta.z}`))) continue;
    total += 1;
    if (coordinates.length < 250) coordinates.push({ x: placement.x, y: placement.y, z: placement.z });
  }
  return { total, coordinates };
}

function graphReachability(build: ContractEvaluableBuild) {
  const ids = build.plan.roomGraph.rooms.map(({ id }) => id);
  if (!ids.length) return { connected: false, reached: 0, total: 0 };
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const link of build.plan.roomGraph.links) {
    adjacency.get(link.from)?.add(link.to);
    adjacency.get(link.to)?.add(link.from);
  }
  const reached = new Set([ids[0]]);
  const queue = [ids[0]];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
  return { connected: reached.size === ids.length, reached: reached.size, total: ids.length };
}

export function auditBuildSemantics(build: ContractEvaluableBuild): SemanticBuildAudit {
  const envelope = expectedEnvelope(build);
  const byCoordinate = new Map<string, Placement>();
  for (const placement of build.placements) byCoordinate.set(coordinateKey(placement), placement);
  const entrances = detectEntrances(build);
  const entrancePlacements = cardinalSides.flatMap((side) => entrances.coordinates[side]);
  const blockedEntranceCoordinates: Vec3[] = [];
  for (const placement of entrancePlacements) {
    const side = entranceSide(placement, envelope)!;
    const inward = side === "south" ? { x: 0, z: 1 } : side === "north" ? { x: 0, z: -1 } : side === "west" ? { x: 1, z: 0 } : { x: -1, z: 0 };
    for (let distance = 1; distance <= 2; distance += 1) for (let dy = 0; dy < 2; dy += 1) {
      const point = { x: placement.x + inward.x * distance, y: placement.y + dy, z: placement.z + inward.z * distance };
      if (byCoordinate.has(coordinateKey(point))) blockedEntranceCoordinates.push(point);
    }
  }
  const spawn = findSafeSpawn(build, byCoordinate);
  const lights = interiorLightingPlacements(build);
  let functionalTotal = 0;
  const functionalCoordinates: Vec3[] = [];
  for (const placement of build.placements) {
    if (!/interior|furnitur|hearth|fireplace|storage|workstation|seating|bed|loft/i.test(placement.phase)) continue;
    functionalTotal += 1;
    if (functionalCoordinates.length < 250) functionalCoordinates.push({ x: placement.x, y: placement.y, z: placement.z });
  }
  const unsupported = supportFailures(build, byCoordinate);
  const palette = new Set(Object.values(build.input.rolePalette).filter((value): value is string => typeof value === "string"));
  let illegalPaletteTotal = 0;
  const illegalPaletteCoordinates: Vec3[] = [];
  for (const placement of build.placements) {
    if (palette.has(placement.block)) continue;
    illegalPaletteTotal += 1;
    if (illegalPaletteCoordinates.length < 250) illegalPaletteCoordinates.push({ x: placement.x, y: placement.y, z: placement.z });
  }
  const graph = graphReachability(build);
  const actualHash = calculateBuildHash(build.input, build.placements);
  const allInteger = build.placements.every(({ x, y, z }) => [x, y, z].every(Number.isSafeInteger));
  const allInside = build.placements.every((point) => isInsideEnvelope(point, envelope));
  const originMatches = build.bounds.min.x === envelope.min.x && build.bounds.min.y === envelope.min.y && build.bounds.min.z === envelope.min.z;
  const exactVersion = build.registry.edition === build.input.edition
    && build.registry.requestedVersion === build.input.version
    && (build.input.edition !== "java" || build.registry.coverageVersion === build.input.version)
    && !build.registry.note;
  const checks: SemanticAuditCheck[] = [
    {
      id: "hash-integrity", category: "integrity", status: actualHash === build.hash ? "pass" : "fail",
      message: actualHash === build.hash ? "The canonical payload reproduces the declared SHA-256 hash." : "The input or placements no longer reproduce the declared build hash.",
      expected: build.hash, actual: actualHash, coordinates: [],
    },
    {
      id: "canonical-grid", category: "integrity", status: allInteger && byCoordinate.size === build.placements.length ? "pass" : "fail",
      message: allInteger && byCoordinate.size === build.placements.length ? "Every placement has one unique integer coordinate." : "The canonical record contains a fractional or duplicate coordinate.",
      expected: `${build.placements.length} unique integer coordinates`, actual: `${byCoordinate.size} unique coordinates; integer=${allInteger}`, coordinates: [],
    },
    {
      id: "entrances", category: "entrances", status: Object.keys(entrances.widths).length ? "pass" : "fail",
      message: Object.keys(entrances.widths).length ? "Boundary door geometry identifies at least one entrance." : "No lower door block was found on a requested-envelope boundary.",
      expected: "at least one boundary entrance", actual: cardinalSides.map((side) => `${side}:${entrances.widths[side] ?? 0}`).join(", "), coordinates: boundedCoordinates(entrancePlacements),
    },
    {
      id: "entrance-clearance", category: "clearance", status: entrancePlacements.length && !blockedEntranceCoordinates.length ? "pass" : entrancePlacements.length ? "warning" : "unevaluated",
      message: !entrancePlacements.length ? "Clearance cannot be evaluated without a boundary entrance." : blockedEntranceCoordinates.length ? "At least one entrance has blocked two-block headroom immediately inside the facade." : "Every detected entrance has two-block headroom for the first two interior blocks.",
      expected: "two blocks of headroom for two blocks inward", actual: `${blockedEntranceCoordinates.length} blocked cells`, coordinates: boundedCoordinates(blockedEntranceCoordinates),
    },
    {
      id: "spawn-safety", category: "spawn", status: spawn ? "pass" : "warning",
      message: spawn ? "The central column contains a supported standing position with two clear blocks above." : "No safe two-block-high central standing position was found.",
      expected: "supported center spawn with two-block headroom", actual: spawn ? `${spawn.x},${spawn.y},${spawn.z}` : "none", coordinates: spawn ? [spawn] : [],
    },
    {
      id: "room-access", category: "rooms", status: "unevaluated",
      message: `The plan graph reaches ${graph.reached}/${graph.total} rooms, but schema v2 has no room bounds or door-to-room associations for geometric access proof.`,
      expected: "geometric path from an entrance to every room", actual: `plan graph connected=${graph.connected}; geometric mapping unavailable`, coordinates: [],
    },
    {
      id: "lighting", category: "lighting", status: lights.length ? "pass" : "warning",
      message: lights.length ? "The canonical record contains explicit lighting-role or luminous blocks." : "No explicit lighting-role or luminous block was found; engine-accurate light propagation is unavailable.",
      expected: "at least one explicit luminous placement", actual: `${lights.length} luminous placements`, coordinates: boundedCoordinates(lights),
    },
    {
      id: "functional-interior", category: "interior", status: functionalTotal ? "pass" : "warning",
      message: functionalTotal ? "Interior-function phases are represented by canonical placements." : "No placement is associated with an interior-function phase; an empty shell is not certified as furnished or functional.",
      expected: "at least one constructed interior-function placement", actual: `${functionalTotal} placements`, coordinates: functionalCoordinates, total: functionalTotal,
    },
    {
      id: "support-contact", category: "support", status: unsupported.total ? "warning" : "pass",
      message: unsupported.total ? "Some non-landscape placements have no face-adjacent block and require contact review." : "Every non-landscape placement has face-adjacent contact.",
      expected: "face-adjacent contact for every non-landscape placement", actual: `${unsupported.total} isolated placements`, coordinates: unsupported.coordinates, total: unsupported.total,
    },
    {
      id: "palette-legality", category: "palette", status: illegalPaletteTotal ? "fail" : "pass",
      message: illegalPaletteTotal ? "Placements contain identifiers outside the normalized role palette." : "Every placement identifier belongs to the normalized role palette.",
      expected: "all placements drawn from normalized role palette", actual: `${illegalPaletteTotal} illegal placements`, coordinates: illegalPaletteCoordinates, total: illegalPaletteTotal,
    },
    {
      id: "exact-version", category: "version", status: exactVersion ? "pass" : "fail",
      message: exactVersion ? "Registry metadata exactly covers the requested edition/version." : "Registry metadata does not prove exact requested-version compatibility.",
      expected: `${build.input.edition} ${build.input.version}`, actual: `${build.registry.edition} requested=${build.registry.requestedVersion} coverage=${build.registry.coverageVersion}${build.registry.note ? ` (${build.registry.note})` : ""}`, coordinates: [],
    },
    {
      id: "dimensions", category: "origin", status: allInside ? "pass" : "fail",
      message: allInside ? "Every placement remains inside the requested inclusive envelope." : "At least one placement exceeds the requested inclusive envelope.",
      expected: `${envelope.min.x},${envelope.min.y},${envelope.min.z} through ${envelope.max.x},${envelope.max.y},${envelope.max.z}`, actual: `${build.bounds.min.x},${build.bounds.min.y},${build.bounds.min.z} through ${build.bounds.max.x},${build.bounds.max.y},${build.bounds.max.z}`, coordinates: boundedCoordinates(build.placements.filter((point) => !isInsideEnvelope(point, envelope))),
    },
    {
      id: "paste-origin", category: "origin", status: originMatches ? "pass" : "fail",
      message: originMatches ? "The occupied minimum corner equals the requested paste origin." : "The occupied minimum corner does not equal the requested paste origin.",
      expected: `${envelope.min.x},${envelope.min.y},${envelope.min.z}`, actual: `${build.bounds.min.x},${build.bounds.min.y},${build.bounds.min.z}`, coordinates: [],
    },
    {
      id: "block-budget", category: "budget", status: build.placements.length <= build.input.blockBudget ? "pass" : "fail",
      message: build.placements.length <= build.input.blockBudget ? "The canonical placement count is within budget." : "The canonical placement count exceeds the locked block budget.",
      expected: `<= ${build.input.blockBudget} placements`, actual: `${build.placements.length} placements`, coordinates: [],
    },
  ];
  return { evaluatorVersion: CONTRACT_EVALUATOR_VERSION, buildHash: build.hash, checks, entranceWidths: entrances.widths, lightCount: lights.length, spawn };
}

function semanticCheck(audit: SemanticBuildAudit, id: string) {
  return audit.checks.find((check) => check.id === id)!;
}

function hardResult(clause: ContractClause, status: ContractCheckResult["status"], message: string, expected?: string, actual?: string, coordinates?: Vec3[]): ContractCheckResult {
  return {
    clauseId: clause.id,
    severity: "hard",
    status,
    requirement: clause.requirement,
    ...(clause.evaluator ? { evaluator: clause.evaluator } : {}),
    message,
    ...(expected ? { expected } : {}),
    ...(actual ? { actual } : {}),
    ...(coordinates?.length ? { coordinates: boundedCoordinates(coordinates) } : {}),
  };
}

function resultFromSemantic(clause: ContractClause, check: SemanticAuditCheck) {
  const status = check.status === "pass" ? "pass" : check.status === "unevaluated" ? "unevaluated" : "fail";
  return hardResult(clause, status, check.message, check.expected, check.actual, check.coordinates);
}

function centeredRange(minimum: number, maximum: number, width: number) {
  const boundedWidth = Math.max(1, Math.min(width, maximum - minimum + 1));
  const start = Math.max(minimum, Math.min(maximum - boundedWidth + 1, Math.floor((minimum + maximum - boundedWidth + 1) / 2)));
  return Array.from({ length: boundedWidth }, (_, index) => start + index);
}

function corridorResult(build: ContractEvaluableBuild, clause: ContractClause) {
  const width = Number(clause.parameters.minimumWidth ?? 1);
  const cross = Boolean(clause.parameters.cross);
  const envelope = expectedEnvelope(build);
  const byCoordinate = new Map(build.placements.map((placement) => [coordinateKey(placement), placement]));
  const blocked: Vec3[] = [];
  const yValues = [build.input.origin.y + 2, build.input.origin.y + 3];
  if (cross) {
    for (const x of centeredRange(envelope.min.x + 1, envelope.max.x - 1, width)) {
      for (let z = envelope.min.z + 1; z < envelope.max.z; z += 1) for (const y of yValues) if (byCoordinate.has(`${x},${y},${z}`)) blocked.push({ x, y, z });
    }
    for (const z of centeredRange(envelope.min.z + 1, envelope.max.z - 1, width)) {
      for (let x = envelope.min.x + 1; x < envelope.max.x; x += 1) for (const y of yValues) if (byCoordinate.has(`${x},${y},${z}`)) blocked.push({ x, y, z });
    }
  } else {
    const entranceAudit = detectEntrances(build);
    const entrances = cardinalSides.flatMap((side) => entranceAudit.coordinates[side]);
    if (!entrances.length) return hardResult(clause, "unevaluated", "No boundary entrance exists from which to evaluate a corridor.", "a clear path from a boundary entrance", "no entrance");
    const widestEntrance = Math.max(0, ...Object.values(entranceAudit.widths));
    if (widestEntrance < width) {
      return hardResult(clause, "fail", "No detected entrance is wide enough to originate the requested corridor.", `${width}-block-wide entrance corridor`, `${widestEntrance}-block maximum entrance width`);
    }
    for (const entrance of entrances) {
      const side = entranceSide(entrance, envelope)!;
      const inward = side === "south" ? { x: 0, z: 1 } : side === "north" ? { x: 0, z: -1 } : side === "west" ? { x: 1, z: 0 } : { x: -1, z: 0 };
      const distance = side === "north" || side === "south" ? Math.floor(build.input.dimensions.depth / 2) : Math.floor(build.input.dimensions.width / 2);
      for (let step = 1; step <= distance; step += 1) for (const y of [entrance.y, entrance.y + 1]) {
        const point = { x: entrance.x + inward.x * step, y, z: entrance.z + inward.z * step };
        if (byCoordinate.has(coordinateKey(point))) blocked.push(point);
      }
    }
  }
  return hardResult(
    clause,
    blocked.length ? "fail" : "pass",
    blocked.length ? "Canonical blocks obstruct the requested corridor headroom." : "The requested corridor volume has two-block headroom.",
    `${width}-block-wide ${cross ? "cross" : "entrance"} corridor`,
    `${blocked.length} blocked cells`,
    blocked,
  );
}

function pedestalResult(build: ContractEvaluableBuild, clause: ContractClause) {
  const size = Math.max(1, Number(clause.parameters.size ?? 1));
  const material = typeof clause.parameters.material === "string" ? clause.parameters.material : undefined;
  const envelope = expectedEnvelope(build);
  const byCoordinate = new Map(build.placements.map((placement) => [coordinateKey(placement), placement]));
  const xs = centeredRange(envelope.min.x, envelope.max.x, size);
  const zs = centeredRange(envelope.min.z, envelope.max.z, size);
  for (let y = envelope.min.y; y <= envelope.max.y - 2; y += 1) {
    const platform = xs.flatMap((x) => zs.map((z) => byCoordinate.get(`${x},${y},${z}`)));
    if (platform.some((placement) => !placement)) continue;
    if (material && platform.some((placement) => placement!.block !== material)) continue;
    if (!material && platform.some((placement) => !/spawn|pedestal/i.test(placement!.phase))) continue;
    const blocked = xs.flatMap((x) => zs.flatMap((z) => [1, 2].map((dy) => ({ x, y: y + dy, z })))).filter((point) => byCoordinate.has(coordinateKey(point)));
    if (blocked.length) return hardResult(clause, "fail", "The central pedestal exists but lacks two-block headroom.", `${size}x${size} clear pedestal`, `${blocked.length} blocked headroom cells`, blocked);
    return hardResult(clause, "pass", "A centered pedestal with clear spawn headroom is present.", `${size}x${size}${material ? ` ${material}` : ""} pedestal`, `platform at y=${y}`, platform as Placement[]);
  }
  return hardResult(clause, "fail", "No canonical centered pedestal matches the requested size, material, and semantic phase.", `${size}x${size}${material ? ` ${material}` : ""} pedestal`, "none");
}

function lightingResult(build: ContractEvaluableBuild, clause: ContractClause) {
  const lights = interiorLightingPlacements(build);
  const minimum = Math.max(1, Number(clause.parameters.minimumCount ?? 1));
  const scope = String(clause.parameters.scope ?? "interior");
  let relevant = lights;
  if (scope === "spawn") {
    const envelope = expectedEnvelope(build);
    const cx = Math.floor((envelope.min.x + envelope.max.x) / 2);
    const cz = Math.floor((envelope.min.z + envelope.max.z) / 2);
    relevant = lights.filter(({ x, z }) => Math.abs(x - cx) <= 2 && Math.abs(z - cz) <= 2);
  }
  const distributed = Boolean(clause.parameters.distributed);
  let quadrants = 0;
  if (distributed) {
    const envelope = expectedEnvelope(build);
    const cx = (envelope.min.x + envelope.max.x) / 2;
    const cz = (envelope.min.z + envelope.max.z) / 2;
    quadrants = new Set(relevant.map(({ x, z }) => `${x <= cx ? "w" : "e"}${z <= cz ? "s" : "n"}`)).size;
  }
  const passes = relevant.length >= minimum && (!distributed || quadrants >= Math.min(4, minimum));
  return hardResult(
    clause,
    passes ? "pass" : "fail",
    passes ? "Explicit luminous placements satisfy the requested scope." : "The requested explicit lighting count or distribution is absent; no engine-light propagation was inferred.",
    `${minimum} explicit light(s)${scope === "spawn" ? " near spawn" : " in the interior"}${distributed ? ", distributed" : ""}`,
    `${relevant.length} matching light(s)${distributed ? ` across ${quadrants} quadrant(s)` : ""}`,
    relevant,
  );
}

function evaluateHardClause(build: ContractEvaluableBuild, clause: ContractClause, audit: SemanticBuildAudit): ContractCheckResult {
  if (!clause.supported || !clause.evaluator) {
    const reason = typeof clause.parameters.reason === "string" ? clause.parameters.reason : undefined;
    const unknown = Array.isArray(clause.parameters.unrecognized) ? ` Unrecognized terms: ${clause.parameters.unrecognized.join(", ")}.` : "";
    return hardResult(clause, "unsupported", `${reason ?? "No executable evaluator exists for this hard requirement."}${unknown}`);
  }
  switch (clause.evaluator) {
    case "hash-integrity":
    case "canonical-grid":
    case "exact-version":
    case "dimensions":
    case "paste-origin":
    case "palette-legality":
    case "block-budget":
    case "spawn-safety":
      return resultFromSemantic(clause, semanticCheck(audit, clause.evaluator));
    case "edition": {
      const pass = build.registry.edition === build.input.edition;
      return hardResult(clause, pass ? "pass" : "fail", pass ? "Registry and requested editions match." : "Registry and requested editions differ.", build.input.edition, build.registry.edition);
    }
    case "entrances": {
      const sides = (clause.parameters.sides as string[] ?? ["south"]) as CardinalSide[];
      const minimum = Number(clause.parameters.minimumWidth ?? 1);
      const missing = sides.filter((side) => (audit.entranceWidths[side] ?? 0) < minimum);
      return hardResult(
        clause,
        missing.length ? "fail" : "pass",
        missing.length ? `Boundary door geometry does not satisfy ${missing.join(", ")}.` : "Boundary door geometry satisfies every required side and width.",
        sides.map((side) => `${side}>=${minimum}`).join(", "),
        cardinalSides.map((side) => `${side}=${audit.entranceWidths[side] ?? 0}`).join(", "),
      );
    }
    case "corridor-clearance": return corridorResult(build, clause);
    case "spawn-pedestal": return pedestalResult(build, clause);
    case "lighting": return lightingResult(build, clause);
    case "covered-porch": {
      const porch = build.placements.filter((placement) => /porch/i.test(placement.phase));
      const byColumn = new Set(build.placements.filter((placement) => /roof|cover|eave/i.test(placement.phase)).map(({ x, z }) => `${x},${z}`));
      const covered = porch.filter(({ x, z }) => byColumn.has(`${x},${z}`));
      const pass = porch.length > 0 && covered.length >= Math.ceil(porch.length / 2);
      return hardResult(clause, pass ? "pass" : "fail", pass ? "A majority of porch placements have canonical cover above their columns." : "A covered porch is not represented by enough porch-and-cover columns.", ">=50% covered porch columns", `${covered.length}/${porch.length}`, porch);
    }
    case "hearth": {
      const matches = build.placements.filter((placement) => /hearth|fireplace/i.test(placement.phase) || /(?:^|:)(?:campfire|soul_campfire|furnace|blast_furnace)$/.test(placement.block));
      return hardResult(clause, matches.length ? "pass" : "fail", matches.length ? "Canonical hearth placements are present." : "No canonical hearth phase or hearth block is present.", "constructed hearth", `${matches.length} placements`, matches);
    }
    case "storage-loft": {
      const minimumY = build.input.origin.y + Math.max(3, build.plan.floorHeights[0] ?? 4);
      const matches = build.placements.filter((placement) => placement.y >= minimumY && /storage|loft/i.test(placement.phase));
      return hardResult(clause, matches.length ? "pass" : "fail", matches.length ? "Canonical storage-loft placements exist above the ground floor." : "The plan label is not backed by constructed storage-loft placements.", `storage/loft phase at y>=${minimumY}`, `${matches.length} placements`, matches);
    }
    case "functional-interior": {
      const check = semanticCheck(audit, "functional-interior");
      return resultFromSemantic(clause, check);
    }
    case "support-contact": {
      const check = semanticCheck(audit, "support-contact");
      return resultFromSemantic(clause, check);
    }
    default:
      return hardResult(clause, "unevaluated", `Evaluator ${clause.evaluator} did not produce a result.`);
  }
}

function createCertificate(build: ContractEvaluableBuild, hardResults: ContractCheckResult[], warnings: ContractCheckResult[], aesthetics: ContractCheckResult[]): BuildCertificate {
  const hard = {
    passed: hardResults.filter(({ status }) => status === "pass").length,
    failed: hardResults.filter(({ status }) => status === "fail").length,
    unsupported: hardResults.filter(({ status }) => status === "unsupported").length,
    unevaluated: hardResults.filter(({ status }) => status === "unevaluated").length,
  };
  const status = hard.failed || hard.unsupported || hard.unevaluated ? "invalid" : "valid";
  const lines = [
    "Blockwright Semantic Certificate",
    `Evaluator: ${CONTRACT_EVALUATOR_VERSION}`,
    `Build: ${build.id}`,
    `SHA-256: ${build.hash}`,
    `Status: ${status.toUpperCase()}`,
    `Hard requirements: ${hard.passed} passed, ${hard.failed} failed, ${hard.unsupported} unsupported, ${hard.unevaluated} unevaluated`,
    `Operational warnings: ${warnings.length}`,
    `Aesthetic observations: ${aesthetics.length}`,
    ...hardResults.map((result) => `[${result.status.toUpperCase()}] ${result.requirement} — ${result.actual ?? result.message}`),
  ];
  return {
    schemaVersion: 1,
    evaluatorVersion: CONTRACT_EVALUATOR_VERSION,
    buildId: build.id,
    buildHash: build.hash,
    status,
    hard,
    warningCount: warnings.length,
    aestheticObservationCount: aesthetics.length,
    text: lines.join("\n"),
  };
}

export function validateBuildContract(build: ContractEvaluableBuild, override?: BuildContractOverride, existingAudit?: SemanticBuildAudit): BuildContractResult {
  const normalizedClauses = normalizeBuildContract(build.input, override);
  const audit = existingAudit ?? auditBuildSemantics(build);
  const hardResults = normalizedClauses
    .filter(({ severity }) => severity === "hard")
    .map((item) => {
      try {
        return evaluateHardClause(build, item, audit);
      } catch (error) {
        return hardResult(item, "unevaluated", `Evaluator failed closed: ${error instanceof Error ? error.message : "unknown evaluation error"}`);
      }
    });
  const declaredWarnings: ContractCheckResult[] = normalizedClauses
    .filter(({ severity }) => severity === "warning")
    .map((item) => ({ clauseId: item.id, severity: "warning", status: "warning", requirement: item.requirement, evaluator: item.evaluator, message: item.sourceText }));
  const auditWarnings: ContractCheckResult[] = audit.checks
    .filter(({ status }) => status === "warning" || status === "unevaluated")
    .map((check) => ({ clauseId: `audit-${check.id}`, severity: "warning", status: "warning", requirement: check.expected, evaluator: check.id, message: check.message, actual: check.actual, ...(check.coordinates.length ? { coordinates: check.coordinates } : {}) }));
  const registryWarnings: ContractCheckResult[] = build.registry.note
    ? [{ clauseId: "audit-registry-note", severity: "warning", status: "warning", requirement: "exact registry coverage", evaluator: "exact-version", message: build.registry.note }]
    : [];
  const warnings = [...declaredWarnings, ...auditWarnings, ...registryWarnings];
  const aestheticObservations: ContractCheckResult[] = [
    {
      clauseId: "aesthetic-style-profile",
      severity: "aesthetic",
      status: "observation",
      requirement: `${build.input.style} architectural expression`,
      evaluator: "aesthetic-observation",
      message: "Style quality remains subjective and is intentionally excluded from hard contract validity.",
      actual: `${build.plan.footprint.kind} footprint; ${build.plan.roofGrammar.type} roof; ${build.plan.massing.asymmetry.toFixed(3)} asymmetry`,
    },
    ...normalizedClauses.filter(({ severity }) => severity === "aesthetic").map((item) => ({
      clauseId: item.id,
      severity: "aesthetic" as const,
      status: "observation" as const,
      requirement: item.requirement,
      evaluator: item.evaluator,
      message: item.sourceText,
    })),
  ];
  const summary = {
    passed: hardResults.filter(({ status }) => status === "pass").length,
    failed: hardResults.filter(({ status }) => status === "fail").length,
    unsupported: hardResults.filter(({ status }) => status === "unsupported").length,
    unevaluated: hardResults.filter(({ status }) => status === "unevaluated").length,
  };
  const certificate = createCertificate(build, hardResults, warnings, aestheticObservations);
  return {
    schemaVersion: 1,
    evaluatorVersion: CONTRACT_EVALUATOR_VERSION,
    buildHash: build.hash,
    status: certificate.status,
    normalizedClauses,
    hardResults,
    warnings,
    aestheticObservations,
    summary,
    certificate,
  };
}
