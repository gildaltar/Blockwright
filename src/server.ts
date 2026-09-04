import { McpServer } from "skybridge/server";
import { z } from "zod";
import minecraftData from "minecraft-data";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import { REGISTRY_META } from "./data/registry-meta.js";
import { STYLE_PROFILES, getStyleProfile } from "./data/styles.js";
import { compileBuild, generateBuildCandidates, summarizeBuild } from "./lib/compiler.js";
import { createBundle, toBlueprint, toCsv, toJson, toMcfunction, type ExportFormat } from "./lib/exports.js";
import { listJavaRegistries, readJavaRegistry } from "./lib/java-registry.js";
import { checkJavaUpdates, syncJavaVersion } from "./lib/java-version-sync.js";
import { continuePaletteInterview, deletePalette, listPalettes, loadPalette, renamePalette, savePalette } from "./lib/palette-studio.js";
import { estimateBuild } from "./lib/preflight.js";
import { auditBuild } from "./lib/reviewer.js";
import { exportSchematic, importSchematic } from "./lib/schematic.js";
import { discoverWorlds, installWorldEditSchematic } from "./lib/worlds.js";
import type { ArchitecturalPlan, BuildInput, BuildRecord, WorldRegion } from "./lib/types.js";

const vec3Schema = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const dimensionsSchema = z.object({
  width: z.number().int().min(5).max(65535),
  depth: z.number().int().min(5).max(65535),
  height: z.number().int().min(5).max(65535),
});
const paletteRoles = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"] as const;
const rolePaletteSchema = z.object(Object.fromEntries(paletteRoles.map((role) => [role, z.string()])) as Record<(typeof paletteRoles)[number], z.ZodString>);
const buildInputSchema = {
  name: z.string().min(1).max(80),
  edition: z.enum(["java", "bedrock"]),
  version: z.string().min(1),
  style: z.string().default("nordic"),
  dimensions: dimensionsSchema,
  palette: z.array(z.string()).max(16).optional(),
  rolePalette: rolePaletteSchema.partial().optional(),
  origin: vec3Schema.optional(),
  features: z.array(z.string()).max(12).optional(),
  blockBudget: z.number().int().min(100).max(2000000).optional(),
  seed: z.string().min(1).max(120).optional(),
  buildingType: z.enum(["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"]).optional(),
  confirmationToken: z.string().optional(),
};

const buildCache = new Map<string, BuildRecord>();

function rememberBuild(build: BuildRecord) {
  buildCache.delete(build.id);
  buildCache.set(build.id, build);
  while (buildCache.size > 32) buildCache.delete(buildCache.keys().next().value!);
  return build;
}

function asBuild(value: unknown) {
  const reference = typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : undefined;
  if (reference && buildCache.has(reference)) return buildCache.get(reference)!;
  if (!value || typeof value !== "object" || !("input" in value)) throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
  return rememberBuild(compileBuild((value as BuildRecord).input));
}

const keyOf = ({ x, y, z }: { x: number; y: number; z: number }) => `${x},${y},${z}`;
const javaRegistry = minecraftData("1.21.8");
const fallbackJavaBlocks = Object.values(javaRegistry?.blocksByName ?? {}).map((block) => ({
  id: `minecraft:${block.name}`,
  displayName: block.displayName,
  hardness: block.hardness,
  stackSize: block.stackSize,
}));
const bedrockBlocks = [...new Set(Object.values(MinecraftBlockTypes))].map((id) => ({ id, displayName: id.replace("minecraft:", "").replaceAll("_", " ") }));

function javaBlocksFor(version?: string) {
  const snapshot = version ? readJavaRegistry(version) : listJavaRegistries()[0];
  return snapshot?.blocks.map(({ id, displayName }) => ({ id, displayName })) ?? fallbackJavaBlocks;
}

const server = new McpServer(
  { name: "blockwright", version: "0.4.0" },
  { capabilities: {} },
)
  .registerTool(
    {
      name: "get_supported_versions",
      description: "Get current Java and Bedrock block-registry coverage and source metadata.",
      inputSchema: { edition: z.enum(["java", "bedrock"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ edition }) => {
      const installedJava = listJavaRegistries().map(({ version, type, releaseTime, syncedAt, blockCount, client, protocolVersion, worldVersion, resourcePackVersion }) => ({ version, type, releaseTime, syncedAt, blockCount, clientSha1: client.sha1, protocolVersion, worldVersion, resourcePackVersion }));
      const versionData = { ...REGISTRY_META, java: { ...REGISTRY_META.java, installed: installedJava } };
      const versions = edition ? { [edition]: versionData[edition] } : versionData;
      return { structuredContent: { versions }, content: [{ type: "text", text: "Returned registry coverage with source and synchronization metadata." }] };
    },
  )
  .registerTool(
    {
      name: "check_java_updates",
      description: "Check Mojang's live Java release manifest and compare it with Blockwright's locally synchronized registries. This does not download a client JAR or change files.",
      inputSchema: { channel: z.enum(["release", "snapshot"]).default("release") },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async ({ channel }) => {
      const result = await checkJavaUpdates(channel);
      return { structuredContent: result, content: [{ type: "text", text: result.updateAvailable ? `Java ${result.latestVersion} is available to synchronize.` : `Java ${result.latestVersion} is already synchronized.` }] };
    },
  )
  .registerTool(
    {
      name: "sync_java_version",
      description: "Synchronize a Java version from Mojang's official manifest and client JAR. Verifies SHA-1, writes an exact block registry, and can create a local vanilla resource pack for the texture loader.",
      inputSchema: { version: z.string().default("latest"), includeTextures: z.boolean().default(true) },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async ({ version, includeTextures }) => {
      const result = await syncJavaVersion(version, includeTextures);
      return {
        structuredContent: {
          version: result.snapshot.version,
          type: result.snapshot.type,
          blockCount: result.snapshot.blockCount,
          protocolVersion: result.snapshot.protocolVersion,
          worldVersion: result.snapshot.worldVersion,
          resourcePackVersion: result.snapshot.resourcePackVersion,
          clientSha1: result.snapshot.client.sha1,
          registryPath: result.registryPath,
          resourcePackPath: result.resourcePackPath,
        },
        content: [{ type: "text", text: `Synchronized Java ${result.snapshot.version} with ${result.snapshot.blockCount.toLocaleString()} block identifiers${result.resourcePackPath ? " and created a local vanilla resource pack" : ""}.` }],
      };
    },
  )
  .registerTool(
    {
      name: "search_blocks",
      description: "Search edition-specific Minecraft block identifiers. Java and Bedrock identifiers are never mixed.",
      inputSchema: { query: z.string().min(1), edition: z.enum(["java", "bedrock"]), version: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ query, edition, version, limit }) => {
      const needle = query.toLowerCase().replaceAll(" ", "_");
      const source = edition === "java" ? javaBlocksFor(version) : bedrockBlocks;
      const matches = source.filter((block) => block.id.includes(needle) || block.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
      const coverage = edition === "java" && version && readJavaRegistry(version)
        ? { requestedVersion: version, coverageVersion: version, source: "Mojang Java client JAR blockstate assets", syncedAt: readJavaRegistry(version)!.syncedAt }
        : REGISTRY_META[edition];
      return { structuredContent: { edition, requestedVersion: version, coverage, matches }, content: [{ type: "text", text: `Found ${matches.length} ${edition} block identifiers matching “${query}”.` }] };
    },
  )
  .registerTool(
    {
      name: "get_style_profile",
      description: "Return an original architectural rule profile for a Minecraft build style.",
      inputSchema: { style: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ style }) => {
      const profile = getStyleProfile(style);
      return { structuredContent: { profile, availableStyles: STYLE_PROFILES.map(({ id, name }) => ({ id, name })) }, content: [{ type: "text", text: `Returned the ${profile.name} profile: ${profile.principles.join(", ")}.` }] };
    },
  )
  .registerTool(
    {
      name: "continue_palette_interview",
      description: "Start or continue a stateful, adaptive palette interview. Applies exact-version-valid role changes and returns only the next most useful unanswered question.",
      inputSchema: {
        sessionId: z.string().optional(), name: z.string().optional(), edition: z.enum(["java", "bedrock"]), version: z.string(), style: z.string().optional(),
        answers: z.record(z.string(), z.string()).optional(), roleChanges: rolePaletteSchema.partial().optional(),
        lockRoles: z.array(z.enum(paletteRoles)).optional(), unlockRoles: z.array(z.enum(paletteRoles)).optional(), rejectBlocks: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      view: { component: "palette-studio", description: "Adaptive role-palette interview with exact-version validation, role locking, replacement, and local texture preview." },
    },
    async (input) => {
      const result = continuePaletteInterview(input as Parameters<typeof continuePaletteInterview>[0]);
      return { structuredContent: result, content: [{ type: "text", text: result.nextQuestion ? result.nextQuestion.question : "Palette interview is complete and every role is valid for the selected version." }] };
    },
  )
  .registerTool(
    {
      name: "save_palette",
      description: "Save or update a completed palette interview as a named local palette.",
      inputSchema: { sessionId: z.string(), name: z.string().min(1).max(80) },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ sessionId, name }) => {
      const palette = savePalette(sessionId, name);
      return { structuredContent: { palette }, content: [{ type: "text", text: `Saved palette “${palette.name}”.` }] };
    },
  )
  .registerTool(
    {
      name: "list_palettes",
      description: "List named local Blockwright palettes with stable identifiers, versions, locks, and role blocks.",
      inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async () => ({ structuredContent: { palettes: listPalettes() }, content: [{ type: "text", text: `Found ${listPalettes().length} saved palette(s).` }] }),
  )
  .registerTool(
    {
      name: "load_palette",
      description: "Load one named palette by stable identifier.", inputSchema: { paletteId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ paletteId }) => ({ structuredContent: { palette: loadPalette(paletteId) }, content: [{ type: "text", text: "Loaded the saved palette." }] }),
  )
  .registerTool(
    {
      name: "rename_palette",
      description: "Rename a saved local palette.", inputSchema: { paletteId: z.string(), name: z.string().min(1).max(80) },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ paletteId, name }) => ({ structuredContent: { palette: renamePalette(paletteId, name) }, content: [{ type: "text", text: `Renamed palette to “${name}”.` }] }),
  )
  .registerTool(
    {
      name: "delete_palette",
      description: "Delete a saved local palette by stable identifier.", inputSchema: { paletteId: z.string() },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async ({ paletteId }) => ({ structuredContent: deletePalette(paletteId), content: [{ type: "text", text: "Deleted the selected palette." }] }),
  )
  .registerTool(
    {
      name: "estimate_build",
      description: "Run a safety preflight before generation: volume, occupied blocks, materials, chunks, commands, export bytes, memory, time, and Minecraft/WorldEdit risk.",
      inputSchema: { ...buildInputSchema, riskThresholds: z.object({ amberOccupiedBlocks: z.number().int().positive().optional(), redOccupiedBlocks: z.number().int().positive().optional(), amberChunks: z.number().int().positive().optional(), redChunks: z.number().int().positive().optional(), hardPlacementLimit: z.number().int().positive().optional(), regionSize: z.number().int().min(16).max(256).optional() }).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async (input) => {
      const { riskThresholds, ...buildInput } = input;
      const preflight = estimateBuild(buildInput as BuildInput, riskThresholds);
      return { structuredContent: { preflight }, content: [{ type: "text", text: `${preflight.overallRisk.toUpperCase()} risk: approximately ${preflight.estimatedOccupiedBlocks.toLocaleString()} occupied blocks across ${preflight.chunksTouched.toLocaleString()} chunks.${preflight.requiresConfirmation ? " Explicit confirmation is required." : ""}` }] };
    },
  )
  .registerTool(
    {
      name: "generate_build_candidates",
      description: "Generate and compare deterministic architectural candidates. Style changes plan geometry, room organization, structure, roof, openings, and landscape—not only blocks.",
      inputSchema: { ...buildInputSchema, candidateCount: z.number().int().min(1).max(5).default(3), recentPlans: z.array(z.any()).max(20).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async (input) => {
      const { candidateCount, recentPlans, ...buildInput } = input;
      const candidates = generateBuildCandidates(buildInput as BuildInput, candidateCount, (recentPlans ?? []) as ArchitecturalPlan[]);
      candidates.forEach(({ build }) => rememberBuild(build));
      const summaries = candidates.map(({ build, candidate, maximumSimilarity }) => ({ candidate, maximumSimilarity, build: summarizeBuild(build), plan: build.plan }));
      return { structuredContent: { candidates: summaries }, content: [{ type: "text", text: `Generated ${summaries.length} structurally compared candidate(s).` }], _meta: { builds: candidates.map(({ build }) => build) } };
    },
  )
  .registerTool(
    {
      name: "compile_build",
      description: "Compile a build specification into one exact deterministic Minecraft voxel record and open the Blockwright workbench.",
      inputSchema: buildInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      view: { component: "compile-build", description: "Interactive exact-block workbench with 3D inspection, layers, validation, and downloads." },
    },
    async (input) => {
      const build = rememberBuild(compileBuild(input as BuildInput));
      return { structuredContent: { build: summarizeBuild(build) }, content: [{ type: "text", text: `${build.input.name} compiled to ${build.placements.length.toLocaleString()} exact placements. Hash: ${build.hash.slice(0, 12)}.` }], _meta: { build } };
    },
  )
  .registerTool(
    {
      name: "validate_build",
      description: "Recompile and validate a canonical Blockwright build record, or use its cached build id from a prior response, for deterministic integrity, bounds, collisions, and budget status.",
      inputSchema: { build: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value }) => {
      const build = asBuild(value);
      return { structuredContent: { buildId: build.id, hash: build.hash, bounds: build.bounds, materialCounts: build.materialCounts, validation: build.validation }, content: [{ type: "text", text: build.validation.valid ? "Build validation passed." : `Build has ${build.validation.blockingIssues} blocking issue(s).` }] };
    },
  )
  .registerTool(
    {
      name: "audit_build",
      description: "Scan the entire canonical build (or its cached build id) for recurring structural defect classes: incomplete block states, unsupported roof stairs and lights, dangling connection arms, isolated placements, and overlapping generator writes. Use this after annotations identify an example so analogous issues are checked globally.",
      inputSchema: { build: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value }) => {
      const build = asBuild(value);
      const audit = auditBuild(build);
      return {
        structuredContent: { audit },
        content: [{ type: "text", text: `Scanned all ${audit.scannedPlacements.toLocaleString()} placements across ${audit.checks.length} structural checks; found ${audit.totals.errors} errors and ${audit.totals.warnings} warnings.` }],
      };
    },
  )
  .registerTool(
    {
      name: "review_build",
      description: "Open the state-aware 3D build reviewer from a canonical build or cached build id for exact block or region selection, measurements, layer clipping, roof hiding, reusable annotations, review JSON import/export, and whole-build structural audit findings.",
      inputSchema: { build: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      view: { component: "review-build", description: "State-aware 3D reviewer with exact-coordinate annotations, measurements, roof hiding, and global defect-class findings." },
    },
    async ({ build: value }) => {
      const build = asBuild(value);
      const audit = auditBuild(build);
      return {
        structuredContent: {
          review: {
            buildId: build.id,
            hash: build.hash,
            name: build.input.name,
            blockCount: build.placements.length,
            audit: audit.totals,
          },
        },
        content: [{ type: "text", text: `Opened the state-aware reviewer for ${build.input.name}. The global audit scanned ${audit.scannedPlacements.toLocaleString()} placements and found ${audit.findings.length} finding categories.` }],
        _meta: { build, audit },
      };
    },
  )
  .registerTool(
    {
      name: "analyze_world_region",
      description: "Compare a canonical Blockwright build against existing and protected world coordinates.",
      inputSchema: { build: z.any(), region: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, region: regionValue }) => {
      const build = asBuild(value);
      const region = regionValue as WorldRegion;
      const occupied = new Set((region.blocks ?? []).map(keyOf));
      const protectedSet = new Set((region.protectedCoordinates ?? []).map(keyOf));
      const occupiedConflicts = build.placements.filter((p) => occupied.has(keyOf(p))).map(({ x, y, z }) => ({ x, y, z }));
      const protectedConflicts = build.placements.filter((p) => protectedSet.has(keyOf(p))).map(({ x, y, z }) => ({ x, y, z }));
      return { structuredContent: { buildId: build.id, occupiedConflicts: occupiedConflicts.slice(0, 250), protectedConflicts: protectedConflicts.slice(0, 250), totals: { occupied: occupiedConflicts.length, protected: protectedConflicts.length }, cutFill: { cutBlocks: occupiedConflicts.length, estimatedFillBlocks: 0 } }, content: [{ type: "text", text: `World analysis found ${occupiedConflicts.length} occupied and ${protectedConflicts.length} protected-coordinate conflicts.` }] };
    },
  )
  .registerTool(
    {
      name: "render_build",
      description: "Return render-ready placement data for an exact Blockwright build or layer.",
      inputSchema: { build: z.any(), layer: z.number().int().optional(), mode: z.enum(["solid", "blueprint", "exploded"]).default("solid") },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, layer, mode }) => {
      const build = asBuild(value);
      const placements = layer === undefined ? build.placements : build.placements.filter((p) => p.y === layer);
      return { structuredContent: { buildId: build.id, mode, layer, count: placements.length, bounds: build.bounds }, content: [{ type: "text", text: `Prepared ${placements.length.toLocaleString()} placements for ${mode} rendering.` }], _meta: { placements } };
    },
  )
  .registerTool(
    {
      name: "export_build",
      description: "Export a canonical build as JSON, CSV, Java commands, Bedrock commands, Sponge v3 .schem, a layer blueprint, or a checksummed ZIP bundle.",
      inputSchema: { build: z.any(), format: z.enum(["json", "csv", "java_mcfunction", "bedrock_mcfunction", "blueprint", "schem", "bundle"]) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, format }) => {
      const build = asBuild(value);
      const safeName = build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
      if (format === "bundle") {
        const bytes = await createBundle(build);
        return { structuredContent: { buildId: build.id, format, filename: `${safeName}.zip`, bytes: bytes.byteLength }, content: [{ type: "text", text: `Prepared checksummed ZIP bundle for ${build.input.name}.` }], _meta: { mimeType: "application/zip", base64: Buffer.from(bytes).toString("base64") } };
      }
      if (format === "schem") {
        const schematic = exportSchematic(build);
        return { structuredContent: { buildId: build.id, format, filename: `${safeName}.schem`, bytes: schematic.bytes.byteLength, dataVersion: build.registry.worldVersion, schematicVersion: 3 }, content: [{ type: "text", text: `Prepared Sponge Schematic v3 export for ${build.input.name}.` }], _meta: { mimeType: "application/octet-stream", base64: Buffer.from(schematic.bytes).toString("base64") } };
      }
      const exports: Record<Exclude<ExportFormat, "bundle" | "schem">, { extension: string; mimeType: string; text: string }> = {
        json: { extension: "json", mimeType: "application/json", text: toJson(build) },
        csv: { extension: "csv", mimeType: "text/csv", text: toCsv(build) },
        java_mcfunction: { extension: "java.mcfunction", mimeType: "text/plain", text: toMcfunction(build, "java") },
        bedrock_mcfunction: { extension: "bedrock.mcfunction", mimeType: "text/plain", text: toMcfunction(build, "bedrock") },
        blueprint: { extension: "blueprint.txt", mimeType: "text/plain", text: toBlueprint(build) },
      };
      const file = exports[format as Exclude<ExportFormat, "bundle" | "schem">];
      return { structuredContent: { buildId: build.id, format, filename: `${safeName}.${file.extension}`, bytes: Buffer.byteLength(file.text) }, content: [{ type: "text", text: `Prepared ${format} export for ${build.input.name}.` }], _meta: { mimeType: file.mimeType, text: file.text } };
    },
  )
  .registerTool(
    {
      name: "export_schematic",
      description: "Export a Java build as a real GZip-compressed Sponge Schematic v3 file with DataVersion, block-state palette, varint data, offset, transforms, replacements, and supported block entities.",
      inputSchema: { build: z.any(), name: z.string().optional(), author: z.string().optional(), offset: vec3Schema.optional(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0), mirror: z.enum(["none", "x", "z"]).default("none"), includeAir: z.boolean().default(false), replacements: z.record(z.string(), z.string()).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, name, author, offset, rotation, mirror, includeAir, replacements }) => {
      const build = asBuild(value); const schematic = exportSchematic(build, { name, author, offset, rotation, mirror, includeAir, replacements });
      const safeName = (name || build.input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
      return { structuredContent: { buildId: build.id, filename: `${safeName}.schem`, bytes: schematic.bytes.byteLength, schematicVersion: 3, dataVersion: build.registry.worldVersion, dimensions: { width: schematic.width, height: schematic.height, depth: schematic.length }, paletteSize: schematic.paletteSize, blockCount: schematic.blockCount, includeAir, rotation, mirror, offset: offset ?? { x: 0, y: 0, z: 0 } }, content: [{ type: "text", text: `Prepared WorldEdit-compatible Sponge v3 schematic ${safeName}.schem.` }], _meta: { mimeType: "application/octet-stream", base64: Buffer.from(schematic.bytes).toString("base64") } };
    },
  )
  .registerTool(
    {
      name: "import_schematic",
      description: "Parse a GZip-compressed Sponge Schematic v3 .schem for analysis, preview, revision, or palette replacement.",
      inputSchema: { base64: z.string().min(1), origin: vec3Schema.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ base64, origin }) => {
      const imported = await importSchematic(Buffer.from(base64, "base64"), origin);
      return { structuredContent: { format: imported.format, version: imported.version, dataVersion: imported.dataVersion, metadata: imported.metadata, dimensions: imported.dimensions, offset: imported.offset, paletteSize: imported.paletteSize, blockCount: imported.placements.length }, content: [{ type: "text", text: `Imported Sponge v3 schematic with ${imported.placements.length.toLocaleString()} occupied blocks.` }], _meta: { placements: imported.placements } };
    },
  )
  .registerTool(
    {
      name: "discover_worlds",
      description: "Safely discover Java saved worlds on this Windows PC from the standard saves folder or one explicitly authorized launcher/instance saves folder. Reads level.dat only.",
      inputSchema: { authorizedSavesFolder: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      view: { component: "world-browser", description: "Local Java world picker with version, game mode, platform, lock, and WorldEdit location details." },
    },
    async ({ authorizedSavesFolder }) => {
      const result = await discoverWorlds(authorizedSavesFolder);
      return { structuredContent: result, content: [{ type: "text", text: `Discovered ${result.worlds.length} local Java world(s). ${result.localOnly}` }] };
    },
  )
  .registerTool(
    {
      name: "get_worldedit_compatibility",
      description: "Return the currently verified WorldEdit compatibility boundary for Java 26.2.",
      inputSchema: { minecraftVersion: z.string(), platform: z.enum(["fabric", "neoforge", "forge", "paper", "spigot", "unknown"]) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ minecraftVersion, platform }) => {
      const compatible = minecraftVersion === "26.2" && ["fabric", "neoforge", "paper", "spigot"].includes(platform);
      const result = compatible
        ? { compatible: true, worldEditVersion: "7.4.4", evidence: "Stable WorldEdit 7.4.4 artifacts include Minecraft 26.2 Fabric, NeoForge, and Bukkit distributions.", verifiedAt: "2026-09-02" }
        : { compatible: false, worldEditVersion: undefined, evidence: "No compatibility claim is stored for this exact version/platform pair. Use vanilla commands or verify a current WorldEdit release first.", verifiedAt: "2026-09-02" };
      return { structuredContent: { minecraftVersion, platform, ...result }, content: [{ type: "text", text: result.evidence }] };
    },
  )
  .registerTool(
    {
      name: "install_worldedit_schematic",
      description: "Preview, then install, a verified Sponge v3 schematic into the exact WorldEdit folder for a selected local world/instance. Reports dimension, anchor, affected bounds/chunks, conflicts, risk, and paste instructions. Never edits Minecraft region files.",
      inputSchema: {
        build: z.any(), worldId: z.string(), canonicalWorldPath: z.string(), targetFolder: z.string(), name: z.string(), confirmed: z.boolean().default(false), overwrite: z.boolean().default(false),
        dimension: z.enum(["overworld", "the_nether", "the_end"]).default("overworld"), anchor: vec3Schema.optional(), region: z.any().optional(),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0), mirror: z.enum(["none", "x", "z"]).default("none"),
        offset: vec3Schema.optional(), includeAir: z.boolean().default(false), replacements: z.record(z.string(), z.string()).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, worldId, canonicalWorldPath, targetFolder, name, confirmed, overwrite, dimension, anchor, region, rotation, mirror, offset, includeAir, replacements }) => {
      const build = asBuild(value);
      const result = await installWorldEditSchematic({ worldId, canonicalWorldPath, targetFolder, name, build, confirmed, overwrite, dimension, anchor, region: region as WorldRegion | undefined, includeAir, schematicOptions: { rotation, mirror, offset, replacements } });
      const text = result.status === "installed"
        ? `Installed and re-read ${result.installedPath}. In game: ${result.instructions.join(" then ")}.`
        : `Installation preview only; no file was written. Review ${result.blockCount.toLocaleString()} blocks across ${result.chunksTouched} chunks at ${result.anchor.x}, ${result.anchor.y}, ${result.anchor.z}, then repeat with confirmed=true.`;
      return { structuredContent: result, content: [{ type: "text", text }] };
    },
  )
  .registerTool(
    {
      name: "revise_build",
      description: "Apply explicit changes to a canonical build input and return a newly compiled immutable build record.",
      inputSchema: { build: z.any(), changes: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value, changes }) => {
      const current = asBuild(value);
      const patch = changes as Partial<BuildInput>;
      const next = rememberBuild(compileBuild({ ...current.input, ...patch, dimensions: { ...current.input.dimensions, ...(patch.dimensions ?? {}) } }));
      return { structuredContent: { previousHash: current.hash, build: summarizeBuild(next) }, content: [{ type: "text", text: `Revised ${current.input.name}. New hash: ${next.hash.slice(0, 12)}.` }], _meta: { build: next } };
    },
  )
  .registerTool(
    {
      name: "get_build_chunk",
      description: "Internal widget helper for paginating large immutable placement records.",
      inputSchema: { build: z.any(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(2000).default(1000) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { "openai/visibility": "private" },
    },
    async ({ build: value, offset, limit }) => {
      const build = asBuild(value);
      const placements = build.placements.slice(offset, offset + limit);
      return { structuredContent: { buildId: build.id, offset, returned: placements.length, total: build.placements.length }, content: [], _meta: { placements } };
    },
  );

export default await server.run();
export type AppType = typeof server;
