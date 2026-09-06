import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInitialBuildPlacementPage } from "../src/lib/build-view-paging.js";
import { ComponentCache } from "../src/lib/component-cache.js";
import { compileBuild, planBuildInput } from "../src/lib/compiler.js";
import type { ComponentOperationCacheEntry } from "../src/lib/design-kernel.js";
import { auditBuild } from "../src/lib/reviewer-audit.js";
import { exportSchematic, importSchematic } from "../src/lib/schematic.js";
import {
  analyzeTerrainFit,
  confirmTerrainFitPreview,
  verifyTerrainFitPreview,
  type TerrainWorldRegion,
} from "../src/lib/terrain-fit.js";
import type {
  BuildInput,
  BuildRecord,
  ComponentGraphManifest,
  DesignProgramV2,
  DesignRequirement,
} from "../src/lib/types.js";

const RELEASE = "0.8.0";
const BASE_COLUMN_SEED = "benchmark-v080-colonnade-a";
const REVISED_COLUMN_SEED = "benchmark-v080-colonnade-b";
const EXPECTED_COMPONENT_ORDER = [
  "terrain",
  "plaza",
  "colonnade",
  "retaining-structure",
  "roof",
  "lighting",
  "grove",
  "path-connection",
];

type MemorySnapshot = ReturnType<typeof memorySnapshot>;

type BenchmarkRun = {
  name: "cold" | "warm-identical" | "incremental-revision";
  durationMs: number;
  occupiedBlockCount: number;
  distinctMaterialCount: number;
  buildHash: string;
  componentGraphHash: string;
  componentOrder: string[];
  componentBlockCounts: Record<string, number>;
  materialBlockCounts: Record<string, number>;
  cache: {
    hits: number;
    misses: number;
    directlyChangedComponents: string[];
    recompiledComponents: string[];
    reusedComponents: string[];
    dependentRecompiles: string[];
    evictions: number;
    retainedEntries: number;
    retainedOperationWeight: number;
  };
  memory: {
    beforeBytes: MemorySnapshot;
    afterBytes: MemorySnapshot;
    deltaBytes: MemorySnapshot;
    processMaxRssKilobytes: number;
  };
  validation: {
    valid: boolean;
    blockingIssues: number;
    warnings: number;
    attemptedCollisions: number;
    componentConflicts: number;
  };
  representation: {
    canonicalDesignOperationCount: number;
    canonicalProceduralOperationCount: number;
    canonicalDesignIrJsonBytes: number;
    compiledPlacementJsonBytes: number;
    naiveFullEnvelopePositionCount: number;
    naiveFullEnvelopeVoxelJsonBytes: number;
    avoidedAirPositions: number;
    avoidedAirPositionReductionPercent: number;
    canonicalIrCompressionRatioVsNaiveVoxels: number;
    canonicalIrReductionPercentVsNaiveVoxels: number;
    compiledPlacementCompressionRatioVsNaiveVoxels: number;
    compiledPlacementReductionPercentVsNaiveVoxels: number;
  };
};

function benchmarkRequirement(elementIds: string[]): DesignRequirement {
  const text = "Compile the deterministic Blockwright v0.8.0 reference build.";
  const sourceSpan = { start: 0, end: text.length, text };
  return {
    id: "reference-build",
    text,
    elementIds,
    claims: [{
      id: "reference-build-quantity",
      sourceSpan,
      predicate: "quantity",
      status: "asserted",
    }],
    assertions: [
      { kind: "placement_count", claimId: "reference-build-quantity", sourceSpan, minimum: 1_000 },
      { kind: "distinct_elements", claimId: "reference-build-quantity", sourceSpan, minimum: 10 },
    ],
  };
}

export function referenceDesign(columnSeed: string, columnRevision: number): DesignProgramV2 {
  const elements: DesignProgramV2["elements"] = [
    {
      id: "terrain-surface",
      kind: "procedural",
      intent: "seeded terrain foundation",
      phase: "terrain",
      requirementIds: ["reference-build"],
      primitive: {
        type: "terrain_surface",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 63, y: 6, z: 47 },
        baseY: 3,
        amplitude: 2,
        scale: 9,
        seed: "benchmark-v080-terrain",
        fillToY: 0,
      },
      material: "terrain-mix",
    },
    {
      id: "plaza-surface",
      kind: "procedural",
      intent: "rounded patterned plaza",
      phase: "plaza",
      requirementIds: ["reference-build"],
      primitive: {
        type: "rounded_rectangle",
        min: { x: 5, y: 6, z: 5 },
        max: { x: 58, y: 6, z: 42 },
        radius: 5,
        filled: true,
      },
      material: "plaza-checker",
    },
    {
      id: "retaining-wall",
      kind: "procedural",
      intent: "weathered three-course retaining structure",
      phase: "retaining-structure",
      requirementIds: ["reference-build"],
      offsets: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      primitive: {
        type: "rounded_rectangle",
        min: { x: 3, y: 4, z: 3 },
        max: { x: 60, y: 4, z: 44 },
        radius: 7,
        filled: false,
        thickness: 2,
      },
      material: "retaining-weathering",
    },
    {
      id: "connecting-path",
      kind: "sweep",
      intent: "walkable connection from the west approach to the central plaza",
      phase: "path-connection",
      requirementIds: ["reference-build"],
      points: [
        { x: 2, y: 5, z: 24 },
        { x: 7, y: 6, z: 24 },
        { x: 12, y: 6, z: 23 },
        { x: 18, y: 6, z: 24 },
      ],
      crossSection: "solid",
      material: "path-pattern",
      width: 3,
      height: 1,
    },
    {
      id: "entry-door-lower",
      kind: "fill",
      intent: "state-correct lower half of the west boundary entrance",
      phase: "openings",
      requirementIds: ["reference-build"],
      min: { x: 0, y: 6, z: 24 },
      max: { x: 0, y: 6, z: 24 },
      material: "entry-door-lower",
    },
    {
      id: "entry-door-upper",
      kind: "fill",
      intent: "state-correct upper half of the west boundary entrance",
      phase: "openings",
      requirementIds: ["reference-build"],
      min: { x: 0, y: 7, z: 24 },
      max: { x: 0, y: 7, z: 24 },
      material: "entry-door-upper",
    },
    {
      id: "interior-bench",
      kind: "fill",
      intent: "supported functional seating within the pavilion",
      phase: "interior-seating",
      requirementIds: ["reference-build"],
      min: { x: 20, y: 7, z: 15 },
      max: { x: 25, y: 7, z: 15 },
      material: "interior-bench",
    },
    {
      id: "column-shaft",
      kind: "cylinder",
      intent: "repeated weathered column shaft",
      phase: "column",
      requirementIds: ["reference-build"],
      center: { x: 0, y: 7, z: 0 },
      radius: 1,
      height: 10,
      material: "column-weathering",
    },
    {
      id: "column-cap",
      kind: "procedural",
      intent: "repeated gradient column capital",
      phase: "capital",
      requirementIds: ["reference-build"],
      primitive: {
        type: "sphere",
        center: { x: 0, y: 17, z: 0 },
        radius: 2,
        hollow: true,
      },
      material: "capital-gradient",
    },
    {
      id: "roof-ridge",
      kind: "procedural",
      intent: "sparse procedural roof",
      phase: "roof",
      requirementIds: ["reference-build"],
      primitive: {
        type: "roof_ridge",
        min: { x: 4, y: 18, z: 4 },
        max: { x: 59, y: 25, z: 43 },
        ridgeAxis: "x",
        thickness: 1,
      },
      material: "roof-pattern",
    },
    {
      id: "lantern-unit",
      kind: "fill",
      intent: "repeated plaza lantern",
      phase: "lighting",
      requirementIds: ["reference-build"],
      min: { x: 0, y: 7, z: 0 },
      max: { x: 0, y: 7, z: 0 },
      material: "lighting",
    },
    {
      id: "tree-trunk",
      kind: "cylinder",
      intent: "radially repeated tree trunk",
      phase: "landscape",
      requirementIds: ["reference-build"],
      center: { x: 0, y: 5, z: 0 },
      radius: 1,
      height: 5,
      material: "trunk-pattern",
    },
    {
      id: "tree-canopy",
      kind: "procedural",
      intent: "radially repeated clustered canopy",
      phase: "landscape",
      requirementIds: ["reference-build"],
      primitive: {
        type: "sphere",
        center: { x: 0, y: 12, z: 0 },
        radius: 3,
        hollow: false,
      },
      material: "foliage-clusters",
    },
  ];

  return {
    schemaVersion: 2,
    description: "Blockwright v0.8.0 deterministic component/cache reference build",
    requirements: [benchmarkRequirement(elements.map(({ id }) => id))],
    elements,
    materials: {
      "terrain-mix": {
        distribution: "weighted_noise",
        seed: "benchmark-v080-ground-material",
        scale: 7,
        blocks: [
          { id: "minecraft:stone", weight: 5 },
          { id: "minecraft:andesite", weight: 3 },
          { id: "minecraft:tuff", weight: 2 },
        ],
      },
      "plaza-checker": {
        distribution: "checker",
        size: { x: 3, y: 1, z: 3 },
        materials: [
          { id: "minecraft:smooth_stone" },
          { id: "minecraft:polished_andesite" },
        ],
      },
      "retaining-weathering": {
        distribution: "weathering",
        seed: "benchmark-v080-retaining-weathering",
        base: { id: "minecraft:stone_bricks" },
        weathered: { id: "minecraft:mossy_stone_bricks" },
        amount: 0.16,
        edge: { exposedAxesAtLeast: 2, weight: 0.34 },
        surfaceDirection: { directions: ["up", "north", "west"], weight: 0.12 },
      },
      "path-pattern": {
        distribution: "pattern",
        axis: "x",
        stride: 3,
        materials: [
          { id: "minecraft:gravel" },
          { id: "minecraft:coarse_dirt" },
          { id: "minecraft:packed_mud" },
        ],
      },
      "entry-door-lower": {
        block: "minecraft:oak_door",
        state: { facing: "east", half: "lower", hinge: "left", open: false, powered: false },
      },
      "entry-door-upper": {
        block: "minecraft:oak_door",
        state: { facing: "east", half: "upper", hinge: "left", open: false, powered: false },
      },
      "interior-bench": {
        block: "minecraft:smooth_stone_slab",
        state: { type: "bottom", waterlogged: false },
      },
      "column-weathering": {
        distribution: "weathering",
        seed: "benchmark-v080-column-weathering",
        base: { id: "minecraft:quartz_block" },
        weathered: { id: "minecraft:calcite" },
        amount: 0.22,
        edge: { exposedAxesAtLeast: 2, weight: 0.28 },
        height: { minY: 14, weight: 0.18 },
      },
      "capital-gradient": {
        distribution: "gradient",
        axis: "y",
        stops: [
          { at: 0, material: { id: "minecraft:quartz_block" } },
          { at: 0.5, material: { id: "minecraft:chiseled_quartz_block" } },
          { at: 0.8, material: { id: "minecraft:quartz_bricks" } },
        ],
      },
      "roof-pattern": {
        distribution: "pattern",
        axis: "x",
        stride: 4,
        materials: [
          { id: "minecraft:deepslate_tiles" },
          { id: "minecraft:cracked_deepslate_tiles" },
          { id: "minecraft:polished_deepslate" },
        ],
      },
      "trunk-pattern": {
        distribution: "pattern",
        axis: "y",
        stride: 2,
        materials: [
          { id: "minecraft:stripped_spruce_log", state: { axis: "y" } },
          { id: "minecraft:spruce_log", state: { axis: "y" } },
        ],
      },
      "foliage-clusters": {
        distribution: "clustered_noise",
        seed: "benchmark-v080-foliage",
        scale: 2,
        blocks: [
          { id: "minecraft:spruce_leaves", weight: 4 },
          { id: "minecraft:azalea_leaves", weight: 1 },
        ],
      },
    },
    templates: [
      { id: "column-bay", name: "Column and capital", elementIds: ["column-shaft", "column-cap"] },
      { id: "lantern-row", name: "Alternating lantern row", elementIds: ["lantern-unit"] },
      { id: "tree", name: "Procedural tree", elementIds: ["tree-trunk", "tree-canopy"] },
    ],
    components: [
      {
        id: "roof",
        name: "Ridged roof",
        type: "roof",
        bounds: { min: { x: 4, y: 18, z: 4 }, max: { x: 59, y: 25, z: 43 } },
        dependencies: ["colonnade"],
        elementIds: ["roof-ridge"],
        seed: "benchmark-v080-roof",
        operationPhase: "roof",
        revision: { revision: 1 },
      },
      {
        id: "lighting",
        name: "Alternating lanterns",
        type: "lighting",
        bounds: { min: { x: 7, y: 7, z: 7 }, max: { x: 57, y: 7, z: 35 } },
        dependencies: ["plaza"],
        elementIds: [],
        templateInstances: [
          {
            id: "north-row",
            templateId: "lantern-row",
            origin: { x: 8, y: 0, z: 8 },
            repetition: {
              kind: "alternating",
              count: 6,
              step: { x: 9, y: 0, z: 0 },
              alternateOffset: { x: 0, y: 0, z: 2 },
            },
          },
          {
            id: "south-row",
            templateId: "lantern-row",
            origin: { x: 8, y: 0, z: 33 },
            repetition: {
              kind: "linear",
              count: 6,
              step: { x: 9, y: 0, z: 0 },
            },
          },
        ],
        seed: "benchmark-v080-lighting",
        operationPhase: "lighting",
        revision: { revision: 1 },
      },
      {
        id: "terrain",
        name: "Terrain foundation",
        type: "terrain",
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 63, y: 6, z: 47 } },
        dependencies: [],
        elementIds: ["terrain-surface"],
        seed: "benchmark-v080-terrain-component",
        operationPhase: "terrain_foundation",
        revision: { revision: 1 },
      },
      {
        id: "colonnade",
        name: "Repeated colonnade",
        type: "structure",
        bounds: { min: { x: 8, y: 7, z: 8 }, max: { x: 56, y: 19, z: 36 } },
        dependencies: ["plaza"],
        elementIds: [],
        templateInstances: [{
          id: "column-grid",
          templateId: "column-bay",
          origin: { x: 10, y: 0, z: 10 },
          repetition: {
            kind: "grid",
            count: { x: 5, y: 1, z: 3 },
            step: { x: 11, y: 0, z: 12 },
          },
        }],
        seed: columnSeed,
        operationPhase: "structure",
        revision: {
          revision: columnRevision,
          ...(columnRevision > 1 ? { parentRevision: columnRevision - 1, message: "Change only the colonnade seed." } : {}),
        },
      },
      {
        id: "retaining-structure",
        name: "Weathered retaining structure",
        type: "retaining-structure",
        bounds: { min: { x: 3, y: 4, z: 3 }, max: { x: 60, y: 6, z: 44 } },
        dependencies: ["terrain"],
        elementIds: ["retaining-wall"],
        seed: "benchmark-v080-retaining-structure",
        operationPhase: "structure",
        revision: { revision: 1 },
      },
      {
        id: "grove",
        name: "Radial tree grove",
        type: "landscape",
        bounds: { min: { x: 9, y: 5, z: 1 }, max: { x: 55, y: 15, z: 47 } },
        dependencies: ["terrain"],
        elementIds: [],
        templateInstances: [{
          id: "radial-trees",
          templateId: "tree",
          repetition: {
            kind: "radial",
            count: 8,
            center: { x: 32, y: 0, z: 24 },
            radius: 20,
            startAngleDegrees: 0,
          },
        }],
        seed: "benchmark-v080-grove",
        operationPhase: "landscaping",
        revision: { revision: 1 },
      },
      {
        id: "plaza",
        name: "Rounded plaza",
        type: "primary-mass",
        bounds: { min: { x: 5, y: 6, z: 5 }, max: { x: 58, y: 7, z: 42 } },
        dependencies: ["terrain"],
        elementIds: ["plaza-surface", "interior-bench"],
        seed: "benchmark-v080-plaza",
        operationPhase: "primary_mass",
        revision: { revision: 1 },
      },
      {
        id: "path-connection",
        name: "West approach path and boundary entrance",
        type: "path-connection",
        bounds: { min: { x: 0, y: 5, z: 21 }, max: { x: 20, y: 7, z: 27 } },
        dependencies: ["plaza"],
        elementIds: ["connecting-path", "entry-door-lower", "entry-door-upper"],
        seed: "benchmark-v080-path-connection",
        operationPhase: "landscaping",
        revision: { revision: 1 },
      },
    ],
  };
}

export function referenceInput(columnSeed: string, columnRevision: number): BuildInput {
  return {
    name: "Blockwright v0.8.0 Reference Pavilion",
    edition: "java",
    version: "26.2",
    style: "modern",
    buildingType: "courtyard",
    dimensions: { width: 64, depth: 48, height: 32 },
    origin: { x: 320, y: 72, z: -192 },
    blockBudget: 100_000,
    seed: "benchmark-v080-build",
    sourceBrief: "Compile the deterministic Blockwright v0.8.0 reference build.",
    // The contract validator intentionally admits only normalized palette/library
    // leaves. Register every distributed-material leaf so this reference build is
    // independently palette-legal as well as compiler-valid.
    materialLibrary: {
      "benchmark-andesite": "minecraft:andesite",
      "benchmark-azalea-leaves": "minecraft:azalea_leaves",
      "benchmark-calcite": "minecraft:calcite",
      "benchmark-chiseled-quartz": "minecraft:chiseled_quartz_block",
      "benchmark-cracked-deepslate": "minecraft:cracked_deepslate_tiles",
      "benchmark-coarse-dirt": "minecraft:coarse_dirt",
      "benchmark-deepslate": "minecraft:deepslate_tiles",
      "benchmark-gravel": "minecraft:gravel",
      "benchmark-mossy-stone-bricks": "minecraft:mossy_stone_bricks",
      "benchmark-oak-door": {
        block: "minecraft:oak_door",
        state: { facing: "east", half: "lower", hinge: "left", open: false, powered: false },
      },
      "benchmark-packed-mud": "minecraft:packed_mud",
      "benchmark-polished-andesite": "minecraft:polished_andesite",
      "benchmark-polished-deepslate": "minecraft:polished_deepslate",
      "benchmark-quartz": "minecraft:quartz_block",
      "benchmark-quartz-bricks": "minecraft:quartz_bricks",
      "benchmark-smooth-stone": "minecraft:smooth_stone",
      "benchmark-smooth-stone-slab": {
        block: "minecraft:smooth_stone_slab",
        state: { type: "bottom", waterlogged: false },
      },
      "benchmark-spruce-leaves": "minecraft:spruce_leaves",
      "benchmark-spruce-log": { block: "minecraft:spruce_log", state: { axis: "y" } },
      "benchmark-stone": "minecraft:stone",
      "benchmark-stone-bricks": "minecraft:stone_bricks",
      "benchmark-stripped-spruce-log": { block: "minecraft:stripped_spruce_log", state: { axis: "y" } },
      "benchmark-tuff": "minecraft:tuff",
    },
    design: referenceDesign(columnSeed, columnRevision),
  };
}

function memorySnapshot() {
  const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external, arrayBuffers };
}

function subtractMemory(after: MemorySnapshot, before: MemorySnapshot): MemorySnapshot {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
}

function countsByComponent(build: BuildRecord) {
  const counts: Record<string, number> = {};
  for (const placement of build.placements) {
    const id = placement.componentId ?? "unattributed";
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalJson(value: unknown): string {
  const canonicalize = (child: unknown): unknown => {
    if (Array.isArray(child)) return child.map(canonicalize);
    if (child && typeof child === "object") {
      return Object.fromEntries(Object.entries(child as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return child;
  };
  return JSON.stringify(canonicalize(value));
}

function measureNaiveFullEnvelopeVoxelJsonBytes(build: BuildRecord) {
  const byCoordinate = new Map(build.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement]));
  const { dimensions, origin } = build.input;
  let bytes = 2; // Opening and closing JSON array brackets.
  let first = true;
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let z = 0; z < dimensions.depth; z += 1) {
      for (let x = 0; x < dimensions.width; x += 1) {
        const world = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
        const placement = byCoordinate.get(`${world.x},${world.y},${world.z}`);
        const voxel = placement
          ? { ...world, block: placement.block, ...(placement.state ? { state: placement.state } : {}) }
          : { ...world, block: "minecraft:air" };
        bytes += (first ? 0 : 1) + Buffer.byteLength(JSON.stringify(voxel), "utf8");
        first = false;
      }
    }
  }
  return bytes;
}

function rounded(value: number) {
  return Number(value.toFixed(6));
}

function representationMetrics(input: BuildInput, build: BuildRecord): BenchmarkRun["representation"] {
  if (!input.design || input.design.schemaVersion !== 2) {
    throw new Error("BENCHMARK_ASSERTION_FAILED: representation metrics require canonical Design IR v2.");
  }
  const canonicalDesignIrJsonBytes = Buffer.byteLength(canonicalJson(input.design), "utf8");
  const compiledPlacementJsonBytes = Buffer.byteLength(JSON.stringify(build.placements), "utf8");
  const naiveFullEnvelopePositionCount = input.dimensions.width * input.dimensions.depth * input.dimensions.height;
  const naiveFullEnvelopeVoxelJsonBytes = measureNaiveFullEnvelopeVoxelJsonBytes(build);
  const avoidedAirPositions = naiveFullEnvelopePositionCount - build.placements.length;
  return {
    canonicalDesignOperationCount: input.design.elements.length,
    canonicalProceduralOperationCount: input.design.elements.filter(({ kind }) => kind === "procedural").length,
    canonicalDesignIrJsonBytes,
    compiledPlacementJsonBytes,
    naiveFullEnvelopePositionCount,
    naiveFullEnvelopeVoxelJsonBytes,
    avoidedAirPositions,
    avoidedAirPositionReductionPercent: rounded(avoidedAirPositions / naiveFullEnvelopePositionCount * 100),
    canonicalIrCompressionRatioVsNaiveVoxels: rounded(naiveFullEnvelopeVoxelJsonBytes / canonicalDesignIrJsonBytes),
    canonicalIrReductionPercentVsNaiveVoxels: rounded((1 - canonicalDesignIrJsonBytes / naiveFullEnvelopeVoxelJsonBytes) * 100),
    compiledPlacementCompressionRatioVsNaiveVoxels: rounded(naiveFullEnvelopeVoxelJsonBytes / compiledPlacementJsonBytes),
    compiledPlacementReductionPercentVsNaiveVoxels: rounded((1 - compiledPlacementJsonBytes / naiveFullEnvelopeVoxelJsonBytes) * 100),
  };
}

function requiredGraph(build: BuildRecord) {
  if (!build.componentGraph) throw new Error("BENCHMARK_ASSERTION_FAILED: v0.8.0 build did not expose a component graph.");
  return build.componentGraph;
}

function requiredReport(build: BuildRecord) {
  if (!build.compileReport) throw new Error("BENCHMARK_ASSERTION_FAILED: v0.8.0 build did not expose a compile report.");
  return build.compileReport;
}

function runCompile(
  name: BenchmarkRun["name"],
  input: BuildInput,
  cache: ComponentCache<ComponentOperationCacheEntry>,
  previousComponentGraph?: ComponentGraphManifest,
): { build: BuildRecord; report: BenchmarkRun } {
  const before = memorySnapshot();
  const started = performance.now();
  const build = compileBuild(input, {
    componentCache: cache,
    previousComponentGraph,
    maximumPlacements: 250_000,
    maximumPlacementAttempts: 1_000_000,
  });
  const durationMs = performance.now() - started;
  const after = memorySnapshot();
  const graph = requiredGraph(build);
  const compileReport = requiredReport(build);
  const cacheStats = cache.stats();
  const directlyChanged = new Set(compileReport.changed);

  return {
    build,
    report: {
      name,
      durationMs: Number(durationMs.toFixed(3)),
      occupiedBlockCount: build.placements.length,
      distinctMaterialCount: Object.keys(build.materialCounts).length,
      buildHash: build.hash,
      componentGraphHash: graph.graphHash,
      componentOrder: graph.order,
      componentBlockCounts: countsByComponent(build),
      materialBlockCounts: Object.fromEntries(Object.entries(build.materialCounts).sort(([left], [right]) => left.localeCompare(right))),
      cache: {
        hits: compileReport.cacheHits,
        misses: compileReport.cacheMisses,
        directlyChangedComponents: compileReport.changed,
        recompiledComponents: compileReport.rebuilt,
        reusedComponents: compileReport.reused,
        dependentRecompiles: compileReport.rebuilt.filter((id) => !directlyChanged.has(id)),
        evictions: compileReport.evictions,
        retainedEntries: cacheStats.entries,
        retainedOperationWeight: cacheStats.weight,
      },
      memory: {
        beforeBytes: before,
        afterBytes: after,
        deltaBytes: subtractMemory(after, before),
        processMaxRssKilobytes: process.resourceUsage().maxRSS,
      },
      validation: {
        valid: build.validation.valid,
        blockingIssues: build.validation.blockingIssues,
        warnings: build.validation.warnings,
        attemptedCollisions: build.validation.attemptedCollisions,
        componentConflicts: compileReport.conflictCount,
      },
      representation: representationMetrics(input, build),
    },
  };
}

function assertEqual<Value>(actual: Value, expected: Value, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`BENCHMARK_ASSERTION_FAILED: ${message}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function referenceTerrainFit(build: BuildRecord) {
  const width = 80;
  const depth = 64;
  const heightMap = Array.from({ length: depth }, (_, z) => Array.from({ length: width }, (_, x) => {
    const terrace = x < 13 ? -3 : x > 68 ? 2 : 0;
    const contour = (x + z) % 11 === 0 ? 1 : 0;
    return 9 + terrace + contour;
  }));
  const biomeMap = Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:old_growth_spruce_taiga"));
  const surfaceBlocks = Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:podzol"));
  const subsurfaceBlocks = Array.from({ length: depth }, () => Array.from({ length: width }, () => ["minecraft:dirt", "minecraft:dirt", "minecraft:stone"]));
  const region: TerrainWorldRegion = {
    edition: "java",
    version: "26.2",
    origin: { x: 0, y: 0, z: 0 },
    dimensions: { width, depth, height: 64 },
    heightMap,
    biomeMap,
    surfaceBlocks,
    subsurfaceBlocks,
    pathCoordinates: [{ x: 40, y: 10, z: 61 }],
    vegetationCoordinates: [
      { x: 5, y: 10, z: 6 },
      { x: 74, y: 10, z: 18 },
      { x: 30, y: 10, z: 60 },
    ],
  };
  const preview = analyzeTerrainFit(build, region, {
    targetAnchor: { x: 8, y: 10, z: 8 },
    lockTargetY: true,
    maximumHorizontalOffset: 1,
    rotations: [0],
    maximumCandidates: 16,
    maximumFootprintColumns: 10_000,
    retainingThreshold: 2,
    pathSearchLimit: 100_000,
    terrainInterface: {
      strategy: "flat_pad",
      maxCutDepth: 8,
      maxFillHeight: 8,
      allowRetainingWalls: true,
      allowTerraces: true,
      blendRadius: 4,
      innerBlendRadius: 2,
      waterPolicy: "bridge",
    },
  });
  if (!verifyTerrainFitPreview(preview)) throw new Error("BENCHMARK_ASSERTION_FAILED: TerrainFit preview hash did not verify.");
  if (preview.risk === "red") throw new Error(`BENCHMARK_ASSERTION_FAILED: reference TerrainFit preview is red risk: ${preview.warnings.join("; ")}`);
  if (!preview.retainingWalls.required || !preview.operations.some(({ op }) => op === "retaining_structure")) {
    throw new Error("BENCHMARK_ASSERTION_FAILED: reference TerrainFit preview did not include required retaining support.");
  }
  if (preview.pathConnection.status !== "connected" || !preview.operations.some(({ op }) => op === "connect_path")) {
    throw new Error("BENCHMARK_ASSERTION_FAILED: reference TerrainFit preview did not connect the build to the supplied path.");
  }
  const confirmed = confirmTerrainFitPreview(preview, preview.hash);
  return {
    previewId: preview.id,
    previewHash: preview.hash,
    regionHash: preview.regionHash,
    risk: preview.risk,
    candidateCount: preview.candidates.length,
    selected: preview.selected,
    cutVolume: preview.cutVolume,
    fillVolume: preview.fillVolume,
    changedTerrainArea: preview.changedTerrainArea,
    maximumCutDepth: preview.maximumCutDepth,
    maximumFillHeight: preview.maximumFillHeight,
    blendZones: preview.blendZones,
    retainingWalls: preview.retainingWalls,
    pathConnection: {
      status: preview.pathConnection.status,
      length: preview.pathConnection.length,
      crossesWater: preview.pathConnection.crossesWater,
    },
    sampledNativeMaterials: preview.sampledNativeMaterials,
    sampledBiomes: preview.sampledBiomes,
    operationKinds: preview.operations.map(({ op }) => op),
    warningCount: preview.warnings.length,
    hashVerified: true,
    confirmation: {
      status: confirmed.status,
      installationBoundary: confirmed.installationBoundary,
      operationCount: confirmed.operations.length,
      worldWritePerformed: false,
    },
  };
}

async function referenceWorkflow(build: BuildRecord, input: BuildInput) {
  const planStarted = performance.now();
  const planned = planBuildInput(input);
  const planDurationMs = performance.now() - planStarted;

  const auditStarted = performance.now();
  const audit = auditBuild(build);
  const auditDurationMs = performance.now() - auditStarted;

  const renderStarted = performance.now();
  const renderPage = createInitialBuildPlacementPage(build);
  const renderPreparationMs = performance.now() - renderStarted;

  const exportStarted = performance.now();
  const schematic = exportSchematic(build, { name: "Blockwright v0.8.0 Reference Pavilion", author: "Blockwright benchmark" });
  const exportDurationMs = performance.now() - exportStarted;
  const schematicSha256 = createHash("sha256").update(schematic.bytes).digest("hex");

  const importStarted = performance.now();
  const imported = await importSchematic(schematic.bytes, build.bounds.min, { maximumVolume: 250_000 });
  const importDurationMs = performance.now() - importStarted;
  if (imported.placements.length !== build.placements.length) {
    throw new Error(`BENCHMARK_ASSERTION_FAILED: schematic round trip changed occupied count from ${build.placements.length} to ${imported.placements.length}.`);
  }
  if (!audit.certificate || audit.certificate.buildHash !== build.hash) {
    throw new Error("BENCHMARK_ASSERTION_FAILED: audit certificate is not bound to the reference build hash.");
  }

  return {
    prompt: {
      sourceBriefRetained: planned.input.sourceBrief === input.sourceBrief,
      characterCount: input.sourceBrief?.length ?? 0,
    },
    plan: {
      durationMs: Number(planDurationMs.toFixed(3)),
      buildingType: planned.plan.program.buildingType,
      structuralFingerprint: planned.plan.structuralFingerprint,
      preflightRisk: planned.preflight.overallRisk,
      estimatedOccupiedBlocks: planned.preflight.estimatedOccupiedBlocks,
      expandedPlacements: 0,
    },
    validation: {
      valid: build.validation.valid,
      blockingIssues: build.validation.blockingIssues,
      warnings: build.validation.warnings,
    },
    audit: {
      durationMs: Number(auditDurationMs.toFixed(3)),
      scannedPlacements: audit.scannedPlacements,
      findingCodes: audit.findings.map(({ code }) => code),
      totals: audit.totals,
      contractStatus: audit.contract.status,
      certificateStatus: audit.certificate.status,
      certificateBuildHash: audit.certificate.buildHash,
    },
    renderPreparation: {
      durationMs: Number(renderPreparationMs.toFixed(3)),
      returnedPlacements: renderPage.returned,
      totalPlacements: renderPage.total,
      bounded: renderPage.returned < renderPage.total,
    },
    inspection: {
      componentCount: build.componentGraph?.components.length ?? 0,
      componentOrder: build.componentGraph?.order ?? [],
      attributedPlacements: build.placements.filter(({ componentId }) => Boolean(componentId)).length,
      conflictCount: build.compileReport?.conflictCount ?? 0,
    },
    schematicExport: {
      durationMs: Number(exportDurationMs.toFixed(3)),
      format: "sponge_schematic_v3",
      bytes: schematic.bytes.byteLength,
      sha256: schematicSha256,
      dimensions: { width: schematic.width, height: schematic.height, depth: schematic.length },
      paletteSize: schematic.paletteSize,
      blockCount: schematic.blockCount,
      dataVersion: build.registry.worldVersion,
    },
    schematicRoundTrip: {
      durationMs: Number(importDurationMs.toFixed(3)),
      format: imported.format,
      version: imported.version,
      dataVersion: imported.dataVersion,
      importedPlacements: imported.placements.length,
      occupiedCountPreserved: imported.placements.length === build.placements.length,
      liveWorldWritePerformed: false,
    },
  };
}

async function main() {
  const cache = new ComponentCache<ComponentOperationCacheEntry>({ maxEntries: 24, maxWeight: 500_000 });
  const baselineInput = referenceInput(BASE_COLUMN_SEED, 1);
  const revisedInput = referenceInput(REVISED_COLUMN_SEED, 2);

  const cold = runCompile("cold", baselineInput, cache);
  const warm = runCompile("warm-identical", baselineInput, cache, requiredGraph(cold.build));
  const incremental = runCompile("incremental-revision", revisedInput, cache, requiredGraph(warm.build));
  const terrainFit = referenceTerrainFit(cold.build);
  const workflow = await referenceWorkflow(cold.build, baselineInput);

  assertEqual(cold.report.componentOrder, EXPECTED_COMPONENT_ORDER, "component order must remain stable");
  assertEqual(warm.report.buildHash, cold.report.buildHash, "identical warm compile must preserve the build hash");
  assertEqual(warm.report.componentGraphHash, cold.report.componentGraphHash, "identical warm compile must preserve the graph hash");
  assertEqual(warm.report.cache.recompiledComponents, [], "identical warm compile must recompile no components");
  assertEqual(warm.report.cache.reusedComponents, EXPECTED_COMPONENT_ORDER, "identical warm compile must reuse every component");
  assertEqual(incremental.report.cache.directlyChangedComponents, ["colonnade"], "only the revised colonnade may be directly changed");
  assertEqual(incremental.report.cache.recompiledComponents, ["colonnade", "roof"], "the revision must rebuild the colonnade and dependent roof");
  assertEqual(
    incremental.report.cache.reusedComponents,
    ["terrain", "plaza", "retaining-structure", "lighting", "grove", "path-connection"],
    "unaffected components must be reused",
  );
  assertEqual(incremental.report.cache.dependentRecompiles, ["roof"], "the dependency closure must be explicit");
  assertEqual([cold.report.validation.valid, warm.report.validation.valid, incremental.report.validation.valid], [true, true, true], "all reference compiles must pass validation");
  assertEqual(warm.report.representation, cold.report.representation, "identical warm compile must preserve all deterministic representation metrics");
  assertEqual(cold.report.representation.canonicalProceduralOperationCount, 6, "the fixture must retain six canonical procedural operations");
  assertEqual(
    cold.report.representation.avoidedAirPositionReductionPercent > 70,
    true,
    "the reference envelope must retain a large sparse interior",
  );
  assertEqual(
    [cold.report.componentBlockCounts["path-connection"] > 0, cold.report.componentBlockCounts["retaining-structure"] > 0],
    [true, true],
    "path connection and retaining structure components must both compile occupied blocks",
  );

  const output = {
    schemaVersion: 1,
    benchmark: "blockwright-v080-reference-build",
    release: RELEASE,
    classification: "deterministic synthetic reference build; timing and memory are observational",
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    fixture: {
      dimensions: baselineInput.dimensions,
      totalEnvelopeBlocks: baselineInput.dimensions.width * baselineInput.dimensions.depth * baselineInput.dimensions.height,
      componentCount: EXPECTED_COMPONENT_ORDER.length,
      templateCount: (baselineInput.design as DesignProgramV2).templates.length,
      repetitionKinds: ["grid", "alternating", "linear", "radial"],
      proceduralPrimitiveKinds: ["terrain_surface", "rounded_rectangle", "sphere", "roof_ridge"],
      authoredElementKinds: ["procedural", "cylinder", "fill", "sweep"],
      distributedMaterialKinds: ["weighted_noise", "checker", "weathering", "gradient", "pattern", "clustered_noise"],
      requiredReferenceComponents: {
        pathConnection: "path-connection",
        retainingStructure: "retaining-structure",
      },
      representationDefinitions: {
        canonicalDesignIr: "UTF-8 bytes of recursively key-sorted Design IR JSON with undefined fields omitted",
        compiledPlacements: "UTF-8 bytes of JSON.stringify(BuildRecord.placements)",
        naiveFullEnvelopeVoxels: "UTF-8 bytes of a dense JSON array containing {x,y,z,block,state?} for every envelope coordinate; unoccupied coordinates are minecraft:air",
      },
      revision: {
        component: "colonnade",
        changedField: "seed",
        from: BASE_COLUMN_SEED,
        to: REVISED_COLUMN_SEED,
        revisionFrom: 1,
        revisionTo: 2,
      },
    },
    runs: [cold.report, warm.report, incremental.report],
    workflow,
    terrainFit,
    checks: {
      identicalBuildHash: warm.report.buildHash === cold.report.buildHash,
      identicalGraphHash: warm.report.componentGraphHash === cold.report.componentGraphHash,
      warmCacheHitRatio: warm.report.cache.hits / EXPECTED_COMPONENT_ORDER.length,
      incrementalCacheHitRatio: incremental.report.cache.hits / EXPECTED_COMPONENT_ORDER.length,
      revisedBuildHashChanged: incremental.report.buildHash !== warm.report.buildHash,
      assertionsPassed: true,
    },
    limitations: [
      "Durations vary with machine load and include full BuildRecord planning, validation, placement merge, and hashing; component cache hits avoid component operation generation only.",
      "Memory values are process snapshots before and after each synchronous compile; processMaxRssKilobytes is process-wide and is not an isolated per-run peak.",
      "The fixture is synthetic and deterministic. It is a compiler/cache regression reference, not a representative customer workload or Minecraft paste-time benchmark.",
      "The reference includes a state-correct boundary entrance and supported interior seating. Geometric room-to-door access remains unevaluated because Design IR v2 does not encode room bounds or door associations.",
      `${cold.report.validation.componentConflicts} reported component conflicts are deterministic phase-ordered replacements at connected/overlapping authored geometry, not nondeterministic cache corruption.`,
      "The naive dense-byte baseline stores only coordinate, block, and optional state; it omits the richer phase, element, requirement, and component provenance carried by compiled placements.",
      "Avoided air positions are the full envelope position count minus final occupied placements; they measure sparse occupancy, not a claim that an exporter writes explicit air blocks.",
    ],
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
