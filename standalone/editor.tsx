import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import {
  Activity,
  AlertTriangle,
  Box,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  ClipboardCheck,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FilePlus2,
  FlipHorizontal2,
  Focus,
  FolderOpen,
  Grid3X3,
  Hammer,
  HardDrive,
  Layers3,
  Lock,
  Menu,
  Minus,
  MonitorCog,
  MousePointer2,
  Move3d,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Rotate3d,
  RotateCcw,
  Scaling,
  Search,
  Settings2,
  Shapes,
  SquareTerminal,
  Trash2,
  Unlock,
  Workflow,
  X,
  XCircle,
} from "lucide-react";
import {
  componentCanResizeExactly,
  componentCanRotateOrMirrorExactly,
  componentUsesProceduralGeometry,
  rotateBoundsY,
  translateDesignElement,
  translateTemplateInstance,
} from "./editor-geometry.js";
import "./editor.css";

type Vec3 = { x: number; y: number; z: number };
type Bounds = { min: Vec3; max: Vec3 };
type Phase = "terrain_foundation" | "primary_mass" | "structure" | "walls" | "roof" | "cuts_openings" | "trim" | "detail" | "lighting" | "landscaping" | "explicit_overrides";
type PrimitiveKind = "fill" | "shell" | "carve" | "cylinder" | "basin" | "stairs" | "ramp" | "line" | "plane" | "circle" | "ellipse" | "sphere" | "cone" | "pyramid" | "polygon" | "rounded_rectangle" | "extrusion" | "profile_extrusion" | "roof_plane" | "roof_ridge" | "terrain_surface";
type RepetitionKind = "none" | "linear" | "grid" | "radial" | "mirrored" | "alternating" | "position_list";
type ToolMode = "select" | "move" | "scale" | "rotate";
type NavSection = "editor" | "builds" | "tasks" | "models" | "settings" | "diagnostics";
type TaskState = "queued" | "preparing" | "compiling" | "validating" | "completed" | "cancelling" | "cancelled" | "failed" | "interrupted";

type DesignElement = {
  id: string;
  kind: string;
  intent: string;
  requirementIds: string[];
  material?: string;
  min?: Vec3;
  max?: Vec3;
  center?: Vec3;
  radius?: number;
  height?: number;
  thickness?: number;
  points?: Vec3[];
  from?: Vec3;
  to?: Vec3;
  width?: number;
  primitive?: Record<string, unknown>;
  clip?: Bounds;
  masks?: Array<{ primitive: Record<string, unknown>; invert?: boolean }>;
  operation?: string;
  [key: string]: unknown;
};

type DesignComponent = {
  id: string;
  name: string;
  type: string;
  bounds: Bounds;
  dependencies: string[];
  elementIds: string[];
  templateInstances?: Array<{ id: string; templateId: string; origin?: Vec3; repetition?: Record<string, unknown>; materialOverrides?: Record<string, string> }>;
  seed: string;
  operationPhase: Phase;
  revision: { revision: number; parentRevision?: number; message?: string };
};

type DesignProgram = {
  schemaVersion: 2;
  description: string;
  requirements: Array<Record<string, unknown>>;
  elements: DesignElement[];
  materials: Record<string, unknown>;
  templates: Array<{ id: string; name?: string; elementIds: string[] }>;
  components: DesignComponent[];
};

type Placement = Vec3 & { block?: string; material?: string; state?: Record<string, unknown>; componentId?: string; phase?: string };
type TaskSnapshot = {
  id: string;
  operation: string;
  state: TaskState;
  progress: { sequence: number; phase: TaskState; operation: string; detail?: string; work?: { unit: string; completedUnits?: number; totalUnits?: number; affectedComponent?: string; cacheHits?: number; cacheReusedUnits?: number } };
  timing: { queuedAt: string; startedAt?: string; updatedAt: string; finishedAt?: string; elapsedMs: number; queueMs?: number; runMs?: number };
  resultAvailable: boolean;
  resultReference?: string;
  diagnostic?: { id: string; code: string; error: string; likelyCause: string; recommendedAction: string; logReference: string; retry?: { safe: boolean; reason: string } };
};
type BuildSummary = { id: string; hash?: string; blockCount?: number; placementCount?: number; componentCount?: number; conflictCount?: number; cacheHits?: number; cacheMisses?: number };
type TerrainStrategy = "flat_pad" | "raised_foundation" | "natural_slope" | "terraced" | "retaining_wall" | "stilts" | "sunken" | "cliff_embedded" | "waterfront" | "bridge_span";
type TerrainWaterPolicy = "preserve" | "bridge" | "culvert" | "retain" | "redirect";
type TerrainRotation = 0 | 90 | 180 | 270;
type TerrainFitSummary = {
  previewRef: string;
  previewId: string;
  previewHash: string;
  buildId: string;
  buildHash: string;
  regionHash: string;
  risk: "green" | "amber" | "red";
  selected: {
    id: string;
    anchor: Vec3;
    rotation: TerrainRotation;
    mirrorX: boolean;
    totalScore: number;
    excavation: number;
    fill: number;
    protectedConflicts: number;
    structureConflicts: number;
    waterConflicts: number;
  };
  candidates: Array<Record<string, unknown>>;
  cutVolume: number;
  fillVolume: number;
  changedTerrainArea: number;
  maximumCutDepth: number;
  maximumFillHeight: number;
  blendZones: { footprintColumns: number; innerColumns: number; outerColumns: number };
  retainingWalls: { required: boolean; columns: number };
  pathConnection: { status: "connected" | "blocked" | "not_requested"; length: number; crossesWater: number };
  conflictTotals: { water: number; protected: number; structures: number };
  operationCounts: { gradingColumns: number; retainingColumns: number; pathPoints: number; waterCoordinates: number; vegetationRestoration: boolean };
  warnings: string[];
};
type TerrainFitResponse = {
  ok: true;
  terrain: TerrainFitSummary;
  detailPage: { offset: number; returned: number; total: number };
  terrainDetail: Array<{ operation: string; operationIndex: number; value: unknown }>;
  terrainContext: Record<string, unknown>;
  snapshotValidated: true;
  installationBoundary: "read_only_preview";
  worldWritePerformed: false;
};
type ProviderStatus = {
  id?: string;
  label?: string;
  name?: string;
  kind?: string;
  privacy?: string;
  availability?: string;
  state?: string;
  status?: string;
  available?: boolean;
  model?: string | null;
  modelCount?: number;
  message?: string;
  endpoint?: string;
  errorCode?: string | null;
  capabilities?: string[];
};
type Bootstrap = {
  ok: boolean;
  version?: string;
  mode: "local";
  tasks?: TaskSnapshot[];
  providers?: ProviderStatus[] | { providers?: ProviderStatus[]; policy?: string };
  diagnostics?: Record<string, unknown> | Array<Record<string, unknown>>;
  hardware?: Record<string, unknown>;
};

type SceneVoxel = Placement & { componentId: string; material: string };
type ComponentViewState = { hidden?: boolean; locked?: boolean; isolated?: boolean; terrainInterface?: "surface" | "embedded" | "bridge" | "retaining" | "free"; blendRadius?: number; rotation?: number };

const TERMINAL_STATES = new Set<TaskState>(["completed", "cancelled", "failed", "interrupted"]);
const ACTIVE_STATES = new Set<TaskState>(["queued", "preparing", "compiling", "validating", "cancelling"]);
const MAX_PREVIEW_VOXELS = 6_000;
const PLACEMENT_PAGE_LIMIT = 2_500;

const TERRAIN_STRATEGIES: Array<{ value: TerrainStrategy; label: string }> = [
  { value: "flat_pad", label: "Flat pad" },
  { value: "raised_foundation", label: "Raised foundation" },
  { value: "natural_slope", label: "Natural slope" },
  { value: "terraced", label: "Terraced" },
  { value: "retaining_wall", label: "Retaining wall" },
  { value: "stilts", label: "Stilts" },
  { value: "sunken", label: "Sunken" },
  { value: "cliff_embedded", label: "Cliff embedded" },
  { value: "waterfront", label: "Waterfront" },
  { value: "bridge_span", label: "Bridge span" },
];

const MATERIAL_COLORS: Record<string, string> = {
  foundation: "#9ca9ad",
  wall: "#ded1ba",
  frame: "#a57a55",
  roof: "#718b96",
  trim: "#e0a15a",
  glazing: "#86c7d6",
  lighting: "#ffe18a",
  accents: "#e4864f",
  landscaping: "#78a17a",
  stone_blend: "#9aa59c",
};

function createDeterministicTerrainSample() {
  const origin = { x: -8, y: 0, z: -8 };
  const width = 52;
  const depth = 45;
  const heightMap = Array.from({ length: depth }, (_row, z) => Array.from({ length: width }, (_column, x) => {
    const worldX = origin.x + x;
    const worldZ = origin.z + z;
    return 63 + (worldX >= 20 && worldZ >= -1 ? 1 : 0);
  }));
  const biomeMap = Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:plains"));
  const surfaceBlocks = Array.from({ length: depth }, () => Array.from({ length: width }, () => "minecraft:grass_block"));
  return {
    edition: "java",
    version: "26.2",
    origin,
    dimensions: { width, depth, height: 96 },
    heightMap,
    biomeMap,
    surfaceBlocks,
    pathCoordinates: Array.from({ length: 7 }, (_unused, index) => ({ x: 14 + index, y: 64, z: 32 })),
    protectedCoordinates: [],
    protectedRegions: [],
    structures: [],
  };
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof Boxes }> = [
  { id: "editor", label: "Editor", icon: Boxes },
  { id: "builds", label: "Builds", icon: FolderOpen },
  { id: "tasks", label: "Tasks", icon: Activity },
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "diagnostics", label: "Diagnostics", icon: SquareTerminal },
];

const PRIMITIVES: Array<{ value: PrimitiveKind; label: string }> = [
  ["fill", "Box / fill"], ["shell", "Hollow box"], ["carve", "Clear / subtract"], ["line", "Line / path"],
  ["plane", "Plane"], ["circle", "Circle"], ["ellipse", "Ellipse"], ["cylinder", "Cylinder"], ["sphere", "Sphere"],
  ["cone", "Cone"], ["pyramid", "Pyramid"], ["polygon", "Polygon"], ["rounded_rectangle", "Rounded rectangle"],
  ["stairs", "Staircase"], ["ramp", "Ramp"], ["extrusion", "Extrusion"], ["profile_extrusion", "Profile extrusion"],
  ["roof_plane", "Roof plane"], ["roof_ridge", "Roof ridge"], ["basin", "Basin"], ["terrain_surface", "Terrain surface"],
].map(([value, label]) => ({ value: value as PrimitiveKind, label }));

function requirement(elementIds: string[]) {
  const text = "pavilion geometry";
  const sourceSpan = { start: 0, end: text.length, text };
  return {
    id: "pavilion-contract",
    text,
    elementIds,
    claims: [{ id: "complete-geometry", sourceSpan, predicate: "quantity", status: "asserted" }],
    assertions: [
      { kind: "placement_count", claimId: "complete-geometry", sourceSpan, minimum: 500 },
      { kind: "distinct_elements", claimId: "complete-geometry", sourceSpan, minimum: 6 },
    ],
  };
}

export function createSeededDesign(): DesignProgram {
  const elements: DesignElement[] = [
    { id: "foundation-pad", kind: "fill", intent: "raised stone foundation", requirementIds: ["pavilion-contract"], min: { x: 2, y: 0, z: 2 }, max: { x: 31, y: 1, z: 23 }, material: "foundation" },
    { id: "pavilion-floor", kind: "fill", intent: "finished pavilion floor", requirementIds: ["pavilion-contract"], min: { x: 4, y: 2, z: 4 }, max: { x: 29, y: 2, z: 21 }, material: "stone_blend" },
    { id: "outer-walls", kind: "shell", intent: "perimeter wall shell", requirementIds: ["pavilion-contract"], min: { x: 4, y: 3, z: 4 }, max: { x: 29, y: 10, z: 21 }, thickness: 1, material: "wall" },
    { id: "front-door", kind: "carve", intent: "three-block-tall accessible entry", requirementIds: ["pavilion-contract"], min: { x: 15, y: 3, z: 4 }, max: { x: 18, y: 6, z: 4 } },
    { id: "column-unit", kind: "fill", intent: "timber structural column", requirementIds: ["pavilion-contract"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 7, z: 0 }, material: "frame" },
    { id: "roof-lower", kind: "fill", intent: "deep lower roof plane", requirementIds: ["pavilion-contract"], min: { x: 2, y: 11, z: 2 }, max: { x: 31, y: 11, z: 23 }, material: "roof" },
    { id: "roof-middle", kind: "fill", intent: "stepped roof plane", requirementIds: ["pavilion-contract"], min: { x: 5, y: 12, z: 4 }, max: { x: 28, y: 12, z: 21 }, material: "roof" },
    { id: "roof-ridge", kind: "fill", intent: "lit ridge cap", requirementIds: ["pavilion-contract"], min: { x: 9, y: 13, z: 6 }, max: { x: 24, y: 14, z: 19 }, material: "trim" },
    { id: "garden-bed", kind: "basin", intent: "shallow planted rain garden", requirementIds: ["pavilion-contract"], min: { x: 4, y: 0, z: 25 }, max: { x: 29, y: 1, z: 26 }, wallMaterial: "foundation", floorMaterial: "landscaping", rimMaterial: "trim", wallThickness: 1 },
    { id: "path", kind: "fill", intent: "entry path connection", requirementIds: ["pavilion-contract"], min: { x: 15, y: 0, z: 24 }, max: { x: 18, y: 0, z: 27 }, material: "trim" },
  ];
  return {
    schemaVersion: 2,
    description: "Deterministic no-model pavilion example with reusable columns, exact component bounds, and a seeded material distribution.",
    requirements: [requirement(elements.map(({ id }) => id))],
    elements,
    materials: {
      foundation: "minecraft:polished_andesite",
      wall: "minecraft:calcite",
      frame: "minecraft:stripped_dark_oak_log",
      roof: "minecraft:deepslate_tiles",
      trim: "minecraft:cut_copper",
      glazing: { block: "minecraft:tinted_glass", tags: ["transparent"] },
      lighting: "minecraft:ochre_froglight",
      landscaping: "minecraft:moss_block",
      stone_blend: {
        distribution: "weighted_noise",
        seed: "river-stone-08",
        scale: 5,
        blocks: [
          { material: "minecraft:stone", weight: 6 },
          { material: "minecraft:andesite", weight: 3 },
          { material: "minecraft:tuff", weight: 1 },
        ],
      },
    },
    templates: [{ id: "column-template", name: "Perimeter column", elementIds: ["column-unit"] }],
    components: [
      { id: "foundation", name: "Foundation", type: "foundation", bounds: { min: { x: 2, y: 0, z: 2 }, max: { x: 31, y: 2, z: 23 } }, dependencies: [], elementIds: ["foundation-pad", "pavilion-floor"], seed: "foundation-080", operationPhase: "terrain_foundation", revision: { revision: 1 } },
      { id: "frame", name: "Structural Frame", type: "structure", bounds: { min: { x: 4, y: 3, z: 4 }, max: { x: 29, y: 10, z: 21 } }, dependencies: ["foundation"], elementIds: [], templateInstances: [{ id: "perimeter-columns", templateId: "column-template", origin: { x: 4, y: 3, z: 4 }, repetition: { kind: "position_list", positions: [{ x: 0, y: 0, z: 0 }, { x: 25, y: 0, z: 0 }, { x: 0, y: 0, z: 17 }, { x: 25, y: 0, z: 17 }] } }], seed: "frame-080", operationPhase: "structure", revision: { revision: 1 } },
      { id: "walls", name: "Wall Shell", type: "walls", bounds: { min: { x: 4, y: 3, z: 4 }, max: { x: 29, y: 10, z: 21 } }, dependencies: ["frame"], elementIds: ["outer-walls"], seed: "walls-080", operationPhase: "walls", revision: { revision: 1 } },
      { id: "roof", name: "Stepped Roof", type: "roof", bounds: { min: { x: 2, y: 11, z: 2 }, max: { x: 31, y: 14, z: 23 } }, dependencies: ["frame", "walls"], elementIds: ["roof-lower", "roof-middle", "roof-ridge"], seed: "roof-080", operationPhase: "roof", revision: { revision: 1 } },
      { id: "openings", name: "Entry Openings", type: "cuts", bounds: { min: { x: 15, y: 3, z: 4 }, max: { x: 18, y: 6, z: 4 } }, dependencies: ["walls"], elementIds: ["front-door"], seed: "openings-080", operationPhase: "cuts_openings", revision: { revision: 1 } },
      { id: "landscape", name: "Rain Garden & Path", type: "landscape", bounds: { min: { x: 4, y: 0, z: 24 }, max: { x: 29, y: 1, z: 27 } }, dependencies: ["foundation"], elementIds: ["garden-bed", "path"], seed: "landscape-080", operationPhase: "landscaping", revision: { revision: 1 } },
    ],
  };
}

function cloneDesign(design: DesignProgram): DesignProgram {
  return structuredClone(design);
}

function clampInteger(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function dimensions(bounds: Bounds): Vec3 {
  return { x: bounds.max.x - bounds.min.x + 1, y: bounds.max.y - bounds.min.y + 1, z: bounds.max.z - bounds.min.z + 1 };
}

function componentMaterial(component: DesignComponent, design: DesignProgram) {
  const first = design.elements.find((element) => component.elementIds.includes(element.id) && element.material);
  return first?.material ?? (component.operationPhase === "roof" ? "roof" : component.operationPhase === "landscaping" ? "landscaping" : "foundation");
}

function appendVoxel(target: SceneVoxel[], seen: Set<string>, voxel: SceneVoxel) {
  if (target.length >= MAX_PREVIEW_VOXELS) return;
  const key = `${voxel.x},${voxel.y},${voxel.z}`;
  if (voxel.material === "__carve__") {
    seen.delete(key);
    const index = target.findIndex((candidate) => `${candidate.x},${candidate.y},${candidate.z}` === key);
    if (index >= 0) target.splice(index, 1);
    return;
  }
  if (seen.has(key)) return;
  seen.add(key);
  target.push(voxel);
}

function voxelsForElement(element: DesignElement, componentId: string, target: SceneVoxel[], seen: Set<string>, offset: Vec3 = { x: 0, y: 0, z: 0 }) {
  const material = element.kind === "carve" ? "__carve__" : element.material ?? String(element.wallMaterial ?? "foundation");
  const emitBox = (min: Vec3, max: Vec3, shell = false) => {
    const volume = Math.max(1, (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1));
    const stride = volume > 2_400 ? Math.ceil(Math.cbrt(volume / 2_400)) : 1;
    for (let x = min.x; x <= max.x && target.length < MAX_PREVIEW_VOXELS; x += stride) {
      for (let y = min.y; y <= max.y && target.length < MAX_PREVIEW_VOXELS; y += stride) {
        for (let z = min.z; z <= max.z && target.length < MAX_PREVIEW_VOXELS; z += stride) {
          if (shell && x !== min.x && x !== max.x && y !== min.y && y !== max.y && z !== min.z && z !== max.z) continue;
          appendVoxel(target, seen, { x: x + offset.x, y: y + offset.y, z: z + offset.z, componentId, material });
        }
      }
    }
  };
  if (element.min && element.max) {
    emitBox(element.min, element.max, element.kind === "shell" || element.kind === "basin");
    return;
  }
  if (element.center && element.radius !== undefined && element.height !== undefined) {
    const radius = Math.max(1, Math.round(element.radius));
    for (let y = 0; y < element.height && target.length < MAX_PREVIEW_VOXELS; y += 1) {
      for (let x = -radius; x <= radius; x += 1) for (let z = -radius; z <= radius; z += 1) {
        if (x * x + z * z <= radius * radius) appendVoxel(target, seen, { x: element.center.x + x + offset.x, y: element.center.y + y + offset.y, z: element.center.z + z + offset.z, componentId, material });
      }
    }
    return;
  }
  if (element.from && element.to) emitBox({ x: Math.min(element.from.x, element.to.x), y: Math.min(element.from.y, element.to.y), z: Math.min(element.from.z, element.to.z) }, { x: Math.max(element.from.x, element.to.x), y: Math.max(element.from.y, element.to.y), z: Math.max(element.from.z, element.to.z) });
}

function localPreview(design: DesignProgram, componentState: Record<string, ComponentViewState>): SceneVoxel[] {
  const voxels: SceneVoxel[] = [];
  const seen = new Set<string>();
  const isolated = Object.entries(componentState).find(([, state]) => state.isolated)?.[0];
  for (const component of design.components) {
    if (componentState[component.id]?.hidden || (isolated && isolated !== component.id)) continue;
    for (const elementId of component.elementIds) {
      const element = design.elements.find((candidate) => candidate.id === elementId);
      if (element) voxelsForElement(element, component.id, voxels, seen);
    }
    for (const instance of component.templateInstances ?? []) {
      const template = design.templates.find(({ id }) => id === instance.templateId);
      const origins: Vec3[] = [];
      const base = instance.origin ?? { x: 0, y: 0, z: 0 };
      const repetition = instance.repetition;
      if (!repetition || repetition.kind === undefined) origins.push(base);
      else if (repetition.kind === "position_list" && Array.isArray(repetition.positions)) {
        for (const position of repetition.positions as Vec3[]) origins.push({ x: base.x + position.x, y: base.y + position.y, z: base.z + position.z });
      } else if (repetition.kind === "linear") {
        const count = Number(repetition.count ?? 1);
        const step = repetition.step as Vec3;
        for (let index = 0; index < count; index += 1) origins.push({ x: base.x + step.x * index, y: base.y + step.y * index, z: base.z + step.z * index });
      } else origins.push(base);
      for (const origin of origins) for (const elementId of template?.elementIds ?? []) {
        const element = design.elements.find((candidate) => candidate.id === elementId);
        if (element) voxelsForElement(element, component.id, voxels, seen, origin);
      }
    }
  }
  return voxels;
}

async function localApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/local/editor${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({ error: `The local engine returned HTTP ${response.status}.` })) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `The local engine returned HTTP ${response.status}.`);
  return payload;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneErrorBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.onError(error.message || "The 3D renderer could not start."); }
  render() { return this.state.failed ? null : this.props.children; }
}

function VoxelBatch({ voxels, color, onSelect }: { voxels: SceneVoxel[]; color: string; onSelect: (id: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { invalidate } = useThree();
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    voxels.forEach((voxel, index) => {
      matrix.makeTranslation(voxel.x, voxel.y, voxel.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [invalidate, voxels]);
  return <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, voxels.length)]} castShadow receiveShadow onClick={(event) => {
    event.stopPropagation();
    const voxel = event.instanceId === undefined ? undefined : voxels[event.instanceId];
    if (voxel) onSelect(voxel.componentId);
  }}>
    <boxGeometry args={[0.94, 0.94, 0.94]} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.8} metalness={0.01} />
  </instancedMesh>;
}

function InstanceVoxels({ voxels, selectedId, onSelect }: { voxels: SceneVoxel[]; selectedId?: string; onSelect: (id: string) => void }) {
  const batches = useMemo(() => {
    const groups = new Map<string, SceneVoxel[]>();
    for (const voxel of voxels) {
      const key = voxel.componentId === selectedId ? "__selected__" : voxel.material;
      const group = groups.get(key) ?? [];
      group.push(voxel);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [selectedId, voxels]);
  return <group>{batches.map(([material, entries]) => <VoxelBatch key={material} voxels={entries} color={material === "__selected__" ? "#f1a657" : MATERIAL_COLORS[material] ?? "#879592"} onSelect={onSelect} />)}</group>;
}

function SelectionProxy({ bounds, mode, locked, onCommit }: { bounds: Bounds; mode: ToolMode; locked: boolean; onCommit: (change: { move?: Vec3; size?: Vec3; rotation?: number }) => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const size = dimensions(bounds);
  const center: [number, number, number] = [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2];
  const commit = () => {
    const object = mesh.current;
    if (!object || locked) return;
    if (mode === "move") {
      const move = { x: Math.round(object.position.x - center[0]), y: Math.round(object.position.y - center[1]), z: Math.round(object.position.z - center[2]) };
      if (move.x || move.y || move.z) onCommit({ move });
    } else if (mode === "scale") {
      const next = { x: Math.max(1, Math.round(size.x * object.scale.x)), y: Math.max(1, Math.round(size.y * object.scale.y)), z: Math.max(1, Math.round(size.z * object.scale.z)) };
      if (next.x !== size.x || next.y !== size.y || next.z !== size.z) onCommit({ size: next });
    } else if (mode === "rotate") {
      const degrees = ((Math.round(THREE.MathUtils.radToDeg(object.rotation.y) / 90) * 90) % 360 + 360) % 360;
      if (degrees) onCommit({ rotation: degrees });
    }
  };
  const selectedMesh = <mesh ref={mesh} position={center}>
    <boxGeometry args={[size.x + 0.12, size.y + 0.12, size.z + 0.12]} />
    <meshBasicMaterial color="#ffad5b" transparent opacity={0.11} wireframe />
  </mesh>;
  if (mode === "select" || locked) return selectedMesh;
  return <TransformControls mode={mode === "scale" ? "scale" : mode === "rotate" ? "rotate" : "translate"} translationSnap={1} rotationSnap={Math.PI / 2} scaleSnap={0.25} showX showY showZ onMouseUp={commit}>
    {selectedMesh}
  </TransformControls>;
}

function EditorScene({ voxels, selected, cameraPreset, tool, locked, onSelect, onCommit, onReady, onClear }: {
  voxels: SceneVoxel[];
  selected?: DesignComponent;
  cameraPreset: "iso" | "top" | "front" | "left" | "right";
  tool: ToolMode;
  locked: boolean;
  onSelect: (id: string) => void;
  onCommit: (change: { move?: Vec3; size?: Vec3; rotation?: number }) => void;
  onReady: () => void;
  onClear: () => void;
}) {
  const bounds = useMemo(() => {
    if (!voxels.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 36, y: 18, z: 28 } };
    return voxels.reduce((result, voxel) => ({ min: { x: Math.min(result.min.x, voxel.x), y: Math.min(result.min.y, voxel.y), z: Math.min(result.min.z, voxel.z) }, max: { x: Math.max(result.max.x, voxel.x), y: Math.max(result.max.y, voxel.y), z: Math.max(result.max.z, voxel.z) } }), { min: { ...voxels[0] }, max: { ...voxels[0] } });
  }, [voxels]);
  const center: [number, number, number] = [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2];
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z, 20);
  const camera: Record<typeof cameraPreset, [number, number, number]> = {
    iso: [center[0] + span * 1.15, center[1] + span * 0.8, center[2] + span * 1.15],
    top: [center[0], center[1] + span * 2, center[2] + 0.01],
    front: [center[0], center[1] + span * 0.35, center[2] + span * 1.7],
    left: [center[0] - span * 1.7, center[1] + span * 0.35, center[2]],
    right: [center[0] + span * 1.7, center[1] + span * 0.35, center[2]],
  };
  return <Canvas
    frameloop="demand"
    shadows
    dpr={[1, 1.5]}
    gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    onCreated={({ gl }) => { gl.setClearColor("#0b1115"); onReady(); }}
    onPointerMissed={onClear}
  >
    <color attach="background" args={["#0b1115"]} />
    <ambientLight intensity={2.1} />
    <hemisphereLight intensity={1.2} color="#cce5e8" groundColor="#54624c" />
    <directionalLight castShadow intensity={3.2} position={[25, 42, 20]} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    <PerspectiveCamera key={`${cameraPreset}:${center.join(":")}:${span}`} makeDefault position={camera[cameraPreset]} fov={43} near={0.1} far={1_000} />
    <OrbitControls makeDefault target={center} enableDamping={false} minDistance={4} maxDistance={span * 5} maxPolarAngle={Math.PI / 2.02} />
    <Grid args={[96, 96]} position={[center[0], bounds.min.y - 0.52, center[2]]} cellSize={1} cellThickness={0.4} cellColor="#334148" sectionSize={8} sectionThickness={0.8} sectionColor="#65737a" fadeDistance={100} fadeStrength={1} infiniteGrid />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], bounds.min.y - 0.56, center[2]]} receiveShadow>
      <planeGeometry args={[96, 96]} />
      <meshStandardMaterial color="#17231f" roughness={1} />
    </mesh>
    <InstanceVoxels voxels={voxels} selectedId={selected?.id} onSelect={onSelect} />
    {selected && <SelectionProxy key={`${selected.id}-${selected.revision.revision}-${tool}`} bounds={selected.bounds} mode={tool} locked={locked} onCommit={onCommit} />}
  </Canvas>;
}

function formatDuration(milliseconds = 0) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function StateGlyph({ state }: { state: TaskState }) {
  if (state === "completed") return <CheckCircle2 aria-hidden="true" />;
  if (state === "failed" || state === "interrupted") return <XCircle aria-hidden="true" />;
  if (state === "cancelled" || state === "cancelling") return <CircleStop aria-hidden="true" />;
  return <RefreshCw aria-hidden="true" className="bw-spin" />;
}

function statusTone(state: TaskState) {
  return state === "completed" ? "success" : state === "failed" || state === "interrupted" ? "danger" : state === "cancelled" ? "muted" : "active";
}

function NumericField({ label, value, onChange, disabled, min, max }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; min?: number; max?: number }) {
  return <label className="bw-number-field"><span>{label}</span><input type="number" value={value} min={min} max={max} step={1} disabled={disabled} onChange={(event) => onChange(clampInteger(event.target.valueAsNumber, value))} /></label>;
}

function JsonFacts({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <p className="bw-empty">No data was reported.</p>;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const) : typeof value === "object" ? Object.entries(value as Record<string, unknown>) : [["value", value] as const];
  return <dl className="bw-facts">{entries.map(([key, item]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{typeof item === "object" ? JSON.stringify(item) : String(item)}</dd></div>)}</dl>;
}

function nonDuplicateId(base: string, existing: string[]) {
  const root = base.replace(/-copy(?:-\d+)?$/, "");
  let index = 2;
  let candidate = `${root}-copy`;
  while (existing.includes(candidate)) candidate = `${root}-copy-${index++}`;
  return candidate;
}

function defaultElement(kind: PrimitiveKind, id: string): DesignElement {
  const base = { id: `${id}-shape`, intent: `editable ${kind.replaceAll("_", " ")}`, requirementIds: ["pavilion-contract"], material: "wall" };
  if (kind === "fill" || kind === "shell" || kind === "carve") return { ...base, kind, min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 4, z: 5 }, ...(kind === "shell" ? { thickness: 1 } : {}), ...(kind === "carve" ? { material: undefined } : {}) };
  if (kind === "cylinder") return { ...base, kind, center: { x: 3, y: 0, z: 3 }, radius: 3, height: 5, cap: true };
  if (kind === "basin") return { ...base, kind, min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 2, z: 7 }, wallMaterial: "foundation", floorMaterial: "landscaping", rimMaterial: "trim", wallThickness: 1 };
  if (kind === "stairs" || kind === "ramp") return { ...base, kind, from: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 4, z: 0 }, width: 3 };
  const primitives: Record<Exclude<PrimitiveKind, "fill" | "shell" | "carve" | "cylinder" | "basin" | "stairs" | "ramp">, Record<string, unknown>> = {
    line: { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 4, z: 5 }, thickness: 1 },
    plane: { type: "plane", min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 0, z: 5 }, filled: true },
    circle: { type: "circle", center: { x: 3, y: 0, z: 3 }, radius: 3, axis: "y", filled: false, thickness: 1 },
    ellipse: { type: "ellipse", center: { x: 3, y: 0, z: 3 }, radiusU: 3, radiusV: 2, axis: "y", filled: false, thickness: 1 },
    sphere: { type: "sphere", center: { x: 3, y: 3, z: 3 }, radius: 3, hollow: false },
    cone: { type: "cone", baseCenter: { x: 3, y: 0, z: 3 }, radius: 3, height: 6, direction: "up", hollow: false },
    pyramid: { type: "pyramid", min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 6, z: 6 }, hollow: false },
    polygon: { type: "polygon", points: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 3, y: 0, z: 6 }], filled: true },
    rounded_rectangle: { type: "rounded_rectangle", min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 0, z: 5 }, radius: 2, filled: true },
    extrusion: { type: "extrusion", origin: { x: 0, y: 0, z: 0 }, profile: { plane: "xy", points: [{ u: 0, v: 0 }, { u: 4, v: 0 }, { u: 4, v: 4 }, { u: 0, v: 4 }], filled: true }, offset: { x: 0, y: 0, z: 6 } },
    profile_extrusion: { type: "profile_extrusion", profile: { plane: "xy", points: [{ u: 0, v: 0 }, { u: 3, v: 0 }, { u: 3, v: 3 }, { u: 0, v: 3 }], filled: true }, path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 }] },
    roof_plane: { type: "roof_plane", min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 4, z: 7 }, slopeAxis: "x", highSide: "max", thickness: 1 },
    roof_ridge: { type: "roof_ridge", min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 5, z: 8 }, ridgeAxis: "z", thickness: 1 },
    terrain_surface: { type: "terrain_surface", min: { x: 0, y: 0, z: 0 }, max: { x: 11, y: 4, z: 11 }, baseY: 1, amplitude: 3, scale: 6, seed: `${id}-terrain` },
  };
  return { ...base, kind: "procedural", primitive: primitives[kind], operation: "add" };
}

function findMaterial(element: DesignElement | undefined) {
  return element?.material ?? String(element?.wallMaterial ?? "foundation");
}

function taskFromPayload(value: unknown): TaskSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  const task = (payload.task ?? payload) as Partial<TaskSnapshot>;
  return typeof task.id === "string" && typeof task.state === "string" ? task as TaskSnapshot : undefined;
}

function buildFromPayload(value: unknown): BuildSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  const candidates = [payload.build, payload.result, (payload.result as Record<string, unknown> | undefined)?.build, payload.summary];
  for (const candidate of candidates) if (candidate && typeof candidate === "object" && typeof (candidate as BuildSummary).id === "string") return candidate as BuildSummary;
  return undefined;
}

function sortTasks(tasks: TaskSnapshot[]): TaskSnapshot[] {
  return [...tasks].sort((a, b) => {
    const aUpdated = Date.parse(a.timing?.updatedAt ?? a.timing?.queuedAt ?? "");
    const bUpdated = Date.parse(b.timing?.updatedAt ?? b.timing?.queuedAt ?? "");
    return (Number.isFinite(bUpdated) ? bUpdated : 0) - (Number.isFinite(aUpdated) ? aUpdated : 0);
  });
}

export default function ProceduralEditor() {
  const seed = useMemo(createSeededDesign, []);
  const [design, setDesign] = useState<DesignProgram>(() => cloneDesign(seed));
  const [lastCompiledJson, setLastCompiledJson] = useState("");
  const [selectedId, setSelectedId] = useState(seed.components[0]?.id ?? "");
  const [componentState, setComponentState] = useState<Record<string, ComponentViewState>>({});
  const [activeSection, setActiveSection] = useState<NavSection>("editor");
  const [tool, setTool] = useState<ToolMode>("select");
  const [cameraPreset, setCameraPreset] = useState<"iso" | "top" | "front" | "left" | "right">("iso");
  const [primitiveKind, setPrimitiveKind] = useState<PrimitiveKind>("fill");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [build, setBuild] = useState<BuildSummary>();
  const [serverPlacements, setServerPlacements] = useState<SceneVoxel[]>([]);
  const [placementTotal, setPlacementTotal] = useState(0);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [diagnostics, setDiagnostics] = useState<unknown>();
  const [hardware, setHardware] = useState<unknown>();
  const [serverVersion, setServerVersion] = useState<string>();
  const [connection, setConnection] = useState<"checking" | "connected" | "unavailable">("checking");
  const [notice, setNotice] = useState("Loading the PC-local editor service…");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string>();
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string>();
  const [webglAvailable] = useState(supportsWebGL);
  const [showOutline, setShowOutline] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ structure: true, envelope: true, site: true });
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [terrainJson, setTerrainJson] = useState("");
  const [terrainSource, setTerrainSource] = useState("No snapshot loaded");
  const [terrainStrategy, setTerrainStrategy] = useState<TerrainStrategy>("flat_pad");
  const [terrainBlendRadius, setTerrainBlendRadius] = useState(4);
  const [terrainMaxCut, setTerrainMaxCut] = useState(3);
  const [terrainMaxFill, setTerrainMaxFill] = useState(5);
  const [terrainWaterPolicy, setTerrainWaterPolicy] = useState<TerrainWaterPolicy>("preserve");
  const [terrainOffset, setTerrainOffset] = useState(0);
  const [terrainRotation, setTerrainRotation] = useState<TerrainRotation>(0);
  const [terrainAllowMirror, setTerrainAllowMirror] = useState(false);
  const [terrainAllowRetaining, setTerrainAllowRetaining] = useState(true);
  const [terrainAllowTerraces, setTerrainAllowTerraces] = useState(true);
  const [terrainRunning, setTerrainRunning] = useState(false);
  const [terrainError, setTerrainError] = useState<string>();
  const [terrainResult, setTerrainResult] = useState<TerrainFitResponse>();
  const pendingDesign = useRef(new Map<string, string>());
  const loadedBuildId = useRef<string>();

  const selected = design.components.find(({ id }) => id === selectedId);
  const selectedState = selected ? componentState[selected.id] ?? {} : {};
  const selectedUsesProceduralGeometry = selected ? componentUsesProceduralGeometry(selected, design) : false;
  const selectedResizeBlocked = Boolean(selected && !componentCanResizeExactly(selected, design));
  const selectedRotateMirrorBlocked = Boolean(selected && !componentCanRotateOrMirrorExactly(selected, design));
  const selectedRepetition = (selected?.templateInstances?.[0]?.repetition?.kind as RepetitionKind | undefined) ?? "none";
  const designJson = useMemo(() => JSON.stringify(design), [design]);
  const dirty = designJson !== lastCompiledJson;
  const localVoxels = useMemo(() => localPreview(design, componentState), [componentState, design]);
  const visibleServerPlacements = useMemo(() => {
    if (!serverPlacements.length) return [];
    const isolated = Object.entries(componentState).find(([, state]) => state.isolated)?.[0];
    return serverPlacements.filter((placement) => !componentState[placement.componentId]?.hidden && (!isolated || placement.componentId === isolated));
  }, [componentState, serverPlacements]);
  const sceneVoxels = visibleServerPlacements.length ? visibleServerPlacements : localVoxels;
  const sceneMinY = sceneVoxels.length ? Math.min(...sceneVoxels.map(({ y }) => y)) : 0;
  const sceneMaxY = sceneVoxels.length ? Math.max(...sceneVoxels.map(({ y }) => y)) : 0;
  const activeTask = tasks.find(({ id }) => id === activeTaskId) ?? tasks.find(({ state }) => ACTIVE_STATES.has(state)) ?? tasks[0];

  useEffect(() => {
    if ((selectedResizeBlocked && tool === "scale") || (selectedRotateMirrorBlocked && tool === "rotate")) setTool("select");
  }, [selectedResizeBlocked, selectedRotateMirrorBlocked, tool]);

  useEffect(() => {
    document.body.classList.add("bw-editor-body");
    return () => document.body.classList.remove("bw-editor-body");
  }, []);

  useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 920px)");
    const closeOverlayPanels = () => {
      if (!narrowViewport.matches) return;
      setShowOutline(false);
      setShowInspector(false);
    };
    closeOverlayPanels();
    narrowViewport.addEventListener("change", closeOverlayPanels);
    return () => narrowViewport.removeEventListener("change", closeOverlayPanels);
  }, []);

  const applyDesign = useCallback((mutator: (draft: DesignProgram) => void) => {
    setDesign((current) => {
      const draft = cloneDesign(current);
      mutator(draft);
      return draft;
    });
    setServerPlacements([]);
    setPlacementTotal(0);
  }, []);

  const loadPlacements = useCallback(async (buildId: string) => {
    if (loadedBuildId.current === buildId) return;
    const collected: SceneVoxel[] = [];
    let offset = 0;
    let total = 0;
    try {
      do {
        const page = await localApi<{ buildId: string; placements: Placement[]; offset: number; limit: number; returned: number; total: number }>(`/builds/${encodeURIComponent(buildId)}/placements?offset=${offset}&limit=${PLACEMENT_PAGE_LIMIT}`);
        total = page.total;
        for (const placement of page.placements ?? []) collected.push({ ...placement, componentId: placement.componentId ?? "compiled", material: placement.block ?? placement.material ?? "foundation" });
        offset += page.returned;
        if (!page.returned) break;
      } while (offset < total && collected.length < MAX_PREVIEW_VOXELS);
      loadedBuildId.current = buildId;
      setServerPlacements(collected.slice(0, MAX_PREVIEW_VOXELS));
      setPlacementTotal(total);
      setNotice(`Loaded ${Math.min(collected.length, MAX_PREVIEW_VOXELS).toLocaleString()} of ${total.toLocaleString()} compiled placements into the bounded viewport.`);
    } catch (error) {
      setNotice(error instanceof Error ? `The build completed, but its placement page could not be loaded: ${error.message}` : "The build completed, but its placement page could not be loaded.");
    }
  }, []);

  const mergeTask = useCallback((task: TaskSnapshot) => {
    setTasks((current) => sortTasks([task, ...current.filter(({ id }) => id !== task.id)]));
  }, []);

  const refreshTask = useCallback(async (taskId: string) => {
    const payload = await localApi<Record<string, unknown>>(`/tasks/${encodeURIComponent(taskId)}`);
    const task = taskFromPayload(payload);
    if (task) {
      mergeTask(task);
      if (task.state === "completed") {
        const submitted = pendingDesign.current.get(task.id);
        if (submitted) setLastCompiledJson(submitted);
        setNotice(`Task ${task.id} completed. Loading its bounded build evidence…`);
      } else if (task.state === "failed" || task.state === "interrupted") {
        setNotice(`Task ${task.id} ${task.state}: ${task.diagnostic?.code ?? "TASK_FAILED"}. ${task.diagnostic?.recommendedAction ?? "Open Tasks to review the diagnostic."}`);
      } else if (task.state === "cancelled") {
        setNotice(`Task ${task.id} was cancelled. No build result was committed.`);
      }
    }
    const nextBuild = buildFromPayload(payload);
    if (nextBuild) {
      setBuild(nextBuild);
      if (task?.state === "completed") await loadPlacements(nextBuild.id);
    }
    return task;
  }, [loadPlacements, mergeTask]);

  const refreshTasks = useCallback(async (silent = false) => {
    try {
      const payload = await localApi<{ tasks: TaskSnapshot[] }>("/tasks");
      setTasks(sortTasks(payload.tasks ?? []));
      if (!silent) setNotice(`Refreshed ${payload.tasks?.length ?? 0} retained task record${payload.tasks?.length === 1 ? "" : "s"}.`);
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : "Tasks could not be refreshed.");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    localApi<Bootstrap>("/bootstrap").then((payload) => {
      if (disposed) return;
      setConnection("connected");
      setServerVersion(payload.version);
      setTasks(sortTasks(payload.tasks ?? []));
      setProviders(Array.isArray(payload.providers) ? payload.providers : payload.providers?.providers ?? []);
      setDiagnostics(payload.diagnostics);
      setHardware(payload.hardware);
      setNotice(`PC-local engine ${payload.version ? `v${payload.version} ` : ""}is ready. Edits remain local until you start a compile task.`);
    }).catch((error) => {
      if (disposed) return;
      setConnection("unavailable");
      setNotice(error instanceof Error ? `Local editor service unavailable: ${error.message} Your seeded design is still editable in this page.` : "Local editor service unavailable. Your seeded design is still editable in this page.");
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!activeTask || TERMINAL_STATES.has(activeTask.state)) return;
    const timer = window.setInterval(() => { void refreshTask(activeTask.id).catch((error) => setNotice(error instanceof Error ? error.message : "Task status could not be refreshed.")); }, 1_200);
    return () => window.clearInterval(timer);
  }, [activeTask?.id, activeTask?.state, refreshTask]);

  const startCompile = async () => {
    if (submitting) return;
    setSubmitting(true);
    setNotice("Submitting the exact current Design IR to the PC-local task queue…");
    const buildInput = {
      name: "Riverlight Pavilion",
      edition: "java",
      version: "26.2",
      style: "contemporary craft pavilion",
      sourceBrief: "A complete, editable pavilion with foundation, structure, enclosure, roof, openings, and landscaping.",
      dimensions: { width: 36, depth: 28, height: 18 },
      origin: { x: 0, y: 64, z: 0 },
      blockBudget: 150_000,
      seed: "riverlight-pavilion-080",
      rolePalette: {
        foundation: "minecraft:polished_andesite", wall: "minecraft:calcite", frame: "minecraft:stripped_dark_oak_log", roof: "minecraft:deepslate_tiles", trim: "minecraft:cut_copper", glazing: "minecraft:tinted_glass", lighting: "minecraft:ochre_froglight", doors: "minecraft:dark_oak_door", railings: "minecraft:dark_oak_fence", accents: "minecraft:oxidized_cut_copper", landscaping: "minecraft:moss_block",
      },
      design,
    };
    try {
      const payload = await localApi<Record<string, unknown>>("/compile", { method: "POST", body: JSON.stringify({ buildInput }) });
      const task = taskFromPayload(payload);
      if (!task) throw new Error("The engine accepted the request but did not return a readable task snapshot.");
      pendingDesign.current.set(task.id, designJson);
      mergeTask(task);
      setActiveTaskId(task.id);
      setNotice(`Compile task ${task.id} was accepted in state “${task.state}”.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The compile task was not accepted.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelTask = async (taskId: string) => {
    setCancelling(taskId);
    try {
      const payload = await localApi<Record<string, unknown>>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", body: "{}" });
      const task = taskFromPayload(payload);
      if (!task) throw new Error("The engine did not return the cancellation state.");
      mergeTask(task);
      setNotice(`Task ${task.id} is now “${task.state}”.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The task could not be cancelled.");
    } finally {
      setCancelling(undefined);
    }
  };

  const loadTerrainSample = () => {
    setTerrainJson(JSON.stringify(createDeterministicTerrainSample(), null, 2));
    setTerrainSource("Bundled deterministic sample snapshot");
    setTerrainError(undefined);
    setTerrainResult(undefined);
  };

  const loadTerrainFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      setTerrainError("That snapshot is larger than the editor's 16 MB upload guard. Export a smaller bounded region.");
      return;
    }
    try {
      const value = await file.text();
      JSON.parse(value);
      setTerrainJson(value);
      setTerrainSource(file.name);
      setTerrainError(undefined);
      setTerrainResult(undefined);
    } catch {
      setTerrainError("The selected file is not valid JSON. No request was sent.");
    }
  };

  const runTerrainPreview = async () => {
    if (!build || terrainRunning) return;
    let region: unknown;
    try {
      if (!terrainJson.trim()) throw new Error("Paste a TerrainWorldRegion snapshot or choose a JSON file first.");
      region = JSON.parse(terrainJson);
    } catch (error) {
      setTerrainError(error instanceof Error ? error.message : "The snapshot is not valid JSON.");
      return;
    }
    setTerrainRunning(true);
    setTerrainError(undefined);
    setTerrainResult(undefined);
    setNotice(`Requesting a read-only TerrainFit analysis for completed build ${build.id}…`);
    try {
      const payload = await localApi<TerrainFitResponse>(`/builds/${encodeURIComponent(build.id)}/terrain-fit`, {
        method: "POST",
        body: JSON.stringify({
          region,
          options: {
            terrainInterface: {
              strategy: terrainStrategy,
              maxCutDepth: terrainMaxCut,
              maxFillHeight: terrainMaxFill,
              allowRetainingWalls: terrainAllowRetaining,
              allowTerraces: terrainAllowTerraces,
              blendRadius: terrainBlendRadius,
              waterPolicy: terrainWaterPolicy,
            },
            maximumHorizontalOffset: terrainOffset,
            rotations: [terrainRotation],
            allowMirror: terrainAllowMirror,
            maximumCandidates: 32,
            maximumFootprintColumns: 262_144,
            pathSearchLimit: 100_000,
          },
          detailOffset: 0,
          detailLimit: 120,
        }),
      });
      if (payload.snapshotValidated !== true || payload.worldWritePerformed !== false || payload.installationBoundary !== "read_only_preview") {
        throw new Error("The engine response did not contain the required read-only boundary evidence.");
      }
      setTerrainResult(payload);
      setNotice(`TerrainFit preview ${payload.terrain.previewId} returned with ${payload.terrain.risk} risk. The server reports that no world write was performed.`);
    } catch (error) {
      setTerrainError(error instanceof Error ? error.message : "TerrainFit could not analyze this snapshot.");
      setNotice("TerrainFit did not return a preview. No success state was recorded.");
    } finally {
      setTerrainRunning(false);
    }
  };

  useEffect(() => {
    setTerrainResult(undefined);
    setTerrainError(undefined);
  }, [build?.id]);

  const selectComponent = (id: string) => {
    setSelectedId(id);
    setActiveSection("editor");
    setShowInspector(true);
  };

  const mutateSelected = (mutator: (component: DesignComponent, draft: DesignProgram) => void, message: string) => {
    if (!selected || selectedState.locked) return;
    applyDesign((draft) => {
      const component = draft.components.find(({ id }) => id === selected.id);
      if (!component) return;
      mutator(component, draft);
      component.revision = { parentRevision: component.revision.revision, revision: component.revision.revision + 1, message };
    });
  };

  const translateSelected = (delta: Vec3) => mutateSelected((component, draft) => {
    const move = (point: Vec3) => { point.x += delta.x; point.y += delta.y; point.z += delta.z; };
    move(component.bounds.min); move(component.bounds.max);
    for (const element of draft.elements.filter(({ id }) => component.elementIds.includes(id))) {
      translateDesignElement(element, delta);
    }
    for (const instance of component.templateInstances ?? []) translateTemplateInstance(instance, delta);
  }, "Moved component with exact integer coordinates");

  const resizeSelected = (nextSize: Vec3) => {
    if (!selected || selectedState.locked || selectedResizeBlocked) return;
    mutateSelected((component, draft) => {
    const old = dimensions(component.bounds);
    const min = { ...component.bounds.min };
    const ratios = { x: (nextSize.x - 1) / Math.max(1, old.x - 1), y: (nextSize.y - 1) / Math.max(1, old.y - 1), z: (nextSize.z - 1) / Math.max(1, old.z - 1) };
    const scalePoint = (point: Vec3) => {
      point.x = min.x + Math.round((point.x - min.x) * (nextSize.x - 1) / Math.max(1, old.x - 1));
      point.y = min.y + Math.round((point.y - min.y) * (nextSize.y - 1) / Math.max(1, old.y - 1));
      point.z = min.z + Math.round((point.z - min.z) * (nextSize.z - 1) / Math.max(1, old.z - 1));
    };
    component.bounds.max = { x: min.x + nextSize.x - 1, y: min.y + nextSize.y - 1, z: min.z + nextSize.z - 1 };
    for (const element of draft.elements.filter(({ id }) => component.elementIds.includes(id))) {
      if (element.min) scalePoint(element.min); if (element.max) scalePoint(element.max); if (element.center) scalePoint(element.center); if (element.from) scalePoint(element.from); if (element.to) scalePoint(element.to); element.points?.forEach(scalePoint);
      if (element.primitive) for (const key of ["min", "max", "center", "baseCenter", "origin", "from", "to"]) { const point = element.primitive[key]; if (point && typeof point === "object" && "x" in point) scalePoint(point as Vec3); }
    }
    for (const instance of component.templateInstances ?? []) {
      if (instance.origin) scalePoint(instance.origin);
      const repetition = instance.repetition;
      if (!repetition) continue;
      for (const key of ["step", "alternateOffset"] as const) {
        const vector = repetition[key] as Vec3 | undefined;
        if (vector) { vector.x = Math.round(vector.x * ratios.x); vector.y = Math.round(vector.y * ratios.y); vector.z = Math.round(vector.z * ratios.z); }
      }
      if (Array.isArray(repetition.positions)) for (const vector of repetition.positions as Vec3[]) { vector.x = Math.round(vector.x * ratios.x); vector.y = Math.round(vector.y * ratios.y); vector.z = Math.round(vector.z * ratios.z); }
      if (repetition.center && typeof repetition.center === "object") scalePoint(repetition.center as Vec3);
      if (typeof repetition.radius === "number") repetition.radius = Math.max(1, Math.round(repetition.radius * (ratios.x + ratios.z) / 2));
    }
    }, "Resized component with integer coordinate resampling");
  };

  const rotateSelected = (degrees: number) => {
    if (!selected || selectedState.locked || selectedRotateMirrorBlocked) return;
    const targetId = selected.id;
    mutateSelected((component, draft) => {
    const normalized = ((degrees % 360) + 360) % 360;
    const center = { x: (component.bounds.min.x + component.bounds.max.x) / 2, y: (component.bounds.min.y + component.bounds.max.y) / 2, z: (component.bounds.min.z + component.bounds.max.z) / 2 };
    const rotate = (point: Vec3) => {
      let x = point.x - center.x;
      let z = point.z - center.z;
      const turns = normalized / 90;
      for (let index = 0; index < turns; index += 1) [x, z] = [-z, x];
      point.x = Math.round(center.x + x); point.z = Math.round(center.z + z);
    };
    const nextComponentBounds = rotateBoundsY(component.bounds, normalized);
    for (const element of draft.elements.filter(({ id }) => component.elementIds.includes(id))) {
      for (const point of [element.min, element.max, element.center, element.from, element.to]) if (point) rotate(point);
      element.points?.forEach(rotate);
      if (element.min && element.max) {
        const low = { x: Math.min(element.min.x, element.max.x), y: Math.min(element.min.y, element.max.y), z: Math.min(element.min.z, element.max.z) };
        const high = { x: Math.max(element.min.x, element.max.x), y: Math.max(element.min.y, element.max.y), z: Math.max(element.min.z, element.max.z) };
        element.min = low; element.max = high;
      }
    }
    const rotateVector = (vector: Vec3) => {
      let x = vector.x;
      let z = vector.z;
      for (let index = 0; index < normalized / 90; index += 1) [x, z] = [-z, x];
      vector.x = Math.round(x); vector.z = Math.round(z);
    };
    for (const instance of component.templateInstances ?? []) {
      if (instance.origin) rotate(instance.origin);
      const repetition = instance.repetition;
      if (!repetition) continue;
      for (const key of ["step", "alternateOffset"] as const) { const vector = repetition[key] as Vec3 | undefined; if (vector) rotateVector(vector); }
      if (Array.isArray(repetition.positions)) (repetition.positions as Vec3[]).forEach(rotateVector);
      if (repetition.center && typeof repetition.center === "object") rotate(repetition.center as Vec3);
      if (repetition.axis === "x" && (normalized === 90 || normalized === 270)) repetition.axis = "z";
      else if (repetition.axis === "z" && (normalized === 90 || normalized === 270)) repetition.axis = "x";
    }
    component.bounds = nextComponentBounds;
    }, `Rotated component ${degrees} degrees around Y`);
    setComponentState((current) => ({ ...current, [targetId]: { ...current[targetId], rotation: ((current[targetId]?.rotation ?? 0) + degrees + 360) % 360 } }));
  };

  const mirrorSelected = (axis: "x" | "z") => {
    if (!selected || selectedState.locked || selectedRotateMirrorBlocked) return;
    mutateSelected((component, draft) => {
      const low = component.bounds.min[axis];
      const high = component.bounds.max[axis];
      const mirror = (point: Vec3) => { point[axis] = low + high - point[axis]; };
      for (const element of draft.elements.filter(({ id }) => component.elementIds.includes(id))) {
        for (const point of [element.min, element.max, element.center, element.from, element.to]) if (point) mirror(point);
        element.points?.forEach(mirror);
        if (element.min && element.max && element.min[axis] > element.max[axis]) [element.min[axis], element.max[axis]] = [element.max[axis], element.min[axis]];
      }
      for (const instance of component.templateInstances ?? []) {
        if (instance.origin) mirror(instance.origin);
        const repetition = instance.repetition;
        if (!repetition) continue;
        for (const key of ["step", "alternateOffset"] as const) { const vector = repetition[key] as Vec3 | undefined; if (vector) vector[axis] *= -1; }
        if (Array.isArray(repetition.positions)) for (const vector of repetition.positions as Vec3[]) vector[axis] *= -1;
        if (repetition.center && typeof repetition.center === "object") mirror(repetition.center as Vec3);
      }
    }, `Mirrored component across ${axis.toUpperCase()}`);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const componentId = nonDuplicateId(selected.id, design.components.map(({ id }) => id));
    applyDesign((draft) => {
      const source = draft.components.find(({ id }) => id === selected.id)!;
      const copy = structuredClone(source);
      copy.id = componentId;
      copy.name = `${source.name} Copy`;
      copy.seed = `${source.seed}-copy`;
      copy.bounds.min.x += 2; copy.bounds.max.x += 2;
      copy.revision = { revision: 1, message: `Duplicated from ${source.id}` };
      const idMap = new Map<string, string>();
      for (const elementId of source.elementIds) {
        const element = draft.elements.find(({ id }) => id === elementId);
        if (!element) continue;
        const next = structuredClone(element);
        next.id = nonDuplicateId(element.id, draft.elements.map(({ id }) => id).concat([...idMap.values()]));
        idMap.set(element.id, next.id);
        translateDesignElement(next, { x: 2, y: 0, z: 0 });
        draft.elements.push(next);
      }
      copy.elementIds = copy.elementIds.map((id) => idMap.get(id) ?? id);
      for (const instance of copy.templateInstances ?? []) translateTemplateInstance(instance, { x: 2, y: 0, z: 0 });
      draft.components.push(copy);
      const requirementRecord = draft.requirements[0] as { elementIds?: string[] };
      requirementRecord.elementIds?.push(...copy.elementIds);
    });
    setSelectedId(componentId);
    setNotice(`Duplicated ${selected.name} as an independent component. Compile to validate the new graph.`);
  };

  const deleteSelected = () => {
    if (!selected || selectedState.locked) return;
    if (!window.confirm(`Delete ${selected.name} and its directly owned primitive operations?`)) return;
    applyDesign((draft) => {
      const owned = new Set(selected.elementIds);
      draft.components = draft.components.filter(({ id }) => id !== selected.id).map((component) => ({ ...component, dependencies: component.dependencies.filter((id) => id !== selected.id) }));
      draft.elements = draft.elements.filter(({ id }) => !owned.has(id));
      const requirementRecord = draft.requirements[0] as { elementIds?: string[] };
      if (requirementRecord.elementIds) requirementRecord.elementIds = requirementRecord.elementIds.filter((id) => !owned.has(id));
    });
    setSelectedId(design.components.find(({ id }) => id !== selected.id)?.id ?? "");
  };

  const addPrimitive = () => {
    const id = nonDuplicateId(primitiveKind.replaceAll("_", "-"), design.components.map(({ id }) => id));
    const element = defaultElement(primitiveKind, id);
    const bounds: Bounds = element.min && element.max ? { min: { ...element.min }, max: { ...element.max } } : { min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 6, z: 7 } };
    applyDesign((draft) => {
      draft.elements.push(element);
      draft.components.push({ id, name: PRIMITIVES.find(({ value }) => value === primitiveKind)?.label ?? primitiveKind, type: primitiveKind, bounds, dependencies: [], elementIds: [element.id], seed: `${id}-080`, operationPhase: primitiveKind === "carve" ? "cuts_openings" : primitiveKind.includes("roof") ? "roof" : primitiveKind === "terrain_surface" ? "landscaping" : "detail", revision: { revision: 1, message: "Created in the no-model editor" } });
      const requirementRecord = draft.requirements[0] as { elementIds?: string[] };
      requirementRecord.elementIds?.push(element.id);
    });
    setSelectedId(id);
    setNotice(`Created ${primitiveKind.replaceAll("_", " ")} component locally. It has not been compiled yet.`);
  };

  const convertToTemplate = () => {
    if (!selected || selectedState.locked || !selected.elementIds.length) return;
    mutateSelected((component, draft) => {
      const id = nonDuplicateId(`${component.id}-template`, draft.templates.map(({ id }) => id));
      draft.templates.push({ id, name: `${component.name} template`, elementIds: [...component.elementIds] });
      component.templateInstances = [...(component.templateInstances ?? []), { id: `${component.id}-instance`, templateId: id, origin: { x: 0, y: 0, z: 0 } }];
      component.elementIds = [];
    }, "Converted owned operations to a reusable template reference");
  };

  const changeRepetition = (kind: RepetitionKind) => {
    if (!selected || selectedState.locked) return;
    mutateSelected((component) => {
      const instance = component.templateInstances?.[0];
      if (!instance) return;
      const choices: Record<Exclude<RepetitionKind, "none">, Record<string, unknown>> = {
        linear: { kind: "linear", count: 4, step: { x: 4, y: 0, z: 0 } },
        grid: { kind: "grid", count: { x: 3, y: 1, z: 3 }, step: { x: 4, y: 0, z: 4 } },
        radial: { kind: "radial", count: 8, center: { x: 0, y: 0, z: 0 }, radius: 8, startAngleDegrees: 0 },
        mirrored: { kind: "mirrored", axis: "x", coordinate: Math.round((component.bounds.min.x + component.bounds.max.x) / 2) },
        alternating: { kind: "alternating", count: 4, step: { x: 4, y: 0, z: 0 }, alternateOffset: { x: 0, y: 1, z: 0 } },
        position_list: { kind: "position_list", positions: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }] },
      };
      instance.repetition = kind === "none" ? undefined : choices[kind];
    }, kind === "none" ? "Removed template repetition" : `Applied ${kind.replaceAll("_", " ")} repetition`);
  };

  const setSelectedMaterial = (material: string) => mutateSelected((component, draft) => {
    const element = draft.elements.find(({ id }) => component.elementIds.includes(id) && id !== "front-door");
    if (element) element.material = material;
    else if (component.templateInstances?.[0]) component.templateInstances[0].materialOverrides = { ...(component.templateInstances[0].materialOverrides ?? {}), frame: material };
  }, `Changed component material to ${material}`);

  const setBooleanOperation = (operation: string) => mutateSelected((component, draft) => {
    const element = draft.elements.find(({ id }) => component.elementIds.includes(id) && id !== "front-door");
    if (element?.kind === "procedural") element.operation = operation;
  }, `Changed procedural boolean operation to ${operation}`);

  const toggleComponentClip = () => mutateSelected((component, draft) => {
    const element = draft.elements.find(({ id }) => component.elementIds.includes(id) && id !== "front-door");
    if (element?.kind !== "procedural") return;
    element.clip = element.clip ? undefined : structuredClone(component.bounds);
  }, selectedElement?.clip ? "Removed component-bounds clip" : "Clipped procedural operation to component bounds");

  const addPaletteMaterial = () => {
    const names = Object.keys(design.materials);
    let index = names.length + 1;
    let name = `material_${index}`;
    while (names.includes(name)) name = `material_${++index}`;
    applyDesign((draft) => { draft.materials[name] = "minecraft:stone"; });
    setNotice(`Added ${name} with minecraft:stone as its exact starting block. It has not been compiled yet.`);
  };

  const updateMaterialDefinition = (name: string, value: string) => applyDesign((draft) => {
    const definition = draft.materials[name];
    if (typeof definition === "string") draft.materials[name] = value;
    else if (definition && typeof definition === "object" && "id" in definition) (definition as { id: string }).id = value;
    else if (definition && typeof definition === "object" && "block" in definition) (definition as { block: string }).block = value;
  });

  const updateMaterialWeight = (name: string, materialIndex: number, weight: number) => applyDesign((draft) => {
    const definition = draft.materials[name] as { blocks?: Array<{ weight?: number }> } | undefined;
    if (definition?.blocks?.[materialIndex]) definition.blocks[materialIndex].weight = Math.max(1, weight);
  });

  const resetExample = () => {
    if (dirty && !window.confirm("Discard current local edits and reload the deterministic pavilion example?")) return;
    const next = createSeededDesign();
    setDesign(next); setSelectedId(next.components[0]?.id ?? ""); setComponentState({}); setServerPlacements([]); setBuild(undefined); setLastCompiledJson("");
    setNotice("Reloaded the deterministic example. No server or world state was changed.");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && terrainOpen) { setTerrainOpen(false); return; }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.ctrlKey && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); return; }
      if (event.key === "Delete") { event.preventDefault(); deleteSelected(); return; }
      if (event.key === "Escape") { setComponentState((current) => Object.fromEntries(Object.entries(current).map(([id, state]) => [id, { ...state, isolated: false }]))); setTool("select"); return; }
      if (!selected || selectedState.locked) return;
      const delta = event.shiftKey ? 4 : 1;
      const moves: Record<string, Vec3> = { ArrowLeft: { x: -delta, y: 0, z: 0 }, ArrowRight: { x: delta, y: 0, z: 0 }, ArrowUp: { x: 0, y: 0, z: -delta }, ArrowDown: { x: 0, y: 0, z: delta } };
      if (moves[event.key]) { event.preventDefault(); translateSelected(moves[event.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedSize = selected ? dimensions(selected.bounds) : undefined;
  const selectedElement = selected ? design.elements.find(({ id }) => selected.elementIds.includes(id)) : undefined;
  const materialOptions = Object.keys(design.materials);
  const filteredComponents = design.components.filter((component) => `${component.name} ${component.id} ${component.type}`.toLowerCase().includes(search.toLowerCase()));
  const phaseGroups = [
    { id: "structure", label: "Structure", phases: ["terrain_foundation", "primary_mass", "structure"] },
    { id: "envelope", label: "Envelope", phases: ["walls", "roof", "cuts_openings", "trim", "detail", "lighting"] },
    { id: "site", label: "Site", phases: ["landscaping", "explicit_overrides"] },
  ];

  const outlineKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const items = filteredComponents.map(({ id: componentId }) => componentId);
    const index = items.indexOf(id);
    const nextIndex = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : -1;
    if (nextIndex >= 0) {
      event.preventDefault();
      setSelectedId(items[nextIndex]);
      document.querySelector<HTMLButtonElement>(`[data-component-id="${CSS.escape(items[nextIndex])}"]`)?.focus();
    }
  };

  const renderTaskTable = (compact = false) => <div className={compact ? "bw-task-list compact" : "bw-task-list"}>
    {tasks.length === 0 ? <p className="bw-empty">No compile task has been accepted in this local workspace.</p> : tasks.map((task) => <button key={task.id} type="button" className={`bw-task-row ${activeTaskId === task.id ? "selected" : ""}`} onClick={() => { setActiveTaskId(task.id); if (!compact) void refreshTask(task.id).catch((error) => setNotice(error instanceof Error ? error.message : "Task status could not be loaded.")); }}>
      <span className={`bw-state ${statusTone(task.state)}`}><StateGlyph state={task.state} />{task.state}</span>
      <span><strong>{task.progress?.operation ?? task.operation}</strong><small>{task.progress?.detail ?? task.id}</small></span>
      <span className="bw-task-work"><b>{task.progress?.work?.completedUnits?.toLocaleString() ?? "—"}</b><small>{task.progress?.work?.totalUnits ? ` / ${task.progress.work.totalUnits.toLocaleString()} ${task.progress.work.unit}` : task.progress?.work?.unit ?? "units not reported"}</small></span>
      <time>{formatDuration(task.timing?.elapsedMs)}</time>
    </button>)}
  </div>;

  return <div className="bw-app" data-editor-ready="true">
    <header className="bw-topbar">
      <a className="bw-wordmark" href="#" aria-label="Blockwright home"><span aria-hidden="true"><i /><i /><i /><i /></span><b>BLOCKWRIGHT</b><small>0.8 EDITOR</small></a>
      <div className="bw-breadcrumb"><span>Builds</span><ChevronRight /><strong>Riverlight Pavilion</strong><em>{dirty ? "Local edits" : "Compiled revision"}</em></div>
      <div className="bw-top-actions">
        <button type="button" className="bw-icon-button bw-panel-toggle" onClick={() => setShowOutline((value) => !value)} aria-label={showOutline ? "Hide component outline" : "Show component outline"}>{showOutline ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
        <span className={`bw-connection ${connection}`}><i />{connection === "connected" ? `Engine ${serverVersion ? `v${serverVersion}` : "ready"}` : connection === "checking" ? "Checking engine" : "Edit-only mode"}</span>
        <button type="button" className="bw-secondary-action" onClick={resetExample}><RotateCcw />Reset example</button>
        <button type="button" className="bw-primary-action" disabled={submitting || connection !== "connected"} onClick={() => void startCompile()}><Play />{submitting ? "Submitting…" : "Compile build"}</button>
        <button type="button" className="bw-icon-button bw-panel-toggle" onClick={() => setShowInspector((value) => !value)} aria-label={showInspector ? "Hide inspector" : "Show inspector"}>{showInspector ? <PanelRightClose /> : <PanelRightOpen />}</button>
      </div>
    </header>

    <nav className="bw-nav" aria-label="Workspace">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)} aria-label={label} aria-current={activeSection === id ? "page" : undefined}><Icon /><span>{label}</span></button>)}
      <a href="#" aria-label="Back to Blockwright home"><X /><span>Exit editor</span></a>
    </nav>

    <aside className={`bw-outline ${showOutline ? "open" : "closed"}`} aria-label="Component outline">
      <div className="bw-panel-header"><div><small>DESIGN IR V2</small><strong>Components</strong></div><button type="button" className="bw-icon-button" onClick={() => setShowOutline(false)} aria-label="Close component outline"><PanelLeftClose /></button></div>
      <label className="bw-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter id, name, type" aria-label="Filter components" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear component filter"><X /></button>}</label>
      <div className="bw-create-row"><select value={primitiveKind} onChange={(event) => setPrimitiveKind(event.target.value as PrimitiveKind)} aria-label="Primitive type">{PRIMITIVES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={addPrimitive}><Plus />Add</button></div>
      <div className="bw-tree" role="tree" aria-label="Deterministic component order">
        {phaseGroups.map((group) => {
          const components = filteredComponents.filter(({ operationPhase }) => group.phases.includes(operationPhase));
          if (!components.length) return null;
          return <div key={group.id} className="bw-tree-group">
            <button type="button" className="bw-tree-heading" aria-expanded={expanded[group.id] !== false} onClick={() => setExpanded((current) => ({ ...current, [group.id]: current[group.id] === false }))}>{expanded[group.id] === false ? <ChevronRight /> : <ChevronDown />}<span>{group.label}</span><b>{components.length}</b></button>
            {expanded[group.id] !== false && components.map((component) => {
              const state = componentState[component.id] ?? {};
              const active = component.id === selectedId;
              return <button type="button" role="treeitem" aria-selected={active} tabIndex={active ? 0 : -1} data-component-id={component.id} key={component.id} className={`bw-tree-item ${active ? "active" : ""} ${state.hidden ? "hidden" : ""}`} onClick={() => selectComponent(component.id)} onKeyDown={(event) => outlineKeyDown(event, component.id)}>
                <span className="bw-tree-icon"><Box /></span><span><strong>{component.name}</strong><small>{component.id} · r{component.revision.revision}</small></span>{state.locked ? <Lock className="bw-row-state" /> : state.hidden ? <EyeOff className="bw-row-state" /> : null}
              </button>;
            })}
          </div>;
        })}
      </div>
      <div className="bw-outline-actions"><button type="button" onClick={duplicateSelected} disabled={!selected}><Copy />Duplicate</button><button type="button" onClick={deleteSelected} disabled={!selected || selectedState.locked}><Trash2 />Delete</button></div>
    </aside>

    <main className="bw-main">
      {activeSection === "editor" && <>
        <div className="bw-commandbar" aria-label="Editor tools">
          <div className="bw-tool-group" role="group" aria-label="Transform tool">
            {([{ id: "select", label: "Select", icon: MousePointer2 }, { id: "move", label: "Move", icon: Move3d }, { id: "scale", label: "Resize", icon: Scaling }, { id: "rotate", label: "Rotate", icon: Rotate3d }] as const).map(({ id, label, icon: Icon }) => {
              const unsupported = id === "scale" ? selectedResizeBlocked : id === "rotate" ? selectedRotateMirrorBlocked : false;
              return <button key={id} type="button" className={tool === id ? "active" : ""} aria-pressed={tool === id} disabled={unsupported} onClick={() => setTool(id)} title={unsupported ? `${label} is unavailable for nested procedural primitives because every shape parameter and orientation cannot yet be preserved exactly.` : `${label}${id === "move" ? " · arrow keys move one block" : ""}`}><Icon /><span>{label}</span></button>;
            })}
          </div>
          <span className="bw-selection-summary"><b>{selected?.name ?? "No selection"}</b>{selected && <small>{dimensions(selected.bounds).x} × {dimensions(selected.bounds).z} × {dimensions(selected.bounds).y} · {selected.operationPhase.replaceAll("_", " ")}</small>}</span>
          <div className="bw-camera" role="group" aria-label="Camera preset">
            {(["iso", "top", "front", "left", "right"] as const).map((preset) => <button key={preset} type="button" aria-pressed={cameraPreset === preset} className={cameraPreset === preset ? "active" : ""} onClick={() => setCameraPreset(preset)}>{preset}</button>)}
            <button type="button" onClick={() => setCameraPreset("iso")} title="Reset camera"><Focus /></button>
          </div>
        </div>
        <section className={`bw-viewport ${!webglAvailable || sceneError ? "fallback" : ""}`} aria-label="Procedural build viewport" data-render-ready={sceneReady && sceneVoxels.length > 0 ? "true" : "false"}>
          {webglAvailable && !sceneError ? <SceneErrorBoundary onError={setSceneError}>
            <EditorScene voxels={sceneVoxels} selected={selected} cameraPreset={cameraPreset} tool={tool} locked={Boolean(selectedState.locked || (selectedResizeBlocked && tool === "scale") || (selectedRotateMirrorBlocked && tool === "rotate"))} onSelect={selectComponent} onClear={() => tool === "select" && setSelectedId("")} onReady={() => setSceneReady(true)} onCommit={(change) => {
              if (change.move) translateSelected(change.move);
              if (change.size) resizeSelected(change.size);
              if (change.rotation) rotateSelected(change.rotation);
            }} />
          </SceneErrorBoundary> : <div className="bw-webgl-fallback"><AlertTriangle /><h2>3D view unavailable</h2><p>{sceneError ?? "WebGL is unavailable on this display. Exact component data remains available below."}</p></div>}
          <div className="bw-view-badges"><span>{serverPlacements.length ? "COMPILED PAGE" : "LOCAL PREVIEW"}</span><span>{sceneVoxels.length.toLocaleString()} shown{placementTotal > sceneVoxels.length ? ` / ${placementTotal.toLocaleString()}` : ""}</span><span>Y {sceneMinY}–{sceneMaxY}</span></div>
          <details className="bw-data-fallback" open={!webglAvailable || Boolean(sceneError)}><summary>Deterministic component table</summary><div className="bw-table-wrap"><table><thead><tr><th>Component</th><th>Phase</th><th>Bounds min</th><th>Bounds max</th><th>Material</th><th>Deps</th></tr></thead><tbody>{design.components.map((component) => <tr key={component.id} className={component.id === selectedId ? "selected" : ""} onClick={() => selectComponent(component.id)}><th>{component.name}<small>{component.id}</small></th><td>{component.operationPhase}</td><td>{component.bounds.min.x}, {component.bounds.min.y}, {component.bounds.min.z}</td><td>{component.bounds.max.x}, {component.bounds.max.y}, {component.bounds.max.z}</td><td>{componentMaterial(component, design)}</td><td>{component.dependencies.join(", ") || "—"}</td></tr>)}</tbody></table></div></details>
        </section>
      </>}

      {activeSection === "tasks" && <section className="bw-page"><div className="bw-page-heading"><div><small>TRUTHFUL BACKGROUND WORK</small><h1>Tasks</h1><p>Progress is shown only when the engine reports a phase or bounded work count.</p></div><button type="button" className="bw-secondary-action" onClick={() => void refreshTasks()}><RefreshCw />Refresh</button></div>{renderTaskTable()}{activeTask?.diagnostic && <aside className="bw-task-diagnostic" aria-label="Selected task diagnostic"><AlertTriangle /><div><strong>{activeTask.diagnostic.code}</strong><p>{activeTask.diagnostic.error}</p><dl><div><dt>Likely cause</dt><dd>{activeTask.diagnostic.likelyCause}</dd></div><div><dt>Recommended action</dt><dd>{activeTask.diagnostic.recommendedAction}</dd></div><div><dt>Safe to retry</dt><dd>{activeTask.diagnostic.retry?.safe ? "Yes" : "No"}{activeTask.diagnostic.retry?.reason ? ` — ${activeTask.diagnostic.retry.reason}` : ""}</dd></div><div><dt>Log reference</dt><dd>{activeTask.diagnostic.logReference}</dd></div></dl></div></aside>}</section>}
      {activeSection === "builds" && <section className="bw-page"><div className="bw-page-heading"><div><small>LAST COMPLETED RESULT</small><h1>Build evidence</h1><p>The compiled artifact appears here only after a completed task returns a build reference.</p></div></div>{build ? <><dl className="bw-metrics"><div><dt>Build id</dt><dd>{build.id}</dd></div><div><dt>Hash</dt><dd>{build.hash ?? "Not reported"}</dd></div><div><dt>Blocks</dt><dd>{(build.blockCount ?? build.placementCount)?.toLocaleString() ?? "Not reported"}</dd></div><div><dt>Components</dt><dd>{build.componentCount ?? design.components.length}</dd></div><div><dt>Conflicts</dt><dd>{build.conflictCount ?? "Not reported"}</dd></div><div><dt>Cache hits</dt><dd>{build.cacheHits ?? "Not reported"}</dd></div></dl><p className="bw-boundary-note"><ClipboardCheck />This page is build evidence, not proof that anything was written into a Minecraft world.</p></> : <p className="bw-empty large">No completed build has been returned in this editor session.</p>}</section>}
      {activeSection === "models" && <section className="bw-page"><div className="bw-page-heading"><div><small>OPTIONAL PROVIDERS</small><h1>Models</h1><p>The editor and compiler work without a model. Provider discovery never makes a compile claim.</p></div></div>{providers.length ? <div className="bw-provider-list">{providers.map((provider, index) => <article key={provider.id ?? index}><Cpu /><div><strong>{provider.label ?? provider.name ?? provider.id ?? `Provider ${index + 1}`}</strong><small>{provider.kind ?? "provider"} · {provider.availability ?? provider.state ?? provider.status ?? (provider.available ? "available" : "unavailable")}{provider.privacy ? ` · ${provider.privacy}` : ""}</small><p>{provider.message ?? provider.errorCode ?? (provider.modelCount !== undefined ? `${provider.modelCount} model${provider.modelCount === 1 ? "" : "s"} reported.` : provider.model ? `Configured model: ${provider.model}.` : "No model inventory was reported.")}</p></div></article>)}</div> : <p className="bw-empty large">No enabled model provider was reported. No-model editing and compilation remain available.</p>}</section>}
      {activeSection === "diagnostics" && <section className="bw-page"><div className="bw-page-heading"><div><small>SANITIZED LOCAL STATUS</small><h1>Diagnostics</h1><p>These values come from the bootstrap response; credential contents and absolute user paths are not shown.</p></div></div><JsonFacts value={diagnostics} /></section>}
      {activeSection === "settings" && <section className="bw-page"><div className="bw-page-heading"><div><small>WORKSPACE STATE</small><h1>Settings</h1><p>View settings are ephemeral. Canonical designs stay in Blockwright stores rather than browser local storage.</p></div></div><div className="bw-settings-grid"><label><span>Default camera</span><select value={cameraPreset} onChange={(event) => setCameraPreset(event.target.value as typeof cameraPreset)}><option value="iso">Isometric</option><option value="top">Top</option><option value="front">Front</option><option value="left">Left</option><option value="right">Right</option></select></label><label><span>Outline panel</span><select value={showOutline ? "open" : "closed"} onChange={(event) => setShowOutline(event.target.value === "open")}><option value="open">Open</option><option value="closed">Closed</option></select></label><label><span>Inspector panel</span><select value={showInspector ? "open" : "closed"} onChange={(event) => setShowInspector(event.target.value === "open")}><option value="open">Open</option><option value="closed">Closed</option></select></label></div><h2>Detected hardware</h2><JsonFacts value={hardware} /></section>}
    </main>

    <aside className={`bw-inspector ${showInspector ? "open" : "closed"}`} aria-label="Exact component inspector">
      <div className="bw-panel-header"><div><small>EXACT INSPECTOR</small><strong>{selected?.name ?? "No selection"}</strong></div><button type="button" className="bw-icon-button" onClick={() => setShowInspector(false)} aria-label="Close inspector"><PanelRightClose /></button></div>
      {!selected || !selectedSize ? <p className="bw-empty">Select a component from the outline, viewport, or fallback table.</p> : <div className="bw-inspector-scroll">
        <section className="bw-inspector-section"><header><span>Component</span><code>{selected.id}</code></header><label><span>Name</span><input value={selected.name} disabled={selectedState.locked} onChange={(event) => mutateSelected((component) => { component.name = event.target.value.slice(0, 80); }, "Renamed component")} /></label><div className="bw-inline-actions"><button type="button" className={selectedState.hidden ? "active" : ""} onClick={() => setComponentState((current) => ({ ...current, [selected.id]: { ...current[selected.id], hidden: !current[selected.id]?.hidden } }))}>{selectedState.hidden ? <EyeOff /> : <Eye />}{selectedState.hidden ? "Hidden" : "Visible"}</button><button type="button" className={selectedState.locked ? "active" : ""} onClick={() => setComponentState((current) => ({ ...current, [selected.id]: { ...current[selected.id], locked: !current[selected.id]?.locked } }))}>{selectedState.locked ? <Lock /> : <Unlock />}{selectedState.locked ? "Locked" : "Unlocked"}</button><button type="button" className={selectedState.isolated ? "active" : ""} onClick={() => setComponentState((current) => Object.fromEntries(design.components.map((component) => [component.id, { ...current[component.id], isolated: component.id === selected.id ? !current[selected.id]?.isolated : false }])))}><Focus />Isolate</button></div><p className="bw-help">Visibility, lock, and isolate affect this editor view only; they do not remove canonical operations.</p></section>

        <section className="bw-inspector-section"><header><span>Position</span><code>min corner</code></header><div className="bw-field-grid three"><NumericField label="X" value={selected.bounds.min.x} disabled={selectedState.locked} onChange={(value) => translateSelected({ x: value - selected.bounds.min.x, y: 0, z: 0 })} /><NumericField label="Y" value={selected.bounds.min.y} disabled={selectedState.locked} onChange={(value) => translateSelected({ x: 0, y: value - selected.bounds.min.y, z: 0 })} /><NumericField label="Z" value={selected.bounds.min.z} disabled={selectedState.locked} onChange={(value) => translateSelected({ x: 0, y: 0, z: value - selected.bounds.min.z })} /></div></section>
        <section className="bw-inspector-section"><header><span>Dimensions</span><code>blocks</code></header><div className="bw-field-grid three"><NumericField label="Width (X)" min={1} value={selectedSize.x} disabled={selectedState.locked || selectedResizeBlocked} onChange={(value) => resizeSelected({ ...selectedSize, x: Math.max(1, value) })} /><NumericField label="Depth (Z)" min={1} value={selectedSize.z} disabled={selectedState.locked || selectedResizeBlocked} onChange={(value) => resizeSelected({ ...selectedSize, z: Math.max(1, value) })} /><NumericField label="Height (Y)" min={1} value={selectedSize.y} disabled={selectedState.locked || selectedResizeBlocked} onChange={(value) => resizeSelected({ ...selectedSize, y: Math.max(1, value) })} /></div><div className="bw-field-grid two"><label><span>Rotation Y</span><select value={selectedState.rotation ?? 0} disabled={selectedState.locked || selectedRotateMirrorBlocked} onChange={(event) => { const next = Number(event.target.value); const current = selectedState.rotation ?? 0; rotateSelected((next - current + 360) % 360); }}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><div><span className="bw-control-label">Mirror</span><div className="bw-inline-actions compact"><button type="button" disabled={selectedState.locked || selectedRotateMirrorBlocked} onClick={() => mirrorSelected("x")}><FlipHorizontal2 />X</button><button type="button" disabled={selectedState.locked || selectedRotateMirrorBlocked} onClick={() => mirrorSelected("z")}><FlipHorizontal2 />Z</button></div></div></div>{(selectedResizeBlocked || selectedRotateMirrorBlocked) && <p className="bw-help"><AlertTriangle />{selectedUsesProceduralGeometry ? "Nested procedural geometry has exact shape parameters." : "This component uses geometry that is not safely resampled by every transform."} Unsupported Resize, Rotate, or Mirror controls are disabled so displayed bounds cannot diverge from compiled geometry. Move and Duplicate translate paths, clips, masks, terrain height fields, basin liquid levels, sweep support heights, and template mirror planes together; compile after editing to validate the canonical result.</p>}</section>

        <section className="bw-inspector-section">
          <header><span>Operation</span><code>r{selected.revision.revision}</code></header>
          <label><span>Phase</span><select value={selected.operationPhase} disabled={selectedState.locked} onChange={(event) => mutateSelected((component) => { component.operationPhase = event.target.value as Phase; }, "Changed merge phase")}>{["terrain_foundation", "primary_mass", "structure", "walls", "roof", "cuts_openings", "trim", "detail", "lighting", "landscaping", "explicit_overrides"].map((phase) => <option key={phase}>{phase}</option>)}</select></label>
          {selectedElement?.kind === "procedural" && <div className="bw-field-grid two"><label><span>Boolean merge</span><select value={String(selectedElement.operation ?? "add")} disabled={selectedState.locked} onChange={(event) => setBooleanOperation(event.target.value)}><option value="add">Add</option><option value="union">Union</option><option value="clear">Clear</option><option value="subtract">Subtract</option><option value="cut">Cut</option><option value="intersect">Intersect</option></select></label><div><span className="bw-control-label">Bounds</span><button type="button" className={`bw-wide-action ${selectedElement.clip ? "active" : ""}`} disabled={selectedState.locked} onClick={toggleComponentClip}><Box />{selectedElement.clip ? "Clipped" : "Add clip"}</button></div></div>}
          <label><span>Material</span><select value={findMaterial(selectedElement)} disabled={selectedState.locked} onChange={(event) => setSelectedMaterial(event.target.value)}>{materialOptions.map((material) => <option key={material}>{material}</option>)}</select></label>
          <label><span>Deterministic seed</span><input value={selected.seed} disabled={selectedState.locked} onChange={(event) => mutateSelected((component) => { component.seed = event.target.value.slice(0, 120); }, "Changed deterministic seed")} /></label>
          <dl className="bw-compact-facts"><div><dt>Dependencies</dt><dd>{selected.dependencies.join(", ") || "None"}</dd></div><div><dt>Owned ops</dt><dd>{selected.elementIds.length}</dd></div><div><dt>Template refs</dt><dd>{selected.templateInstances?.length ?? 0}</dd></div></dl>
        </section>

        <section className="bw-inspector-section"><header><span>Templates & repetition</span><Workflow /></header>{selected.templateInstances?.length ? <label><span>Repetition</span><select value={selectedRepetition} disabled={selectedState.locked} onChange={(event) => changeRepetition(event.target.value as RepetitionKind)}><option value="none">Single instance</option><option value="linear">Linear array</option><option value="grid">Grid</option><option value="radial">Radial</option><option value="mirrored">Mirrored</option><option value="alternating">Alternating</option><option value="position_list">Position list</option></select></label> : <button type="button" className="bw-wide-action" disabled={selectedState.locked || !selected.elementIds.length} onClick={convertToTemplate}><Grid3X3 />Convert owned operations to template</button>}<p className="bw-help">Templates reference canonical primitive definitions; repetition does not copy their source records.</p></section>

        <section className="bw-inspector-section">
          <div className="bw-section-heading-row"><button type="button" className="bw-section-toggle" aria-expanded={paletteOpen} onClick={() => setPaletteOpen((value) => !value)}><span>Material palette</span>{paletteOpen ? <ChevronDown /> : <ChevronRight />}</button><button type="button" className="bw-mini-action" onClick={addPaletteMaterial} aria-label="Add exact material"><Plus /></button></div>
          {paletteOpen && <div className="bw-palette-list">{Object.entries(design.materials).map(([name, definition]) => {
            const distributed = typeof definition === "object" && definition && "blocks" in definition ? definition as { distribution?: string; blocks: Array<{ material?: string; id?: string; weight?: number }> } : undefined;
            const exactValue = typeof definition === "string" ? definition : definition && typeof definition === "object" && "id" in definition ? String((definition as { id?: string }).id ?? "") : definition && typeof definition === "object" && "block" in definition ? String((definition as { block?: string }).block ?? "") : undefined;
            return <div className="bw-material-record" key={name}><div className="bw-material-heading"><i style={{ background: MATERIAL_COLORS[name] ?? "#879592" }} /><span><strong>{name}</strong><small>{distributed?.distribution ?? (exactValue ? "exact block" : "stateful material")}</small></span>{distributed ? <b>{distributed.blocks.length} mix</b> : null}</div>{exactValue !== undefined && <input aria-label={`${name} exact block id`} value={exactValue} onChange={(event) => updateMaterialDefinition(name, event.target.value)} />}{distributed && <div className="bw-distribution-list">{distributed.blocks.map((entry, index) => <label key={`${entry.material ?? entry.id}-${index}`}><span>{entry.material ?? entry.id ?? `entry ${index + 1}`}</span><input type="number" min={1} step={1} value={entry.weight ?? 1} aria-label={`${name} material weight ${index + 1}`} onChange={(event) => updateMaterialWeight(name, index, clampInteger(event.target.valueAsNumber, entry.weight ?? 1))} /></label>)}</div>}</div>;
          })}</div>}
        </section>

        <section className="bw-inspector-section">
          <header><span>Terrain interface</span><Layers3 /></header>
          <label><span>Relationship note</span><select value={selectedState.terrainInterface ?? "surface"} onChange={(event) => setComponentState((current) => ({ ...current, [selected.id]: { ...current[selected.id], terrainInterface: event.target.value as ComponentViewState["terrainInterface"] } }))}><option value="surface">Surface</option><option value="embedded">Embedded</option><option value="bridge">Bridge</option><option value="retaining">Retaining</option><option value="free">Free-standing</option></select></label>
          <NumericField label="Preferred blend radius" min={0} max={64} value={selectedState.blendRadius ?? 4} onChange={(value) => setComponentState((current) => ({ ...current, [selected.id]: { ...current[selected.id], blendRadius: Math.max(0, Math.min(64, value)) } }))} />
          <button type="button" className="bw-wide-action bw-terrain-launch" disabled={!build} onClick={() => { setTerrainBlendRadius(selectedState.blendRadius ?? terrainBlendRadius); setTerrainOpen(true); }}><Layers3 />Open Terrain Preview</button>
          <p className="bw-help">{build ? `Analyzes completed build ${build.id}; current uncompiled edits are not included.` : "Compile or select a completed build before analyzing a real region snapshot."}</p>
        </section>
      </div>}
    </aside>

    {terrainOpen && <div className="bw-terrain-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setTerrainOpen(false); }}>
      <section className="bw-terrain-dialog" role="dialog" aria-modal="true" aria-labelledby="bw-terrain-title">
        <header className="bw-terrain-header">
          <div><small>READ-ONLY WORLD ANALYSIS</small><h2 id="bw-terrain-title">Terrain Preview</h2><p>Score an existing compiled build against a supplied TerrainWorldRegion snapshot. This surface cannot install, edit, or save a world.</p></div>
          <button type="button" className="bw-icon-button" onClick={() => setTerrainOpen(false)} aria-label="Close Terrain Preview"><X /></button>
        </header>
        <div className="bw-terrain-body">
          <section className="bw-terrain-input" aria-label="Terrain preview input">
            <div className="bw-terrain-build-line"><span>Compiled build</span><code>{build?.id ?? "No completed build selected"}</code>{dirty && <b>Local edits excluded</b>}</div>
            <div className="bw-terrain-source-row">
              <label className="bw-file-input"><FolderOpen /><span>Choose region JSON</span><input type="file" accept=".json,application/json" onChange={(event) => void loadTerrainFile(event.target.files?.[0])} /></label>
              <button type="button" className="bw-secondary-action" onClick={loadTerrainSample}>Load sample snapshot</button>
            </div>
            <label className="bw-terrain-json"><span>TerrainWorldRegion JSON <small>{terrainSource}</small></span><textarea value={terrainJson} spellCheck={false} placeholder={'{\n  "edition": "java",\n  "version": "26.2",\n  "origin": { "x": -8, "y": 0, "z": -8 },\n  "dimensions": { "width": 52, "depth": 45, "height": 96 },\n  "heightMap": [[63]]\n}'} onChange={(event) => { setTerrainJson(event.target.value); setTerrainSource("Pasted or edited JSON"); setTerrainResult(undefined); setTerrainError(undefined); }} /></label>
            <p className="bw-terrain-source-note">The bundled sample is an explicitly labeled deterministic test fixture, not a scan of your Minecraft world. Imported data is schema-validated by the local engine before analysis.</p>
            <div className="bw-terrain-options">
              <label><span>Fit strategy</span><select value={terrainStrategy} onChange={(event) => { setTerrainStrategy(event.target.value as TerrainStrategy); setTerrainResult(undefined); }}>{TERRAIN_STRATEGIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Water policy</span><select value={terrainWaterPolicy} onChange={(event) => { setTerrainWaterPolicy(event.target.value as TerrainWaterPolicy); setTerrainResult(undefined); }}>{(["preserve", "bridge", "culvert", "retain", "redirect"] as const).map((policy) => <option key={policy}>{policy}</option>)}</select></label>
              <NumericField label="Blend radius" min={0} max={128} value={terrainBlendRadius} onChange={(value) => { setTerrainBlendRadius(Math.max(0, Math.min(128, value))); setTerrainResult(undefined); }} />
              <NumericField label="Max cut" min={0} max={256} value={terrainMaxCut} onChange={(value) => { setTerrainMaxCut(Math.max(0, Math.min(256, value))); setTerrainResult(undefined); }} />
              <NumericField label="Max fill" min={0} max={256} value={terrainMaxFill} onChange={(value) => { setTerrainMaxFill(Math.max(0, Math.min(256, value))); setTerrainResult(undefined); }} />
              <NumericField label="Search offset" min={0} max={32} value={terrainOffset} onChange={(value) => { setTerrainOffset(Math.max(0, Math.min(32, value))); setTerrainResult(undefined); }} />
              <label><span>Rotation</span><select value={terrainRotation} onChange={(event) => { setTerrainRotation(Number(event.target.value) as TerrainRotation); setTerrainResult(undefined); }}>{([0, 90, 180, 270] as const).map((rotation) => <option key={rotation} value={rotation}>{rotation}°</option>)}</select></label>
            </div>
            <div className="bw-terrain-flags">
              <label><input type="checkbox" checked={terrainAllowMirror} onChange={(event) => { setTerrainAllowMirror(event.target.checked); setTerrainResult(undefined); }} />Allow mirrored candidate</label>
              <label><input type="checkbox" checked={terrainAllowRetaining} onChange={(event) => { setTerrainAllowRetaining(event.target.checked); setTerrainResult(undefined); }} />Allow retaining walls</label>
              <label><input type="checkbox" checked={terrainAllowTerraces} onChange={(event) => { setTerrainAllowTerraces(event.target.checked); setTerrainResult(undefined); }} />Allow terraces</label>
            </div>
            {terrainError && <p className="bw-terrain-error" role="alert"><AlertTriangle />{terrainError}</p>}
            <button type="button" className="bw-primary-action bw-terrain-run" disabled={!build || !terrainJson.trim() || terrainRunning} onClick={() => void runTerrainPreview()}><Play />{terrainRunning ? "Analyzing snapshot…" : "Analyze read-only preview"}</button>
          </section>
          <section className="bw-terrain-result" aria-label="Terrain preview evidence" aria-live="polite">
            {!terrainResult ? <div className="bw-terrain-empty"><Layers3 /><h3>{terrainRunning ? "TerrainFit is scoring bounded candidates" : "No preview evidence yet"}</h3><p>{terrainRunning ? "Waiting for the local engine response. No success is shown until it returns." : "Supply a real snapshot or the labeled sample, choose the fit controls, and run analysis against the selected completed build."}</p></div> : <>
              <div className={`bw-terrain-risk ${terrainResult.terrain.risk}`}><span>Risk</span><strong>{terrainResult.terrain.risk}</strong><small>{terrainResult.terrain.candidates.length} candidate{terrainResult.terrain.candidates.length === 1 ? "" : "s"} retained</small></div>
              <dl className="bw-terrain-metrics">
                <div><dt>Anchor</dt><dd>{terrainResult.terrain.selected.anchor.x}, {terrainResult.terrain.selected.anchor.y}, {terrainResult.terrain.selected.anchor.z}</dd></div>
                <div><dt>Transform</dt><dd>{terrainResult.terrain.selected.rotation}° · {terrainResult.terrain.selected.mirrorX ? "mirrored" : "not mirrored"}</dd></div>
                <div><dt>Cut</dt><dd>{terrainResult.terrain.cutVolume.toLocaleString()} blocks</dd></div>
                <div><dt>Fill</dt><dd>{terrainResult.terrain.fillVolume.toLocaleString()} blocks</dd></div>
                <div><dt>Changed area</dt><dd>{terrainResult.terrain.changedTerrainArea.toLocaleString()} columns</dd></div>
                <div><dt>Max cut / fill</dt><dd>{terrainResult.terrain.maximumCutDepth} / {terrainResult.terrain.maximumFillHeight}</dd></div>
                <div><dt>Water conflicts</dt><dd>{terrainResult.terrain.conflictTotals.water}</dd></div>
                <div><dt>Protected conflicts</dt><dd>{terrainResult.terrain.conflictTotals.protected}</dd></div>
                <div><dt>Structure conflicts</dt><dd>{terrainResult.terrain.conflictTotals.structures}</dd></div>
                <div><dt>Retaining</dt><dd>{terrainResult.terrain.retainingWalls.required ? `${terrainResult.terrain.retainingWalls.columns} columns` : "Not required"}</dd></div>
                <div><dt>Path</dt><dd>{terrainResult.terrain.pathConnection.status} · {terrainResult.terrain.pathConnection.length} blocks</dd></div>
                <div><dt>Detail page</dt><dd>{terrainResult.detailPage.returned} / {terrainResult.detailPage.total}</dd></div>
              </dl>
              <dl className="bw-terrain-hashes">
                <div><dt>Preview ref</dt><dd>{terrainResult.terrain.previewRef}</dd></div>
                <div><dt>Preview hash</dt><dd>{terrainResult.terrain.previewHash}</dd></div>
                <div><dt>Build hash</dt><dd>{terrainResult.terrain.buildHash}</dd></div>
                <div><dt>Region hash</dt><dd>{terrainResult.terrain.regionHash}</dd></div>
              </dl>
              <div className="bw-terrain-boundary"><ClipboardCheck /><div><strong>Snapshot validated · no world write performed</strong><p>The engine returned <code>snapshotValidated: true</code>, <code>worldWritePerformed: false</code>, and the <code>read_only_preview</code> boundary. This is immutable analysis evidence, not an install plan.</p></div></div>
              {terrainResult.terrain.warnings.length > 0 && <div className="bw-terrain-warnings"><strong>Warnings</strong><ul>{terrainResult.terrain.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
              <details className="bw-terrain-details"><summary>First bounded operation records ({terrainResult.detailPage.returned})</summary><ol>{terrainResult.terrainDetail.slice(0, 24).map((record, index) => <li key={`${record.operation}-${record.operationIndex}-${index}`}><span>{record.operation} #{record.operationIndex}</span><code>{JSON.stringify(record.value)}</code></li>)}</ol>{terrainResult.detailPage.returned > 24 && <p>Showing 24 records in the editor; {terrainResult.detailPage.returned} were returned in this bounded page.</p>}</details>
            </>}
          </section>
        </div>
      </section>
    </div>}

    <section className="bw-task-rail" aria-label="Task rail">
      <header><span><Activity />TASKS</span><b>{tasks.filter(({ state }) => ACTIVE_STATES.has(state)).length} active</b><button type="button" onClick={() => { setActiveSection("tasks"); void refreshTasks(true); }}>Open all</button></header>
      {activeTask ? <div className="bw-current-task"><span className={`bw-state ${statusTone(activeTask.state)}`}><StateGlyph state={activeTask.state} />{activeTask.state}</span><div><strong>{activeTask.progress?.operation ?? activeTask.operation}</strong><small>{activeTask.progress?.detail ?? activeTask.id}</small></div><div className="bw-progress-track" role="progressbar" aria-label={`${activeTask.state} work`} aria-valuemin={0} aria-valuemax={activeTask.progress?.work?.totalUnits} aria-valuenow={activeTask.progress?.work?.completedUnits}><i style={{ width: activeTask.progress?.work?.totalUnits ? `${Math.min(100, (activeTask.progress.work.completedUnits ?? 0) / activeTask.progress.work.totalUnits * 100)}%` : ACTIVE_STATES.has(activeTask.state) ? "18%" : activeTask.state === "completed" ? "100%" : "0%" }} /></div><span className="bw-work-count">{activeTask.progress?.work?.completedUnits?.toLocaleString() ?? "—"}{activeTask.progress?.work?.totalUnits ? ` / ${activeTask.progress.work.totalUnits.toLocaleString()}` : ""} <small>{activeTask.progress?.work?.unit ?? "units not reported"}</small></span>{ACTIVE_STATES.has(activeTask.state) && <button type="button" className="bw-cancel" disabled={cancelling === activeTask.id || activeTask.state === "cancelling"} onClick={() => void cancelTask(activeTask.id)}><CircleStop />{cancelling === activeTask.id ? "Requesting…" : "Cancel"}</button>}</div> : <p className="bw-empty">No task has been accepted. The editor has not compiled or written anything.</p>}
      <div className="bw-notice" role="status"><span className={connection === "connected" ? "ok" : connection === "unavailable" ? "warn" : ""} /><p>{notice}</p></div>
    </section>
  </div>;
}
