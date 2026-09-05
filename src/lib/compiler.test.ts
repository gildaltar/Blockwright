import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { compileBuild } from "./compiler.js";
import { createBedrockMcpack } from "./bedrock-pack.js";
import { chunkMcfunction, createBundle, optimizedBedrockCommands, toCsv, toMcfunction } from "./exports.js";

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

  it("treats the Bedrock stable registry token as exact synchronized coverage", () => {
    const build = compileBuild({ ...input, edition: "bedrock", version: "stable" });
    expect(build.registry.requestedVersion).toBe("stable");
    expect(build.validation.issues.some((issue) => issue.code === "REGISTRY_COVERAGE_GAP")).toBe(false);
    expect(build.contract.hardResults.find(({ evaluator }) => evaluator === "exact-version")?.status).toBe("pass");
  });

  it("constructs and certifies requested waterpark attractions instead of relabeling generic massing", () => {
    const build = compileBuild({
      name: "Aqua Meridian Regression",
      edition: "bedrock",
      version: "stable",
      style: "modern",
      buildingType: "waterpark",
      dimensions: { width: 96, depth: 96, height: 36 },
      origin: { x: 0, y: 64, z: 0 },
      blockBudget: 500_000,
      seed: "aqua-meridian-regression",
      features: ["wave pool", "lazy river", "three water slides", "splash pad", "locker rooms", "food court", "lifeguard stations", "functional interiors", "distributed lighting"],
    });
    expect(build.validation.valid).toBe(true);
    expect(build.contract.status).toBe("valid");
    expect(build.plan.footprint.kind).toBe("campus");
    expect(build.materialCounts["minecraft:water"]).toBeGreaterThan(500);
    expect(Object.keys(build.materialCounts).length).toBeGreaterThan(10);
    for (const token of ["wave pool", "lazy river", "water slide", "splash pad", "locker room", "food court", "lifeguard station"]) {
      expect(build.placements.some(({ phase }) => phase.includes(token)), token).toBe(true);
    }
    expect(build.contract.hardResults.filter(({ clauseId }) => clauseId.startsWith("feature-")).every(({ status }) => status === "pass")).toBe(true);
    expect(build.contract.hardResults.find(({ requirement }) => requirement === "constructed water slide chute")?.actual).toContain("3 distinct features");
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
    expect(toMcfunction(build, "bedrock")).not.toContain('"facing"=');
    expect(toMcfunction(build, "bedrock")).toContain('"direction"=');
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

  it("creates an importable, throttled Bedrock mcpack with optimized commands", async () => {
    const build = compileBuild({
      name: "Aqua Meridian Mobile",
      edition: "bedrock",
      version: "stable",
      style: "modern",
      buildingType: "waterpark",
      dimensions: { width: 96, depth: 96, height: 36 },
      origin: { x: 0, y: 64, z: 0 },
      blockBudget: 500_000,
      seed: "aqua-meridian-mobile",
      features: ["wave pool", "lazy river", "three water slides", "splash pad", "locker rooms", "food court", "lifeguard stations"],
    });
    const result = await createBedrockMcpack(build, 64);
    const zip = await JSZip.loadAsync(result.bytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    const inventory = JSON.parse(await zip.file("blockwright-inventory.json")!.async("string"));
    const partNames = Object.keys(zip.files).filter((name) => /\/part_\d+\.mcfunction$/.test(name));
    expect(manifest.format_version).toBe(2);
    expect(manifest.modules[0].type).toBe("data");
    expect(inventory.contractStatus).toBe("valid");
    expect(inventory.commandCount).toBe(optimizedBedrockCommands(build).length);
    expect(inventory.commandCount).toBeLessThan(build.placements.length * 0.5);
    expect(partNames).toHaveLength(inventory.parts);
    for (const name of partNames) expect((await zip.file(name)!.async("string")).split("\n").length).toBeLessThanOrEqual(66);
    expect(zip.file(`functions/${result.namespace}/load_site.mcfunction`)).not.toBeNull();
    expect(zip.file(`functions/${result.namespace}/cleanup.mcfunction`)).not.toBeNull();
  });

  it("refuses to package a mislabeled unsupported waterpark shell", async () => {
    const invalid = compileBuild({
      name: "Not Actually A Waterpark",
      edition: "bedrock",
      version: "stable",
      style: "modern",
      buildingType: "megabase",
      dimensions: { width: 80, depth: 80, height: 32 },
      blockBudget: 500_000,
      features: ["wave pool"],
    });
    expect(invalid.contract.status).toBe("invalid");
    await expect(createBedrockMcpack(invalid)).rejects.toThrow(/BUILD_NOT_DELIVERABLE/);
  });
});
