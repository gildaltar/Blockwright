import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { compileBuild } from "./compiler.js";
import { chunkMcfunction, createBundle, toCsv, toMcfunction } from "./exports.js";
import { architecturalPlanOutputSchema } from "./output-schemas.js";
import { estimateBuild } from "./preflight.js";
import type { DesignAssertion, DesignAtomicClaim, DesignRequirement } from "./types.js";

type AssertionSpec = DesignAssertion extends infer Assertion
  ? Assertion extends DesignAssertion ? Omit<Assertion, "claimId" | "sourceSpan"> : never
  : never;

function designRequirement(id: string, text: string, elementIds: string[], predicate: DesignAtomicClaim["predicate"], assertions: AssertionSpec[]): DesignRequirement {
  const sourceSpan = { start: 0, end: text.length, text };
  const claimId = `${id}-claim`;
  return {
    id,
    text,
    elementIds,
    claims: [{ id: claimId, sourceSpan, predicate, status: "asserted" }],
    assertions: assertions.map((assertion) => ({ ...assertion, claimId, sourceSpan })) as DesignAssertion[],
  };
}

const input = {
  name: "Nordic Hearth Lodge",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 17, depth: 13, height: 14 },
  origin: { x: -8, y: 64, z: 20 },
  blockBudget: 12000,
};

const bedrockInput = {
  ...input,
  name: "Bedrock Export Test",
  edition: "bedrock" as const,
  version: "stable",
  origin: { x: 0, y: 64, z: 0 },
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

  it("treats the advertised Bedrock stable registry snapshot as exact coverage", () => {
    const build = compileBuild(bedrockInput);
    expect(build.registry.requestedVersion).toBe("stable");
    expect(build.validation.issues.some((issue) => issue.code === "REGISTRY_COVERAGE_GAP")).toBe(false);
    expect(build.contract.status).toBe("valid");
  });

  it("rejects unsupported hard requirements before producing a generic build", () => {
    expect(() => compileBuild({ ...bedrockInput, features: ["water slide", "lazy river", "functional pool"] }))
      .toThrow(/UNSUPPORTED_HARD_REQUIREMENT.*water slide.*generic substitute was generated/i);
  });

  it("compiles a freeform style through generic geometry without a Nordic fallback", () => {
    const requirement = "A contained pool generated from generic geometry";
    const build = compileBuild({
      ...bedrockInput,
      name: "Freeform Aquatic Design",
      style: "biophilic aquatic resort",
      sourceBrief: requirement,
      dimensions: { width: 12, depth: 12, height: 8 },
      features: [requirement],
      materialLibrary: { basin: "minecraft:light_blue_concrete", water: "minecraft:water" },
      design: {
        schemaVersion: 1,
        description: requirement,
        requirements: [designRequirement("pool", requirement, ["pool-basin"], "containment", [
          { kind: "placement_count", minimum: 20 },
          { kind: "element_kind", elementKind: "basin", minimum: 1 },
          { kind: "axis_span", axis: "x", minimum: 12 },
        ])],
        elements: [{ id: "pool-basin", kind: "basin", intent: "contained pool", requirementIds: ["pool"], min: { x: 0, y: 0, z: 0 }, max: { x: 11, y: 3, z: 11 }, wallMaterial: "basin", liquidMaterial: "water", liquidLevel: 2 }],
      },
    });
    expect(build.input.style).toBe("biophilic aquatic resort");
    expect(build.placements.some(({ block }) => block === "minecraft:water")).toBe(true);
    expect(build.placements.every(({ elementId }) => elementId === "pool-basin")).toBe(true);
    expect(build.contract.status).toBe("valid");
  });

  it("derives Aqua-like custom plan metadata from authored geometry and boundary assertions", () => {
    const northEntrance = "North guest entrance";
    const eastConnection = "East connection promenade";
    const descendingRoute = "Descending circulation path";
    const features = [northEntrance, eastConnection, descendingRoute];
    const doorState = (direction: "south" | "west", upper: boolean) => ({
      block: "minecraft:iron_door",
      state: {
        "minecraft:cardinal_direction": direction,
        door_hinge_bit: false,
        open_bit: false,
        upper_block_bit: upper,
      },
    });
    const request = {
      ...bedrockInput,
      name: "Aqua-like authored plan",
      style: "custom aquatic",
      buildingType: "hall" as const,
      sourceBrief: features.join("\n"),
      dimensions: { width: 16, depth: 16, height: 12 },
      features,
      materialLibrary: {
        north_door_lower: doorState("south", false),
        north_door_upper: doorState("south", true),
        east_door_lower: doorState("west", false),
        east_door_upper: doorState("west", true),
        path: "minecraft:cyan_concrete",
        supports: "minecraft:iron_block",
      },
      design: {
        schemaVersion: 1 as const,
        description: "Aqua-like boundary circulation fixture",
        requirements: [
          designRequirement("north-access", northEntrance, ["site-anchor", "north-lower", "north-upper"], "boundary", [
            { kind: "placement_count", minimum: 8 },
            { kind: "element_kind", elementKind: "fill", minimum: 2 },
            { kind: "boundary_contact", sides: ["north"], minimumPlacementsPerSide: 4, elementIds: ["north-lower"] },
          ]),
          designRequirement("east-access", eastConnection, ["east-lower", "east-upper"], "boundary", [
            { kind: "placement_count", minimum: 8 },
            { kind: "element_kind", elementKind: "fill", minimum: 2 },
            { kind: "boundary_contact", sides: ["east"], minimumPlacementsPerSide: 4, elementIds: ["east-lower"] },
          ]),
          designRequirement("route", descendingRoute, ["descending-route"], "path", [
            { kind: "placement_count", minimum: 10 },
            { kind: "element_kind", elementKind: "sweep", minimum: 1 },
            { kind: "path_geometry", minimumPaths: 1, minimumControlPointsPerPath: 3, minimumVerticalDrop: 6, supportsRequired: true },
          ]),
        ],
        elements: [
          { id: "site-anchor", kind: "fill" as const, intent: "authored site origin", phase: "site", requirementIds: ["north-access"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "path" },
          { id: "north-lower", kind: "fill" as const, intent: "north guest entrance", phase: "guest access", requirementIds: ["north-access"], min: { x: 6, y: 1, z: 0 }, max: { x: 9, y: 1, z: 0 }, material: "north_door_lower" },
          { id: "north-upper", kind: "fill" as const, intent: "north guest entrance", phase: "guest access", requirementIds: ["north-access"], min: { x: 6, y: 2, z: 0 }, max: { x: 9, y: 2, z: 0 }, material: "north_door_upper" },
          { id: "east-lower", kind: "fill" as const, intent: "east connection promenade", phase: "exterior circulation", requirementIds: ["east-access"], min: { x: 15, y: 1, z: 7 }, max: { x: 15, y: 1, z: 10 }, material: "east_door_lower" },
          { id: "east-upper", kind: "fill" as const, intent: "east connection promenade", phase: "exterior circulation", requirementIds: ["east-access"], min: { x: 15, y: 2, z: 7 }, max: { x: 15, y: 2, z: 10 }, material: "east_door_upper" },
          {
            id: "descending-route",
            kind: "sweep" as const,
            intent: "descending circulation path with authored supports",
            phase: "vertical circulation",
            requirementIds: ["route"],
            points: [{ x: 3, y: 9, z: 3 }, { x: 8, y: 6, z: 8 }, { x: 12, y: 3, z: 12 }],
            crossSection: "solid" as const,
            material: "path",
            width: 1,
            height: 1,
            supports: { material: "supports", interval: 3, toY: 0 },
          },
        ],
      },
    };
    const build = compileBuild(request);
    expect(build.contract.status, build.certificate.text).toBe("valid");
    expect(() => architecturalPlanOutputSchema.parse(build.plan)).not.toThrow();
    expect(build.plan.entrances).toEqual([
      { side: "north", width: 4, emphasis: "north guest entrance" },
      { side: "east", width: 4, emphasis: "east connection promenade" },
    ]);
    expect(build.plan.circulation.primary).toContain("descending circulation path with authored supports");
    expect(build.plan.circulation.vertical).toContain("descending circulation path with authored supports");
    expect(build.plan.circulation.exterior).toEqual(expect.arrayContaining(["north guest entrance", "east connection promenade"]));
    expect(build.plan.massing.volumes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "north-lower", "north-upper", "east-lower", "east-upper", "descending-route",
    ]));
    expect(build.plan.massing.volumes.find(({ id }) => id === "descending-route")?.purpose).toBe("descending circulation path with authored supports");
    expect(build.plan.program.spaces).toEqual(expect.arrayContaining([
      "north guest entrance", "east connection promenade", "descending circulation path with authored supports",
    ]));
    const serializedPlan = JSON.stringify(build.plan).toLowerCase();
    for (const legacyClaim of ["main living bar", "raised cross volume", "linear service spine", "terrace"]) {
      expect(serializedPlan).not.toContain(legacyClaim);
    }
    expect(compileBuild(request).plan).toEqual(build.plan);
  });

  it("retains and validates every entry in material libraries larger than one hundred", () => {
    const materialLibrary = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`material_${index}`, index === 119 ? "minecraft:cyan_concrete" : "minecraft:stone"]));
    const requirement = "One registry-validated material sample";
    const request = {
      ...bedrockInput,
      name: "Open Material Library",
      sourceBrief: requirement,
      dimensions: { width: 5, depth: 5, height: 5 },
      features: [requirement],
      materialLibrary,
      design: {
        schemaVersion: 1 as const,
        description: requirement,
        requirements: [designRequirement("sample", requirement, ["sample"], "quantity", [
          { kind: "element_kind", elementKind: "fill", minimum: 1 },
          { kind: "element_instances", minimum: 1 },
          { kind: "distinct_materials", minimum: 1 },
        ])],
        elements: [{ id: "sample", kind: "fill" as const, intent: "sample", requirementIds: ["sample"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "material_119" }],
      },
    };
    const build = compileBuild(request);
    expect(Object.keys(build.input.materialLibrary)).toHaveLength(120);
    expect(build.placements[0].block).toBe("minecraft:cyan_concrete");
    expect(() => compileBuild({ ...request, materialLibrary: { ...materialLibrary, material_119: "minecraft:not_a_real_block" } }))
      .toThrow(/INVALID_BLOCK_IDENTIFIERS.*material_119/i);
    expect(() => compileBuild({ ...request, materialLibrary: { ...materialLibrary, material_119: { block: "minecraft:stone", state: { axis: "y" } } } }))
      .toThrow(/INVALID_BEDROCK_MATERIAL materialLibrary\.material_119.*no Bedrock.*state named axis/i);
  });

  it("rejects label-only operational and vague-scale claims over one stone block", () => {
    const oneBlock = (text: string, predicate: DesignAtomicClaim["predicate"], assertions: AssertionSpec[]) => ({
      ...bedrockInput,
      name: text,
      style: "custom geometric",
      sourceBrief: text,
      dimensions: { width: 5, depth: 5, height: 5 },
      features: [text],
      materialLibrary: { stone: "minecraft:stone" },
      design: {
        schemaVersion: 1 as const,
        description: text,
        requirements: [designRequirement("claim", text, ["token"], predicate, assertions)],
        elements: [{ id: "token", kind: "fill" as const, intent: "single stone token", requirementIds: ["claim"], min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, material: "stone" }],
      },
    });
    expect(() => compileBuild(oneBlock("A working elevator", "fixture", [
      { kind: "element_kind", elementKind: "fill", minimum: 1 },
      { kind: "axis_span", axis: "y", minimum: 1 },
    ]))).toThrow(/DESIGN_OPERATIONAL_CLAIM_UNSUPPORTED/);
    expect(() => compileBuild(oneBlock("Large life sized water park", "extent", [
      { kind: "axis_span", axis: "y", minimum: 1 },
    ]))).toThrow(/DESIGN_(?:QUALITATIVE_ASSERTION_REQUIRED|FIXTURE_EVIDENCE_INSUFFICIENT)/);
    expect(() => compileBuild(oneBlock("Water park", "fixture", [
      { kind: "element_kind", elementKind: "fill", minimum: 1 },
      { kind: "axis_span", axis: "y", minimum: 1 },
    ]))).toThrow(/DESIGN_FIXTURE_EVIDENCE_INSUFFICIENT/);
    const flatText = "Large life sized water park";
    expect(() => compileBuild({
      ...bedrockInput,
      name: "Flat semantic token",
      style: "custom geometric",
      sourceBrief: flatText,
      dimensions: { width: 16, depth: 16, height: 5 },
      features: [flatText],
      materialLibrary: { stone: "minecraft:stone" },
      design: {
        schemaVersion: 1,
        description: flatText,
        requirements: [designRequirement("flat", flatText, ["flat"], "extent", [
          { kind: "axis_span", axis: "x", minimum: 16 },
          { kind: "axis_span", axis: "z", minimum: 16 },
          { kind: "axis_span", axis: "y", minimum: 1 },
          { kind: "placement_count", minimum: 256 },
          { kind: "distinct_materials", minimum: 1 },
        ])],
        elements: [{ id: "flat", kind: "fill", intent: "flat token", requirementIds: ["flat"], min: { x: 0, y: 0, z: 0 }, max: { x: 15, y: 0, z: 15 }, material: "stone" }],
      },
    })).toThrow(/DESIGN_FIXTURE_EVIDENCE_INSUFFICIENT/);
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

  it("allows only the build's matching edition command format", () => {
    const javaBuild = compileBuild(input);
    const bedrockBuild = compileBuild(bedrockInput);
    expect(toMcfunction(javaBuild, "java")).toContain("setblock -8 64 20 minecraft:stone_bricks replace");
    expect(toMcfunction(bedrockBuild, "bedrock")).toContain("setblock 0 64 0 minecraft:stone_bricks replace");
    expect(() => toMcfunction(javaBuild, "bedrock")).toThrow(/requires a valid Bedrock Edition build/i);
    expect(() => toMcfunction(bedrockBuild, "java")).toThrow(/requires a valid Java Edition build/i);
  });

  it("chunks large command output without dropping commands", () => {
    const build = compileBuild(input);
    const chunks = chunkMcfunction(build, "java", 100);
    expect(chunks.flatMap((chunk) => chunk.split("\n"))).toHaveLength(build.placements.length);
  });

  it("blocks uncertified command exports and single Bedrock functions above 10,000 commands", () => {
    const invalid = compileBuild({ ...input, blockBudget: 100 });
    expect(() => toMcfunction(invalid, "java")).toThrow(/hash-bound contract is invalid/i);

    const request = { ...bedrockInput, dimensions: { width: 64, depth: 64, height: 20 }, blockBudget: 100_000, seed: "large-bedrock-export-test" };
    const preflight = estimateBuild(request);
    const large = compileBuild({ ...request, confirmationToken: preflight.confirmationToken });
    expect(large.placements.length).toBeGreaterThan(10_000);
    expect(() => toMcfunction(large, "bedrock")).toThrow(/10,000-command function-call ceiling/i);
    const chunks = chunkMcfunction(large, "bedrock", 8_000);
    expect(chunks.every((chunk) => chunk.split("\n").length <= 8_000)).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.split("\n"))).toHaveLength(large.placements.length);
  });

  it("creates a checksummed zip bundle", async () => {
    const build = compileBuild(input);
    const bytes = await createBundle(build);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("build-java.mcfunction")).not.toBeNull();
    expect(zip.file("build-bedrock.mcfunction")).toBeNull();
  });
});
