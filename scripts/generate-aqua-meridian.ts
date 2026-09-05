import { strict as assert } from "node:assert";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBuild } from "../src/lib/compiler.js";
import { createBedrockMcpack } from "../src/lib/bedrock-structure.js";
import { preflightConfirmationToken } from "../src/lib/preflight.js";
import { auditBuild } from "../src/lib/reviewer-audit.js";
import type {
  BuildInput,
  BuildRecord,
  DesignAssertion,
  DesignAtomicClaim,
  DesignElement,
  DesignProgram,
  DesignRequirement,
  Dimensions,
  RolePalette,
  Vec3,
} from "../src/lib/types.js";

export type ProjectBuildFixture = {
  name: string;
  edition: "bedrock";
  version: string;
  buildingType: NonNullable<BuildInput["buildingType"]>;
  style: string;
  seed: string;
  blockBudget: number;
  dimensions: Dimensions;
  origin: Vec3;
  features: string[];
};

export type AquaMeridianFixture = {
  project: {
    name: string;
    purpose: string;
    overallBounds: { minimum: Vec3; maximum: Vec3 };
    estimatedFootprint: Dimensions;
  };
  sharedRolePalette: RolePalette;
  acceptance: Record<string, unknown>;
  builds: ProjectBuildFixture[];
};

export type AquaMeridianResult = {
  fixture: AquaMeridianFixture;
  builds: BuildRecord[];
  report: ReturnType<typeof validateAquaMeridian>;
};

type MaterialLibrary = NonNullable<BuildInput["materialLibrary"]>;

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const AQUA_MERIDIAN_FIXTURE_PATH = resolve(SCRIPT_DIRECTORY, "../benchmarks/aqua-meridian-waterpark.project.json");

/**
 * Open-ended material vocabulary for the generic geometry programs below.
 * This is deliberately much larger than the 11 compatibility roles. Every
 * identifier is checked against the packaged current Bedrock registry by
 * compileBuild, and more than thirty of these blocks are actually placed.
 */
export const AQUA_MERIDIAN_MATERIALS: MaterialLibrary = Object.freeze({
  site_paving: { block: "minecraft:smooth_stone", tags: ["site", "circulation"] },
  white_structure: { block: "minecraft:white_concrete", tags: ["structure"] },
  pale_structure: { block: "minecraft:light_gray_concrete", tags: ["structure"] },
  charcoal_structure: { block: "minecraft:gray_concrete", tags: ["structure", "mechanical"] },
  black_detail: { block: "minecraft:black_concrete", tags: ["signage", "detail"] },
  quartz: { block: "minecraft:quartz_block", tags: ["structure", "finish"] },
  smooth_quartz: { block: "minecraft:smooth_quartz", tags: ["finish"] },
  quartz_brick: { block: "minecraft:quartz_bricks", tags: ["finish"] },
  carved_quartz: { block: "minecraft:chiseled_quartz_block", tags: ["signage", "finish"] },
  andesite: { block: "minecraft:polished_andesite", tags: ["deck", "mechanical"] },
  diorite: { block: "minecraft:polished_diorite", tags: ["deck", "finish"] },
  stone_brick: { block: "minecraft:stone_bricks", tags: ["foundation"] },
  dark_tile: { block: "minecraft:deepslate_tiles", tags: ["drain", "roof"] },
  dark_masonry: { block: "minecraft:polished_blackstone_bricks", tags: ["mechanical", "retaining"] },
  dark_glass: { block: "minecraft:tinted_glass", tags: ["glazing"] },
  aqua_glass: { block: "minecraft:cyan_stained_glass", tags: ["glazing", "wayfinding"] },
  sky_glass: { block: "minecraft:light_blue_stained_glass", tags: ["glazing"] },
  clear_glass: { block: "minecraft:white_stained_glass", tags: ["glazing"] },
  blue_glass: { block: "minecraft:blue_stained_glass", tags: ["glazing"] },
  green_glass: { block: "minecraft:lime_stained_glass", tags: ["glazing", "wayfinding"] },
  water: { block: "minecraft:water", state: { liquid_depth: 0 }, tags: ["liquid"] },
  aqua: { block: "minecraft:cyan_concrete", tags: ["ride", "wayfinding"] },
  sky: { block: "minecraft:light_blue_concrete", tags: ["pool", "wayfinding"] },
  blue: { block: "minecraft:blue_concrete", tags: ["pool", "wayfinding"] },
  safety_yellow: { block: "minecraft:yellow_concrete", tags: ["safety", "signage"] },
  safety_orange: { block: "minecraft:orange_concrete", tags: ["safety", "ride"] },
  safety_red: { block: "minecraft:red_concrete", tags: ["safety", "emergency"] },
  fresh_lime: { block: "minecraft:lime_concrete", tags: ["family", "wayfinding"] },
  planted_green: { block: "minecraft:green_concrete", tags: ["family", "wayfinding"] },
  flume_magenta: { block: "minecraft:magenta_concrete", tags: ["ride"] },
  flume_purple: { block: "minecraft:purple_concrete", tags: ["ride"] },
  family_pink: { block: "minecraft:pink_concrete", tags: ["family", "wayfinding"] },
  iron: { block: "minecraft:iron_block", tags: ["metal", "mechanical"] },
  copper: { block: "minecraft:copper_block", tags: ["metal", "mechanical"] },
  cut_copper: { block: "minecraft:cut_copper", tags: ["metal", "finish"] },
  exposed_copper: { block: "minecraft:exposed_cut_copper", tags: ["metal", "weathered"] },
  oxidized_copper: { block: "minecraft:oxidized_cut_copper", tags: ["metal", "weathered"] },
  redstone_light: { block: "minecraft:redstone_lamp", tags: ["lighting", "mechanical"] },
  sea_light: { block: "minecraft:sea_lantern", tags: ["lighting", "pool"] },
  warm_light: { block: "minecraft:glowstone", tags: ["lighting"] },
  pearl_light: { block: "minecraft:pearlescent_froglight", tags: ["lighting"] },
  green_light: { block: "minecraft:verdant_froglight", tags: ["lighting"] },
  amber_light: { block: "minecraft:ochre_froglight", tags: ["lighting"] },
  rail: { block: "minecraft:iron_bars", tags: ["railing", "fence"] },
  iron_chain: { block: "minecraft:iron_chain", tags: ["mechanical", "detail"] },
  ladder: { block: "minecraft:ladder", tags: ["access"] },
  iron_door: { block: "minecraft:iron_door", tags: ["door", "service"] },
  iron_door_north_lower: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "north", door_hinge_bit: false, open_bit: true, upper_block_bit: false }, tags: ["door", "access"] },
  iron_door_north_upper: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "north", door_hinge_bit: false, open_bit: true, upper_block_bit: true }, tags: ["door", "access"] },
  iron_door_south_lower: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "south", door_hinge_bit: false, open_bit: true, upper_block_bit: false }, tags: ["door", "access"] },
  iron_door_south_upper: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "south", door_hinge_bit: false, open_bit: true, upper_block_bit: true }, tags: ["door", "access"] },
  iron_door_east_lower: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "east", door_hinge_bit: false, open_bit: true, upper_block_bit: false }, tags: ["door", "access"] },
  iron_door_east_upper: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "east", door_hinge_bit: false, open_bit: true, upper_block_bit: true }, tags: ["door", "access"] },
  iron_door_west_lower: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "west", door_hinge_bit: false, open_bit: true, upper_block_bit: false }, tags: ["door", "access"] },
  iron_door_west_upper: { block: "minecraft:iron_door", state: { "minecraft:cardinal_direction": "west", door_hinge_bit: false, open_bit: true, upper_block_bit: true }, tags: ["door", "access"] },
  quartz_stair: { block: "minecraft:quartz_stairs", tags: ["circulation"] },
  andesite_stair: { block: "minecraft:polished_andesite_stairs", tags: ["circulation"] },
  bamboo_stair: { block: "minecraft:bamboo_stairs", tags: ["circulation", "warmth"] },
  quartz_slab: { block: "minecraft:smooth_quartz_slab", tags: ["coping", "finish"] },
  black_slab: { block: "minecraft:polished_blackstone_slab", tags: ["drain", "finish"] },
  copper_grate: { block: "minecraft:copper_grate", tags: ["drain", "mechanical"] },
  weathered_grate: { block: "minecraft:weathered_copper_grate", tags: ["drain", "mechanical"] },
  oxidized_grate: { block: "minecraft:oxidized_copper_grate", tags: ["drain", "mechanical"] },
  spruce: { block: "minecraft:spruce_planks", tags: ["wood", "furniture"] },
  dark_oak: { block: "minecraft:dark_oak_planks", tags: ["wood", "furniture"] },
  bamboo: { block: "minecraft:bamboo_planks", tags: ["wood", "shade"] },
  spruce_post: { block: "minecraft:stripped_spruce_log", tags: ["wood", "post"] },
  jungle_post: { block: "minecraft:stripped_jungle_log", tags: ["wood", "post"] },
  mangrove: { block: "minecraft:mangrove_planks", tags: ["wood", "finish"] },
  jungle_leaf: { block: "minecraft:jungle_leaves", tags: ["vegetation"] },
  azalea_leaf: { block: "minecraft:azalea_leaves", tags: ["vegetation"] },
  flower_leaf: { block: "minecraft:azalea_leaves_flowered", tags: ["vegetation"] },
  moss: { block: "minecraft:moss_block", tags: ["vegetation", "ground"] },
  grass: { block: "minecraft:grass_block", tags: ["vegetation", "ground"] },
  sand: { block: "minecraft:sand", tags: ["beach"] },
  sandstone: { block: "minecraft:smooth_sandstone", tags: ["beach", "finish"] },
  calcite: { block: "minecraft:calcite", tags: ["rockwork"] },
  mossy_masonry: { block: "minecraft:mossy_stone_bricks", tags: ["rockwork", "retaining"] },
  mud_brick: { block: "minecraft:mud_bricks", tags: ["landscape", "retaining"] },
  prismarine: { block: "minecraft:prismarine", tags: ["pool", "finish"] },
  prismarine_brick: { block: "minecraft:prismarine_bricks", tags: ["pool", "finish"] },
  dark_prismarine: { block: "minecraft:dark_prismarine", tags: ["pool", "mechanical"] },
});

const point = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

type DoorwaySide = "north" | "south" | "east" | "west";

/**
 * Make a row of individually valid two-block Bedrock doors. `side` describes
 * the facade the doors occupy; each open door faces inward from that facade.
 * The helper is generic geometry/provenance, not a catalog of attraction nouns.
 */
function pairedDoorElements(options: {
  id: string;
  intent: string;
  phase: string;
  requirementIds: string[];
  side: DoorwaySide;
  fixed: number;
  start: number;
  width: number;
  lowerY?: number;
}): DesignElement[] {
  const lowerY = options.lowerY ?? 2;
  const varyingCoordinates = Array.from({ length: options.width }, (_, index) => options.start + index);
  const base = options.side === "north" || options.side === "south"
    ? point(varyingCoordinates[0], lowerY, options.fixed)
    : point(options.fixed, lowerY, varyingCoordinates[0]);
  const offsets = varyingCoordinates.map((coordinate) => options.side === "north" || options.side === "south"
    ? point(coordinate - varyingCoordinates[0], 0, 0)
    : point(0, 0, coordinate - varyingCoordinates[0]));
  const inwardFacing = ({ north: "south", south: "north", west: "east", east: "west" } as const)[options.side];
  return [
    {
      id: `${options.id}-lower`, kind: "fill", intent: options.intent, phase: options.phase,
      requirementIds: options.requirementIds, min: base, max: base,
      material: `iron_door_${inwardFacing}_lower`, offsets,
    },
    {
      id: `${options.id}-upper`, kind: "fill", intent: options.intent, phase: options.phase,
      requirementIds: options.requirementIds, min: point(base.x, base.y + 1, base.z), max: point(base.x, base.y + 1, base.z),
      material: `iron_door_${inwardFacing}_upper`, offsets,
    },
  ];
}

function requirementIds(prefix: string, features: readonly string[]) {
  return features.map((_, index) => `${prefix}-feature-${index + 1}`);
}

function exactSpan(text: string, start: number, end: number) {
  return { start, end, text: text.slice(start, end) };
}

function claimPredicate(text: string): DesignAtomicClaim["predicate"] {
  if (/\b(?:aligned|connection|exits?|emergency exit|north|south|east|west)\b/i.test(text)) return "boundary";
  if (/\b(?:supports?|support frame)\b/i.test(text)) return "support";
  if (/\b(?:entrance|hall|atrium|rooms?|facilities|facade|wall|tower|fortress|cabanas?|kiosks?|station|yard)\b/i.test(text)) return "enclosure";
  if (/\b(?:routes?|flumes?|lazy river|slides?|waterfalls?|drops?|turns?|runouts?|guardrails|safety railings)\b/i.test(text)) return "path";
  if (/\b(?:deck|plaza|surfacing|markings|lanes?|terraces?|area|sectors?)\b/i.test(text)) return "surface";
  if (/\b(?:pools?|splash pad|basin|planters?|planting beds?)\b/i.test(text)) return "containment";
  if (/\b(?:stairs?|ramps?|step-free approaches?|gates?|doors?|access)\b/i.test(text)) return "access";
  if (/\b(?:lighting|glazing|glass|rockwork|palms?|landscap|foliage|water)\b/i.test(text)) return "material";
  if (/\b(?:large|life[- ]sized|broad|wide|deep|grand|tall|high|multi[- ]level)\b/i.test(text)) return "extent";
  if (/^\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(text)) return "quantity";
  return "fixture";
}

function atomicClaims(requirementId: string, text: string): DesignAtomicClaim[] {
  const separators = /,|;|\b(?:with|including|plus|along with|and)\b/gi;
  const claims: DesignAtomicClaim[] = [];
  let cursor = 0;
  const append = (rawStart: number, rawEnd: number) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (start === end) return;
    const sourceSpan = exactSpan(text, start, end);
    claims.push({ id: `${requirementId}-claim-${claims.length + 1}`, sourceSpan, predicate: claimPredicate(sourceSpan.text), status: "asserted" });
  };
  for (const match of text.matchAll(separators)) {
    append(cursor, match.index!);
    cursor = match.index! + match[0].length;
  }
  append(cursor, text.length);
  return claims;
}

function elementEnvelope(element: DesignElement) {
  const translated = (points: Vec3[]) => {
    const repetitions = element.offsets?.length ? element.offsets : [point(0, 0, 0)];
    return repetitions.flatMap((offset) => points.map((item) => point(item.x + offset.x, item.y + offset.y, item.z + offset.z)));
  };
  if (element.kind === "fill" || element.kind === "shell" || element.kind === "carve" || element.kind === "basin") return translated([element.min, element.max]);
  if (element.kind === "cylinder") return translated([
    point(element.center.x - element.radius, element.center.y, element.center.z - element.radius),
    point(element.center.x + element.radius, element.center.y + element.height - 1, element.center.z + element.radius),
  ]);
  if (element.kind === "sweep") return translated(element.points);
  return translated([element.from, element.to]);
}

function largestElementAxis(element: DesignElement) {
  const points = elementEnvelope(element);
  const spans = (["x", "y", "z"] as const).map((axis) => ({ axis, span: Math.max(...points.map((item) => item[axis])) - Math.min(...points.map((item) => item[axis])) + 1 }));
  return spans.sort((a, b) => b.span - a.span)[0];
}

function words(value: string) {
  const ignored = new Set(["a", "an", "the", "and", "with", "of", "to", "for", "from", "in", "on", "at", "including"]);
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !ignored.has(word)));
}

function bestElement(claim: DesignAtomicClaim, mapped: DesignElement[], used: Set<string>) {
  const preferredKinds: Partial<Record<DesignAtomicClaim["predicate"], DesignElement["kind"][]>> = {
    path: ["sweep"], containment: ["basin"], enclosure: ["shell"], access: ["stairs", "ramp"],
    surface: ["fill", "basin", "ramp"], support: ["sweep"],
  };
  const preferred = claim.predicate === "access" && /\b(?:gates?|doors?)\b/i.test(claim.sourceSpan.text)
    ? ["fill", "shell"] satisfies DesignElement["kind"][]
    : preferredKinds[claim.predicate];
  const candidates = preferred && mapped.some(({ kind }) => preferred.includes(kind)) ? mapped.filter(({ kind }) => preferred.includes(kind)) : mapped;
  const claimWords = words(claim.sourceSpan.text);
  const ranked = candidates.map((element) => {
    const searchable = words(`${element.id} ${element.intent} ${element.phase ?? ""}`);
    const score = [...claimWords].filter((word) => searchable.has(word) || [...searchable].some((candidate) => candidate.includes(word) || word.includes(candidate))).length;
    return { element, score: score * 10 + (used.has(element.id) ? 0 : 1) };
  }).sort((a, b) => b.score - a.score || a.element.id.localeCompare(b.element.id));
  const selected = ranked[0].element;
  used.add(selected.id);
  return selected;
}

function elementMaterialReferences(element: DesignElement) {
  if (element.kind === "fill" || element.kind === "shell" || element.kind === "cylinder" || element.kind === "sweep" || element.kind === "stairs" || element.kind === "ramp") {
    return [element.material, ...(element.kind === "sweep" && element.innerMaterial ? [element.innerMaterial] : []), ...((element.kind === "stairs" || element.kind === "ramp") && element.railingMaterial ? [element.railingMaterial] : [])];
  }
  if (element.kind === "basin") return [element.wallMaterial, element.floorMaterial, element.rimMaterial, element.liquidMaterial].filter((item): item is string => Boolean(item));
  return [];
}

function materialTagFor(element: DesignElement, claimText: string) {
  const desired = /light/i.test(claimText) ? "lighting"
    : /water|pool|shower|river|fall/i.test(claimText) ? "liquid"
      : /glass|glaz/i.test(claimText) ? "glazing"
        : /plant|palm|landscap|rockwork/i.test(claimText) ? "vegetation"
          : undefined;
  const available = elementMaterialReferences(element).flatMap((reference) => {
    const material = AQUA_MERIDIAN_MATERIALS[reference];
    return typeof material === "string" ? [] : material?.tags ?? [];
  });
  return desired && available.includes(desired) ? desired : available[0];
}

function requirements(features: readonly string[], ids: readonly string[], elementIds: readonly string[][], elements: readonly DesignElement[]): DesignRequirement[] {
  assert.equal(features.length, elementIds.length, "Every original feature must have an explicit element mapping.");
  const byId = new Map(elements.map((element) => [element.id, element]));
  return features.map((text, index) => {
    const requirementId = ids[index];
    const mappedIds = [...elementIds[index]];
    const mapped = mappedIds.map((id) => byId.get(id)!);
    assert.ok(mapped.every(Boolean), `Every ${requirementId} mapping must name an existing element.`);
    const claims = atomicClaims(requirementId, text);
    const used = new Set<string>();
    const assertions: DesignAssertion[] = [];
    for (const claim of claims) {
      const selected = bestElement(claim, mapped, used);
      const scope = [selected.id];
      const span = claim.sourceSpan;
      assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "placement_count", minimum: 1 });
      assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "element_kind", elementKind: selected.kind, minimum: 1 });
      const largest = largestElementAxis(selected);
      assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: largest.axis, minimum: Math.min(2, largest.span) });

      if (claim.predicate === "path") {
        const path = selected.kind === "sweep" ? selected : mapped.find((element): element is Extract<DesignElement, { kind: "sweep" }> => element.kind === "sweep");
        assert.ok(path, `${claim.id} path claim needs a sweep element.`);
        assertions.push({
          claimId: claim.id,
          sourceSpan: span,
          elementIds: [path.id],
          kind: "path_geometry",
          minimumPaths: 1,
          minimumControlPointsPerPath: Math.min(2, path.points.length),
          ...(/\b(?:drop|descending|waterfall)\b/i.test(span.text) ? { minimumVerticalDrop: Math.max(1, Math.max(...path.points.map(({ y }) => y)) - Math.min(...path.points.map(({ y }) => y))) } : {}),
        });
      }
      if (claim.predicate === "boundary") {
        const namedSides = (["north", "south", "east", "west"] as const).filter((side) => new RegExp(`\\b${side}\\b`, "i").test(span.text));
        const element = namedSides.length
          ? mapped.find((candidate) => namedSides.some((side) => candidate.id.includes(side))) ?? selected
          : selected;
        const envelope = elementEnvelope(element);
        const elementNamedSides = (["north", "south", "east", "west"] as const).filter((side) => element.id.includes(side));
        const inferredSides = namedSides.length ? namedSides : elementNamedSides.length ? elementNamedSides : ([
          ...(Math.min(...envelope.map(({ x }) => x)) === 0 ? ["west" as const] : []),
          ...(Math.min(...envelope.map(({ z }) => z)) === 0 ? ["north" as const] : []),
        ]);
        assert.ok(inferredSides.length, `${claim.id} boundary claim needs a named or zero-boundary side.`);
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: [element.id], kind: "boundary_contact", sides: inferredSides, minimumPlacementsPerSide: 1 });
      }
      if (claim.predicate === "material") {
        const tag = materialTagFor(selected, span.text);
        assert.ok(tag, `${claim.id} material claim needs a tagged material.`);
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "material_tag_count", tag, minimumPlacements: 1 });
      }
      if (/\b(?:large|life[- ]sized)\b/i.test(span.text)) {
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "x", minimum: 16 });
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "z", minimum: 16 });
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "y", minimum: 4 });
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "placement_count", minimum: 64 });
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "distinct_materials", minimum: 2 });
      }
      if (/\bgrand\b/i.test(span.text)) {
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "y", minimum: 6 });
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "x", minimum: 12 });
      }
      if (/\bbroad\b/i.test(span.text)) assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "x", minimum: 16 });
      if (/\bwide\b/i.test(span.text)) assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: largest.axis === "y" ? "x" : largest.axis, minimum: 5 });
      if (/\bdeep\b/i.test(span.text)) assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "y", minimum: 4 });
      if (/\bmulti[- ]level\b/i.test(span.text)) assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "axis_span", axis: "y", minimum: 6 });
      if (/\blooping\b/i.test(span.text) && selected.kind === "sweep") assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: scope, kind: "path_geometry", minimumPaths: 1, minimumControlPointsPerPath: 4 });
      if (claim.predicate === "fixture" && /\b[a-z][a-z-]*s\b\s*$/i.test(span.text) && !/\b(?:glass|access)\s*$/i.test(span.text)) {
        const repeated = [...mapped].sort((a, b) => (b.offsets?.length ?? 1) - (a.offsets?.length ?? 1))[0];
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: [repeated.id], kind: "element_instances", minimum: 2 });
      }

      const high = claim.sourceSpan.text.match(/\b(\d+|fifty)[- ]blocks?[- ]high\b/i);
      if (high) {
        const minimum = /^\d+$/.test(high[1]) ? Number(high[1]) : 50;
        const ySpan = (element: DesignElement) => {
          const points = elementEnvelope(element);
          return Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)) + 1;
        };
        const tallest = [...mapped].sort((a, b) => ySpan(b) - ySpan(a))[0];
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: [tallest.id], kind: "axis_span", axis: "y", minimum });
      }
      const distinct = claim.sourceSpan.text.match(/\b(\d+|four)\s+distinct\b/i);
      if (distinct) {
        const minimum = /^\d+$/.test(distinct[1]) ? Number(distinct[1]) : 4;
        const paths = mapped.filter((element): element is Extract<DesignElement, { kind: "sweep" }> => element.kind === "sweep");
        assertions.push({
          claimId: claim.id,
          sourceSpan: span,
          elementIds: paths.map(({ id }) => id),
          kind: "path_geometry",
          minimumPaths: minimum,
          minimumControlPointsPerPath: Math.min(...paths.map(({ points }) => points.length)),
          minimumVerticalDrop: Math.min(...paths.map(({ points }) => Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)))),
          supportsRequired: true,
        });
      }
      const counted = claim.sourceSpan.text.match(/^\s*(\d+|two)\s+(?:(?:[a-z][a-z-]*)\s+){0,3}[a-z][a-z-]*s\b/i);
      if (counted && !/\bdistinct\b/i.test(claim.sourceSpan.text)) {
        const minimum = /^\d+$/.test(counted[1]) ? Number(counted[1]) : 2;
        const repeated = (selected.offsets?.length ?? 1) >= minimum
          ? selected
          : mapped
            .filter((element) => (element.offsets?.length ?? 1) >= minimum)
            .sort((a, b) => (b.offsets?.length ?? 1) - (a.offsets?.length ?? 1))[0];
        assert.ok(repeated, `Requirement ${requirementId} claim ${claim.id} needs ${minimum} instances of its mapped subject`);
        assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: [repeated.id], kind: "element_instances", minimum });
      }
      if (/\bsupports?\b/i.test(claim.sourceSpan.text)) {
        const supported = mapped.filter((element): element is Extract<DesignElement, { kind: "sweep" }> => element.kind === "sweep" && Boolean(element.supports));
        if (supported.length) assertions.push({ claimId: claim.id, sourceSpan: span, elementIds: supported.map(({ id }) => id), kind: "support_count", minimumColumns: supported.length });
      }
    }
    return { id: requirementId, text, elementIds: mappedIds, claims, assertions };
  });
}

function arrivalDesign(features: readonly string[]): DesignProgram {
  const r = requirementIds("arrival", features);
  const elements: DesignElement[] = [
    { id: "arrival-plaza", kind: "fill", intent: "broad resort arrival plaza", phase: "arrival plaza", requirementIds: [r[0]], min: point(0, 0, 0), max: point(159, 0, 47), material: "site_paving" },
    { id: "arrival-wayfinding-bands", kind: "fill", intent: "colored plaza wayfinding bands", phase: "arrival plaza markings", requirementIds: [r[0]], min: point(10, 1, 5), max: point(13, 1, 32), material: "aqua", offsets: [point(0, 0, 0), point(18, 0, 0), point(118, 0, 0), point(136, 0, 0)] },
    { id: "arrival-atrium", kind: "shell", intent: "grand glazed entrance atrium", phase: "arrival architecture", requirementIds: [r[0], r[2]], min: point(31, 1, 8), max: point(128, 24, 42), material: "white_structure", thickness: 2 },
    { id: "arrival-atrium-clear", kind: "carve", intent: "usable atrium volume", phase: "arrival architecture", requirementIds: [], min: point(33, 2, 10), max: point(126, 22, 40) },
    { id: "arrival-glass-roof", kind: "fill", intent: "glass-roofed atrium", phase: "atrium roof", requirementIds: [r[2]], min: point(38, 23, 11), max: point(121, 23, 39), material: "aqua_glass" },
    { id: "arrival-roof-ribs", kind: "fill", intent: "atrium roof ribs and ventilation", phase: "atrium roof structure", requirementIds: [r[2], r[5]], min: point(38, 24, 11), max: point(38, 24, 39), material: "oxidized_copper", offsets: Array.from({ length: 8 }, (_, index) => point(index * 12, 0, 0)) },
    { id: "arrival-resort-sign", kind: "fill", intent: "large Aqua Meridian resort wordmark mosaic", phase: "resort signage", requirementIds: [r[0]], min: point(58, 16, 7), max: point(101, 21, 7), material: "blue_glass" },
    { id: "arrival-sign-letters", kind: "fill", intent: "high contrast resort sign lettering", phase: "resort signage", requirementIds: [r[0]], min: point(61, 18, 6), max: point(98, 19, 6), material: "pearl_light" },
    { id: "arrival-ticket-counters", kind: "fill", intent: "ticket and guest-service counters", phase: "guest processing", requirementIds: [r[1], r[5]], min: point(39, 2, 14), max: point(49, 4, 15), material: "quartz_brick", offsets: [point(0, 0, 0), point(18, 0, 0), point(36, 0, 0), point(54, 0, 0)] },
    { id: "arrival-ticket-glass", kind: "fill", intent: "ticket windows", phase: "guest processing", requirementIds: [r[1]], min: point(40, 5, 14), max: point(48, 9, 14), material: "clear_glass", offsets: [point(0, 0, 0), point(18, 0, 0), point(36, 0, 0), point(54, 0, 0)] },
    { id: "arrival-turnstiles", kind: "cylinder", intent: "turnstiles and security screening lanes", phase: "guest processing", requirementIds: [r[1]], center: point(51, 1, 26), radius: 1, height: 4, material: "iron", hollow: true, cap: true, offsets: Array.from({ length: 8 }, (_, index) => point(index * 8, 0, 0)) },
    { id: "arrival-security-frames", kind: "shell", intent: "security screening frames", phase: "guest processing", requirementIds: [r[1]], min: point(48, 1, 29), max: point(54, 8, 31), material: "safety_yellow", thickness: 1, offsets: Array.from({ length: 7 }, (_, index) => point(index * 10, 0, 0)) },
    { id: "arrival-service-rooms", kind: "shell", intent: "guest services and first-aid rooms", phase: "guest facilities", requirementIds: [r[1]], min: point(33, 1, 33), max: point(51, 11, 40), material: "pale_structure", thickness: 1, offsets: [point(0, 0, 0), point(76, 0, 0)] },
    { id: "arrival-first-aid-mark", kind: "fill", intent: "first-aid safety mark", phase: "guest facilities signage", requirementIds: [r[1]], min: point(116, 5, 32), max: point(121, 6, 32), material: "safety_red" },
    { id: "arrival-map-wall", kind: "fill", intent: "illuminated park map and directional signs", phase: "atrium information", requirementIds: [r[2]], min: point(72, 3, 39), max: point(87, 11, 39), material: "sky_glass" },
    { id: "arrival-map-routes", kind: "fill", intent: "multi-color map route graphics", phase: "atrium information", requirementIds: [r[2]], min: point(74, 5, 38), max: point(85, 5, 38), material: "fresh_lime", offsets: [point(0, 0, 0), point(0, 2, 0), point(0, 4, 0)] },
    { id: "arrival-clocks-speakers", kind: "cylinder", intent: "clocks and public-address speakers", phase: "atrium information", requirementIds: [r[2]], center: point(43, 14, 10), radius: 1, height: 2, material: "black_detail", offsets: Array.from({ length: 7 }, (_, index) => point(index * 12, 0, 0)) },
    { id: "arrival-lights", kind: "fill", intent: "integrated atrium lights", phase: "atrium lighting", requirementIds: [r[2], r[5]], min: point(39, 22, 12), max: point(40, 22, 13), material: "sea_light", offsets: Array.from({ length: 7 }, (_, index) => point(index * 13, 0, 0)) },
    { id: "arrival-locker-wings", kind: "shell", intent: "locker changing restroom and family facility rooms", phase: "changing facilities", requirementIds: [r[3]], min: point(5, 1, 10), max: point(29, 15, 41), material: "quartz", thickness: 1, offsets: [point(0, 0, 0), point(125, 0, 0)] },
    { id: "arrival-room-partitions", kind: "fill", intent: "private changing and restroom partitions", phase: "changing facilities", requirementIds: [r[3]], min: point(9, 1, 14), max: point(9, 9, 37), material: "aqua_glass", offsets: [point(7, 0, 0), point(14, 0, 0), point(125, 0, 0), point(132, 0, 0), point(139, 0, 0)] },
    { id: "arrival-showers", kind: "basin", intent: "shower and foot-rinse bays", phase: "changing facilities water", requirementIds: [r[3]], min: point(11, 1, 34), max: point(25, 3, 39), wallMaterial: "prismarine_brick", rimMaterial: "quartz_slab", liquidMaterial: "water", liquidLevel: 2, offsets: [point(0, 0, 0), point(124, 0, 0)] },
    { id: "arrival-promendade", kind: "fill", intent: "southbound main promenade to park sectors", phase: "main promenade", requirementIds: [r[4]], min: point(67, 1, 35), max: point(92, 1, 47), material: "diorite" },
    { id: "arrival-promendade-rails", kind: "fill", intent: "promenade exit railings and gates", phase: "main promenade", requirementIds: [r[4], r[5]], min: point(66, 2, 35), max: point(66, 4, 47), material: "rail", offsets: [point(0, 0, 0), point(27, 0, 0)] },
    { id: "arrival-drains", kind: "fill", intent: "linear plaza and wet-area drains", phase: "fine detail drains", requirementIds: [r[5]], min: point(4, 1, 4), max: point(4, 1, 43), material: "copper_grate", offsets: [point(0, 0, 0), point(151, 0, 0)] },
    { id: "arrival-benches", kind: "fill", intent: "arrival benches and counters", phase: "fine detail furniture", requirementIds: [r[5]], min: point(15, 2, 4), max: point(24, 2, 6), material: "bamboo", offsets: [point(0, 0, 0), point(31, 0, 0), point(75, 0, 0), point(106, 0, 0)] },
    { id: "arrival-bins", kind: "cylinder", intent: "waste and recycling bins", phase: "fine detail furniture", requirementIds: [r[5]], center: point(28, 1, 5), radius: 1, height: 3, material: "dark_masonry", offsets: [point(0, 0, 0), point(30, 0, 0), point(44, 0, 0), point(74, 0, 0), point(102, 0, 0)] },
    { id: "arrival-planters", kind: "basin", intent: "integrated landscape planters", phase: "fine detail landscape", requirementIds: [r[5]], min: point(7, 1, 3), max: point(12, 3, 7), wallMaterial: "mud_brick", floorMaterial: "moss", rimMaterial: "sandstone", offsets: [point(0, 0, 0), point(140, 0, 0)] },
    { id: "arrival-planter-foliage", kind: "cylinder", intent: "dense planter foliage", phase: "fine detail landscape", requirementIds: [r[5]], center: point(9, 3, 5), radius: 2, height: 3, material: "flower_leaf", offsets: [point(0, 0, 0), point(140, 0, 0)] },
    ...pairedDoorElements({ id: "arrival-north-entrance", intent: "broad north arrival entrance", phase: "arrival entrance access", requirementIds: [r[0]], side: "north", fixed: 0, start: 77, width: 6 }),
    ...pairedDoorElements({ id: "arrival-south-exit", intent: "southbound promenade exit", phase: "main promenade access", requirementIds: [r[4]], side: "south", fixed: 47, start: 76, width: 8 }),
  ];
  return {
    schemaVersion: 1,
    description: "A generic-primitives program for a glazed arrival complex, guest-processing hall, facilities, and connected promenade.",
    requirements: requirements(features, r, [
      ["arrival-plaza", "arrival-wayfinding-bands", "arrival-atrium", "arrival-resort-sign", "arrival-sign-letters", "arrival-north-entrance-lower", "arrival-north-entrance-upper"],
      ["arrival-ticket-counters", "arrival-ticket-glass", "arrival-turnstiles", "arrival-security-frames", "arrival-service-rooms", "arrival-first-aid-mark"],
      ["arrival-atrium", "arrival-glass-roof", "arrival-roof-ribs", "arrival-map-wall", "arrival-map-routes", "arrival-clocks-speakers", "arrival-lights"],
      ["arrival-locker-wings", "arrival-room-partitions", "arrival-showers"],
      ["arrival-promendade", "arrival-promendade-rails", "arrival-south-exit-lower", "arrival-south-exit-upper"],
      ["arrival-roof-ribs", "arrival-lights", "arrival-promendade-rails", "arrival-drains", "arrival-benches", "arrival-bins", "arrival-planters", "arrival-planter-foliage"],
    ], elements),
    elements,
  };
}

function thrillDesign(features: readonly string[]): DesignProgram {
  const r = requirementIds("thrill", features);
  const elements: DesignElement[] = [
    { id: "thrill-deck", kind: "fill", intent: "sector-wide ride deck and connection plaza", phase: "thrill deck", requirementIds: [r[5]], min: point(0, 0, 0), max: point(111, 0, 111), material: "andesite" },
    { id: "thrill-tower-core", kind: "shell", intent: "fifty-block sculptural slide tower and elevator core", phase: "slide tower", requirementIds: [r[0]], min: point(42, 1, 26), max: point(59, 51, 45), material: "charcoal_structure", thickness: 2 },
    { id: "thrill-tower-glazing", kind: "fill", intent: "visible elevator core glazing", phase: "slide tower elevator", requirementIds: [r[0]], min: point(47, 4, 25), max: point(54, 48, 25), material: "dark_glass" },
    { id: "thrill-platforms", kind: "fill", intent: "four loading and transfer platforms", phase: "slide tower platforms", requirementIds: [r[0], r[2]], min: point(34, 12, 20), max: point(67, 13, 51), material: "smooth_quartz", offsets: [point(0, 0, 0), point(0, 12, 0), point(0, 24, 0), point(0, 36, 0)] },
    { id: "thrill-upper-loading-bridge", kind: "fill", intent: "upper loading bridge to the east flume", phase: "slide tower platforms", requirementIds: [r[0], r[2]], min: point(58, 48, 38), max: point(79, 49, 46), material: "smooth_quartz" },
    { id: "thrill-stairs-a", kind: "stairs", intent: "realistic lower access stair flight", phase: "slide tower access", requirementIds: [r[0]], from: point(30, 1, 20), to: point(41, 12, 20), width: 5, material: "quartz_stair", railingMaterial: "rail" },
    { id: "thrill-stairs-b", kind: "stairs", intent: "realistic switchback access flights", phase: "slide tower access", requirementIds: [r[0]], from: point(41, 13, 51), to: point(30, 24, 51), width: 5, material: "quartz_stair", railingMaterial: "rail", offsets: [point(0, 0, 0), point(0, 24, 0)] },
    { id: "thrill-stairs-c", kind: "stairs", intent: "realistic switchback access flights", phase: "slide tower access", requirementIds: [r[0]], from: point(30, 25, 20), to: point(41, 36, 20), width: 5, material: "andesite_stair", railingMaterial: "rail" },
    { id: "thrill-flume-a", kind: "sweep", intent: "cyan open descending flume with turns and supports", phase: "open flume A", requirementIds: [r[1]], points: [point(39, 49, 31), point(25, 43, 43), point(18, 34, 58), point(25, 21, 74), point(40, 3, 92)], crossSection: "open_channel", material: "aqua", innerMaterial: "water", width: 7, height: 4, thickness: 1, supports: { material: "iron", interval: 5, toY: 1, radius: 1 } },
    { id: "thrill-flume-b", kind: "sweep", intent: "magenta enclosed corkscrew flume with supports", phase: "tube flume B", requirementIds: [r[1]], points: [point(47, 47, 28), point(65, 42, 35), point(80, 33, 50), point(76, 20, 69), point(68, 4, 94)], crossSection: "tube", material: "flume_magenta", innerMaterial: "water", width: 7, height: 7, thickness: 1, supports: { material: "charcoal_structure", interval: 6, toY: 1 } },
    { id: "thrill-flume-c", kind: "sweep", intent: "yellow high-speed open drop and runout", phase: "speed flume C", requirementIds: [r[1]], points: [point(55, 45, 38), point(58, 37, 52), point(58, 27, 67), point(55, 16, 81), point(54, 3, 96)], crossSection: "open_channel", material: "safety_yellow", innerMaterial: "water", width: 5, height: 3, thickness: 1, supports: { material: "iron", interval: 4, toY: 1 } },
    { id: "thrill-flume-d", kind: "sweep", intent: "orange enclosed sweeping flume with support frame", phase: "tube flume D", requirementIds: [r[1]], points: [point(78, 49, 42), point(92, 44, 43), point(105, 29, 58), point(106, 18, 75), point(88, 4, 97)], crossSection: "tube", material: "safety_orange", innerMaterial: "water", width: 8, height: 8, thickness: 1, supports: { material: "cut_copper", interval: 8, toY: 1, radius: 0 } },
    { id: "thrill-queue-rails", kind: "sweep", intent: "queue switchbacks and guardrails", phase: "queue", requirementIds: [r[2]], points: [point(4, 2, 5), point(35, 2, 5), point(35, 2, 10), point(4, 2, 10), point(4, 2, 15), point(35, 2, 15), point(35, 2, 20), point(4, 2, 20), point(4, 2, 25), point(35, 2, 25)], crossSection: "solid", material: "rail", width: 1, height: 3 },
    { id: "thrill-loading-gates", kind: "fill", intent: "loading-platform gates and height restriction bars", phase: "loading safety", requirementIds: [r[2]], min: point(35, 14, 23), max: point(39, 17, 23), material: "safety_red", offsets: [point(0, 0, 0), point(8, 12, 0), point(16, 24, 0), point(24, 36, 0)] },
    { id: "thrill-shade-roofs", kind: "fill", intent: "queue and platform shade roofs", phase: "loading shade", requirementIds: [r[2]], min: point(2, 6, 2), max: point(38, 6, 28), material: "blue_glass" },
    { id: "thrill-splash-pool", kind: "basin", intent: "deep splashdown pool and four landing channels", phase: "splashdown", requirementIds: [r[3]], min: point(25, 1, 86), max: point(101, 7, 109), wallMaterial: "prismarine", floorMaterial: "dark_prismarine", rimMaterial: "quartz_slab", liquidMaterial: "water", liquidLevel: 6, wallThickness: 2 },
    { id: "thrill-landing-dividers", kind: "fill", intent: "separated flume landing channels", phase: "splashdown lanes", requirementIds: [r[1], r[3]], min: point(42, 6, 88), max: point(43, 7, 107), material: "aqua_glass", offsets: [point(0, 0, 0), point(16, 0, 0), point(32, 0, 0), point(48, 0, 0)] },
    { id: "thrill-lifeguard-posts", kind: "shell", intent: "lifeguard posts and rescue-equipment lockers", phase: "splashdown safety", requirementIds: [r[3]], min: point(18, 1, 90), max: point(23, 8, 96), material: "white_structure", thickness: 1, offsets: [point(0, 0, 0), point(84, 0, 0)] },
    { id: "thrill-rescue-marks", kind: "cylinder", intent: "high visibility rescue rings", phase: "splashdown safety", requirementIds: [r[3]], center: point(20, 5, 89), radius: 2, height: 1, material: "safety_orange", hollow: true, offsets: [point(0, 0, 0), point(84, 0, 0)] },
    { id: "thrill-pump-house", kind: "shell", intent: "pump and filtration service building", phase: "mechanical plant interior shell", requirementIds: [r[4]], min: point(79, 1, 2), max: point(109, 15, 29), material: "dark_masonry", thickness: 2 },
    { id: "thrill-service-door-clearance", kind: "carve", intent: "clear service door openings through the pump-house wall", phase: "mechanical plant access", requirementIds: [], min: point(84, 2, 2), max: point(87, 4, 3), offsets: [point(0, 0, 0), point(14, 0, 0)] },
    { id: "thrill-exposed-pipes", kind: "cylinder", intent: "exposed filtration pipes and vents", phase: "mechanical plant detail", requirementIds: [r[4]], center: point(84, 2, 30), radius: 2, height: 12, material: "oxidized_copper", hollow: true, thickness: 1, offsets: [point(0, 0, 0), point(8, 0, 0), point(16, 0, 0)] },
    { id: "thrill-east-connection", kind: "fill", intent: "east connection plaza", phase: "sector connection", requirementIds: [r[5]], min: point(103, 1, 38), max: point(111, 1, 84), material: "pale_structure" },
    { id: "thrill-north-connection", kind: "fill", intent: "north connection plaza", phase: "sector connection", requirementIds: [r[5]], min: point(68, 1, 0), max: point(111, 1, 7), material: "pale_structure" },
    { id: "thrill-drains", kind: "fill", intent: "deck drains and grates", phase: "thrill fine detail", requirementIds: [r[6]], min: point(2, 1, 32), max: point(109, 1, 32), material: "weathered_grate", offsets: [point(0, 0, 0), point(0, 0, 8)] },
    { id: "thrill-warning-lines", kind: "fill", intent: "warning markings and depth bands", phase: "thrill fine detail", requirementIds: [r[6]], min: point(7, 1, 35), max: point(18, 1, 36), material: "safety_red", offsets: [point(0, 0, 0), point(22, 0, 0), point(44, 0, 0), point(66, 0, 0)] },
    { id: "thrill-cameras-speakers", kind: "cylinder", intent: "cameras speakers and area lights", phase: "thrill fine detail", requirementIds: [r[6]], center: point(6, 2, 34), radius: 1, height: 5, material: "sea_light", offsets: Array.from({ length: 10 }, (_, index) => point(index * 11, 0, index % 2 ? 9 : 0)) },
    ...pairedDoorElements({ id: "thrill-service-door-a", intent: "pump-house service doors", phase: "mechanical plant access", requirementIds: [r[4]], side: "north", fixed: 2, start: 84, width: 4 }),
    ...pairedDoorElements({ id: "thrill-service-door-b", intent: "pump-house maintenance doors", phase: "mechanical plant access", requirementIds: [r[4]], side: "north", fixed: 2, start: 98, width: 4 }),
    ...pairedDoorElements({ id: "thrill-north-entry", intent: "north connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "north", fixed: 0, start: 70, width: 4 }),
    ...pairedDoorElements({ id: "thrill-east-entry", intent: "east connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "east", fixed: 111, start: 58, width: 4 }),
  ];
  return {
    schemaVersion: 1,
    description: "A generic path-and-volume program for a tall access structure, four non-identical descending channels, splashdown, queues, plant, and connections.",
    requirements: requirements(features, r, [
      ["thrill-tower-core", "thrill-tower-glazing", "thrill-platforms", "thrill-stairs-a", "thrill-stairs-b", "thrill-stairs-c"],
      ["thrill-flume-a", "thrill-flume-b", "thrill-flume-c", "thrill-flume-d", "thrill-landing-dividers"],
      ["thrill-platforms", "thrill-queue-rails", "thrill-loading-gates", "thrill-shade-roofs"],
      ["thrill-splash-pool", "thrill-lifeguard-posts", "thrill-rescue-marks", "thrill-landing-dividers"],
      ["thrill-pump-house", "thrill-service-door-a-lower", "thrill-service-door-a-upper", "thrill-service-door-b-lower", "thrill-service-door-b-upper", "thrill-exposed-pipes"],
      ["thrill-deck", "thrill-east-connection", "thrill-north-connection", "thrill-north-entry-lower", "thrill-north-entry-upper", "thrill-east-entry-lower", "thrill-east-entry-upper"],
      ["thrill-drains", "thrill-warning-lines", "thrill-cameras-speakers"],
    ], elements),
    elements,
  };
}

function waveDesign(features: readonly string[]): DesignProgram {
  const r = requirementIds("wave", features);
  const elements: DesignElement[] = [
    { id: "wave-deck", kind: "fill", intent: "broad pool deck and connection promenade", phase: "wave deck", requirementIds: [r[4], r[5]], min: point(0, 0, 0), max: point(127, 0, 111), material: "diorite" },
    { id: "wave-pool", kind: "basin", intent: "large wave pool with deep end", phase: "wave pool", requirementIds: [r[0]], min: point(5, 1, 13), max: point(68, 7, 80), wallMaterial: "prismarine_brick", floorMaterial: "sky", rimMaterial: "quartz_slab", liquidMaterial: "water", liquidLevel: 6, wallThickness: 2 },
    { id: "wave-beach-entry", kind: "ramp", intent: "graduated beach entry", phase: "wave pool beach", requirementIds: [r[0]], from: point(37, 6, 16), to: point(37, 2, 51), width: 55, material: "sandstone", railingMaterial: "safety_yellow" },
    { id: "wave-machine-wall", kind: "shell", intent: "deep-end wave-machine wall", phase: "wave pool machine", requirementIds: [r[0]], min: point(4, 2, 70), max: point(69, 14, 82), material: "dark_prismarine", thickness: 2 },
    { id: "wave-machine-ports", kind: "cylinder", intent: "wave-machine outlets", phase: "wave pool machine", requirementIds: [r[0]], center: point(10, 4, 69), radius: 2, height: 3, material: "oxidized_grate", hollow: true, offsets: Array.from({ length: 7 }, (_, index) => point(index * 9, 0, 0)) },
    { id: "activity-pool", kind: "basin", intent: "multi-use activity pool", phase: "activity pool", requirementIds: [r[1]], min: point(74, 1, 8), max: point(122, 6, 60), wallMaterial: "prismarine", floorMaterial: "sky", rimMaterial: "smooth_quartz", liquidMaterial: "water", liquidLevel: 5, wallThickness: 2 },
    { id: "activity-lanes", kind: "fill", intent: "activity-pool lane markings", phase: "activity pool lanes", requirementIds: [r[1]], min: point(79, 2, 12), max: point(80, 2, 55), material: "blue", offsets: [point(0, 0, 0), point(10, 0, 0), point(20, 0, 0), point(30, 0, 0)] },
    { id: "activity-climbing-wall", kind: "shell", intent: "poolside climbing wall and diving edge", phase: "activity pool features", requirementIds: [r[1]], min: point(112, 6, 14), max: point(122, 21, 25), material: "safety_orange", thickness: 2 },
    { id: "activity-hoops", kind: "cylinder", intent: "pool basketball goals", phase: "activity pool features", requirementIds: [r[1]], center: point(84, 6, 32), radius: 2, height: 1, material: "safety_red", hollow: true, offsets: [point(0, 0, 0), point(26, 0, 0)] },
    { id: "surf-basin", kind: "basin", intent: "surf simulator flow bed", phase: "surf simulator", requirementIds: [r[2]], min: point(75, 1, 70), max: point(121, 5, 99), wallMaterial: "white_structure", floorMaterial: "aqua", rimMaterial: "rail", liquidMaterial: "water", liquidLevel: 4 },
    { id: "surf-ramp", kind: "ramp", intent: "inclined surf simulator surface", phase: "surf simulator", requirementIds: [r[2]], from: point(98, 5, 72), to: point(98, 2, 95), width: 39, material: "aqua", railingMaterial: "rail" },
    { id: "surf-counter", kind: "fill", intent: "surf equipment counter", phase: "surf simulator support", requirementIds: [r[2]], min: point(76, 2, 101), max: point(91, 5, 106), material: "bamboo" },
    { id: "surf-queue", kind: "sweep", intent: "surf queue and spectator rail", phase: "surf simulator queue", requirementIds: [r[2]], points: [point(95, 2, 103), point(122, 2, 103), point(122, 2, 109), point(95, 2, 109)], crossSection: "solid", material: "rail", width: 1, height: 3 },
    { id: "wave-lifeguard-stands", kind: "shell", intent: "elevated lifeguard stands", phase: "pool safety", requirementIds: [r[3]], min: point(2, 1, 10), max: point(6, 8, 15), material: "white_structure", thickness: 1, offsets: [point(0, 0, 0), point(63, 0, 68), point(67, 0, 0), point(116, 0, 49)] },
    { id: "wave-depth-markers", kind: "fill", intent: "warning signs and depth markers", phase: "pool safety markings", requirementIds: [r[3]], min: point(8, 2, 11), max: point(15, 2, 11), material: "safety_yellow", offsets: Array.from({ length: 7 }, (_, index) => point(index * 17, 0, 0)) },
    { id: "wave-rescue-rings", kind: "cylinder", intent: "rescue rings and lane rope floats", phase: "pool safety equipment", requirementIds: [r[3]], center: point(12, 3, 9), radius: 2, height: 1, material: "safety_orange", hollow: true, offsets: [point(0, 0, 0), point(25, 0, 0), point(50, 0, 0), point(75, 0, 0), point(100, 0, 0)] },
    { id: "wave-loungers", kind: "fill", intent: "rows of pool loungers", phase: "pool deck furniture", requirementIds: [r[4]], min: point(8, 1, 87), max: point(15, 1, 89), material: "mangrove", offsets: Array.from({ length: 7 }, (_, index) => point(index * 17, 0, index % 2 ? 7 : 0)) },
    { id: "wave-umbrellas", kind: "cylinder", intent: "umbrellas and shade sail anchors", phase: "pool deck shade", requirementIds: [r[4]], center: point(12, 2, 86), radius: 3, height: 6, material: "family_pink", cap: true, offsets: [point(0, 0, 0), point(25, 0, 7), point(50, 0, 0), point(75, 0, 7), point(100, 0, 0)] },
    { id: "wave-showers", kind: "cylinder", intent: "showers and foot-rinse stations", phase: "pool deck amenities", requirementIds: [r[4]], center: point(5, 1, 102), radius: 1, height: 7, material: "exposed_copper", offsets: Array.from({ length: 8 }, (_, index) => point(index * 16, 0, 0)) },
    { id: "wave-west-promenade", kind: "fill", intent: "west connection promenade", phase: "sector connection", requirementIds: [r[5]], min: point(0, 1, 84), max: point(19, 1, 103), material: "site_paving" },
    { id: "wave-north-south-promenade", kind: "fill", intent: "north and south connection promenades", phase: "sector connection", requirementIds: [r[5]], min: point(20, 1, 0), max: point(70, 1, 7), material: "site_paving", offsets: [point(0, 0, 0), point(0, 0, 104)] },
    { id: "wave-coping-drains", kind: "fill", intent: "pool coping drains and expansion joints", phase: "wave fine detail", requirementIds: [r[6]], min: point(3, 1, 83), max: point(70, 1, 84), material: "black_slab", offsets: [point(0, 0, 0), point(54, 0, 0)] },
    { id: "wave-planters", kind: "basin", intent: "deck planters and waste stations", phase: "wave fine detail", requirementIds: [r[6]], min: point(3, 1, 105), max: point(9, 3, 110), wallMaterial: "mud_brick", floorMaterial: "moss", rimMaterial: "calcite", offsets: [point(0, 0, 0), point(112, 0, 0)] },
    { id: "wave-lights-speakers", kind: "cylinder", intent: "deck lights speakers and bins", phase: "wave fine detail", requirementIds: [r[6]], center: point(14, 1, 106), radius: 1, height: 5, material: "green_light", offsets: Array.from({ length: 9 }, (_, index) => point(index * 13, 0, 0)) },
    ...pairedDoorElements({ id: "wave-north-entry", intent: "north connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "north", fixed: 0, start: 40, width: 4 }),
    ...pairedDoorElements({ id: "wave-south-entry", intent: "south connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "south", fixed: 111, start: 40, width: 4 }),
    ...pairedDoorElements({ id: "wave-west-entry", intent: "west connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "west", fixed: 0, start: 92, width: 4 }),
  ];
  return {
    schemaVersion: 1,
    description: "A generic basins, ramps, shells, and repeated-details program for wave, activity, surf, safety, deck, and connection spaces.",
    requirements: requirements(features, r, [
      ["wave-pool", "wave-beach-entry", "wave-machine-wall", "wave-machine-ports"],
      ["activity-pool", "activity-lanes", "activity-climbing-wall", "activity-hoops"],
      ["surf-basin", "surf-ramp", "surf-counter", "surf-queue"],
      ["wave-lifeguard-stands", "wave-depth-markers", "wave-rescue-rings"],
      ["wave-deck", "wave-loungers", "wave-umbrellas", "wave-showers"],
      ["wave-deck", "wave-west-promenade", "wave-north-south-promenade", "wave-north-entry-lower", "wave-north-entry-upper", "wave-south-entry-lower", "wave-south-entry-upper", "wave-west-entry-lower", "wave-west-entry-upper"],
      ["wave-coping-drains", "wave-planters", "wave-lights-speakers"],
    ], elements),
    elements,
  };
}

function familyDesign(features: readonly string[]): DesignProgram {
  const r = requirementIds("family", features);
  const elements: DesignElement[] = [
    { id: "family-deck", kind: "fill", intent: "family sector deck and circulation", phase: "family deck", requirementIds: [r[5]], min: point(0, 0, 0), max: point(119, 0, 79), material: "sandstone" },
    { id: "family-river", kind: "sweep", intent: "wide closed-loop lazy river", phase: "lazy river", requirementIds: [r[0]], points: [point(10, 2, 9), point(56, 2, 7), point(106, 2, 10), point(111, 2, 37), point(106, 2, 70), point(61, 2, 73), point(12, 2, 69), point(7, 2, 39), point(10, 2, 9)], crossSection: "open_channel", material: "prismarine", innerMaterial: "water", width: 9, height: 4, thickness: 2 },
    { id: "family-river-bridges", kind: "fill", intent: "pedestrian bridges across the river", phase: "lazy river bridges", requirementIds: [r[0]], min: point(5, 6, 31), max: point(20, 7, 42), material: "bamboo", offsets: [point(0, 0, 0), point(94, 0, 0)] },
    { id: "family-river-entry", kind: "stairs", intent: "lazy-river entry stairs", phase: "lazy river access", requirementIds: [r[0]], from: point(24, 6, 8), to: point(31, 4, 8), width: 7, material: "bamboo_stair", railingMaterial: "rail", offsets: [point(0, 0, 0), point(47, 0, 64)] },
    { id: "family-current-jets", kind: "cylinder", intent: "current jets and tube-staging bollards", phase: "lazy river operations", requirementIds: [r[0]], center: point(31, 1, 7), radius: 1, height: 2, material: "copper", offsets: [point(0, 0, 0), point(22, 0, 0), point(44, 0, 1), point(66, 0, 2), point(75, 0, 25), point(73, 0, 49), point(40, 0, 65), point(5, 0, 61)] },
    { id: "family-fortress", kind: "shell", intent: "multi-level family play fortress", phase: "play fortress", requirementIds: [r[1]], min: point(39, 2, 22), max: point(79, 24, 57), material: "fresh_lime", thickness: 2 },
    { id: "family-fortress-platforms", kind: "fill", intent: "multi-level play platforms", phase: "play fortress platforms", requirementIds: [r[1]], min: point(35, 8, 18), max: point(83, 9, 61), material: "bamboo", offsets: [point(0, 0, 0), point(0, 8, 0)] },
    { id: "family-tipping-bucket", kind: "cylinder", intent: "large tipping-bucket silhouette", phase: "play fortress water feature", requirementIds: [r[1]], center: point(59, 24, 39), radius: 6, height: 6, material: "safety_orange", hollow: true, thickness: 1, cap: true },
    { id: "family-small-slide-a", kind: "sweep", intent: "small open family slide", phase: "family slide", requirementIds: [r[1]], points: [point(45, 17, 28), point(33, 12, 33), point(25, 5, 45)], crossSection: "open_channel", material: "family_pink", innerMaterial: "water", width: 5, height: 3, supports: { material: "jungle_post", interval: 4, toY: 1 } },
    { id: "family-small-slide-b", kind: "sweep", intent: "small enclosed family slide", phase: "family slide", requirementIds: [r[1]], points: [point(73, 16, 30), point(87, 12, 38), point(94, 5, 50)], crossSection: "tube", material: "flume_purple", innerMaterial: "water", width: 6, height: 6, supports: { material: "spruce_post", interval: 4, toY: 1 } },
    { id: "family-spray-columns", kind: "cylinder", intent: "spray-play features", phase: "play fortress spray", requirementIds: [r[1]], center: point(45, 2, 44), radius: 1, height: 14, material: "sky_glass", offsets: [point(0, 0, 0), point(9, 0, 5), point(18, 0, -5), point(27, 0, 2)] },
    { id: "family-splash-pad", kind: "basin", intent: "zero-depth splash pad", phase: "splash pad", requirementIds: [r[2]], min: point(25, 1, 59), max: point(88, 3, 66), wallMaterial: "aqua", floorMaterial: "sky", rimMaterial: "fresh_lime", liquidMaterial: "water", liquidLevel: 2 },
    { id: "family-safety-surface", kind: "fill", intent: "colorful splash-pad safety surfacing", phase: "splash pad surface", requirementIds: [r[2]], min: point(29, 2, 61), max: point(35, 2, 64), material: "family_pink", offsets: [point(0, 0, 0), point(12, 0, 0), point(24, 0, 0), point(36, 0, 0), point(48, 0, 0)] },
    { id: "family-parent-shade", kind: "fill", intent: "shaded parent seating canopy", phase: "splash pad shade", requirementIds: [r[2]], min: point(22, 7, 57), max: point(91, 7, 67), material: "green_glass" },
    { id: "family-parent-benches", kind: "fill", intent: "parent seating benches", phase: "splash pad seating", requirementIds: [r[2]], min: point(26, 2, 56), max: point(36, 3, 57), material: "dark_oak", offsets: [point(0, 0, 0), point(25, 0, 0), point(50, 0, 0)] },
    { id: "family-rock-islands", kind: "cylinder", intent: "rockwork islands and retaining walls", phase: "family landscape", requirementIds: [r[3]], center: point(18, 1, 20), radius: 6, height: 7, material: "mossy_masonry", cap: true, offsets: [point(0, 0, 0), point(77, 0, 1), point(4, 0, 35), point(77, 0, 35)] },
    { id: "family-waterfalls", kind: "sweep", intent: "waterfall ribbons over rockwork", phase: "family landscape water", requirementIds: [r[3]], points: [point(18, 8, 20), point(18, 5, 22), point(18, 2, 25)], crossSection: "solid", material: "water", width: 3, height: 1, offsets: [point(0, 0, 0), point(77, 0, 1)] },
    { id: "family-palms", kind: "cylinder", intent: "palm trunks in ornamental beds", phase: "family landscape palms", requirementIds: [r[3]], center: point(14, 1, 30), radius: 1, height: 13, material: "jungle_post", offsets: [point(0, 0, 0), point(21, 0, -17), point(50, 0, -18), point(88, 0, 0), point(0, 0, 30), point(88, 0, 29)] },
    { id: "family-palm-canopies", kind: "cylinder", intent: "palm and ornamental foliage", phase: "family landscape palms", requirementIds: [r[3]], center: point(14, 13, 30), radius: 4, height: 3, material: "jungle_leaf", cap: true, offsets: [point(0, 0, 0), point(21, 0, -17), point(50, 0, -18), point(88, 0, 0), point(0, 0, 30), point(88, 0, 29)] },
    { id: "family-planting-beds", kind: "basin", intent: "ornamental planting beds", phase: "family landscape beds", requirementIds: [r[3]], min: point(28, 1, 14), max: point(36, 3, 20), wallMaterial: "mud_brick", floorMaterial: "moss", rimMaterial: "calcite", offsets: [point(0, 0, 0), point(48, 0, 0)] },
    { id: "family-access-ramps", kind: "ramp", intent: "step-free accessible approaches", phase: "accessible circulation", requirementIds: [r[4]], from: point(5, 4, 8), to: point(22, 8, 17), width: 9, material: "site_paving", railingMaterial: "rail", offsets: [point(0, 0, 0), point(90, 0, 50)] },
    { id: "family-wide-gates", kind: "shell", intent: "wide emergency exit gates", phase: "accessible circulation", requirementIds: [r[4]], min: point(0, 1, 34), max: point(3, 8, 46), material: "safety_red", thickness: 1, offsets: [point(0, 0, 0), point(116, 0, 0)] },
    { id: "family-north-east-promenade", kind: "fill", intent: "north and east connection promenade", phase: "sector connection", requirementIds: [r[5]], min: point(0, 1, 0), max: point(60, 1, 6), material: "site_paving", offsets: [point(0, 0, 0), point(59, 0, 0)] },
    { id: "family-detail-drains", kind: "fill", intent: "grates drains and warning markings", phase: "family fine detail", requirementIds: [r[6]], min: point(3, 1, 76), max: point(116, 1, 77), material: "oxidized_grate" },
    { id: "family-detail-signs", kind: "fill", intent: "signs clocks and navigation marks", phase: "family fine detail", requirementIds: [r[6]], min: point(4, 5, 4), max: point(11, 8, 4), material: "safety_yellow", offsets: Array.from({ length: 9 }, (_, index) => point(index * 13, 0, 0)) },
    { id: "family-detail-lights", kind: "cylinder", intent: "lighting benches and bins", phase: "family fine detail", requirementIds: [r[6]], center: point(20, 1, 56), radius: 1, height: 5, material: "amber_light", offsets: Array.from({ length: 8 }, (_, index) => point(index * 11, 0, index % 2 ? -3 : 0)) },
    ...pairedDoorElements({ id: "family-north-entry", intent: "north connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "north", fixed: 0, start: 55, width: 4 }),
    ...pairedDoorElements({ id: "family-east-exit", intent: "accessible east emergency exit", phase: "accessible circulation", requirementIds: [r[4], r[5]], side: "east", fixed: 119, start: 38, width: 4 }),
  ];
  return {
    schemaVersion: 1,
    description: "A generic closed-path channel, bridge, multilevel shell, smaller sweeps, shallow basin, landscape cylinders, and accessible-ramp program.",
    requirements: requirements(features, r, [
      ["family-river", "family-river-bridges", "family-river-entry", "family-current-jets"],
      ["family-fortress", "family-fortress-platforms", "family-tipping-bucket", "family-small-slide-a", "family-small-slide-b", "family-spray-columns"],
      ["family-splash-pad", "family-safety-surface", "family-parent-shade", "family-parent-benches"],
      ["family-rock-islands", "family-waterfalls", "family-palms", "family-palm-canopies", "family-planting-beds"],
      ["family-access-ramps", "family-wide-gates", "family-east-exit-lower", "family-east-exit-upper"],
      ["family-deck", "family-north-east-promenade", "family-north-entry-lower", "family-north-entry-upper", "family-east-exit-lower", "family-east-exit-upper"],
      ["family-detail-drains", "family-detail-signs", "family-detail-lights"],
    ], elements),
    elements,
  };
}

function serviceDesign(features: readonly string[]): DesignProgram {
  const r = requirementIds("service", features);
  const elements: DesignElement[] = [
    { id: "service-site", kind: "fill", intent: "hospitality terraces and connection promenade", phase: "hospitality site", requirementIds: [r[2], r[5]], min: point(0, 0, 0), max: point(127, 0, 79), material: "site_paving" },
    { id: "service-food-hall", kind: "shell", intent: "modern food hall with kitchens and seating", phase: "food hall", requirementIds: [r[0]], min: point(5, 1, 7), max: point(80, 21, 39), material: "white_structure", thickness: 2 },
    { id: "service-food-hall-clear", kind: "carve", intent: "usable food hall interior", phase: "food hall", requirementIds: [], min: point(7, 2, 9), max: point(78, 19, 37) },
    { id: "service-glass-facade", kind: "fill", intent: "full-height food-hall glass facade", phase: "food hall glazing", requirementIds: [r[0]], min: point(12, 4, 6), max: point(72, 17, 6), material: "clear_glass" },
    { id: "service-counters", kind: "fill", intent: "food service counters", phase: "food hall counters", requirementIds: [r[0], r[6]], min: point(12, 2, 14), max: point(29, 5, 17), material: "cut_copper", offsets: [point(0, 0, 0), point(23, 0, 0), point(46, 0, 0)] },
    { id: "service-kitchens", kind: "shell", intent: "working kitchen volumes", phase: "food hall kitchens", requirementIds: [r[0]], min: point(9, 1, 25), max: point(31, 12, 37), material: "charcoal_structure", thickness: 1, offsets: [point(0, 0, 0), point(24, 0, 0), point(48, 0, 0)] },
    { id: "service-dining", kind: "fill", intent: "dining tables and bench seating", phase: "food hall dining", requirementIds: [r[0], r[6]], min: point(11, 2, 20), max: point(17, 3, 22), material: "spruce", offsets: Array.from({ length: 8 }, (_, index) => point((index % 4) * 17, 0, Math.floor(index / 4) * 12)) },
    { id: "service-kiosks", kind: "shell", intent: "two snack kiosks", phase: "hospitality kiosks", requirementIds: [r[1]], min: point(3, 1, 45), max: point(21, 11, 58), material: "safety_orange", thickness: 1, offsets: [point(0, 0, 0), point(26, 0, 0)] },
    { id: "service-vending-towel-retail", kind: "fill", intent: "vending towel and retail counters", phase: "hospitality retail", requirementIds: [r[1]], min: point(6, 2, 60), max: point(18, 6, 64), material: "aqua", offsets: [point(0, 0, 0), point(18, 0, 0), point(36, 0, 0)] },
    { id: "service-retail-signs", kind: "fill", intent: "retail and towel wayfinding", phase: "hospitality retail signs", requirementIds: [r[1]], min: point(7, 7, 59), max: point(16, 9, 59), material: "pearl_light", offsets: [point(0, 0, 0), point(18, 0, 0), point(36, 0, 0)] },
    { id: "service-cabanas", kind: "shell", intent: "private cabanas", phase: "hospitality terrace", requirementIds: [r[2]], min: point(58, 1, 45), max: point(72, 10, 57), material: "bamboo", thickness: 1, offsets: [point(0, 0, 0), point(18, 0, 0), point(36, 0, 0)] },
    { id: "service-pergolas", kind: "fill", intent: "pergolas and umbrella shade", phase: "hospitality terrace shade", requirementIds: [r[2]], min: point(55, 9, 43), max: point(126, 10, 61), material: "dark_oak" },
    { id: "service-loungers", kind: "fill", intent: "terrace loungers and dining furniture", phase: "hospitality terrace furniture", requirementIds: [r[2]], min: point(57, 2, 65), max: point(66, 2, 68), material: "mangrove", offsets: Array.from({ length: 6 }, (_, index) => point((index % 3) * 23, 0, Math.floor(index / 3) * 7)) },
    { id: "service-terrace-planters", kind: "basin", intent: "landscaped dining terrace beds", phase: "hospitality terrace landscape", requirementIds: [r[2]], min: point(55, 1, 72), max: point(65, 4, 78), wallMaterial: "mud_brick", floorMaterial: "moss", rimMaterial: "calcite", offsets: [point(0, 0, 0), point(31, 0, 0), point(61, 0, 0)] },
    { id: "service-terrace-foliage", kind: "cylinder", intent: "terrace ornamental planting", phase: "hospitality terrace landscape", requirementIds: [r[2]], center: point(60, 4, 75), radius: 4, height: 4, material: "azalea_leaf", cap: true, offsets: [point(0, 0, 0), point(31, 0, 0), point(61, 0, 0)] },
    { id: "service-plant", kind: "shell", intent: "back-of-house pump filtration and chemical-storage plant", phase: "service plant", requirementIds: [r[3]], min: point(84, 1, 4), max: point(123, 20, 37), material: "dark_masonry", thickness: 2 },
    { id: "service-staff-corridor", kind: "fill", intent: "staff service corridor", phase: "service plant circulation", requirementIds: [r[3]], min: point(82, 1, 38), max: point(126, 4, 43), material: "safety_yellow" },
    { id: "service-chemical-facade", kind: "fill", intent: "marked chemical-storage facade", phase: "service plant safety", requirementIds: [r[3]], min: point(91, 5, 3), max: point(116, 12, 3), material: "safety_red" },
    { id: "service-plant-pipes", kind: "cylinder", intent: "filtration pipes and tanks", phase: "service plant mechanical", requirementIds: [r[3], r[4]], center: point(89, 2, 39), radius: 2, height: 15, material: "exposed_copper", hollow: true, thickness: 1, offsets: [point(0, 0, 0), point(8, 0, 0), point(16, 0, 0), point(24, 0, 0)] },
    { id: "service-maintenance-yard", kind: "shell", intent: "screened maintenance yard and loading area", phase: "maintenance yard", requirementIds: [r[4]], min: point(82, 1, 45), max: point(126, 14, 75), material: "iron", thickness: 1 },
    { id: "service-yard-screen", kind: "fill", intent: "maintenance screening and service access", phase: "maintenance yard screen", requirementIds: [r[4]], min: point(82, 2, 44), max: point(126, 8, 44), material: "oxidized_copper" },
    { id: "service-vents", kind: "cylinder", intent: "exposed vents", phase: "maintenance yard mechanical", requirementIds: [r[4]], center: point(88, 15, 51), radius: 2, height: 8, material: "weathered_grate", hollow: true, offsets: [point(0, 0, 0), point(10, 0, 0), point(20, 0, 0), point(30, 0, 0)] },
    { id: "service-north-connection", kind: "fill", intent: "north connection promenade", phase: "sector connection", requirementIds: [r[5]], min: point(0, 1, 0), max: point(70, 1, 6), material: "pale_structure" },
    { id: "service-west-connection", kind: "fill", intent: "west connection and emergency exit", phase: "sector connection", requirementIds: [r[5]], min: point(0, 1, 0), max: point(6, 1, 50), material: "pale_structure" },
    { id: "service-emergency-exit", kind: "shell", intent: "clearly marked emergency exit", phase: "sector connection safety", requirementIds: [r[5]], min: point(0, 2, 30), max: point(5, 10, 42), material: "safety_red", thickness: 1 },
    { id: "service-detail-bins", kind: "cylinder", intent: "waste and recycling stations", phase: "hospitality fine detail", requirementIds: [r[6]], center: point(8, 1, 69), radius: 1, height: 3, material: "blue", offsets: Array.from({ length: 8 }, (_, index) => point(index * 15, 0, index % 2 ? 4 : 0)) },
    { id: "service-detail-lights", kind: "cylinder", intent: "lighting cameras and speakers", phase: "hospitality fine detail", requirementIds: [r[6]], center: point(12, 1, 3), radius: 1, height: 6, material: "redstone_light", offsets: Array.from({ length: 8 }, (_, index) => point(index * 15, 0, 0)) },
    { id: "service-detail-signs", kind: "fill", intent: "signage and counter labels", phase: "hospitality fine detail", requirementIds: [r[6]], min: point(10, 11, 5), max: point(19, 13, 5), material: "black_detail", offsets: Array.from({ length: 6 }, (_, index) => point(index * 19, 0, 0)) },
    { id: "service-detail-drains", kind: "fill", intent: "kitchen and terrace drains", phase: "hospitality fine detail", requirementIds: [r[6]], min: point(2, 1, 41), max: point(78, 1, 42), material: "copper_grate" },
    ...pairedDoorElements({ id: "service-loading-bay-a", intent: "loading bay service doors", phase: "maintenance yard loading", requirementIds: [r[4]], side: "south", fixed: 75, start: 88, width: 4 }),
    ...pairedDoorElements({ id: "service-loading-bay-b", intent: "loading bay service doors", phase: "maintenance yard loading", requirementIds: [r[4]], side: "south", fixed: 75, start: 102, width: 4 }),
    ...pairedDoorElements({ id: "service-north-entry", intent: "north connection entrance", phase: "sector connection access", requirementIds: [r[5]], side: "north", fixed: 0, start: 60, width: 4 }),
    ...pairedDoorElements({ id: "service-west-exit", intent: "marked west emergency exit", phase: "sector connection safety", requirementIds: [r[5]], side: "west", fixed: 0, start: 20, width: 4 }),
  ];
  return {
    schemaVersion: 1,
    description: "A generic shells, counters, repetitions, landscape basins, plant cylinders, screened-yard, and connection program for hospitality and service operations.",
    requirements: requirements(features, r, [
      ["service-food-hall", "service-glass-facade", "service-counters", "service-kitchens", "service-dining"],
      ["service-kiosks", "service-vending-towel-retail", "service-retail-signs"],
      ["service-site", "service-cabanas", "service-pergolas", "service-loungers", "service-terrace-planters", "service-terrace-foliage"],
      ["service-plant", "service-staff-corridor", "service-chemical-facade", "service-plant-pipes"],
      ["service-maintenance-yard", "service-yard-screen", "service-loading-bay-a-lower", "service-loading-bay-a-upper", "service-loading-bay-b-lower", "service-loading-bay-b-upper", "service-vents", "service-plant-pipes"],
      ["service-site", "service-north-connection", "service-west-connection", "service-emergency-exit", "service-north-entry-lower", "service-north-entry-upper", "service-west-exit-lower", "service-west-exit-upper"],
      ["service-counters", "service-dining", "service-detail-bins", "service-detail-lights", "service-detail-signs", "service-detail-drains"],
    ], elements),
    elements,
  };
}

function designForBuild(index: number, features: readonly string[]) {
  switch (index) {
    case 0: return arrivalDesign(features);
    case 1: return thrillDesign(features);
    case 2: return waveDesign(features);
    case 3: return familyDesign(features);
    case 4: return serviceDesign(features);
    default: throw new Error(`No Aqua Meridian acceptance design exists for build index ${index}.`);
  }
}

export async function readAquaMeridianFixture(path = AQUA_MERIDIAN_FIXTURE_PATH): Promise<AquaMeridianFixture> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as AquaMeridianFixture;
  assert.equal(parsed.project.name, "Aqua Meridian Waterpark");
  assert.equal(parsed.builds.length, 5);
  return parsed;
}

export function completeAquaMeridianBrief(fixture: AquaMeridianFixture, build: ProjectBuildFixture, index: number): BuildInput {
  const design = designForBuild(index, build.features);
  const brief: BuildInput = {
    ...build,
    rolePalette: { ...fixture.sharedRolePalette },
    materialLibrary: { ...AQUA_MERIDIAN_MATERIALS },
    design,
    sourceBrief: [
      `${fixture.project.name}: ${fixture.project.purpose}`,
      `Sector ${index + 1}: ${build.name}`,
      `Exact envelope ${build.dimensions.width}x${build.dimensions.depth}x${build.dimensions.height} at ${build.origin.x},${build.origin.y},${build.origin.z}.`,
      ...build.features.map((feature) => `Required: ${feature}`),
      "Synthesize all requirements using only generic spatial and path primitives; do not substitute a preset shell.",
    ].join("\n"),
  };
  return { ...brief, confirmationToken: preflightConfirmationToken(brief) };
}

export async function generateAquaMeridian(path = AQUA_MERIDIAN_FIXTURE_PATH): Promise<AquaMeridianResult> {
  const fixture = await readAquaMeridianFixture(path);
  const builds = fixture.builds.map((build, index) => compileBuild(completeAquaMeridianBrief(fixture, build, index)));
  return { fixture, builds, report: validateAquaMeridian(fixture, builds) };
}

function inside(pointToCheck: Vec3, min: Vec3, max: Vec3) {
  return pointToCheck.x >= min.x && pointToCheck.x <= max.x
    && pointToCheck.y >= min.y && pointToCheck.y <= max.y
    && pointToCheck.z >= min.z && pointToCheck.z <= max.z;
}

export function validateAquaMeridian(fixture: AquaMeridianFixture, builds: readonly BuildRecord[]) {
  assert.equal(builds.length, fixture.builds.length, "All five sectors must compile.");
  const fingerprints = new Set<string>();
  const hashes = new Set<string>();
  const projectMaterials = new Set<string>();
  const featureEvidence: Array<{ build: string; feature: string; placements: number; elementIds: string[] }> = [];
  const physicalAudits: Array<{
    build: string;
    totals: ReturnType<typeof auditBuild>["totals"];
    findings: Array<{ code: string; severity: string; total: number }>;
  }> = [];
  const projectMin = fixture.project.overallBounds.minimum;
  const projectMax = fixture.project.overallBounds.maximum;
  for (const [index, build] of builds.entries()) {
    const expected = fixture.builds[index];
    assert.deepEqual(build.input.origin, expected.origin, `${build.input.name} origin changed.`);
    assert.deepEqual(build.input.dimensions, expected.dimensions, `${build.input.name} dimensions changed.`);
    assert.deepEqual([...build.input.features].sort(), [...expected.features].sort(), `${build.input.name} feature text changed.`);
    assert.equal(build.input.style, "modern", `${build.input.name} fell back to ${build.input.style}.`);
    assert.ok(build.input.design.elements.length > 0, `${build.input.name} did not use the generic Design IR.`);
    assert.ok(Object.keys(build.input.materialLibrary).length >= 30, `${build.input.name} material library was truncated.`);
    assert.equal(build.contract.status, "valid", `${build.input.name} has an invalid contract.`);
    assert.equal(build.certificate.status, "valid", `${build.input.name} has an invalid certificate.`);
    assert.equal(build.certificate.buildHash, build.hash, `${build.input.name} certificate is not hash-bound.`);
    assert.equal(build.validation.valid, true, `${build.input.name} failed canonical validation.`);
    const physicalAudit = auditBuild(build);
    const blockingFindings = physicalAudit.findings.filter(({ code }) => code === "BLOCKED_ENTRANCE_CLEARANCE");
    const unexpectedWarnings = physicalAudit.findings.filter(({ severity, code }) =>
      severity === "warning" && code !== "ROOM_ACCESS_NOT_GEOMETRICALLY_EVALUATED");
    assert.equal(
      physicalAudit.totals.errors,
      0,
      `${build.input.name} failed the physical reviewer: ${physicalAudit.findings.filter(({ severity }) => severity === "error").map(({ code, total }) => `${code} (${total})`).join(", ")}`,
    );
    assert.equal(
      blockingFindings.length,
      0,
      `${build.input.name} has obstructed boundary circulation: ${blockingFindings.map(({ code, total }) => `${code} (${total})`).join(", ")}`,
    );
    assert.equal(
      unexpectedWarnings.length,
      0,
      `${build.input.name} has unresolved physical-review warnings: ${unexpectedWarnings.map(({ code, total }) => `${code} (${total})`).join(", ")}`,
    );
    physicalAudits.push({
      build: build.input.name,
      totals: { ...physicalAudit.totals },
      findings: physicalAudit.findings.map(({ code, severity, total }) => ({ code, severity, total })),
    });
    assert.ok(build.placements.length <= expected.blockBudget, `${build.input.name} exceeded its 150,000 placement budget.`);
    assert.deepEqual(build.bounds.min, expected.origin, `${build.input.name} does not occupy its exact origin.`);
    const sectorMax = point(
      expected.origin.x + expected.dimensions.width - 1,
      expected.origin.y + expected.dimensions.height - 1,
      expected.origin.z + expected.dimensions.depth - 1,
    );
    for (const placement of build.placements) {
      assert.ok(inside(placement, expected.origin, sectorMax), `${build.input.name} escaped its exact sector envelope at ${placement.x},${placement.y},${placement.z}.`);
      assert.ok(inside(placement, projectMin, projectMax), `${build.input.name} escaped the Aqua Meridian project bounds.`);
      projectMaterials.add(placement.block);
    }
    const materialCount = Object.keys(build.materialCounts).length;
    assert.ok(materialCount > 16, `${build.input.name} used only ${materialCount} actual materials.`);
    const requirementsByText = new Map(build.input.design.requirements.map((requirement) => [requirement.text, requirement]));
    for (const feature of expected.features) {
      const requirement = requirementsByText.get(feature);
      assert.ok(requirement, `${build.input.name} lost feature mapping: ${feature}`);
      const matches = build.placements.filter((placement) =>
        placement.elementId
        && requirement.elementIds.includes(placement.elementId)
        && placement.requirementIds?.includes(requirement.id),
      );
      assert.ok(matches.length >= 1, `${build.input.name} has no canonical placement evidence for: ${feature}`);
      assert.ok(requirement.claims.length >= 1 && requirement.assertions.length >= requirement.claims.length, `${build.input.name} lacks atomic typed assertions for: ${feature}`);
      assert.ok(requirement.claims.every(({ status }) => status === "asserted"), `${build.input.name} retains an unsupported atomic claim for: ${feature}`);
      for (const elementId of requirement.elementIds) assert.ok(matches.some((placement) => placement.elementId === elementId), `${build.input.name} did not materialize mapped element ${elementId}.`);
      const contractResult = build.contract.hardResults.find((result) => result.requirement === feature);
      assert.equal(contractResult?.status, "pass", `${build.input.name} contract did not pass: ${feature}`);
      featureEvidence.push({ build: build.input.name, feature, placements: matches.length, elementIds: [...requirement.elementIds] });
    }
    if (/Thrill|Wave|Family/.test(build.input.name)) assert.ok(build.materialCounts["minecraft:water"] > 0, `${build.input.name} contains no water.`);
    assert.ok(!fingerprints.has(build.structuralFingerprint), `${build.input.name} duplicated another sector's structural fingerprint.`);
    assert.ok(!hashes.has(build.hash), `${build.input.name} duplicated another sector's build hash.`);
    fingerprints.add(build.structuralFingerprint);
    hashes.add(build.hash);
  }
  assert.ok(projectMaterials.size > 30, `The project used only ${projectMaterials.size} actual materials.`);
  const observedBounds = {
    min: point(
      Math.min(...builds.map(({ bounds }) => bounds.min.x)),
      Math.min(...builds.map(({ bounds }) => bounds.min.y)),
      Math.min(...builds.map(({ bounds }) => bounds.min.z)),
    ),
    max: point(
      Math.max(...builds.map(({ bounds }) => bounds.max.x)),
      Math.max(...builds.map(({ bounds }) => bounds.max.y)),
      Math.max(...builds.map(({ bounds }) => bounds.max.z)),
    ),
  };
  assert.ok(inside(observedBounds.min, projectMin, projectMax));
  assert.ok(inside(observedBounds.max, projectMin, projectMax));
  return {
    schemaVersion: 1,
    project: fixture.project.name,
    status: "valid" as const,
    overallEnvelope: fixture.project.overallBounds,
    observedBounds,
    materialLibraryEntries: Object.keys(AQUA_MERIDIAN_MATERIALS).length,
    actualProjectMaterials: projectMaterials.size,
    actualMaterialIds: [...projectMaterials].sort(),
    totalPlacements: builds.reduce((sum, build) => sum + build.placements.length, 0),
    sectors: builds.map((build) => ({
      name: build.input.name,
      id: build.id,
      hash: build.hash,
      structuralFingerprint: build.structuralFingerprint,
      contractStatus: build.contract.status,
      placements: build.placements.length,
      budget: build.input.blockBudget,
      actualMaterials: Object.keys(build.materialCounts).length,
      waterBlocks: build.materialCounts["minecraft:water"] ?? 0,
      bounds: build.bounds,
      attemptedCollisions: build.validation.attemptedCollisions,
    })),
    physicalAudits,
    featureEvidence,
  };
}

export async function writeAquaMeridian(result: AquaMeridianResult, outputDirectory: string) {
  await mkdir(outputDirectory, { recursive: true });
  const pack = await createBedrockMcpack({
    schemaVersion: 1,
    name: result.fixture.project.name,
    description: `${result.fixture.project.purpose}. Generated from generic geometry and validated feature evidence.`,
    packId: "blockwright.aqua-meridian-waterpark",
    builds: result.builds,
  }, {
    namespace: "aqua_meridian",
    tileDimensions: { width: 32, height: 32, depth: 32 },
    manifestVersion: [0, 7, 0],
  });
  const buildDirectory = join(outputDirectory, "build-records");
  await mkdir(buildDirectory, { recursive: true });
  await Promise.all(result.builds.map((build, index) => writeFile(
    join(buildDirectory, `${String(index + 1).padStart(2, "0")}-${build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`),
    `${JSON.stringify(build, null, 2)}\n`,
  )));
  const packPath = join(outputDirectory, pack.fileName);
  await Promise.all([
    writeFile(packPath, pack.bytes),
    writeFile(join(outputDirectory, "validation-report.json"), `${JSON.stringify(result.report, null, 2)}\n`),
    writeFile(join(outputDirectory, "mcpack-metadata.json"), `${JSON.stringify({
      fileName: pack.fileName,
      manifest: pack.manifest,
      metadata: pack.metadata,
      tileCount: pack.tiles.length,
      fileCount: pack.files.length,
      checksumsSha256: pack.checksumsSha256,
      compatibility: pack.compatibility,
    }, null, 2)}\n`),
  ]);
  return { packPath, pack, outputDirectory };
}

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const outputDirectory = resolve(argumentValue("--output") ?? join(process.cwd(), "benchmarks", "generated", "aqua-meridian"));
  const result = await generateAquaMeridian(argumentValue("--fixture") ?? AQUA_MERIDIAN_FIXTURE_PATH);
  const written = await writeAquaMeridian(result, outputDirectory);
  console.log(JSON.stringify({
    status: result.report.status,
    outputDirectory,
    mcpack: written.packPath,
    totalPlacements: result.report.totalPlacements,
    actualProjectMaterials: result.report.actualProjectMaterials,
    sectors: result.report.sectors,
    tileCount: written.pack.tiles.length,
    compatibility: written.pack.compatibility,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
