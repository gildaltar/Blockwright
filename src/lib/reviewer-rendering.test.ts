import { describe, expect, it } from "vitest";
import type { Placement } from "./types.js";
import {
  resolveReviewerPlacementState,
  reviewerBlockColor,
  reviewerGeometryParts,
} from "./reviewer-rendering.js";

const placement = (block: string, state?: Placement["state"]): Placement => ({
  x: 0,
  y: 64,
  z: 0,
  block,
  state,
  phase: "fixture",
});

describe("edition-aware reviewer geometry", () => {
  it("maps native Bedrock stair direction and upside-down state to Java-equivalent geometry", () => {
    const bedrock = placement("minecraft:quartz_stairs", { weirdo_direction: 0, upside_down_bit: true });
    const java = placement("minecraft:quartz_stairs", { facing: "east", half: "top" });
    expect(resolveReviewerPlacementState(bedrock, "bedrock")).toMatchObject({ facing: "east", half: "top" });
    expect(reviewerGeometryParts(bedrock, "bedrock")).toEqual(reviewerGeometryParts(java, "java"));
    expect(reviewerGeometryParts(bedrock, "bedrock")[1].offset).toEqual([.25, -.25, 0]);
  });

  it("renders native Bedrock door cardinal, hinge, open, and upper-half bits", () => {
    const closed = placement("minecraft:iron_door", {
      "minecraft:cardinal_direction": "east",
      door_hinge_bit: false,
      open_bit: false,
      upper_block_bit: true,
    });
    const open = placement("minecraft:iron_door", {
      "minecraft:cardinal_direction": "east",
      door_hinge_bit: true,
      open_bit: true,
      upper_block_bit: false,
    });
    expect(resolveReviewerPlacementState(closed, "bedrock")).toMatchObject({ facing: "east", hinge: "left", doorHalf: "upper", open: false });
    expect(reviewerGeometryParts(closed, "bedrock")[0].rotationY).toBeCloseTo(-Math.PI / 2);
    expect(resolveReviewerPlacementState(open, "bedrock")).toMatchObject({ facing: "east", hinge: "right", doorHalf: "lower", open: true });
    expect(reviewerGeometryParts(open, "bedrock")[0].rotationY).toBeCloseTo(-Math.PI);
    expect(reviewerGeometryParts(open, "bedrock")[0].offset).not.toEqual([0, 0, 0]);
  });

  it("understands native Bedrock trapdoor and slab state names", () => {
    const trapdoor = placement("minecraft:spruce_trapdoor", { direction: 2, open_bit: true, upside_down_bit: true });
    const slab = placement("minecraft:quartz_slab", { "minecraft:vertical_half": "top" });
    const doubleSlab = placement("minecraft:quartz_double_slab", { "minecraft:vertical_half": "bottom" });
    expect(resolveReviewerPlacementState(trapdoor, "bedrock")).toMatchObject({ facing: "south", half: "top", open: true });
    expect(reviewerGeometryParts(trapdoor, "bedrock")[0]).toMatchObject({ size: [1, 1, .1875], offset: [0, 0, .40625] });
    expect(reviewerGeometryParts(slab, "bedrock")[0]).toMatchObject({ size: [1, .5, 1], offset: [0, .25, 0] });
    expect(reviewerGeometryParts(doubleSlab, "bedrock")[0].size).toEqual([1, 1, 1]);
  });
});

describe("procedural reviewer material colors", () => {
  const dyes = [
    "white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow",
    "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink",
  ];

  it.each(["concrete", "wool", "terracotta", "stained_glass"])("keeps all 16 %s colors visually distinct", (family) => {
    const colors = dyes.map((dye) => reviewerBlockColor(`minecraft:${dye}_${family}`));
    expect(new Set(colors)).toHaveLength(dyes.length);
  });

  it("distinguishes material families as well as dye hues", () => {
    expect(new Set([
      reviewerBlockColor("minecraft:red_concrete"),
      reviewerBlockColor("minecraft:red_wool"),
      reviewerBlockColor("minecraft:red_terracotta"),
      reviewerBlockColor("minecraft:red_stained_glass"),
    ])).toHaveLength(4);
    expect(new Set([
      reviewerBlockColor("minecraft:water"),
      reviewerBlockColor("minecraft:jungle_leaves"),
      reviewerBlockColor("minecraft:iron_block"),
      reviewerBlockColor("minecraft:smooth_quartz"),
      reviewerBlockColor("minecraft:oak_planks"),
      reviewerBlockColor("minecraft:oxidized_copper"),
      reviewerBlockColor("minecraft:prismarine"),
      reviewerBlockColor("minecraft:deepslate"),
    ])).toHaveLength(8);
  });

  it("uses deterministic non-gray fallbacks for unfamiliar material names", () => {
    const first = reviewerBlockColor("example:future_material_alpha");
    expect(first).toMatch(/^#[0-9a-f]{6}$/i);
    expect(reviewerBlockColor("example:future_material_alpha")).toBe(first);
    expect(reviewerBlockColor("example:future_material_beta")).not.toBe(first);
  });
});
