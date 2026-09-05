import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { auditBuild } from "./reviewer.js";
import type { BuildRecord, Placement } from "./types.js";

function bedrockDoorFixture() {
  return compileBuild({
    name: "Bedrock Door Pair Fixture",
    edition: "bedrock",
    version: "stable",
    style: "nordic",
    dimensions: { width: 17, depth: 13, height: 14 },
    origin: { x: 0, y: 64, z: 0 },
    blockBudget: 12_000,
    rolePalette: { roof: "minecraft:oak_stairs", doors: "minecraft:iron_door" },
  });
}

function doorPair(build: BuildRecord) {
  const doors = build.placements.filter(({ block }) => /_door$/.test(block) && !/_trapdoor$/.test(block));
  const lower = doors.find(({ state }) => state?.upper_block_bit === false || state?.upper_block_bit === 0);
  const upper = doors.find(({ state }) => state?.upper_block_bit === true || state?.upper_block_bit === 1);
  if (!lower || !upper) throw new Error("Fixture did not produce a complete Bedrock door pair.");
  return { lower, upper };
}

function replacePlacement(build: BuildRecord, original: Placement, replacement: Placement): BuildRecord {
  return {
    ...build,
    placements: build.placements.map((candidate) => candidate === original ? replacement : candidate),
  };
}

function doorPairFinding(build: BuildRecord) {
  return auditBuild(build).findings.find(({ code }) => code === "INVALID_BEDROCK_DOOR_PAIR");
}

describe("Bedrock door-pair reviewer audit", () => {
  it("accepts a deliberate vertical lower/upper pair and normalizes boolean or 0/1 bits", () => {
    const build = bedrockDoorFixture();
    expect(doorPairFinding(build)).toBeUndefined();

    const numericBits = {
      ...build,
      placements: build.placements.map((placement) => {
        if (!/_door$/.test(placement.block) || /_trapdoor$/.test(placement.block)) return placement;
        return {
          ...placement,
          state: {
            ...placement.state,
            door_hinge_bit: placement.state?.door_hinge_bit ? 1 : 0,
            open_bit: placement.state?.open_bit ? 1 : 0,
            upper_block_bit: placement.state?.upper_block_bit ? 1 : 0,
          },
        };
      }),
    };
    expect(doorPairFinding(numericBits)).toBeUndefined();
  });

  it("rejects a lower half whose upper half is missing", () => {
    const build = bedrockDoorFixture();
    const { lower, upper } = doorPair(build);
    const withoutUpper = { ...build, placements: build.placements.filter((placement) => placement !== upper) };
    const finding = doorPairFinding(withoutUpper);
    expect(finding?.total).toBe(1);
    expect(finding?.coordinates).toContainEqual({ x: lower.x, y: lower.y, z: lower.z });
  });

  it("rejects vertically adjacent halves made from different door blocks", () => {
    const build = bedrockDoorFixture();
    const { lower, upper } = doorPair(build);
    const mismatched = replacePlacement(build, upper, { ...upper, block: "minecraft:oak_door" });
    const finding = doorPairFinding(mismatched);
    expect(finding?.coordinates).toEqual(expect.arrayContaining([
      { x: lower.x, y: lower.y, z: lower.z },
      { x: upper.x, y: upper.y, z: upper.z },
    ]));
  });

  it.each([
    {
      label: "cardinal direction",
      mutate: (upper: Placement): Placement => ({
        ...upper,
        state: {
          ...upper.state,
          "minecraft:cardinal_direction": upper.state?.["minecraft:cardinal_direction"] === "north" ? "south" : "north",
        },
      }),
    },
    {
      label: "hinge side",
      mutate: (upper: Placement): Placement => ({
        ...upper,
        state: { ...upper.state, door_hinge_bit: !Boolean(upper.state?.door_hinge_bit) },
      }),
    },
    {
      label: "open state",
      mutate: (upper: Placement): Placement => ({
        ...upper,
        state: { ...upper.state, open_bit: !Boolean(upper.state?.open_bit) },
      }),
    },
  ])("rejects lower/upper halves with a mismatched $label", ({ mutate }) => {
    const build = bedrockDoorFixture();
    const { lower, upper } = doorPair(build);
    const mismatched = replacePlacement(build, upper, mutate(upper));
    const finding = doorPairFinding(mismatched);
    expect(finding?.coordinates).toEqual(expect.arrayContaining([
      { x: lower.x, y: lower.y, z: lower.z },
      { x: upper.x, y: upper.y, z: upper.z },
    ]));
  });

  it("rejects vertically stacked halves that both claim to be lower", () => {
    const build = bedrockDoorFixture();
    const { lower, upper } = doorPair(build);
    const duplicateLower = replacePlacement(build, upper, {
      ...upper,
      state: { ...upper.state, upper_block_bit: false },
    });
    const finding = doorPairFinding(duplicateLower);
    expect(finding?.coordinates).toEqual(expect.arrayContaining([
      { x: lower.x, y: lower.y, z: lower.z },
      { x: upper.x, y: upper.y, z: upper.z },
    ]));
  });
});
