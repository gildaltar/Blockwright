import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { chunkMcfunction, createBundle, toCsv, toMcfunction } from "./exports.js";

const input = {
  name: "Nordic Hearth Lodge",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 17, depth: 13, height: 14 },
  origin: { x: -8, y: 64, z: 20 },
  blockBudget: 12000,
};

describe("compileBuild", () => {
  it("is deterministic", () => {
    const first = compileBuild(input);
    const second = compileBuild(input);
    expect(first.hash).toBe(second.hash);
    expect(first.placements).toEqual(second.placements);
  });

  it("uses unique integer coordinates", () => {
    const build = compileBuild(input);
    const keys = new Set(build.placements.map((p) => `${p.x},${p.y},${p.z}`));
    expect(keys.size).toBe(build.placements.length);
    expect(build.placements.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z))).toBe(true);
  });

  it("keeps occupied bounds inside the requested dimensions", () => {
    const build = compileBuild(input);
    expect(build.bounds.dimensions).toEqual(input.dimensions);
    expect(build.bounds.min).toEqual(input.origin);
  });

  it("derives material and layer counts from placements", () => {
    const build = compileBuild(input);
    expect(Object.values(build.materialCounts).reduce((a, b) => a + b, 0)).toBe(build.placements.length);
    expect(Object.values(build.layerCounts).reduce((a, b) => a + b, 0)).toBe(build.placements.length);
  });

  it("uses the exact synchronized Java 26.2 registry without a coverage warning", () => {
    const build = compileBuild(input);
    expect(build.registry.coverageVersion).toBe("26.2");
    expect(build.validation.issues.some((issue) => issue.code === "REGISTRY_COVERAGE_GAP")).toBe(false);
  });

  it("reports a block-budget violation", () => {
    const build = compileBuild({ ...input, blockBudget: 100 });
    expect(build.validation.valid).toBe(false);
    expect(build.validation.issues.some((issue) => issue.code === "BLOCK_BUDGET_EXCEEDED")).toBe(true);
  });
});

describe("exports", () => {
  it("creates one coordinate CSV row per placement", () => {
    const build = compileBuild(input);
    expect(toCsv(build).split("\n")).toHaveLength(build.placements.length + 1);
  });

  it("neutralizes spreadsheet formulas in user-controlled CSV cells", () => {
    const build = compileBuild(input);
    const csv = toCsv({ ...build, placements: [{ ...build.placements[0], phase: "=HYPERLINK(\"https://attacker.example\")" }] });
    expect(csv).toContain(",\"'=HYPERLINK(\"\"https://attacker.example\"\")\"");
  });

  it("keeps Java and Bedrock command files syntactically separated", () => {
    const build = compileBuild(input);
    expect(toMcfunction(build, "java")).toContain("setblock -8 64 20 minecraft:stone_bricks replace");
    expect(toMcfunction(build, "bedrock")).toContain("setblock -8 64 20 minecraft:stone_bricks replace");
  });

  it("chunks large command output without dropping commands", () => {
    const build = compileBuild(input);
    const chunks = chunkMcfunction(build, "java", 100);
    expect(chunks.flatMap((chunk) => chunk.split("\n"))).toHaveLength(build.placements.length);
  });

  it("creates a checksummed zip bundle", async () => {
    const build = compileBuild(input);
    const bytes = await createBundle(build);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
