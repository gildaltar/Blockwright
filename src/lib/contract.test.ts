import { describe, expect, it } from "vitest";
import { compileBuild, summarizeBuild } from "./compiler.js";
import { auditBuildSemantics, calculateBuildHash, validateBuildContract } from "./contract.js";
import { buildAuditOutputSchema, buildContractResultOutputSchema, buildSummaryOutputSchema } from "./output-schemas.js";
import { auditBuild } from "./reviewer.js";
import type { BuildRecord, Placement } from "./types.js";

const base = {
  name: "Semantic Contract Fixture",
  edition: "java" as const,
  version: "26.2",
  style: "japanese",
  buildingType: "temple" as const,
  dimensions: { width: 25, depth: 21, height: 16 },
  origin: { x: 10, y: 64, z: -30 },
  blockBudget: 100_000,
  seed: "contract-fixture",
};

function rehash(build: BuildRecord, input: BuildRecord["input"], placements: Placement[]): BuildRecord {
  const canonical = [...placements].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
  const hash = calculateBuildHash(input, canonical);
  return { ...build, id: `bw_${hash.slice(0, 12)}`, hash, input, placements: canonical };
}

function addBoundaryDoor(build: BuildRecord, side: "north" | "south" | "east" | "west") {
  const { origin, dimensions, rolePalette } = build.input;
  const x = side === "east" ? origin.x + dimensions.width - 1 : side === "west" ? origin.x : origin.x + Math.floor(dimensions.width / 2);
  const z = side === "north" ? origin.z : side === "south" ? origin.z + dimensions.depth - 1 : origin.z + Math.floor(dimensions.depth / 2);
  const replacements = new Set([`${x},${origin.y + 2},${z}`, `${x},${origin.y + 3},${z}`]);
  const placements = build.placements.filter((placement) => !replacements.has(`${placement.x},${placement.y},${placement.z}`));
  placements.push(
    { x, y: origin.y + 2, z, block: rolePalette.doors!, phase: "openings", state: { half: "lower", facing: side, hinge: "left", open: false, powered: false } },
    { x, y: origin.y + 3, z, block: rolePalette.doors!, phase: "openings", state: { half: "upper", facing: side, hinge: "left", open: false, powered: false } },
  );
  return placements;
}

describe("v0.6 semantic contract", () => {
  it("binds a deterministic readable certificate to the canonical build hash", () => {
    const first = compileBuild({ ...base, features: [] });
    const second = compileBuild({ ...base, features: [] });
    expect(first.contract.status).toBe("valid");
    expect(first.contract.hardResults.every(({ status }) => status === "pass")).toBe(true);
    expect(first.certificate).toEqual(second.certificate);
    expect(first.certificate.text).toContain(first.hash);
    expect(first.certificate.text).toContain("Status: VALID");
    expect(first.certificate.buildHash).toBe(first.hash);
    expect(buildContractResultOutputSchema.safeParse(first.contract).success).toBe(true);
    expect(buildSummaryOutputSchema.safeParse(summarizeBuild(first)).success).toBe(true);
  });

  it("uses Minecraft north=-Z and does not report one facade as four cardinal entrances", () => {
    const build = compileBuild({ ...base, features: ["four cardinal 9-wide entrances"] });
    const entrances = build.contract.hardResults.find(({ evaluator }) => evaluator === "entrances");
    expect(build.plan.entrances.map(({ side }) => side)).toEqual(["south"]);
    expect(entrances?.status).toBe("fail");
    expect(entrances?.actual).toContain("north=2");
    expect(entrances?.actual).toContain("south=0");
    expect(entrances?.expected).toContain("north>=9");
    expect(build.validation.valid).toBe(false);
    expect(build.certificate.text).toContain("[FAIL] north, south, east, west entrances");
  });

  it("counts only lower Bedrock door halves as entrance geometry", () => {
    const compiled = compileBuild({ ...base, features: [] });
    const placements = compiled.placements.map((placement) => {
      if (!/_door$/.test(placement.block) || /_trapdoor$/.test(placement.block)) return placement;
      const { half, ...state } = placement.state ?? {};
      return { ...placement, state: { ...state, upper_block_bit: half === "upper" } };
    });
    const build = rehash(compiled, compiled.input, placements);
    const entrances = auditBuildSemantics(build).checks.find(({ id }) => id === "entrances");
    expect(entrances?.coordinates).toHaveLength(2);
  });

  it("passes the entrance clause only when canonical boundary geometry contains all four sides", () => {
    const compiled = compileBuild({ ...base, features: [] });
    let placements = addBoundaryDoor(compiled, "south");
    let staged = rehash(compiled, { ...compiled.input, features: ["four cardinal entrances"] }, placements);
    placements = addBoundaryDoor(staged, "east");
    staged = rehash(staged, staged.input, placements);
    placements = addBoundaryDoor(staged, "west");
    const fourSided = rehash(staged, staged.input, placements);
    const result = validateBuildContract(fourSided);
    expect(result.hardResults.find(({ evaluator }) => evaluator === "entrances")?.status).toBe("pass");
    expect(result.status).toBe("valid");
  });

  it("does not treat a courtyard floor or a remote token light as a lit central spawn pedestal", () => {
    const compiled = compileBuild({ ...base, features: ["lit central spawn pedestal"] });
    const { origin, rolePalette } = compiled.input;
    const remote = { x: origin.x + 1, y: origin.y + 2, z: origin.z + 1 };
    const placements = compiled.placements.filter((placement) => `${placement.x},${placement.y},${placement.z}` !== `${remote.x},${remote.y},${remote.z}`);
    placements.push({ ...remote, block: rolePalette.lighting!, phase: "lighting", state: { hanging: false, waterlogged: false } });
    const build = rehash(compiled, compiled.input, placements);
    const result = validateBuildContract(build);
    expect(result.hardResults.find(({ evaluator }) => evaluator === "spawn-pedestal")?.status).toBe("fail");
    expect(result.hardResults.find(({ evaluator }) => evaluator === "lighting")?.status).toBe("fail");
    expect(result.status).toBe("invalid");
  });

  it("checks explicit lighting counts instead of inferring illumination", () => {
    const build = compileBuild({ ...base, features: ["33 lights"] });
    const lighting = build.contract.hardResults.find(({ evaluator }) => evaluator === "lighting");
    expect(lighting?.status).toBe("fail");
    expect(lighting?.expected).toContain("33 explicit light(s)");
    expect(lighting?.actual).toContain("0 matching light(s)");
  });

  it("checks the full requested cross-corridor volume instead of trusting the plan label", () => {
    const build = compileBuild({ ...base, features: ["clear 5-wide cross corridors"] });
    const clearance = build.contract.hardResults.find(({ evaluator }) => evaluator === "corridor-clearance");
    expect(build.plan.circulation.primary).toContain("engawa");
    expect(clearance?.status).toBe("fail");
    expect(clearance?.expected).toContain("5-block-wide cross corridor");
    expect(clearance?.actual).not.toBe("0 blocked cells");
    expect(clearance?.coordinates?.length).toBeGreaterThan(0);
  });

  it("fails closed for unknown and currently unevaluable hard requirements", () => {
    expect(() => compileBuild({ ...base, features: ["dragon statue"] })).toThrow(/UNSUPPORTED_HARD_REQUIREMENT/);

    const roomAccess = validateBuildContract(compileBuild({ ...base, features: [] }), { clauses: ["all rooms accessible"] });
    expect(roomAccess.hardResults.find(({ clauseId }) => clauseId.endsWith("room-access"))?.status).toBe("unsupported");
    expect(roomAccess.status).toBe("invalid");
  });

  it("keeps operational warnings and aesthetic observations out of hard validity", () => {
    const build = compileBuild({ ...base, features: ["warning: terrain context not supplied", "aesthetic: serene roof silhouette"] });
    expect(build.contract.status).toBe("valid");
    expect(build.contract.warnings.some(({ requirement }) => requirement === "terrain context not supplied")).toBe(true);
    expect(build.contract.aestheticObservations.some(({ requirement }) => requirement === "serene roof silhouette")).toBe(true);
    expect(build.contract.hardResults.some(({ requirement }) => /terrain context|serene roof/.test(requirement))).toBe(false);
  });

  it("audits every required semantic category and exposes the same hash-bound certificate", () => {
    const build = compileBuild({ ...base, features: [] });
    const semantic = auditBuildSemantics(build);
    expect(semantic.checks.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "hash-integrity", "entrances", "entrance-clearance", "spawn-safety", "room-access", "lighting",
      "functional-interior", "support-contact", "palette-legality", "exact-version", "dimensions", "paste-origin", "block-budget",
    ]));
    expect(semantic.checks.find(({ id }) => id === "room-access")?.status).toBe("unevaluated");
    const audit = auditBuild(build);
    expect(buildAuditOutputSchema.safeParse(audit).success).toBe(true);
    expect(audit.contract.buildHash).toBe(build.hash);
    expect(audit.certificate.text).toBe(audit.contract.certificate.text);
    expect(audit.checks).toContain("canonical payload hash and every normalized hard contract clause");
  });

  it("detects canonical payload tampering even when the declared hash is left unchanged", () => {
    const build = compileBuild({ ...base, features: [] });
    const tampered = { ...build, placements: build.placements.slice(1) };
    const result = validateBuildContract(tampered);
    expect(result.hardResults.find(({ evaluator }) => evaluator === "hash-integrity")?.status).toBe("fail");
    expect(result.status).toBe("invalid");
  });
});
