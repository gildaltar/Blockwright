import * as THREE from "three";
import type { Edition, Placement } from "./types.js";

export type ReviewerShapePart = {
  size: [number, number, number];
  offset: [number, number, number];
  rotationY?: number;
  role?: string;
};

export type ReviewerCardinalDirection = "north" | "south" | "west" | "east";

export type ReviewerPlacementState = {
  facing: ReviewerCardinalDirection;
  half: "top" | "bottom";
  hinge: "left" | "right";
  doorHalf: "upper" | "lower";
  open: boolean;
  hanging: boolean;
  slabType: "top" | "bottom" | "double";
};

const cardinalDirections = new Set<ReviewerCardinalDirection>(["north", "south", "west", "east"]);
const numericDirections: Record<number, ReviewerCardinalDirection> = { 0: "east", 1: "west", 2: "south", 3: "north" };
const directionVectors: Record<ReviewerCardinalDirection, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
};
const directionRotations: Record<ReviewerCardinalDirection, number> = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2,
};

/**
 * Populate an instanced reviewer mesh after React mounts it. Demand-rendered
 * canvases need both fresh instance bounds (for frustum culling) and an
 * explicit frame request after this imperative GPU-buffer update.
 */
export function updateReviewerInstanceMesh(
  mesh: THREE.InstancedMesh,
  placements: Placement[],
  part: ReviewerShapePart,
  invalidate: () => void,
) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, part.rotationY ?? 0, 0));
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    matrix.compose(
      new THREE.Vector3(placement.x + part.offset[0], placement.y + part.offset[1], placement.z + part.offset[2]),
      quaternion,
      new THREE.Vector3(...part.size),
    );
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  invalidate();
}

const DYE_COLORS = {
  white: "#f0f1ec",
  light_gray: "#a7adaf",
  gray: "#596166",
  black: "#202329",
  brown: "#74472f",
  red: "#b53b38",
  orange: "#e47725",
  yellow: "#dfc43b",
  lime: "#75b83d",
  green: "#3f7d48",
  cyan: "#278c9b",
  light_blue: "#58a8d3",
  blue: "#385ba6",
  purple: "#7749a3",
  magenta: "#b64c9d",
  pink: "#e38da7",
} as const;

const DYE_NAMES = Object.keys(DYE_COLORS).sort((left, right) => right.length - left.length) as Array<keyof typeof DYE_COLORS>;

function stateValue(placement: Placement, key: string) {
  return placement.state?.[key];
}

function booleanValue(value: unknown, fallback = false) {
  if (value === true || value === 1 || value === "true" || value === "1") return true;
  if (value === false || value === 0 || value === "false" || value === "0") return false;
  return fallback;
}

function cardinalValue(value: unknown, fallback: ReviewerCardinalDirection = "north") {
  if (typeof value !== "string") return fallback;
  return cardinalDirections.has(value as ReviewerCardinalDirection) ? value as ReviewerCardinalDirection : fallback;
}

function numericDirection(value: unknown, fallback: ReviewerCardinalDirection = "north") {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? numericDirections[number] ?? fallback : fallback;
}

/**
 * Translate the two supported editions' canonical state vocabularies into the
 * small, shared vocabulary used by the architectural renderer. Invalid values
 * deliberately fall back safely here; auditBuild reports them separately.
 */
export function resolveReviewerPlacementState(placement: Placement, edition: Edition): ReviewerPlacementState {
  const bedrock = edition === "bedrock";
  const id = placement.block;
  const nativeNumericFacing = id.endsWith("_stairs")
    ? stateValue(placement, "weirdo_direction")
    : stateValue(placement, "direction");
  const facing = bedrock
    ? (/_door$/.test(id) && !/_trapdoor$/.test(id)
      ? cardinalValue(stateValue(placement, "minecraft:cardinal_direction"))
      : numericDirection(nativeNumericFacing))
    : cardinalValue(stateValue(placement, "facing"));
  const top = bedrock
    ? booleanValue(stateValue(placement, "upside_down_bit"))
    : stateValue(placement, "half") === "top";
  const nativeVerticalHalf = stateValue(placement, "minecraft:vertical_half");
  const slabType = /_double_slab$/.test(id)
    ? "double"
    : bedrock
      ? nativeVerticalHalf === "top" ? "top" : "bottom"
      : stateValue(placement, "type") === "double"
        ? "double"
        : stateValue(placement, "type") === "top" ? "top" : "bottom";

  return {
    facing,
    half: top ? "top" : "bottom",
    hinge: bedrock
      ? booleanValue(stateValue(placement, "door_hinge_bit")) ? "right" : "left"
      : stateValue(placement, "hinge") === "right" ? "right" : "left",
    doorHalf: bedrock
      ? booleanValue(stateValue(placement, "upper_block_bit")) ? "upper" : "lower"
      : stateValue(placement, "half") === "upper" ? "upper" : "lower",
    open: bedrock
      ? booleanValue(stateValue(placement, "open_bit"))
      : booleanValue(stateValue(placement, "open")),
    hanging: booleanValue(stateValue(placement, "hanging")),
    slabType,
  };
}

function parseHex(color: string) {
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16)) as [number, number, number];
}

function mixHex(color: string, target: string, amount: number) {
  const sourceRgb = parseHex(color);
  const targetRgb = parseHex(target);
  return `#${sourceRgb.map((channel, index) => Math.round(channel + (targetRgb[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const [r1, g1, b1] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = l - chroma / 2;
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function stableFallbackColor(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hslToHex(Math.abs(hash) % 360, 24 + (Math.abs(hash >>> 8) % 19), 48 + (Math.abs(hash >>> 16) % 13));
}

/** Procedural, texture-free color which retains Minecraft material identity. */
export function reviewerBlockColor(block: string) {
  const id = block.toLowerCase().replace(/^minecraft:/, "");
  const colorable = /concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box/.test(id);
  if (colorable) {
    const dye = DYE_NAMES.find((name) => new RegExp(`(?:^|_)${name}(?:_|$)`).test(id));
    if (dye) {
      const base = DYE_COLORS[dye];
      if (/terracotta/.test(id) && !/glazed/.test(id)) return mixHex(base, "#7d4c3d", .36);
      if (/glazed_terracotta/.test(id)) return mixHex(base, "#f0e2d3", .12);
      if (/wool|carpet/.test(id)) return mixHex(base, "#ebe7dd", .08);
      if (/stained_glass/.test(id)) return mixHex(base, "#d9f1f2", .18);
      if (/concrete_powder/.test(id)) return mixHex(base, "#eadfcf", .1);
      return base;
    }
  }

  if (/water|bubble_column/.test(id)) return "#2387cf";
  if (/packed_ice|blue_ice/.test(id)) return "#68b7e6";
  if (/ice/.test(id)) return "#a4d8e5";
  if (/glass|pane/.test(id)) return "#a7d2d7";
  if (/sea_lantern|lantern|glowstone|froglight|shroomlight|ochre_froglight/.test(id)) return "#efba55";
  if (/redstone|magma/.test(id)) return "#b84332";
  if (/diamond/.test(id)) return "#55d7ce";
  if (/emerald/.test(id)) return "#42b86b";
  if (/lapis/.test(id)) return "#3659a9";
  if (/gold/.test(id)) return "#d7ac35";
  if (/netherite/.test(id)) return "#39353a";
  if (/oxidized_copper/.test(id)) return "#4f9a83";
  if (/weathered_copper/.test(id)) return "#65927c";
  if (/exposed_copper/.test(id)) return "#ad7958";
  if (/copper/.test(id)) return "#b96342";
  if (/iron|chain|anvil|hopper|cauldron/.test(id)) return "#8b9292";
  if (/deepslate|blackstone|coal|basalt/.test(id)) return "#30383d";
  if (/quartz|calcite|diorite|bone_block/.test(id)) return "#d8d3c6";
  if (/prismarine/.test(id)) return "#559687";
  if (/sandstone|sand|end_stone/.test(id)) return "#cbb67b";
  if (/granite|brick/.test(id)) return "#8d5545";
  if (/stone|tuff|andesite|cobble|gravel/.test(id)) return "#747a78";
  if (/warped/.test(id)) return "#347b76";
  if (/crimson/.test(id)) return "#7c354d";
  if (/mangrove/.test(id)) return "#703d32";
  if (/cherry/.test(id)) return "#d39a9a";
  if (/spruce|dark_oak/.test(id)) return "#49311f";
  if (/jungle|acacia/.test(id)) return "#9a5d36";
  if (/oak|bamboo|birch/.test(id)) return "#ad8250";
  if (/moss|grass|leaves|vine|cactus|azalea|lily|fern/.test(id)) return "#527b4d";
  if (/netherrack|nether_brick/.test(id)) return "#63343b";
  if (/snow/.test(id)) return "#e6eff0";
  if (/clay/.test(id)) return "#9aa5b3";
  return stableFallbackColor(id);
}

export function reviewerGeometryParts(placement: Placement, edition: Edition): ReviewerShapePart[] {
  const id = placement.block;
  const state = resolveReviewerPlacementState(placement, edition);
  const [dx, dz] = directionVectors[state.facing];
  if (id.endsWith("_slab")) {
    if (state.slabType === "double") return [{ size: [1, 1, 1], offset: [0, 0, 0] }];
    return [{ size: [1, .5, 1], offset: [0, state.slabType === "top" ? .25 : -.25, 0] }];
  }
  if (id.endsWith("_stairs")) {
    const top = state.half === "top";
    return [
      { size: [1, .5, 1], offset: [0, top ? .25 : -.25, 0] },
      { size: [Math.abs(dx) ? .5 : 1, .5, Math.abs(dz) ? .5 : 1], offset: [dx * .25, top ? -.25 : .25, dz * .25] },
    ];
  }
  if (id.endsWith("_trapdoor")) {
    if (!state.open) return [{ size: [1, .1875, 1], offset: [0, state.half === "top" ? .40625 : -.40625, 0] }];
    return [{ size: [Math.abs(dx) ? .1875 : 1, 1, Math.abs(dz) ? .1875 : 1], offset: [dx * .40625, 0, dz * .40625] }];
  }
  if (/glass_pane|iron_bars/.test(id)) {
    const value = (side: string) => String(placement.state?.[side] ?? "");
    const parts: ReviewerShapePart[] = [{ size: [.125, 1, .125], offset: [0, 0, 0] }];
    if (value("north") === "true") parts.push({ size: [.125, 1, .5], offset: [0, 0, -.25] });
    if (value("south") === "true") parts.push({ size: [.125, 1, .5], offset: [0, 0, .25] });
    if (value("west") === "true") parts.push({ size: [.5, 1, .125], offset: [-.25, 0, 0] });
    if (value("east") === "true") parts.push({ size: [.5, 1, .125], offset: [.25, 0, 0] });
    return parts;
  }
  if (/_fence$|_wall$/.test(id)) {
    const connected = (side: string) => ["true", "low", "tall"].includes(String(placement.state?.[side] ?? ""));
    const parts: ReviewerShapePart[] = [{ size: [.25, 1, .25], offset: [0, 0, 0] }];
    if (connected("north")) parts.push({ size: [.25, .5, .5], offset: [0, .05, -.25] });
    if (connected("south")) parts.push({ size: [.25, .5, .5], offset: [0, .05, .25] });
    if (connected("west")) parts.push({ size: [.5, .5, .25], offset: [-.25, .05, 0] });
    if (connected("east")) parts.push({ size: [.5, .5, .25], offset: [.25, .05, 0] });
    return parts;
  }
  if (/_door$/.test(id) && !/_trapdoor$/.test(id)) {
    const closedYaw = directionRotations[state.facing];
    if (!state.open) return [{ size: [1, 1, .1875], offset: [0, 0, 0], rotationY: closedYaw }];
    const hingeSign = state.hinge === "left" ? -1 : 1;
    const right: [number, number] = [-dz, dx];
    return [{
      size: [1, 1, .1875],
      offset: [(right[0] * hingeSign + dx) * .40625, 0, (right[1] * hingeSign + dz) * .40625],
      rotationY: closedYaw + (state.hinge === "left" ? Math.PI / 2 : -Math.PI / 2),
    }];
  }
  if (/(^|:)lantern$|soul_lantern$/.test(id)) {
    return [
      { size: [.5, .5, .5], offset: [0, -.05, 0], role: "lantern" },
      { size: [.25, .18, .25], offset: [0, .29, 0], role: "metal" },
      ...(state.hanging ? [{ size: [.12, .28, .12] as [number, number, number], offset: [0, .43, 0] as [number, number, number], role: "metal" }] : []),
    ];
  }
  return [{ size: [1, 1, 1], offset: [0, 0, 0] }];
}
