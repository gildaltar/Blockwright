import { createHash } from "node:crypto";
import { REGISTRY_META } from "../data/registry-meta.js";
import { getStyleProfile } from "../data/styles.js";
import { registryMetadata } from "./java-registry.js";
import { defaultRolePalette, PALETTE_ROLES, validatePaletteIdentifiers } from "./palette-studio.js";
import { assertPreflightConfirmed, estimateBuild } from "./preflight.js";
import type { ArchitecturalPlan, BuildInput, BuildRecord, Dimensions, Placement, RolePalette, Vec3 } from "./types.js";

const DEFAULT_ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function clampDimension(value: number, min: number) {
  return Math.max(min, Math.min(65_535, Math.round(value)));
}

export function normalizeInput(input: BuildInput): Required<BuildInput> {
  const style = getStyleProfile(input.style || "nordic");
  const version = input.version.trim() || REGISTRY_META[input.edition].coverageVersion;
  const positionalPalette = Object.fromEntries((input.palette ?? []).slice(0, PALETTE_ROLES.length).map((block, index) => [PALETTE_ROLES[index], block]));
  const rolePalette = defaultRolePalette(style.id, input.edition, version, { ...positionalPalette, ...input.rolePalette });
  return {
    name: input.name.trim() || "Untitled Build",
    edition: input.edition,
    version,
    style: style.id,
    dimensions: {
      width: clampDimension(input.dimensions.width, 5),
      depth: clampDimension(input.dimensions.depth, 5),
      height: clampDimension(input.dimensions.height, 5),
    },
    palette: input.palette?.length ? [...input.palette] : [...new Set(Object.values(rolePalette))],
    rolePalette,
    origin: input.origin ? { ...input.origin } : { ...DEFAULT_ORIGIN },
    features: input.features ? [...input.features].sort() : ["covered porch", "hearth", "storage loft"],
    blockBudget: Math.max(100, Math.round(input.blockBudget ?? 2_000_000)),
    seed: input.seed?.trim() || createHash("sha256").update(JSON.stringify({ name: input.name.trim(), edition: input.edition, version, style: style.id, dimensions: input.dimensions, buildingType: input.buildingType ?? "auto" })).digest("hex").slice(0, 12),
    buildingType: input.buildingType ?? (style.id === "japanese" ? "temple" : style.id === "medieval" ? "hall" : style.id === "megabase" ? "megabase" : "house"),
    confirmationToken: input.confirmationToken ?? "",
  };
}

type PlacementAccumulator = {
  map: Map<string, Placement>;
  attemptedCollisions: number;
  put: (x: number, y: number, z: number, block: string, phase: string, state?: Placement["state"]) => void;
  remove: (x: number, y: number, z: number) => void;
};

function createAccumulator(origin: Vec3): PlacementAccumulator {
  const map = new Map<string, Placement>();
  const accumulator: PlacementAccumulator = {
    map,
    attemptedCollisions: 0,
    put(x, y, z, block, phase, state) {
      const placement = { x: x + origin.x, y: y + origin.y, z: z + origin.z, block, phase, ...(state ? { state } : {}) };
      const key = `${placement.x},${placement.y},${placement.z}`;
      if (map.has(key)) accumulator.attemptedCollisions += 1;
      map.set(key, placement);
    },
    remove(x, y, z) {
      map.delete(`${x + origin.x},${y + origin.y},${z + origin.z}`);
    },
  };
  return accumulator;
}

function seedNumber(seed: string) {
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) || 1;
}

function seededRandom(seed: string) {
  let state = seedNumber(seed) >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function planFingerprintPayload(plan: Omit<ArchitecturalPlan, "fingerprint">) {
  return JSON.stringify({
    program: plan.program, footprint: plan.footprint,
    volumes: plan.massing.volumes.map(({ min, max, purpose }) => ({ min, max, purpose })),
    floorHeights: plan.floorHeights, frame: plan.structuralFrame,
    roof: plan.roofGrammar, entrances: plan.entrances, windows: plan.windows,
  });
}

export function createArchitecturalPlan(input: Required<BuildInput>): ArchitecturalPlan {
  const random = seededRandom(input.seed);
  const { width, depth, height } = input.dimensions;
  const style = input.style.toLowerCase();
  const japanese = style === "japanese";
  const modern = style === "modern" || style === "warm-modern" || style === "brutalist";
  const tower = input.buildingType === "tower" || style === "fantasy";
  const footprint: ArchitecturalPlan["footprint"] = {
    kind: japanese || input.buildingType === "courtyard" ? "courtyard" : modern ? "interlocking" : tower ? "tower" : "rectangle",
    width, depth, inset: japanese ? Math.max(2, Math.floor(Math.min(width, depth) * (0.22 + random() * 0.08))) : Math.max(1, Math.floor(Math.min(width, depth) * 0.12)),
  };
  const floorHeight = Math.max(4, Math.min(7, 4 + Math.floor(random() * 3)));
  const floors = Math.max(1, Math.floor((height - 2) / floorHeight));
  const asymmetry = Number((0.12 + random() * 0.48).toFixed(3));
  const secondaryWidth = Math.max(3, Math.floor(width * (0.38 + random() * 0.18)));
  const secondaryDepth = Math.max(3, Math.floor(depth * (0.38 + random() * 0.18)));
  const volumes = footprint.kind === "interlocking"
    ? [
        { id: "primary", min: { x: 0, y: 0, z: 0 }, max: { x: Math.max(3, width - secondaryWidth), y: Math.max(4, height - floorHeight), z: depth - 1 }, purpose: "main living bar" },
        { id: "cross", min: { x: Math.max(1, width - secondaryWidth - Math.floor(random() * 3)), y: 0, z: Math.max(1, depth - secondaryDepth - Math.floor(random() * 3)) }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: "raised cross volume" },
      ]
    : footprint.kind === "tower"
      ? [
          { id: "hall", min: { x: 0, y: 0, z: 0 }, max: { x: width - 1, y: Math.max(4, Math.floor(height * 0.55)), z: depth - 1 }, purpose: "great hall" },
          { id: "tower", min: { x: Math.max(0, width - Math.max(5, Math.floor(width * 0.38))), y: 0, z: Math.max(0, depth - Math.max(5, Math.floor(depth * 0.38))) }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: "vertical lookout" },
        ]
      : [{ id: "main", min: { x: 0, y: 0, z: 0 }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: japanese ? "courtyard ring" : "main hall" }];
  const spaces = japanese ? ["genkan", "main hall", "engawa", "courtyard", "service room"] : modern ? ["entry", "living core", "service spine", "terrace"] : tower ? ["great hall", "stair tower", "lookout", "service room"] : ["entry", "main room", "storage", "loft"];
  const rooms = spaces.map((purpose, index) => ({ id: `room-${index + 1}`, purpose, floor: Math.min(floors - 1, Math.floor(index / 3)) }));
  const links = rooms.slice(1).map((room, index) => ({ from: rooms[index].id, to: room.id }));
  const roofType: ArchitecturalPlan["roofGrammar"]["type"] = japanese ? "pagoda" : modern ? "flat" : tower ? "stepped" : "gable";
  const planWithoutFingerprint: Omit<ArchitecturalPlan, "fingerprint"> = {
    schemaVersion: 1, seed: input.seed,
    program: { buildingType: input.buildingType, spaces }, footprint,
    massing: { volumes, asymmetry }, roomGraph: { rooms, links },
    circulation: { primary: japanese ? "engawa loop around courtyard" : modern ? "linear service spine" : tower ? "hall-to-tower hinge" : "central entry to loft stair", vertical: tower ? "spiral tower stair" : floors > 1 ? "compact stair" : "none", exterior: japanese ? ["covered engawa", "garden threshold"] : modern ? ["terrace"] : ["entry porch"] },
    floorHeights: Array.from({ length: floors }, () => floorHeight),
    facadeBays: (["north", "south", "east", "west"] as const).map((side, index) => ({ side, count: Math.max(2, Math.floor((index < 2 ? width : depth) / Math.max(3, 3 + Math.floor(random() * 3)))), rhythm: japanese ? "post-screen-post" : modern ? "solid-glass-solid" : "frame-infill" })),
    structuralFrame: { system: japanese ? "post-and-beam courtyard ring" : modern ? "interlocking shear volumes" : tower ? "masonry hall with corner tower" : "timber frame over masonry base", bayWidth: Math.max(3, Math.min(7, 3 + Math.floor(random() * 5))), supports: japanese ? ["perimeter posts", "courtyard posts"] : ["corners", "facade bays", "roof ridge"] },
    roofGrammar: { type: roofType, pitch: modern ? 0 : Number((0.45 + random() * 0.45).toFixed(2)), overhang: japanese ? 2 : modern ? 1 : 1, tiers: japanese ? Math.max(1, Math.min(3, Math.floor(height / 8))) : tower ? 2 : 1 },
    entrances: [{ side: "south", width: japanese ? 3 : Math.max(1, 1 + Math.floor(random() * 2)), emphasis: japanese ? "recessed genkan" : modern ? "shadow reveal" : "framed threshold" }],
    windows: { pattern: japanese ? "screen bays facing courtyard" : modern ? "continuous bands at living volume" : tower ? "narrow grouped openings" : "paired bays", sill: japanese ? 2 : 3, height: japanese ? 3 : modern ? 3 : 2 },
    details: japanese ? ["deep eaves", "engawa", "layered roof edges"] : modern ? ["shadow gaps", "cantilever", "roof terrace"] : tower ? ["battlements", "buttresses", "tower cap"] : ["porch", "chimney", "exposed frame"],
    landscaping: japanese ? ["courtyard garden", "stepping path", "water or gravel focus"] : modern ? ["terrace", "planter bands"] : ["path", "foundation planting"],
  };
  const fingerprint = createHash("sha256").update(planFingerprintPayload(planWithoutFingerprint)).digest("hex");
  return { ...planWithoutFingerprint, fingerprint };
}

function shellBox(acc: PlacementAccumulator, min: Vec3, max: Vec3, palette: RolePalette, phase: string, flatRoof = false) {
  for (let x = min.x; x <= max.x; x += 1) for (let z = min.z; z <= max.z; z += 1) {
    acc.put(x, min.y, z, palette.foundation, `${phase}: foundation`);
    acc.put(x, min.y + 1, z, palette.wall, `${phase}: floor`);
    if (flatRoof) acc.put(x, max.y, z, palette.roof, `${phase}: roof`);
  }
  for (let y = min.y + 2; y < max.y; y += 1) {
    for (let x = min.x; x <= max.x; x += 1) {
      acc.put(x, y, min.z, palette.wall, `${phase}: walls`);
      acc.put(x, y, max.z, palette.wall, `${phase}: walls`);
    }
    for (let z = min.z + 1; z < max.z; z += 1) {
      acc.put(min.x, y, z, palette.wall, `${phase}: walls`);
      acc.put(max.x, y, z, palette.wall, `${phase}: walls`);
    }
  }
}

function carveDoor(acc: PlacementAccumulator, x: number, z: number, facing: string, palette: RolePalette, width = 1) {
  for (let dx = 0; dx < width; dx += 1) {
    acc.put(x + dx, 2, z, palette.doors, "openings", { half: "lower", facing, hinge: dx % 2 ? "right" : "left", open: false, powered: false });
    acc.put(x + dx, 3, z, palette.doors, "openings", { half: "upper", facing, hinge: dx % 2 ? "right" : "left", open: false, powered: false });
  }
}

function generateNordic(plan: ArchitecturalPlan, dimensions: Dimensions, origin: Vec3, palette: RolePalette) {
  const acc = createAccumulator(origin); const { width: w, depth: d, height: h } = dimensions;
  const roofRise = Math.max(2, Math.min(Math.floor(w / 2), Math.floor(h * 0.42))); const wallTop = h - roofRise - 1;
  shellBox(acc, { x: 0, y: 0, z: 0 }, { x: w - 1, y: wallTop, z: d - 1 }, palette, "main");
  const bay = plan.structuralFrame.bayWidth;
  for (let x = 0; x < w; x += bay) for (const z of [0, d - 1]) for (let y = 2; y <= wallTop; y += 1) acc.put(x, y, z, palette.frame, "frame", { axis: "y" });
  for (let level = 0; level < roofRise; level += 1) {
    const y = wallTop + level;
    for (let z = 0; z < d; z += 1) {
      acc.put(level, y, z, palette.roof, "roof", { facing: "east", half: "bottom", shape: "straight", waterlogged: false });
      acc.put(w - 1 - level, y, z, palette.roof, "roof", { facing: "west", half: "bottom", shape: "straight", waterlogged: false });
    }
  }
  for (let z = 0; z < d; z += 1) acc.put(Math.floor(w / 2), h - 1, z, palette.roof, "roof ridge");
  const entranceX = Math.max(1, Math.min(w - 3, Math.floor(w * (0.32 + plan.massing.asymmetry * 0.35))));
  carveDoor(acc, entranceX, 0, "south", palette);
  for (let x = 2; x < w - 2; x += bay) for (const z of [0, d - 1]) for (let y = 3; y <= Math.min(4, wallTop - 1); y += 1) acc.put(x, y, z, palette.glazing, "openings");
  for (let x = 1; x < w - 1; x += 1) acc.put(x, 1, 0, palette.trim, "porch");
  acc.put(Math.max(1, w - 3), 3, 1, palette.lighting, "lighting", { hanging: false });
  return acc;
}

function generateJapanese(plan: ArchitecturalPlan, dimensions: Dimensions, origin: Vec3, palette: RolePalette) {
  const acc = createAccumulator(origin); const { width: w, depth: d, height: h } = dimensions; const inset = Math.min(plan.footprint.inset, Math.floor(Math.min(w, d) / 2) - 1);
  const wallTop = Math.max(4, h - Math.max(2, plan.roofGrammar.tiers * 2));
  for (let x = 0; x < w; x += 1) for (let z = 0; z < d; z += 1) {
    const courtyard = x >= inset && x < w - inset && z >= inset && z < d - inset;
    if (!courtyard) { acc.put(x, 0, z, palette.foundation, "foundation"); acc.put(x, 1, z, palette.wall, "floor"); }
    else acc.put(x, 0, z, palette.landscaping, "courtyard");
  }
  const boundaries = (x: number, z: number) => x === 0 || z === 0 || x === w - 1 || z === d - 1 || x === inset - 1 || z === inset - 1 || x === w - inset || z === d - inset;
  for (let y = 2; y <= wallTop; y += 1) for (let x = 0; x < w; x += 1) for (let z = 0; z < d; z += 1) {
    if (!boundaries(x, z)) continue;
    const post = (x % plan.structuralFrame.bayWidth === 0 || z % plan.structuralFrame.bayWidth === 0);
    acc.put(x, y, z, post ? palette.frame : (y >= plan.windows.sill && y < plan.windows.sill + plan.windows.height ? palette.glazing : palette.wall), post ? "post frame" : "screen walls", post ? { axis: "y" } : undefined);
  }
  for (let tier = 0; tier < plan.roofGrammar.tiers; tier += 1) {
    const y = Math.min(h - 1, wallTop + tier * 2);
    const edge = Math.min(tier, Math.floor(Math.min(w, d) / 4));
    for (let x = edge; x < w - edge; x += 1) for (let z = edge; z < d - edge; z += 1) {
      if (x <= edge + 1 || z <= edge + 1 || x >= w - edge - 2 || z >= d - edge - 2) {
        const distances = [
          { facing: "east", distance: x - edge },
          { facing: "west", distance: w - edge - 1 - x },
          { facing: "south", distance: z - edge },
          { facing: "north", distance: d - edge - 1 - z },
        ].sort((a, b) => a.distance - b.distance || a.facing.localeCompare(b.facing));
        acc.put(x, y, z, palette.roof, "tiered roof", { facing: distances[0].facing, half: "bottom", shape: "straight", waterlogged: false });
      }
    }
  }
  const doorX = Math.max(1, Math.min(w - 4, Math.floor(w * (0.35 + plan.massing.asymmetry * 0.25))));
  carveDoor(acc, doorX, 0, "south", palette, Math.min(2, w - doorX - 1));
  for (let x = inset; x < w - inset; x += 1) { acc.put(x, 1, inset - 1, palette.trim, "engawa"); acc.put(x, 1, d - inset, palette.trim, "engawa"); }
  return acc;
}

function generateModern(plan: ArchitecturalPlan, dimensions: Dimensions, origin: Vec3, palette: RolePalette) {
  const acc = createAccumulator(origin);
  for (const volume of plan.massing.volumes) shellBox(acc, volume.min, volume.max, palette, volume.id, true);
  for (const volume of plan.massing.volumes) {
    const y0 = Math.min(volume.max.y - 1, volume.min.y + 3); const y1 = Math.min(volume.max.y - 1, y0 + plan.windows.height - 1);
    for (let x = volume.min.x + 1; x < volume.max.x; x += 1) for (let y = y0; y <= y1; y += 1) acc.put(x, y, volume.min.z, palette.glazing, `${volume.id}: glazing`);
  }
  const entranceX = Math.max(1, Math.min(dimensions.width - 3, Math.floor(dimensions.width * plan.massing.asymmetry)));
  carveDoor(acc, entranceX, 0, "south", palette);
  return acc;
}

function generateTower(plan: ArchitecturalPlan, dimensions: Dimensions, origin: Vec3, palette: RolePalette) {
  const acc = createAccumulator(origin);
  for (const volume of plan.massing.volumes) shellBox(acc, volume.min, volume.max, palette, volume.id, true);
  const tower = plan.massing.volumes.find(({ id }) => id === "tower");
  if (tower) for (let x = tower.min.x; x <= tower.max.x; x += 2) for (const z of [tower.min.z, tower.max.z]) acc.put(x, tower.max.y, z, palette.accents, "battlements");
  carveDoor(acc, Math.max(1, Math.floor(dimensions.width * (0.25 + plan.massing.asymmetry * 0.2))), 0, "south", palette);
  return acc;
}

function generateFromPlan(plan: ArchitecturalPlan, dimensions: Dimensions, origin: Vec3, palette: RolePalette) {
  if (plan.footprint.kind === "courtyard") return generateJapanese(plan, dimensions, origin, palette);
  if (plan.footprint.kind === "interlocking") return generateModern(plan, dimensions, origin, palette);
  if (plan.footprint.kind === "tower") return generateTower(plan, dimensions, origin, palette);
  return generateNordic(plan, dimensions, origin, palette);
}

function structuralTokens(plan: ArchitecturalPlan) {
  return new Set([
    plan.program.buildingType, plan.footprint.kind, plan.roofGrammar.type, String(plan.roofGrammar.tiers),
    plan.circulation.primary, plan.circulation.vertical, plan.structuralFrame.system, String(plan.structuralFrame.bayWidth),
    ...plan.program.spaces, ...plan.details,
    ...plan.massing.volumes.map((v) => `${v.purpose}:${v.max.x - v.min.x}:${v.max.y - v.min.y}:${v.max.z - v.min.z}`),
  ]);
}

export function structuralSimilarity(a: ArchitecturalPlan, b: ArchitecturalPlan) {
  const aa = structuralTokens(a); const bb = structuralTokens(b);
  const intersection = [...aa].filter((token) => bb.has(token)).length;
  return intersection / Math.max(1, new Set([...aa, ...bb]).size);
}

function groupRegions(placements: Placement[], size: number) {
  const groups = new Map<string, Placement[]>();
  for (const placement of placements) {
    const rx = Math.floor(placement.x / size); const rz = Math.floor(placement.z / size); const key = `${rx},${rz}`;
    const group = groups.get(key) ?? []; group.push(placement); groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const xs = group.map((p) => p.x); const ys = group.map((p) => p.y); const zs = group.map((p) => p.z);
    return { id: `region-${id}`, chunkMin: { x: Math.floor(Math.min(...xs) / 16), z: Math.floor(Math.min(...zs) / 16) }, chunkMax: { x: Math.floor(Math.max(...xs) / 16), z: Math.floor(Math.max(...zs) / 16) }, bounds: { min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) }, max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) } }, placementCount: group.length };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function calculateBounds(placements: Placement[]) {
  const xs = placements.map((p) => p.x);
  const ys = placements.map((p) => p.y);
  const zs = placements.map((p) => p.z);
  const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) };
  const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };
  return {
    min,
    max,
    dimensions: { width: max.x - min.x + 1, depth: max.z - min.z + 1, height: max.y - min.y + 1 },
  };
}

function stableBuildPayload(input: Required<BuildInput>, placements: Placement[]) {
  const { confirmationToken: _confirmationToken, ...designInput } = input;
  return JSON.stringify({
    input: designInput,
    placements: placements.map(({ x, y, z, block, phase, state }) => ({ x, y, z, block, phase, ...(state ? { state } : {}) })),
  });
}

function completePlacementStates(placements: Placement[]) {
  const keyOf = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
  const map = new Map(placements.map((placement) => [keyOf(placement), placement]));
  const connected = (placement: Placement, dx: number, dz: number) => map.has(`${placement.x + dx},${placement.y},${placement.z + dz}`);
  return placements.map((placement) => {
    const state = { ...(placement.state ?? {}) };
    if (placement.block.endsWith("_stairs")) Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "bottom", shape: state.shape ?? "straight", waterlogged: state.waterlogged ?? false });
    if (placement.block.endsWith("_slab")) Object.assign(state, { type: state.type ?? "bottom", waterlogged: state.waterlogged ?? false });
    if (placement.block.endsWith("_trapdoor")) Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "bottom", open: state.open ?? false, powered: state.powered ?? false, waterlogged: state.waterlogged ?? false });
    if (placement.block.endsWith("_door") && !placement.block.endsWith("_trapdoor")) Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "lower", hinge: state.hinge ?? "left", open: state.open ?? false, powered: state.powered ?? false });
    if (/(^|:)lantern$|soul_lantern$/.test(placement.block)) Object.assign(state, { hanging: state.hanging ?? false, waterlogged: state.waterlogged ?? false });
    if (/glass_pane|iron_bars/.test(placement.block)) Object.assign(state, { north: connected(placement, 0, -1), south: connected(placement, 0, 1), west: connected(placement, -1, 0), east: connected(placement, 1, 0), waterlogged: state.waterlogged ?? false });
    if (/_fence$/.test(placement.block)) Object.assign(state, { north: connected(placement, 0, -1), south: connected(placement, 0, 1), west: connected(placement, -1, 0), east: connected(placement, 1, 0), waterlogged: state.waterlogged ?? false });
    if (/_wall$/.test(placement.block)) Object.assign(state, { north: connected(placement, 0, -1) ? "low" : "none", south: connected(placement, 0, 1) ? "low" : "none", west: connected(placement, -1, 0) ? "low" : "none", east: connected(placement, 1, 0) ? "low" : "none", up: state.up ?? true, waterlogged: state.waterlogged ?? false });
    return Object.keys(state).length ? { ...placement, state } : placement;
  });
}

export function compileBuild(rawInput: BuildInput): BuildRecord {
  const input = normalizeInput(rawInput);
  const preflight = estimateBuild(input);
  assertPreflightConfirmed(input, preflight);
  const paletteValidation = validatePaletteIdentifiers(input.edition, input.version, input.rolePalette);
  if (!paletteValidation.valid) throw new Error(`INVALID_BLOCK_IDENTIFIERS: ${paletteValidation.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
  const plan = createArchitecturalPlan(input);
  const acc = generateFromPlan(plan, input.dimensions, input.origin, input.rolePalette as RolePalette);
  const placements = completePlacementStates([...acc.map.values()]).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
  const materialCounts: Record<string, number> = {};
  const layerCounts: Record<string, number> = {};
  const phaseCounts: Record<string, number> = {};
  for (const placement of placements) {
    materialCounts[placement.block] = (materialCounts[placement.block] ?? 0) + 1;
    layerCounts[String(placement.y)] = (layerCounts[String(placement.y)] ?? 0) + 1;
    phaseCounts[placement.phase] = (phaseCounts[placement.phase] ?? 0) + 1;
  }
  const hash = createHash("sha256").update(stableBuildPayload(input, placements)).digest("hex");
  const overBudget = placements.length > input.blockBudget;
  const issues = overBudget
    ? [{ code: "BLOCK_BUDGET_EXCEEDED", severity: "error" as const, message: `${placements.length.toLocaleString()} placements exceed the ${input.blockBudget.toLocaleString()} block budget.` }]
    : [];
  const staticRegistry = REGISTRY_META[input.edition];
  const exactJavaRegistry = input.edition === "java" ? registryMetadata(input.version) : undefined;
  const coverageGap = input.edition === "java" && !exactJavaRegistry
    ? `Java ${input.version} is not synchronized locally. Available fallback coverage is ${staticRegistry.coverageVersion}; run check_java_updates and sync_java_version before relying on identifiers added after that coverage.`
    : input.version !== staticRegistry.coverageVersion
      ? `Requested ${input.edition} ${input.version}; packaged coverage is ${staticRegistry.coverageVersion}.`
      : undefined;
  const registry = exactJavaRegistry ?? { ...staticRegistry, ...(coverageGap ? { note: coverageGap } : {}) };
  return {
    schemaVersion: 2,
    id: `bw_${hash.slice(0, 12)}`,
    hash,
    input,
    plan,
    preflight,
    structuralFingerprint: plan.fingerprint,
    bounds: calculateBounds(placements),
    placements,
    regions: groupRegions(placements, preflight.regionSize),
    materialCounts,
    layerCounts,
    phases: Object.entries(phaseCounts).map(([name, count]) => ({ name, count })),
    validation: {
      valid: !overBudget,
      blockingIssues: overBudget ? 1 : 0,
      warnings: coverageGap ? 1 : 0,
      issues: coverageGap ? [...issues, { code: "REGISTRY_COVERAGE_GAP", severity: "warning", message: coverageGap }] : issues,
      attemptedCollisions: acc.attemptedCollisions,
    },
    registry: { edition: input.edition, ...registry },
    createdAt: "deterministic",
  };
}

export function generateBuildCandidates(rawInput: BuildInput, count = 3, recentPlans: ArchitecturalPlan[] = []) {
  const target = Math.max(1, Math.min(5, Math.round(count)));
  const baseSeed = rawInput.seed?.trim() || createHash("sha256").update(`${rawInput.name}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12);
  const builds: BuildRecord[] = [];
  for (let attempt = 0; attempt < target * 12 && builds.length < target; attempt += 1) {
    const seed = attempt === 0 ? baseSeed : `${baseSeed}-${attempt}`;
    const candidate = compileBuild({ ...rawInput, seed });
    const compared = [...recentPlans, ...builds.map(({ plan }) => plan)];
    const maximumSimilarity = compared.length ? Math.max(...compared.map((plan) => structuralSimilarity(candidate.plan, plan))) : 0;
    if (maximumSimilarity < 0.82 || attempt >= target * 8) builds.push(candidate);
  }
  return builds.map((build, index) => ({ build, candidate: index + 1, maximumSimilarity: Math.max(0, ...[...recentPlans, ...builds.filter((other) => other !== build).map(({ plan }) => plan)].map((plan) => structuralSimilarity(build.plan, plan))) }));
}

export function summarizeBuild(build: BuildRecord) {
  const { placements: _placements, ...summary } = build;
  return { ...summary, blockCount: build.placements.length };
}
