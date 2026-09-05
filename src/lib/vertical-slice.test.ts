import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { comp, int, long, parse, simplify, string, writeUncompressed, type NBT } from "prismarine-nbt";
import { afterEach, describe, expect, it } from "vitest";
import { compileBuild, generateBuildCandidates, structuralSimilarity, summarizeBuild } from "./compiler.js";
import {
  buildAuditOutputSchema,
  buildCandidateOutputSchema,
  buildPreflightOutputSchema,
  buildSummaryOutputSchema,
  installWorldEditResultOutputSchema,
  paletteInterviewOutputSchema,
  savedPaletteOutputSchema,
} from "./output-schemas.js";
import { continuePaletteInterview, deletePalette, listPalettes, loadPalette, renamePalette, savePalette } from "./palette-studio.js";
import { estimateBuild } from "./preflight.js";
import { auditBuild } from "./reviewer.js";
import { exportSchematic, importSchematic } from "./schematic.js";
import { discoverWorlds, installWorldEditSchematic } from "./worlds.js";

const temporaryRoots: string[] = [];
afterEach(() => {
  delete process.env.BLOCKWRIGHT_STATE_DIR;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const base = {
  name: "Architecture Test", edition: "java" as const, version: "26.2", style: "nordic", dimensions: { width: 25, depth: 21, height: 16 },
  origin: { x: 0, y: 64, z: 0 }, blockBudget: 100_000, seed: "visible-seed-a",
};

function fixtureRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "blockwright-test-")); temporaryRoots.push(root); return root;
}

function writeLevelDat(worldPath: string, name: string, version = "26.2", dataVersion = 4903) {
  mkdirSync(worldPath, { recursive: true });
  const root = comp({ Data: comp({ LevelName: string(name), DataVersion: int(dataVersion), LastPlayed: long(1_786_000_000_000n), GameType: int(1), Version: comp({ Name: string(version), Id: int(dataVersion) }) }) }, "") as unknown as NBT;
  writeFileSync(resolve(worldPath, "level.dat"), gzipSync(writeUncompressed(root, "big")));
}

describe("modular architecture", () => {
  it("keeps build summaries and candidate results aligned with their MCP contracts", () => {
    const build = compileBuild(base);
    expect(buildSummaryOutputSchema.safeParse(summarizeBuild(build)).success).toBe(true);
    const candidates = generateBuildCandidates(base, 2).map(({ build: candidateBuild, candidate, maximumSimilarity }) => ({
      candidate,
      maximumSimilarity,
      build: summarizeBuild(candidateBuild),
      plan: candidateBuild.plan,
    }));
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => buildCandidateOutputSchema.safeParse(candidate).success)).toBe(true);
  });

  it("makes Japanese architecture structurally distinct from Nordic architecture", () => {
    const nordic = compileBuild({ ...base, style: "nordic", buildingType: "house" as const });
    const japanese = compileBuild({ ...base, style: "japanese", buildingType: "temple" as const });
    expect(nordic.plan.footprint.kind).toBe("rectangle");
    expect(japanese.plan.footprint.kind).toBe("courtyard");
    expect(japanese.plan.circulation.primary).toContain("engawa");
    expect(structuralSimilarity(nordic.plan, japanese.plan)).toBeLessThan(0.5);
    expect(japanese.placements.map((p) => `${p.x},${p.y},${p.z}`)).not.toEqual(nordic.placements.map((p) => `${p.x},${p.y},${p.z}`));
  });

  it("is deterministic for the same seed and meaningfully different for a new seed", () => {
    const first = compileBuild({ ...base, style: "modern" });
    const same = compileBuild({ ...base, style: "modern" });
    const different = compileBuild({ ...base, style: "modern", seed: "visible-seed-b" });
    expect(same.hash).toBe(first.hash);
    expect(same.placements).toEqual(first.placements);
    expect(different.structuralFingerprint).not.toBe(first.structuralFingerprint);
    expect(different.placements).not.toEqual(first.placements);
  });

  it("rejects invalid Java 26.2 role identifiers", () => {
    expect(() => compileBuild({ ...base, style: "nordic", rolePalette: { wall: "minecraft:not_a_26_2_block" } })).toThrow(/invalid.*wall/i);
  });
});

describe("safety preflight", () => {
  it("warns and requires confirmation before a large generation", () => {
    const request = { ...base, dimensions: { width: 512, depth: 512, height: 128 }, buildingType: "megabase" as const };
    const preflight = estimateBuild(request);
    expect(buildPreflightOutputSchema.safeParse(preflight).success).toBe(true);
    expect(preflight.totalVolume).toBe(33_554_432);
    expect(preflight.chunksTouched).toBe(1024);
    expect(preflight.overallRisk).toBe("red");
    expect(preflight.requiresConfirmation).toBe(true);
    expect(preflight.choices).toContain("split_into_phases");
    expect(() => compileBuild(request)).toThrow(/CONFIRMATION_REQUIRED|MUST_BE_SPLIT/);
  });
});

describe("palette persistence", () => {
  it("round-trips, renames, and deletes a saved exact-version palette", () => {
    process.env.BLOCKWRIGHT_STATE_DIR = fixtureRoot();
    const started = continuePaletteInterview({ edition: "java", version: "26.2", style: "japanese", answers: { buildType: "temple" }, lockRoles: ["roof"] });
    expect(paletteInterviewOutputSchema.safeParse(started).success).toBe(true);
    const saved = savePalette(started.session.id, "Quiet Courtyard");
    expect(savedPaletteOutputSchema.safeParse(saved).success).toBe(true);
    expect(loadPalette(saved.id).roles.roof).toBe("minecraft:dark_oak_stairs");
    expect(loadPalette(saved.id).lockedRoles).toContain("roof");
    expect(renamePalette(saved.id, "Rain Garden").name).toBe("Rain Garden");
    expect(listPalettes()).toHaveLength(1);
    expect(deletePalette(saved.id).deleted).toBe(true);
    expect(listPalettes()).toHaveLength(0);
  });
});

describe("Sponge schematic v3", () => {
  it("passes an NBT parser and round-trips states, dimensions, offset, and placements", async () => {
    const build = compileBuild({ ...base, style: "japanese" });
    const generated = exportSchematic(build, { offset: { x: -4, y: 2, z: 7 }, rotation: 90 });
    const parsed = simplify((await parse(generated.bytes, "big")).parsed) as any;
    expect(parsed.Schematic.Version).toBe(3);
    expect(parsed.Schematic.DataVersion).toBe(4903);
    expect(parsed.Schematic.Blocks.Palette["minecraft:air"]).toBe(0);
    const imported = await importSchematic(generated.bytes);
    expect(imported.version).toBe(3);
    expect(imported.offset).toEqual({ x: -4, y: 2, z: 7 });
    expect(imported.placements).toHaveLength(build.placements.length);
    expect(imported.placements.some((placement) => placement.state && Object.keys(placement.state).length)).toBe(true);
  });
});

describe("local world discovery and guarded installation", () => {
  it("reads fixture display names and versions and never writes before confirmation", async () => {
    const root = fixtureRoot(); const saves = resolve(root, "saves"); const worldPath = resolve(saves, "fixture-world");
    writeLevelDat(worldPath, "Creative Test World");
    const before = createHash("sha256").update(readFileSync(resolve(worldPath, "level.dat"))).digest("hex");
    const discovery = await discoverWorlds(saves); const world = discovery.worlds.find(({ folderName }) => folderName === "fixture-world")!;
    expect(world.displayName).toBe("Creative Test World"); expect(world.minecraftVersion).toBe("26.2"); expect(world.dataVersion).toBe(4903);
    const build = compileBuild({ ...base, style: "modern" }); const targetFolder = world.suggestedSchematicFolders[0];
    const preview = await installWorldEditSchematic({ worldId: world.id, canonicalWorldPath: world.canonicalPath, targetFolder, name: "guarded", build, confirmed: false, dimension: "overworld", anchor: { x: 32, y: 70, z: -16 } });
    expect(installWorldEditResultOutputSchema.safeParse(preview).success).toBe(true);
    expect(preview.status).toBe("confirmation_required"); expect(preview.blockCount).toBe(build.placements.length); expect(preview.anchor).toEqual({ x: 32, y: 70, z: -16 });
    expect(existsSync(resolve(targetFolder, "guarded.schem"))).toBe(false);
    expect(existsSync(resolve(targetFolder, "guarded.schem"))).toBe(false);
    const after = createHash("sha256").update(readFileSync(resolve(worldPath, "level.dat"))).digest("hex");
    expect(after).toBe(before);
  });
});

describe("global build review audit", () => {
  it("scans the complete canonical record and preserves state-specific findings", () => {
    const build = compileBuild({ ...base, style: "japanese", buildingType: "temple" });
    const reviewed = {
      ...build,
      placements: [
        ...build.placements,
        { x: 999, y: 120, z: 999, block: "minecraft:dark_oak_stairs", phase: "roof repair", state: { half: "top" } },
        { x: 1001, y: 120, z: 999, block: "minecraft:lantern", phase: "lighting", state: { hanging: true } },
      ],
    };
    const audit = auditBuild(reviewed);
    expect(buildAuditOutputSchema.safeParse(audit).success).toBe(true);
    expect(audit.scannedPlacements).toBe(reviewed.placements.length);
    const stairFinding = audit.findings.find(({ code }) => code === "INCOMPLETE_STAIR_STATE");
    expect(stairFinding?.coordinates).toContainEqual({ x: 999, y: 120, z: 999 });
    const lightFinding = audit.findings.find(({ code }) => code === "UNSUPPORTED_LIGHT");
    expect(lightFinding?.coordinates).toContainEqual({ x: 1001, y: 120, z: 999 });
    expect(audit.findings.find(({ code }) => code === "ISOLATED_PLACEMENT")?.total).toBeGreaterThanOrEqual(2);
  });
});
