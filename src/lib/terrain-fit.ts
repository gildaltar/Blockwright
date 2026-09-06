import { createHash } from "node:crypto";
import type { BuildRecord, Placement, Vec3, WorldRegion } from "./types.js";

export const TERRAIN_INTERFACE_STRATEGIES = [
  "flat_pad",
  "raised_foundation",
  "natural_slope",
  "terraced",
  "retaining_wall",
  "stilts",
  "sunken",
  "cliff_embedded",
  "waterfront",
  "bridge_span",
] as const;

export type TerrainInterfaceStrategy = (typeof TERRAIN_INTERFACE_STRATEGIES)[number];
export type TerrainWaterPolicy = "preserve" | "bridge" | "culvert" | "retain" | "redirect";
export type TerrainRotation = 0 | 90 | 180 | 270;

export type TerrainInterface = {
  strategy: TerrainInterfaceStrategy;
  maxCutDepth: number;
  maxFillHeight: number;
  allowRetainingWalls: boolean;
  allowTerraces: boolean;
  blendRadius: number;
  innerBlendRadius?: number;
  waterPolicy?: TerrainWaterPolicy;
};

export type TerrainProtectedRegion = {
  id?: string;
  name?: string;
  bounds: { min: Vec3; max: Vec3 };
  reason?: string;
};

export type TerrainWorldRegion = WorldRegion & {
  surfaceBlocks?: string[][];
  subsurfaceBlocks?: string[][][];
  waterCoordinates?: Vec3[];
  vegetationCoordinates?: Vec3[];
  pathCoordinates?: Vec3[];
  protectedRegions?: TerrainProtectedRegion[];
};

export type TerrainFitBuild = Pick<BuildRecord, "id" | "hash" | "bounds" | "placements"> & {
  input: Pick<BuildRecord["input"], "edition" | "version" | "origin" | "style" | "seed">;
  plan?: Pick<BuildRecord["plan"], "entrances">;
};

export type TerrainFitOptions = {
  terrainInterface: TerrainInterface;
  targetAnchor?: Vec3;
  /** Keep the supplied target Y exact instead of allowing the solver to grade at a lower-impact elevation. */
  lockTargetY?: boolean;
  maximumHorizontalOffset?: number;
  rotations?: TerrainRotation[];
  allowMirror?: boolean;
  maximumCandidates?: number;
  maximumFootprintColumns?: number;
  retainingThreshold?: number;
  pathSearchLimit?: number;
};

export type TerrainCandidateScore = {
  excavation: number;
  fill: number;
  terrainDisturbance: number;
  foundationExposure: number;
  buriedGeometry: number;
  slopeCompatibility: number;
  waterConflicts: number;
  protectedConflicts: number;
  structureConflicts: number;
  pathAlignment: number;
  cutLimitViolations: number;
  fillLimitViolations: number;
  total: number;
};

export type TerrainFitCandidate = {
  id: string;
  anchor: Vec3;
  rotation: TerrainRotation;
  mirrorX: boolean;
  footprint: { width: number; depth: number; height: number };
  yAdjustment: number;
  score: TerrainCandidateScore;
};

export type TerrainColumnDelta = {
  x: number;
  z: number;
  existingHeight: number;
  desiredHeight: number;
  delta: number;
  zone: "footprint" | "inner" | "outer";
  biome: string;
  surfaceBlock: string;
};

export type TerrainRetainingColumn = {
  x: number;
  z: number;
  fromY: number;
  toY: number;
  side: "north" | "south" | "east" | "west" | "interior";
};

export type TerrainPathConnection = {
  from: Vec3;
  to: Vec3;
  points: Vec3[];
  length: number;
  crossesWater: number;
  status: "connected" | "blocked" | "not_requested";
};

export type TerrainOperation =
  | {
      op: "grade_surface";
      bounds: { min: Vec3; max: Vec3 };
      columns: TerrainColumnDelta[];
      strataByBiome: Record<string, string[]>;
      sampledNativeMaterials: Array<{ block: string; count: number }>;
    }
  | {
      op: "retaining_structure";
      style: string;
      material: string;
      accentMaterial?: string;
      columns: TerrainRetainingColumn[];
    }
  | {
      op: "connect_path";
      material: string;
      width: number;
      points: Vec3[];
      waterPolicy: TerrainWaterPolicy;
    }
  | {
      op: "water_interface";
      policy: TerrainWaterPolicy;
      coordinates: Vec3[];
    }
  | {
      op: "restore_vegetation";
      seed: string;
      density: number;
      palette: string[];
      bounds: { min: Vec3; max: Vec3 };
    };

export type TerrainFitPreview = {
  schemaVersion: 1;
  id: string;
  hash: string;
  buildId: string;
  buildHash: string;
  regionHash: string;
  status: "preview";
  selected: TerrainFitCandidate;
  candidates: TerrainFitCandidate[];
  interface: TerrainInterface;
  cutVolume: number;
  fillVolume: number;
  changedTerrainArea: number;
  maximumCutDepth: number;
  maximumFillHeight: number;
  blendZones: { footprintColumns: number; innerColumns: number; outerColumns: number };
  retainingWalls: { required: boolean; columns: number };
  pathConnection: TerrainPathConnection;
  waterConflicts: Vec3[];
  protectedConflicts: Vec3[];
  structureConflicts: string[];
  sampledNativeMaterials: Array<{ block: string; count: number }>;
  sampledBiomes: Array<{ biome: string; count: number }>;
  operations: TerrainOperation[];
  risk: "green" | "amber" | "red";
  warnings: string[];
};

export type ConfirmedTerrainPlan = {
  schemaVersion: 1;
  previewId: string;
  previewHash: string;
  buildId: string;
  buildHash: string;
  status: "confirmed";
  transform: { anchor: Vec3; rotation: TerrainRotation; mirrorX: boolean; yAdjustment: number };
  operations: TerrainOperation[];
  installationBoundary: "procedural_plan_only";
};

type RegionGrid = {
  heights: number[][];
  biomes: string[][];
  surfaces: string[][];
  subsurface?: string[][][];
  water: Set<string>;
  vegetation: Set<string>;
  paths: Set<string>;
  protected: Vec3[];
  protectedRegions: TerrainProtectedRegion[];
  structures: NonNullable<WorldRegion["structures"]>;
};

const DEFAULT_INTERFACE: TerrainInterface = {
  strategy: "raised_foundation",
  maxCutDepth: 3,
  maxFillHeight: 5,
  allowRetainingWalls: true,
  allowTerraces: true,
  blendRadius: 18,
  waterPolicy: "preserve",
};

const key2 = (x: number, z: number) => `${x},${z}`;
const key3 = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const isAir = (block: string) => /(^|:)air$/.test(block);
const isWater = (block: string) => /(^|:)(water|flowing_water)$|kelp|seagrass/.test(block);
const isPath = (block: string) => /dirt_path|gravel|path|road/.test(block);
const isVegetation = (block: string) => /leaves|log|flower|grass|fern|sapling|vine|mushroom|bush/.test(block);
const isSensitive = (placement: Placement) => Boolean(placement.blockEntity)
  || /redstone|repeater|comparator|observer|piston|chest|barrel|shulker|hopper|dispenser|dropper|spawner|beacon/.test(placement.block);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`TERRAIN_FIT_INVALID: ${label} must be an integer.`);
}

function normalizedInterface(input: TerrainInterface): TerrainInterface {
  if (!TERRAIN_INTERFACE_STRATEGIES.includes(input.strategy)) throw new Error(`TERRAIN_FIT_INVALID: unsupported strategy ${String(input.strategy)}.`);
  const maxCutDepth = Math.max(0, Math.round(input.maxCutDepth));
  const maxFillHeight = Math.max(0, Math.round(input.maxFillHeight));
  const blendRadius = Math.max(0, Math.min(128, Math.round(input.blendRadius)));
  const innerBlendRadius = Math.max(0, Math.min(blendRadius, Math.round(input.innerBlendRadius ?? Math.ceil(blendRadius / 3))));
  return {
    ...DEFAULT_INTERFACE,
    ...input,
    maxCutDepth,
    maxFillHeight,
    blendRadius,
    innerBlendRadius,
    waterPolicy: input.waterPolicy ?? "preserve",
  };
}

function validateMatrix<T>(matrix: T[][], width: number, depth: number, label: string) {
  if (matrix.length !== depth || matrix.some((row) => row.length !== width)) {
    throw new Error(`TERRAIN_FIT_INVALID: ${label} must contain ${depth} rows of ${width} values.`);
  }
}

function regionBounds(region: WorldRegion) {
  return {
    min: { ...region.origin },
    max: {
      x: region.origin.x + region.dimensions.width - 1,
      y: region.origin.y + region.dimensions.height - 1,
      z: region.origin.z + region.dimensions.depth - 1,
    },
  };
}

function insideBounds(point: Vec3, bounds: { min: Vec3; max: Vec3 }) {
  return point.x >= bounds.min.x && point.x <= bounds.max.x
    && point.y >= bounds.min.y && point.y <= bounds.max.y
    && point.z >= bounds.min.z && point.z <= bounds.max.z;
}

function boxesOverlap(left: { min: Vec3; max: Vec3 }, right: { min: Vec3; max: Vec3 }) {
  return left.min.x <= right.max.x && left.max.x >= right.min.x
    && left.min.y <= right.max.y && left.max.y >= right.min.y
    && left.min.z <= right.max.z && left.max.z >= right.min.z;
}

function createRegionGrid(region: TerrainWorldRegion): RegionGrid {
  const { width, depth } = region.dimensions;
  if (width * depth > 1_048_576) throw new Error("TERRAIN_FIT_LIMIT: world-region analysis is limited to 1,048,576 columns.");
  const bounds = regionBounds(region);
  const heights = Array.from({ length: depth }, () => Array.from({ length: width }, () => region.origin.y - 1));
  const surfaces = Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:grass_block"));
  const topByColumn = new Map<string, Placement>();
  for (const placement of region.blocks ?? []) {
    if (!insideBounds(placement, bounds) || isAir(placement.block)) continue;
    const x = placement.x - region.origin.x;
    const z = placement.z - region.origin.z;
    const key = key2(x, z);
    const current = topByColumn.get(key);
    if (!current || current.y < placement.y) topByColumn.set(key, placement);
  }
  for (const placement of topByColumn.values()) {
    const x = placement.x - region.origin.x;
    const z = placement.z - region.origin.z;
    heights[z][x] = placement.y;
    surfaces[z][x] = placement.block;
  }
  if (region.heightMap) {
    validateMatrix(region.heightMap, width, depth, "heightMap");
    for (let z = 0; z < depth; z += 1) for (let x = 0; x < width; x += 1) {
      assertSafeInteger(region.heightMap[z][x], `heightMap[${z}][${x}]`);
      heights[z][x] = region.heightMap[z][x];
    }
  }
  if (region.surfaceBlocks) {
    validateMatrix(region.surfaceBlocks, width, depth, "surfaceBlocks");
    for (let z = 0; z < depth; z += 1) for (let x = 0; x < width; x += 1) surfaces[z][x] = region.surfaceBlocks[z][x];
  }
  if (region.subsurfaceBlocks) validateMatrix(region.subsurfaceBlocks, width, depth, "subsurfaceBlocks");
  const biomes = region.biomeMap
    ? region.biomeMap.map((row) => [...row])
    : Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:plains"));
  validateMatrix(biomes, width, depth, "biomeMap");

  const water = new Set<string>();
  const vegetation = new Set<string>();
  const paths = new Set<string>();
  for (const placement of region.blocks ?? []) {
    const column = key2(placement.x, placement.z);
    if (isWater(placement.block)) water.add(column);
    if (isVegetation(placement.block)) vegetation.add(column);
    if (isPath(placement.block)) paths.add(column);
  }
  for (const point of region.waterCoordinates ?? []) water.add(key2(point.x, point.z));
  for (const point of region.vegetationCoordinates ?? []) vegetation.add(key2(point.x, point.z));
  for (const point of region.pathCoordinates ?? []) paths.add(key2(point.x, point.z));
  const protectedCoordinates = [...(region.protectedCoordinates ?? [])];
  for (const placement of region.blocks ?? []) if (isSensitive(placement)) protectedCoordinates.push({ x: placement.x, y: placement.y, z: placement.z });
  return {
    heights,
    biomes,
    surfaces,
    subsurface: region.subsurfaceBlocks?.map((row) => row.map((column) => [...column])),
    water,
    vegetation,
    paths,
    protected: [...new Map(protectedCoordinates.map((point) => [key3(point), point])).values()],
    protectedRegions: region.protectedRegions ?? [],
    structures: region.structures ?? [],
  };
}

function matrixValue<T>(matrix: T[][], region: WorldRegion, x: number, z: number) {
  return matrix[z - region.origin.z]?.[x - region.origin.x];
}

function rotatedFootprint(width: number, depth: number, rotation: TerrainRotation) {
  return rotation === 90 || rotation === 270 ? { width: depth, depth: width } : { width, depth };
}

function transformColumn(localX: number, localZ: number, width: number, depth: number, rotation: TerrainRotation, mirrorX: boolean) {
  const x = mirrorX ? width - 1 - localX : localX;
  if (rotation === 90) return { x: depth - 1 - localZ, z: x };
  if (rotation === 180) return { x: width - 1 - x, z: depth - 1 - localZ };
  if (rotation === 270) return { x: localZ, z: width - 1 - x };
  return { x, z: localZ };
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) / 2)] ?? 0;
}

function candidateOffsets(maximum: number) {
  const limit = Math.max(0, Math.min(32, Math.round(maximum)));
  if (!limit) return [{ x: 0, z: 0 }];
  const step = Math.max(1, Math.ceil(limit / 2));
  const values = [...new Set([0, -step, step, -limit, limit])];
  return values.flatMap((x) => values.map((z) => ({ x, z })))
    .sort((a, b) => Math.abs(a.x) + Math.abs(a.z) - Math.abs(b.x) - Math.abs(b.z) || a.z - b.z || a.x - b.x);
}

function candidateBaseY(strategy: TerrainInterfaceStrategy, heights: number[]) {
  const middle = median(heights);
  const maximum = Math.max(...heights);
  const minimum = Math.min(...heights);
  if (strategy === "raised_foundation") return middle + 2;
  if (strategy === "stilts" || strategy === "bridge_span") return maximum + 2;
  if (strategy === "sunken") return Math.max(minimum + 1, middle);
  if (strategy === "cliff_embedded") return Math.max(minimum + 1, middle);
  return middle + 1;
}

function candidateId(anchor: Vec3, rotation: TerrainRotation, mirrorX: boolean) {
  return `candidate_${digest({ anchor, rotation, mirrorX }).slice(0, 12)}`;
}

function nearestPathDistance(grid: RegionGrid, x: number, z: number) {
  if (!grid.paths.size) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const value of grid.paths) {
    const [pathX, pathZ] = value.split(",").map(Number);
    distance = Math.min(distance, Math.abs(pathX - x) + Math.abs(pathZ - z));
  }
  return Number.isFinite(distance) ? distance : 0;
}

function evaluateCandidate(
  build: TerrainFitBuild,
  region: TerrainWorldRegion,
  grid: RegionGrid,
  terrainInterface: TerrainInterface,
  anchor: Vec3,
  rotation: TerrainRotation,
  mirrorX: boolean,
): TerrainFitCandidate | undefined {
  const sourceWidth = build.bounds.dimensions.width;
  const sourceDepth = build.bounds.dimensions.depth;
  const rotated = rotatedFootprint(sourceWidth, sourceDepth, rotation);
  const footprintHeights: number[] = [];
  const columns: Array<{ x: number; z: number; height: number }> = [];
  for (let localZ = 0; localZ < sourceDepth; localZ += 1) for (let localX = 0; localX < sourceWidth; localX += 1) {
    const transformed = transformColumn(localX, localZ, sourceWidth, sourceDepth, rotation, mirrorX);
    const worldX = anchor.x + transformed.x;
    const worldZ = anchor.z + transformed.z;
    const height = matrixValue(grid.heights, region, worldX, worldZ);
    if (height === undefined) return undefined;
    footprintHeights.push(height);
    columns.push({ x: worldX, z: worldZ, height });
  }
  const baseY = anchor.y;
  const desiredGround = baseY - 1;
  let excavation = 0;
  let fill = 0;
  let disturbance = 0;
  let foundationExposure = 0;
  let buriedGeometry = 0;
  let waterConflicts = 0;
  let protectedConflicts = 0;
  let cutLimitViolations = 0;
  let fillLimitViolations = 0;
  let maximumCut = 0;
  let maximumFill = 0;
  for (const column of columns) {
    const delta = desiredGround - column.height;
    if (delta !== 0) disturbance += 1;
    if (delta < 0) {
      excavation += -delta;
      buriedGeometry += 1;
      maximumCut = Math.max(maximumCut, -delta);
      if (-delta > terrainInterface.maxCutDepth) cutLimitViolations += 1;
    } else if (delta > 0) {
      fill += delta;
      foundationExposure += 1;
      maximumFill = Math.max(maximumFill, delta);
      if (delta > terrainInterface.maxFillHeight) fillLimitViolations += 1;
    }
    if (grid.water.has(key2(column.x, column.z)) && !["waterfront", "bridge_span"].includes(terrainInterface.strategy)) waterConflicts += 1;
  }
  const candidateBounds = {
    min: { x: anchor.x, y: baseY, z: anchor.z },
    max: { x: anchor.x + rotated.width - 1, y: baseY + build.bounds.dimensions.height - 1, z: anchor.z + rotated.depth - 1 },
  };
  for (const point of grid.protected) if (insideBounds(point, candidateBounds)) protectedConflicts += 1;
  for (const item of grid.protectedRegions) if (boxesOverlap(candidateBounds, item.bounds)) protectedConflicts += 1;
  const structureConflicts = grid.structures.filter((structure) => boxesOverlap(candidateBounds, structure.bounds)).length;
  const entranceX = anchor.x + Math.floor(rotated.width / 2);
  const entranceZ = anchor.z + rotated.depth - 1;
  const pathAlignment = nearestPathDistance(grid, entranceX, entranceZ);
  const slopeCompatibility = Math.max(...footprintHeights) - Math.min(...footprintHeights);
  const total = excavation
    + fill * 0.9
    + disturbance * 2
    + foundationExposure * 0.5
    + buriedGeometry
    + slopeCompatibility * 10
    + waterConflicts * 40
    + protectedConflicts * 10_000
    + structureConflicts * 5_000
    + pathAlignment * 0.25
    + (cutLimitViolations + fillLimitViolations) * 500
    + maximumCut * 0.1
    + maximumFill * 0.1;
  const actualAnchor = { ...anchor, y: baseY };
  return {
    id: candidateId(actualAnchor, rotation, mirrorX),
    anchor: actualAnchor,
    rotation,
    mirrorX,
    footprint: { ...rotated, height: build.bounds.dimensions.height },
    yAdjustment: baseY - build.bounds.min.y,
    score: {
      excavation,
      fill,
      terrainDisturbance: disturbance,
      foundationExposure,
      buriedGeometry,
      slopeCompatibility,
      waterConflicts,
      protectedConflicts,
      structureConflicts,
      pathAlignment,
      cutLimitViolations,
      fillLimitViolations,
      total: Number(total.toFixed(3)),
    },
  };
}

function distanceToRectangle(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number) {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

function smoothstep(value: number) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function regularization(seed: string, x: number, z: number) {
  const value = Number.parseInt(digest(`${seed}:${x}:${z}`).slice(0, 8), 16) / 0xffff_ffff;
  return value - 0.5;
}

function strataForBiome(biome: string, observedColumns: string[][] = []) {
  const maximumObservedDepth = Math.min(16, Math.max(0, ...observedColumns.map((column) => column.length)));
  if (maximumObservedDepth) {
    const consensus: string[] = [];
    for (let depth = 0; depth < maximumObservedDepth; depth += 1) {
      const layer = observedColumns.map((column) => column[depth]).filter((block): block is string => Boolean(block) && !isAir(block));
      const mostCommon = materialCounts(layer)[0]?.block;
      if (mostCommon) consensus.push(mostCommon);
    }
    if (consensus.length) return consensus;
  }
  if (/desert|badlands/.test(biome)) return ["minecraft:sand", "minecraft:sand", "minecraft:sandstone", "minecraft:stone"];
  if (/taiga|old_growth|snow/.test(biome)) return ["minecraft:podzol", "minecraft:dirt", "minecraft:stone"];
  if (/swamp|mangrove/.test(biome)) return ["minecraft:mud", "minecraft:mud", "minecraft:clay", "minecraft:stone"];
  if (/beach|ocean/.test(biome)) return ["minecraft:sand", "minecraft:sandstone", "minecraft:stone"];
  return ["minecraft:grass_block", "minecraft:dirt", "minecraft:dirt", "minecraft:stone"];
}

function materialCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([block, count]) => ({ block, count })).sort((a, b) => b.count - a.count || a.block.localeCompare(b.block));
}

function biomeCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([biome, count]) => ({ biome, count })).sort((a, b) => b.count - a.count || a.biome.localeCompare(b.biome));
}

function retainingPalette(style: string) {
  if (/japan|temple|pagoda/.test(style)) return { material: "minecraft:stone_bricks", accentMaterial: "minecraft:mossy_stone_bricks" };
  if (/modern|brutalist/.test(style)) return { material: "minecraft:smooth_stone", accentMaterial: "minecraft:gray_concrete" };
  return { material: "minecraft:cobblestone", accentMaterial: "minecraft:mossy_cobblestone" };
}

function pointSide(x: number, z: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): TerrainRetainingColumn["side"] {
  if (z === bounds.minZ) return "north";
  if (z === bounds.maxZ) return "south";
  if (x === bounds.minX) return "west";
  if (x === bounds.maxX) return "east";
  return "interior";
}

function routeToPath(
  region: TerrainWorldRegion,
  grid: RegionGrid,
  candidate: TerrainFitCandidate,
  waterPolicy: TerrainWaterPolicy,
  searchLimit: number,
): TerrainPathConnection {
  if (!grid.paths.size) {
    const start = {
      x: candidate.anchor.x + Math.floor(candidate.footprint.width / 2),
      y: candidate.anchor.y,
      z: candidate.anchor.z + candidate.footprint.depth - 1,
    };
    return { from: start, to: start, points: [], length: 0, crossesWater: 0, status: "not_requested" };
  }
  const start = {
    x: candidate.anchor.x + Math.floor(candidate.footprint.width / 2),
    z: candidate.anchor.z + candidate.footprint.depth - 1,
  };
  const queue = [start];
  const visited = new Set([key2(start.x, start.z)]);
  const parent = new Map<string, string>();
  let found: { x: number; z: number } | undefined;
  const maximum = Math.max(1, Math.min(250_000, Math.round(searchLimit)));
  while (queue.length && visited.size <= maximum) {
    const current = queue.shift()!;
    if (grid.paths.has(key2(current.x, current.z))) {
      found = current;
      break;
    }
    const currentHeight = matrixValue(grid.heights, region, current.x, current.z);
    for (const next of [
      { x: current.x + 1, z: current.z },
      { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 },
      { x: current.x, z: current.z - 1 },
    ]) {
      const nextKey = key2(next.x, next.z);
      if (visited.has(nextKey)) continue;
      const nextHeight = matrixValue(grid.heights, region, next.x, next.z);
      if (nextHeight === undefined || currentHeight === undefined || Math.abs(nextHeight - currentHeight) > 2) continue;
      if (waterPolicy === "preserve" && grid.water.has(nextKey)) continue;
      if (grid.protected.some((point) => point.x === next.x && point.z === next.z)) continue;
      if (grid.protectedRegions.some((item) => next.x >= item.bounds.min.x && next.x <= item.bounds.max.x && next.z >= item.bounds.min.z && next.z <= item.bounds.max.z)) continue;
      visited.add(nextKey);
      parent.set(nextKey, key2(current.x, current.z));
      queue.push(next);
    }
  }
  if (!found) {
    const from = { x: start.x, y: matrixValue(grid.heights, region, start.x, start.z) ?? candidate.anchor.y, z: start.z };
    return { from, to: from, points: [], length: 0, crossesWater: 0, status: "blocked" };
  }
  const reversed: Array<{ x: number; z: number }> = [];
  let cursor = key2(found.x, found.z);
  while (true) {
    const [x, z] = cursor.split(",").map(Number);
    reversed.push({ x, z });
    const previous = parent.get(cursor);
    if (!previous) break;
    cursor = previous;
  }
  const points = reversed.reverse().map(({ x, z }) => ({ x, y: (matrixValue(grid.heights, region, x, z) ?? candidate.anchor.y - 1) + 1, z }));
  return {
    from: points[0],
    to: points.at(-1)!,
    points,
    length: Math.max(0, points.length - 1),
    crossesWater: points.filter((point) => grid.water.has(key2(point.x, point.z))).length,
    status: "connected",
  };
}

function previewPayload(preview: Omit<TerrainFitPreview, "id" | "hash">) {
  return preview;
}

function terrainPreviewHash(preview: Omit<TerrainFitPreview, "id" | "hash">) {
  return digest(previewPayload(preview));
}

export function analyzeTerrainFit(build: TerrainFitBuild, region: TerrainWorldRegion, options: TerrainFitOptions): TerrainFitPreview {
  if (build.input.edition !== region.edition) throw new Error(`TERRAIN_FIT_EDITION_MISMATCH: build is ${build.input.edition}, region is ${region.edition}.`);
  if (build.input.version !== region.version) throw new Error(`TERRAIN_FIT_VERSION_MISMATCH: build is ${build.input.version}, region is ${region.version}.`);
  const terrainInterface = normalizedInterface(options.terrainInterface);
  const sourceColumns = build.bounds.dimensions.width * build.bounds.dimensions.depth;
  const maximumFootprintColumns = Math.max(1, Math.round(options.maximumFootprintColumns ?? 262_144));
  if (sourceColumns > maximumFootprintColumns) throw new Error(`TERRAIN_FIT_LIMIT: build footprint has ${sourceColumns.toLocaleString()} columns; limit is ${maximumFootprintColumns.toLocaleString()}.`);
  const grid = createRegionGrid(region);
  const regionHash = digest({
    edition: region.edition,
    version: region.version,
    origin: region.origin,
    dimensions: region.dimensions,
    heights: grid.heights,
    biomes: grid.biomes,
    surfaces: grid.surfaces,
    subsurface: grid.subsurface,
    water: [...grid.water].sort(),
    paths: [...grid.paths].sort(),
    protected: grid.protected,
    protectedRegions: grid.protectedRegions,
    structures: grid.structures,
  });
  const rotations = [...new Set(options.rotations?.length ? options.rotations : [0, 90, 180, 270])]
    .filter((rotation): rotation is TerrainRotation => [0, 90, 180, 270].includes(rotation));
  if (!rotations.length) throw new Error("TERRAIN_FIT_INVALID: at least one supported rotation is required.");
  const mirrors = options.allowMirror ? [false, true] : [false];
  const requested = options.targetAnchor ?? { ...build.bounds.min };
  const offsets = candidateOffsets(options.maximumHorizontalOffset ?? 4);
  const candidates: TerrainFitCandidate[] = [];
  const maximumCandidates = Math.max(1, Math.min(512, Math.round(options.maximumCandidates ?? 128)));
  candidateSearch:
  for (const offset of offsets) for (const rotation of rotations) for (const mirrorX of mirrors) {
    const rotated = rotatedFootprint(build.bounds.dimensions.width, build.bounds.dimensions.depth, rotation);
    const footprintHeights: number[] = [];
    for (let z = 0; z < rotated.depth; z += 1) for (let x = 0; x < rotated.width; x += 1) {
      const value = matrixValue(grid.heights, region, requested.x + offset.x + x, requested.z + offset.z + z);
      if (value !== undefined) footprintHeights.push(value);
    }
    if (footprintHeights.length !== rotated.width * rotated.depth) continue;
    const recommended = candidateBaseY(terrainInterface.strategy, footprintHeights);
    const yValues = options.lockTargetY
      ? [requested.y]
      : [...new Set([recommended, recommended - 1, recommended + 1, requested.y])].sort((a, b) => Math.abs(a - recommended) - Math.abs(b - recommended) || a - b);
    for (const y of yValues) {
      if (candidates.length >= maximumCandidates) break candidateSearch;
      const candidate = evaluateCandidate(build, region, grid, terrainInterface, { x: requested.x + offset.x, y, z: requested.z + offset.z }, rotation, mirrorX);
      if (candidate) candidates.push(candidate);
      if (candidates.length >= maximumCandidates) break candidateSearch;
    }
  }
  if (!candidates.length) throw new Error("TERRAIN_FIT_NO_CANDIDATE: no candidate footprint fits inside the supplied world region.");
  candidates.sort((a, b) => a.score.total - b.score.total || a.yAdjustment - b.yAdjustment || a.rotation - b.rotation || Number(a.mirrorX) - Number(b.mirrorX) || a.id.localeCompare(b.id));
  const selected = candidates[0];
  const footprintBounds = {
    minX: selected.anchor.x,
    maxX: selected.anchor.x + selected.footprint.width - 1,
    minZ: selected.anchor.z,
    maxZ: selected.anchor.z + selected.footprint.depth - 1,
  };
  const desiredGround = selected.anchor.y - 1;
  const deltas: TerrainColumnDelta[] = [];
  const retainingColumns: TerrainRetainingColumn[] = [];
  const sampledSurface: string[] = [];
  const sampledBiomeValues: string[] = [];
  const sampledSubsurfaceByBiome = new Map<string, string[][]>();
  let footprintColumns = 0;
  let innerColumns = 0;
  let outerColumns = 0;
  const retainingThreshold = Math.max(1, Math.round(options.retainingThreshold ?? Math.max(2, terrainInterface.maxFillHeight)));
  const regionMaxX = region.origin.x + region.dimensions.width - 1;
  const regionMaxZ = region.origin.z + region.dimensions.depth - 1;
  const scanMinX = Math.max(region.origin.x, footprintBounds.minX - terrainInterface.blendRadius);
  const scanMaxX = Math.min(regionMaxX, footprintBounds.maxX + terrainInterface.blendRadius);
  const scanMinZ = Math.max(region.origin.z, footprintBounds.minZ - terrainInterface.blendRadius);
  const scanMaxZ = Math.min(regionMaxZ, footprintBounds.maxZ + terrainInterface.blendRadius);
  for (let z = scanMinZ; z <= scanMaxZ; z += 1) for (let x = scanMinX; x <= scanMaxX; x += 1) {
    const distance = distanceToRectangle(x, z, footprintBounds.minX, footprintBounds.maxX, footprintBounds.minZ, footprintBounds.maxZ);
    if (distance > terrainInterface.blendRadius) continue;
    const current = matrixValue(grid.heights, region, x, z)!;
    const biome = matrixValue(grid.biomes, region, x, z)!;
    const surfaceBlock = matrixValue(grid.surfaces, region, x, z)!;
    const zone: TerrainColumnDelta["zone"] = distance === 0 ? "footprint" : distance <= (terrainInterface.innerBlendRadius ?? 0) ? "inner" : "outer";
    if (zone === "footprint") footprintColumns += 1;
    else if (zone === "inner") innerColumns += 1;
    else outerColumns += 1;
    if (zone === "outer" && distance >= Math.max(1, terrainInterface.blendRadius * 0.65)) {
      sampledSurface.push(surfaceBlock);
      sampledBiomeValues.push(biome);
      const subsurface = grid.subsurface?.[z - region.origin.z]?.[x - region.origin.x];
      if (subsurface?.length) {
        const columns = sampledSubsurfaceByBiome.get(biome) ?? [];
        columns.push(subsurface);
        sampledSubsurfaceByBiome.set(biome, columns);
        sampledSurface.push(...subsurface.filter((block) => !isAir(block)));
      }
    }
    let target = desiredGround;
    if (terrainInterface.strategy === "natural_slope" || terrainInterface.strategy === "stilts" || terrainInterface.strategy === "bridge_span" || terrainInterface.strategy === "waterfront") {
      target = zone === "footprint" ? current : Math.round(current + (desiredGround - current) * smoothstep(1 - distance / Math.max(1, terrainInterface.blendRadius)) * 0.3);
    } else if (terrainInterface.strategy === "terraced") {
      const terrace = Math.round((current - desiredGround) / 2) * 2;
      target = zone === "footprint" ? desiredGround + Math.max(-2, Math.min(2, terrace)) : Math.round(current + (desiredGround - current) * smoothstep(1 - distance / Math.max(1, terrainInterface.blendRadius)));
    } else if (distance > 0) {
      const influence = smoothstep(1 - distance / Math.max(1, terrainInterface.blendRadius));
      target = Math.round(current + (desiredGround - current) * influence + regularization(build.input.seed, x, z) * Math.min(0.8, influence));
    }
    const delta = target - current;
    if (!delta) continue;
    deltas.push({ x, z, existingHeight: current, desiredHeight: target, delta, zone, biome, surfaceBlock });
    if (zone === "footprint" && Math.abs(delta) >= retainingThreshold) {
      retainingColumns.push({
        x,
        z,
        fromY: Math.min(current, target) + 1,
        toY: Math.max(current, target),
        side: pointSide(x, z, footprintBounds),
      });
    }
  }
  const cutVolume = deltas.reduce((sum, item) => sum + Math.max(0, -item.delta), 0);
  const fillVolume = deltas.reduce((sum, item) => sum + Math.max(0, item.delta), 0);
  const maximumCutDepth = Math.max(0, ...deltas.map((item) => Math.max(0, -item.delta)));
  const maximumFillHeight = Math.max(0, ...deltas.map((item) => Math.max(0, item.delta)));
  const pathConnection = routeToPath(region, grid, selected, terrainInterface.waterPolicy ?? "preserve", options.pathSearchLimit ?? 100_000);
  const selectedBounds = {
    min: selected.anchor,
    max: {
      x: selected.anchor.x + selected.footprint.width - 1,
      y: selected.anchor.y + selected.footprint.height - 1,
      z: selected.anchor.z + selected.footprint.depth - 1,
    },
  };
  const protectedConflicts = grid.protected.filter((point) => insideBounds(point, selectedBounds));
  for (const protectedRegion of grid.protectedRegions) if (boxesOverlap(selectedBounds, protectedRegion.bounds)) protectedConflicts.push({ ...protectedRegion.bounds.min });
  const structureConflicts = grid.structures.filter((structure) => boxesOverlap(selectedBounds, structure.bounds)).map((structure) => structure.name).sort();
  const waterConflicts = [...grid.water]
    .map((value) => value.split(",").map(Number))
    .filter(([x, z]) => x >= footprintBounds.minX && x <= footprintBounds.maxX && z >= footprintBounds.minZ && z <= footprintBounds.maxZ)
    .slice(0, 500)
    .map(([x, z]) => ({ x, y: matrixValue(grid.heights, region, x, z) ?? selected.anchor.y - 1, z }));
  const sampledNativeMaterials = materialCounts(sampledSurface).slice(0, 12);
  const sampledBiomes = biomeCounts(sampledBiomeValues).slice(0, 12);
  const strataByBiome = Object.fromEntries([...new Set(deltas.map((item) => item.biome))].sort().map((biome) => [biome, strataForBiome(biome, sampledSubsurfaceByBiome.get(biome))]));
  const operations: TerrainOperation[] = [];
  if (deltas.length) {
    operations.push({
      op: "grade_surface",
      bounds: {
        min: { x: scanMinX, y: Math.min(...deltas.map((item) => Math.min(item.existingHeight, item.desiredHeight))), z: scanMinZ },
        max: { x: scanMaxX, y: Math.max(...deltas.map((item) => Math.max(item.existingHeight, item.desiredHeight))), z: scanMaxZ },
      },
      columns: deltas,
      strataByBiome,
      sampledNativeMaterials,
    });
  }
  if (retainingColumns.length && terrainInterface.allowRetainingWalls) operations.push({ op: "retaining_structure", style: build.input.style, ...retainingPalette(build.input.style), columns: retainingColumns });
  if (pathConnection.status === "connected") operations.push({
    op: "connect_path",
    material: sampledNativeMaterials.find(({ block }) => isPath(block))?.block ?? "minecraft:dirt_path",
    width: 3,
    points: pathConnection.points,
    waterPolicy: terrainInterface.waterPolicy ?? "preserve",
  });
  if (waterConflicts.length) operations.push({ op: "water_interface", policy: terrainInterface.waterPolicy ?? "preserve", coordinates: waterConflicts });
  const outsideColumns = Math.max(1, outerColumns);
  const vegetationDensity = Math.min(1, [...grid.vegetation].filter((value) => {
    const [x, z] = value.split(",").map(Number);
    return x >= scanMinX && x <= scanMaxX && z >= scanMinZ && z <= scanMaxZ;
  }).length / outsideColumns);
  if (deltas.length && vegetationDensity > 0) operations.push({
    op: "restore_vegetation",
    seed: `${build.input.seed}:terrain-vegetation`,
    density: Number(vegetationDensity.toFixed(4)),
    palette: ["minecraft:grass", "minecraft:dandelion", "minecraft:oak_sapling"],
    bounds: { min: { x: scanMinX, y: desiredGround + 1, z: scanMinZ }, max: { x: scanMaxX, y: desiredGround + 1, z: scanMaxZ } },
  });
  const warnings: string[] = [];
  if (maximumCutDepth > terrainInterface.maxCutDepth) warnings.push(`Maximum cut depth ${maximumCutDepth} exceeds the configured limit ${terrainInterface.maxCutDepth}.`);
  if (maximumFillHeight > terrainInterface.maxFillHeight) warnings.push(`Maximum fill height ${maximumFillHeight} exceeds the configured limit ${terrainInterface.maxFillHeight}.`);
  if (protectedConflicts.length) warnings.push(`${protectedConflicts.length} protected conflict(s) remain at the selected placement.`);
  if (structureConflicts.length) warnings.push(`${structureConflicts.length} existing structure conflict(s) remain at the selected placement.`);
  if (waterConflicts.length && terrainInterface.waterPolicy === "preserve") warnings.push(`${waterConflicts.length} water column(s) intersect the footprint and must be preserved or the placement changed.`);
  if (pathConnection.status === "blocked") warnings.push("A nearby path exists, but no bounded route avoids protected terrain, water policy, and steep steps.");
  if (retainingColumns.length && !terrainInterface.allowRetainingWalls) warnings.push("Retaining support is required but disabled.");
  const risk: TerrainFitPreview["risk"] = protectedConflicts.length || structureConflicts.length
    || (waterConflicts.length > 0 && terrainInterface.waterPolicy === "preserve")
    || maximumCutDepth > terrainInterface.maxCutDepth
    || maximumFillHeight > terrainInterface.maxFillHeight
    || (retainingColumns.length > 0 && !terrainInterface.allowRetainingWalls)
    ? "red"
    : retainingColumns.length || cutVolume + fillVolume > footprintColumns * 2 || pathConnection.status === "blocked"
      ? "amber"
      : "green";
  const unsigned: Omit<TerrainFitPreview, "id" | "hash"> = {
    schemaVersion: 1,
    buildId: build.id,
    buildHash: build.hash,
    regionHash,
    status: "preview",
    selected,
    candidates: candidates.slice(0, 12),
    interface: terrainInterface,
    cutVolume,
    fillVolume,
    changedTerrainArea: deltas.length,
    maximumCutDepth,
    maximumFillHeight,
    blendZones: { footprintColumns, innerColumns, outerColumns },
    retainingWalls: { required: retainingColumns.length > 0, columns: retainingColumns.length },
    pathConnection,
    waterConflicts,
    protectedConflicts,
    structureConflicts,
    sampledNativeMaterials,
    sampledBiomes,
    operations,
    risk,
    warnings,
  };
  const hash = terrainPreviewHash(unsigned);
  return { ...unsigned, id: `tfp_${hash.slice(0, 24)}`, hash };
}

export function verifyTerrainFitPreview(preview: TerrainFitPreview) {
  const { id, hash, ...unsigned } = preview;
  const expected = terrainPreviewHash(unsigned);
  if (hash !== expected || id !== `tfp_${expected.slice(0, 24)}`) {
    throw new Error("TERRAIN_FIT_PREVIEW_INTEGRITY: preview content no longer matches its immutable hash.");
  }
  return true;
}

export function confirmTerrainFitPreview(preview: TerrainFitPreview, confirmationHash: string): ConfirmedTerrainPlan {
  verifyTerrainFitPreview(preview);
  if (confirmationHash !== preview.hash) throw new Error("TERRAIN_FIT_CONFIRMATION_MISMATCH: confirmation must name the exact immutable preview hash.");
  if (preview.risk === "red") throw new Error("TERRAIN_FIT_BLOCKED: red-risk previews cannot be confirmed until their conflicts or configured limits are resolved.");
  return {
    schemaVersion: 1,
    previewId: preview.id,
    previewHash: preview.hash,
    buildId: preview.buildId,
    buildHash: preview.buildHash,
    status: "confirmed",
    transform: {
      anchor: { ...preview.selected.anchor },
      rotation: preview.selected.rotation,
      mirrorX: preview.selected.mirrorX,
      yAdjustment: preview.selected.yAdjustment,
    },
    operations: structuredClone(preview.operations),
    installationBoundary: "procedural_plan_only",
  };
}
