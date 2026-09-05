import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { auditBuild } from "./reviewer-audit.js";
import type { BuildRecord, Placement } from "./types.js";

function bedrockFixture() {
  return compileBuild({
    name: "Bedrock Reviewer State Fixture",
    edition: "bedrock",
    version: "stable",
    style: "nordic",
    dimensions: { width: 17, depth: 13, height: 14 },
    origin: { x: 0, y: 64, z: 0 },
    blockBudget: 12_000,
    rolePalette: { roof: "minecraft:oak_stairs", doors: "minecraft:iron_door" },
  });
}

function replacePlacement(build: BuildRecord, original: Placement, state: Placement["state"]): BuildRecord {
  return {
    ...build,
    placements: build.placements.map((candidate) => candidate === original ? { ...candidate, state } : candidate),
  };
}

describe("edition-aware reviewer audit", () => {
  it("accepts complete native Bedrock stair and door states without Java-state false positives", () => {
    const build = bedrockFixture();
    const stair = build.placements.find(({ block }) => block.endsWith("_stairs"));
    const door = build.placements.find(({ block }) => /_door$/.test(block) && !/_trapdoor$/.test(block));
    expect(stair?.state).toMatchObject({ upside_down_bit: expect.anything(), weirdo_direction: expect.any(Number) });
    expect(door?.state).toMatchObject({
      "minecraft:cardinal_direction": expect.any(String),
      door_hinge_bit: expect.anything(),
      open_bit: expect.anything(),
      upper_block_bit: expect.anything(),
    });
    const audit = auditBuild(build);
    expect(audit.findings.find(({ code }) => code === "INCOMPLETE_STAIR_STATE")).toBeUndefined();
    expect(audit.findings.find(({ code }) => code === "INVALID_DOOR_STATE")).toBeUndefined();
  });

  it("catches missing or mistyped native Bedrock stair and door state fields", () => {
    const build = bedrockFixture();
    const stair = build.placements.find(({ block }) => block.endsWith("_stairs"))!;
    const door = build.placements.find(({ block }) => /_door$/.test(block) && !/_trapdoor$/.test(block))!;
    const missingStairDirection = replacePlacement(build, stair, { upside_down_bit: false });
    const mistypedDoorBit = replacePlacement(build, door, {
      "minecraft:cardinal_direction": "north",
      door_hinge_bit: false,
      open_bit: "false",
      upper_block_bit: false,
    });
    expect(auditBuild(missingStairDirection).findings.find(({ code }) => code === "INCOMPLETE_STAIR_STATE")?.coordinates)
      .toContainEqual({ x: stair.x, y: stair.y, z: stair.z });
    expect(auditBuild(mistypedDoorBit).findings.find(({ code }) => code === "INVALID_DOOR_STATE")?.coordinates)
      .toContainEqual({ x: door.x, y: door.y, z: door.z });
  });
});
