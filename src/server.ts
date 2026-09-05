import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import minecraftData from "minecraft-data";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import { REGISTRY_META } from "./data/registry-meta.js";
import { STYLE_PROFILES, getStyleProfile } from "./data/styles.js";
import { compileBuild, generateBuildCandidates, summarizeBuild } from "./lib/compiler.js";
import { createBundle, toBlueprint, toCsv, toJson, toMcfunction, type ExportFormat } from "./lib/exports.js";
import { listJavaRegistries, readJavaRegistry, registryMetadata } from "./lib/java-registry.js";
import { checkJavaUpdates, syncJavaVersion } from "./lib/java-version-sync.js";
import {
  architecturalPlanOutputSchema,
  auditTotalsOutputSchema,
  buildAuditOutputSchema,
  buildCandidateOutputSchema,
  buildPreflightOutputSchema,
  buildSummaryOutputSchema,
  buildValidationOutputSchema,
  discoveredWorldOutputSchema,
  installWorldEditResultOutputSchema,
  outputBoundsSchema,
  paletteInterviewOutputSchema,
  resourcePackVersionOutputSchema,
  savedPaletteOutputSchema,
} from "./lib/output-schemas.js";
import { continuePaletteInterview, deletePalette, listPalettes, loadPalette, renamePalette, savePalette } from "./lib/palette-studio.js";
import { estimateBuild } from "./lib/preflight.js";
import { auditBuild } from "./lib/reviewer.js";
import { exportSchematic, importSchematic } from "./lib/schematic.js";
import { discoverWorlds, installWorldEditSchematic } from "./lib/worlds.js";
import type { ArchitecturalPlan, BuildInput, BuildRecord, WorldRegion } from "./lib/types.js";

const APP_NAME = "blockwright";
const APP_VERSION = "0.5.0";
const startedAt = Date.now();
type JsonResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): JsonResponse;
  json(body: unknown): void;
};

const vec3Schema = z.object({
  x: z.number().int().describe("Integer east-west block coordinate."),
  y: z.number().int().describe("Integer vertical block coordinate."),
  z: z.number().int().describe("Integer north-south block coordinate."),
});
const dimensionsSchema = z.object({
  width: z.number().int().min(5).max(65535).describe("Exterior width in blocks along the x axis."),
  depth: z.number().int().min(5).max(65535).describe("Exterior depth in blocks along the z axis."),
  height: z.number().int().min(5).max(65535).describe("Maximum build height in blocks along the y axis."),
});
const styleSchema = z.string().min(1).max(80).describe("Architectural style profile identifier, such as nordic or japanese.");
const extentDimensionsSchema = z.object({
  width: z.number().int().min(1).max(65535).describe("Width in blocks along the x axis."),
  depth: z.number().int().min(1).max(65535).describe("Depth in blocks along the z axis."),
  height: z.number().int().min(1).max(65535).describe("Height in blocks along the y axis."),
});
const paletteRoles = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"] as const;
const rolePaletteSchema = z.object(Object.fromEntries(paletteRoles.map((role) => [role, z.string().describe(`Namespaced Minecraft block identifier for the ${role} role.`)])) as Record<(typeof paletteRoles)[number], z.ZodString>);
const buildInputSchema = {
  name: z.string().min(1).max(80).describe("Human-readable build name used in reviews and export filenames."),
  edition: z.enum(["java", "bedrock"]).describe("Minecraft edition whose identifiers and commands must be used."),
  version: z.string().min(1).describe("Exact Minecraft version requested for registry coverage and export compatibility."),
  style: styleSchema.default("nordic"),
  dimensions: dimensionsSchema.describe("Requested exterior build envelope in blocks."),
  palette: z.array(z.string()).max(16).optional().describe("Legacy ordered list of namespaced block identifiers; prefer rolePalette for precise control."),
  rolePalette: rolePaletteSchema.partial().optional().describe("Optional explicit mapping from architectural roles to namespaced block identifiers."),
  origin: vec3Schema.optional().describe("World-space coordinate for the minimum corner of the build; defaults to 0,0,0."),
  features: z.array(z.string()).max(12).optional().describe("Requested rooms, amenities, terrain elements, or construction features."),
  blockBudget: z.number().int().min(100).max(2000000).optional().describe("Maximum occupied-block count allowed for compilation."),
  seed: z.string().min(1).max(120).optional().describe("Visible deterministic seed; reuse it to reproduce the same normalized plan."),
  buildingType: z.enum(["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"]).optional().describe("High-level generator family for the architectural plan."),
  confirmationToken: z.string().optional().describe("Exact token returned by a red-risk preflight; never invent or paraphrase it."),
};

const buildReferenceSchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().optional(),
    hash: z.string().optional(),
    input: z.object({}).passthrough(),
  }).passthrough(),
]).describe("Cached Blockwright build id or a canonical build record containing its normalized input.");

const placementSchema = vec3Schema.extend({
  block: z.string().describe("Namespaced Minecraft block identifier."),
  state: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Canonical block-state properties."),
  phase: z.string().optional().describe("Construction phase label when the snapshot preserves it."),
}).passthrough();

const worldRegionSchema = z.object({
  edition: z.enum(["java", "bedrock"]).describe("Minecraft edition represented by the snapshot."),
  version: z.string().describe("Exact Minecraft version represented by the snapshot."),
  origin: vec3Schema.describe("Minimum world coordinate of the snapshot."),
  dimensions: extentDimensionsSchema.describe("Snapshot dimensions in blocks."),
  blocks: z.array(placementSchema).optional().describe("Known occupied placements in the region."),
  protectedCoordinates: z.array(vec3Schema).optional().describe("Coordinates that the planned build must not overwrite."),
  heightMap: z.array(z.array(z.number().int())).optional().describe("Optional terrain height samples."),
  biomeMap: z.array(z.array(z.string())).optional().describe("Optional biome ids aligned with the region footprint."),
  structures: z.array(z.object({
    name: z.string().describe("Existing structure label."),
    bounds: z.object({ min: vec3Schema, max: vec3Schema }).describe("Existing structure bounds."),
  })).optional().describe("Existing structures recorded in the snapshot."),
}).describe("Canonical world-region snapshot used for non-mutating conflict analysis.");

const buildChangesSchema = z.object({
  ...buildInputSchema,
  style: styleSchema,
  dimensions: dimensionsSchema.partial().optional().describe("Only the dimensions to change; omitted axes stay locked."),
}).partial().describe("Explicit build-input fields to change; all omitted constraints remain locked.");

const toolPresentation = (title: string, invoking: string, invoked: string) => ({
  title,
  _meta: {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  },
});

const buildCache = new Map<string, BuildRecord>();

function rememberBuild(build: BuildRecord) {
  buildCache.delete(build.id);
  buildCache.set(build.id, build);
  while (buildCache.size > 32) buildCache.delete(buildCache.keys().next().value!);
  return build;
}

function asBuild(value: unknown) {
  if (typeof value === "string") {
    const cached = buildCache.get(value);
    if (cached) return cached;
    throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
  }
  if (!value || typeof value !== "object") throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");

  if (!("input" in value) || !value.input) throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
  const suppliedId = "id" in value && typeof value.id === "string" ? value.id : undefined;
  const suppliedHash = "hash" in value && typeof value.hash === "string" ? value.hash : undefined;
  const compiled = compileBuild(value.input as BuildInput);
  if (suppliedId && suppliedId !== compiled.id) {
    throw new Error(`Build integrity check failed: supplied id ${suppliedId} does not match deterministic build id ${compiled.id}.`);
  }
  if (suppliedHash && suppliedHash !== compiled.hash) {
    throw new Error(`Build integrity check failed: supplied hash ${suppliedHash.slice(0, 12)} does not match the deterministic input hash ${compiled.hash.slice(0, 12)}.`);
  }
  const cached = suppliedId ? buildCache.get(suppliedId) : undefined;
  if (cached) {
    if (cached.hash !== compiled.hash) {
      throw new Error(`Build integrity check failed: cached build ${cached.hash.slice(0, 12)} does not match supplied input ${compiled.hash.slice(0, 12)}.`);
    }
    return cached;
  }
  return rememberBuild(compiled);
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
  if (version) {
    const snapshot = readJavaRegistry(version);
    if (!snapshot) {
      const available = listJavaRegistries().map(({ version: installedVersion }) => installedVersion);
      throw new Error(`Java ${version} is not synchronized locally. Run check_java_updates, then sync_java_version before searching exact-version identifiers.${available.length ? ` Installed registries: ${available.join(", ")}.` : " No synchronized Java registries were found."}`);
    }
    return {
      blocks: snapshot.blocks.map(({ id, displayName }) => ({ id, displayName })),
      coverage: registryMetadata(version)!,
    };
  }
  const snapshot = listJavaRegistries()[0];
  if (snapshot) {
    return {
      blocks: snapshot.blocks.map(({ id, displayName }) => ({ id, displayName })),
      coverage: registryMetadata(snapshot.version)!,
    };
  }
  return {
    blocks: fallbackJavaBlocks,
    coverage: {
      requestedVersion: "default",
      coverageVersion: "1.21.8",
      source: "minecraft-data packaged fallback",
      syncedAt: undefined,
      note: "No synchronized Java registry was available; results use the explicitly labeled packaged fallback.",
    },
  };
}

const server = new McpServer(
  { name: APP_NAME, version: APP_VERSION },
  { capabilities: {} },
)
  .registerTool(
    {
      ...toolPresentation("Get Supported Versions", "Checking registry coverage…", "Registry coverage ready"),
      name: "get_supported_versions",
      description: "Get current Java and Bedrock block-registry coverage and source metadata.",
      inputSchema: { edition: z.enum(["java", "bedrock"]).optional().describe("Optional edition filter; omit it to return both Java and Bedrock coverage.") },
      outputSchema: { versions: z.record(z.string(), z.unknown()).describe("Registry coverage keyed by Minecraft edition.") },
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
      ...toolPresentation("Check Java Updates", "Checking Mojang releases…", "Java update check complete"),
      name: "check_java_updates",
      description: "Check Mojang's live Java release manifest and compare it with Blockwright's locally synchronized registries. This does not download a client JAR or change files.",
      inputSchema: { channel: z.enum(["release", "snapshot"]).default("release").describe("Mojang release channel to compare against installed registries.") },
      outputSchema: {
        channel: z.enum(["release", "snapshot"]).describe("Release channel that was checked."),
        latestVersion: z.string().describe("Latest version in the selected channel."),
        latestRelease: z.string().describe("Latest stable Java release in Mojang's manifest."),
        latestSnapshot: z.string().describe("Latest Java snapshot in Mojang's manifest."),
        installed: z.array(z.unknown()).describe("Locally synchronized Java registry summaries."),
        updateAvailable: z.boolean().describe("Whether the selected latest version is missing locally."),
        checkedAt: z.string().describe("ISO timestamp for this live manifest check."),
        manifestUrl: z.string().describe("Official Mojang version-manifest URL used for the check."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async ({ channel }) => {
      const result = await checkJavaUpdates(channel);
      return { structuredContent: result, content: [{ type: "text", text: result.updateAvailable ? `Java ${result.latestVersion} is available to synchronize.` : `Java ${result.latestVersion} is already synchronized.` }] };
    },
  )
  .registerTool(
    {
      ...toolPresentation("Synchronize Java Version", "Synchronizing Java registry…", "Java registry synchronized"),
      name: "sync_java_version",
      description: "Synchronize a Java version from Mojang's official manifest and client JAR. Verifies SHA-1, writes an exact block registry, and can create a local vanilla resource pack for the texture loader.",
      inputSchema: {
        version: z.string().default("latest").describe("Exact Mojang version id, or latest/snapshot to resolve the current channel head."),
        includeTextures: z.boolean().default(true).describe("Also derive a local vanilla resource-pack ZIP from the verified client JAR."),
      },
      outputSchema: {
        version: z.string().describe("Java version that was synchronized."),
        type: z.enum(["release", "snapshot", "old_beta", "old_alpha"]).describe("Mojang version type."),
        blockCount: z.number().int().describe("Namespaced block identifiers written to the registry."),
        protocolVersion: z.number().int().describe("Protocol version read from the verified client."),
        worldVersion: z.number().int().describe("DataVersion read from the verified client."),
        resourcePackVersion: resourcePackVersionOutputSchema,
        clientSha1: z.string().describe("Verified SHA-1 of the official client JAR."),
        registryPath: z.string().describe("Local path of the synchronized registry JSON."),
        resourcePackPath: z.string().optional().describe("Local path of the generated texture resource ZIP, when requested."),
      },
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
      ...toolPresentation("Search Minecraft Blocks", "Searching exact block ids…", "Block search complete"),
      name: "search_blocks",
      description: "Search edition-specific Minecraft block identifiers. Java and Bedrock identifiers are never mixed.",
      inputSchema: {
        query: z.string().min(1).describe("Partial namespaced id or human-readable block name to match."),
        edition: z.enum(["java", "bedrock"]).describe("Minecraft edition whose registry should be searched."),
        version: z.string().optional().describe("Exact Java registry version; Java searches fail clearly when it is not synchronized."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of matches to return."),
      },
      outputSchema: {
        edition: z.enum(["java", "bedrock"]).describe("Edition whose identifiers were searched."),
        requestedVersion: z.string().optional().describe("Version requested by the caller, when supplied."),
        coverage: z.unknown().describe("Exact registry source and coverage metadata for these results."),
        matches: z.array(z.object({ id: z.string(), displayName: z.string() }).passthrough()).describe("Matching namespaced block identifiers."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ query, edition, version, limit }) => {
      const needle = query.toLowerCase().replaceAll(" ", "_");
      const source = edition === "java"
        ? javaBlocksFor(version)
        : { blocks: bedrockBlocks, coverage: { ...REGISTRY_META.bedrock, requestedVersion: version ?? REGISTRY_META.bedrock.requestedVersion } };
      const matches = source.blocks.filter((block) => block.id.includes(needle) || block.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
      const coverage = source.coverage;
      return { structuredContent: { edition, requestedVersion: version, coverage, matches }, content: [{ type: "text", text: `Found ${matches.length} ${edition} block identifiers matching “${query}”.` }] };
    },
  )
  .registerTool(
    {
      ...toolPresentation("Get Style Profile", "Loading style rules…", "Style rules ready"),
      name: "get_style_profile",
      description: "Return an original architectural rule profile for a Minecraft build style.",
      inputSchema: { style: z.string().min(1).describe("Architectural style profile id or name to resolve.") },
      outputSchema: {
        profile: z.unknown().describe("Resolved architectural principles, features, palette roles, and plan rules."),
        availableStyles: z.array(z.object({ id: z.string(), name: z.string() })).describe("Available profile ids and display names."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ style }) => {
      const profile = getStyleProfile(style);
      return { structuredContent: { profile, availableStyles: STYLE_PROFILES.map(({ id, name }) => ({ id, name })) }, content: [{ type: "text", text: `Returned the ${profile.name} profile: ${profile.principles.join(", ")}.` }] };
    },
  )
  .registerTool(
    {
      ...toolPresentation("Continue Palette Interview", "Updating palette interview…", "Palette interview updated"),
      name: "continue_palette_interview",
      description: "Start or continue a stateful, adaptive palette interview. Applies exact-version-valid role changes and returns only the next most useful unanswered question.",
      inputSchema: {
        sessionId: z.string().optional().describe("Existing palette-session id; omit to begin a new interview."),
        name: z.string().optional().describe("Human-readable palette name for a new session."),
        edition: z.enum(["java", "bedrock"]).describe("Minecraft edition locked for the entire interview."),
        version: z.string().describe("Exact Minecraft version locked for the entire interview."),
        style: z.string().optional().describe("Style profile used to seed role defaults for a new session."),
        answers: z.record(z.string(), z.string()).optional().describe("Answers keyed by the interview topic returned by earlier calls."),
        roleChanges: rolePaletteSchema.partial().optional().describe("Validated replacements for individual palette roles."),
        lockRoles: z.array(z.enum(paletteRoles)).optional().describe("Roles to preserve against later automatic or requested changes."),
        unlockRoles: z.array(z.enum(paletteRoles)).optional().describe("Previously locked roles that may be changed again."),
        rejectBlocks: z.array(z.string()).optional().describe("Namespaced block identifiers that must not remain assigned."),
      },
      outputSchema: paletteInterviewOutputSchema,
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
      ...toolPresentation("Save Palette", "Saving palette…", "Palette saved"),
      name: "save_palette",
      description: "Save or update a completed palette interview as a named local palette.",
      inputSchema: {
        sessionId: z.string().describe("Completed palette-session id returned by continue_palette_interview."),
        name: z.string().min(1).max(80).describe("Name to store with the reusable local palette."),
      },
      outputSchema: { palette: savedPaletteOutputSchema.describe("Saved palette record with stable id, roles, locks, and version metadata.") },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ sessionId, name }) => {
      const palette = savePalette(sessionId, name);
      return { structuredContent: { palette }, content: [{ type: "text", text: `Saved palette “${palette.name}”.` }] };
    },
  )
  .registerTool(
    {
      ...toolPresentation("List Saved Palettes", "Loading saved palettes…", "Saved palettes ready"),
      name: "list_palettes",
      description: "List named local Blockwright palettes with stable identifiers, versions, locks, and role blocks.",
      inputSchema: {},
      outputSchema: { palettes: z.array(savedPaletteOutputSchema).describe("Saved local palette records.") },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async () => ({ structuredContent: { palettes: listPalettes() }, content: [{ type: "text", text: `Found ${listPalettes().length} saved palette(s).` }] }),
  )
  .registerTool(
    {
      ...toolPresentation("Load Saved Palette", "Loading palette…", "Palette loaded"),
      name: "load_palette",
      description: "Load one named palette by stable identifier.",
      inputSchema: { paletteId: z.string().describe("Stable palette id returned by list_palettes or save_palette.") },
      outputSchema: { palette: savedPaletteOutputSchema.describe("Saved palette record.") },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ paletteId }) => ({ structuredContent: { palette: loadPalette(paletteId) }, content: [{ type: "text", text: "Loaded the saved palette." }] }),
  )
  .registerTool(
    {
      ...toolPresentation("Rename Saved Palette", "Renaming palette…", "Palette renamed"),
      name: "rename_palette",
      description: "Rename a saved local palette.",
      inputSchema: {
        paletteId: z.string().describe("Stable id of the saved palette to rename."),
        name: z.string().min(1).max(80).describe("New human-readable palette name."),
      },
      outputSchema: { palette: savedPaletteOutputSchema.describe("Renamed saved palette record.") },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ paletteId, name }) => ({ structuredContent: { palette: renamePalette(paletteId, name) }, content: [{ type: "text", text: `Renamed palette to “${name}”.` }] }),
  )
  .registerTool(
    {
      ...toolPresentation("Delete Saved Palette", "Deleting palette…", "Palette deleted"),
      name: "delete_palette",
      description: "Delete a saved local palette by stable identifier.",
      inputSchema: { paletteId: z.string().describe("Stable id of the saved palette to delete.") },
      outputSchema: {
        id: z.string().describe("Stable id of the deleted palette."),
        deleted: z.literal(true).describe("Confirms that the palette record was removed."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async ({ paletteId }) => ({ structuredContent: deletePalette(paletteId), content: [{ type: "text", text: "Deleted the selected palette." }] }),
  )
  .registerTool(
    {
      ...toolPresentation("Estimate Build Risk", "Estimating build scale…", "Build estimate ready"),
      name: "estimate_build",
      description: "Run a safety preflight before generation: volume, occupied blocks, materials, chunks, commands, export bytes, memory, time, and Minecraft/WorldEdit risk.",
      inputSchema: {
        ...buildInputSchema,
        riskThresholds: z.object({
          amberOccupiedBlocks: z.number().int().positive().optional().describe("Occupied-block count that begins amber risk."),
          redOccupiedBlocks: z.number().int().positive().optional().describe("Occupied-block count that begins red risk."),
          amberChunks: z.number().int().positive().optional().describe("Touched-chunk count that begins amber risk."),
          redChunks: z.number().int().positive().optional().describe("Touched-chunk count that begins red risk."),
          hardPlacementLimit: z.number().int().positive().optional().describe("Absolute in-memory placement ceiling; requests above it must be split."),
          regionSize: z.number().int().min(16).max(256).optional().describe("Width and depth, in blocks, for deterministic regional phases."),
        }).optional().describe("Optional operator overrides for preflight thresholds."),
      },
      outputSchema: { preflight: buildPreflightOutputSchema.describe("Scale estimates, risk levels, warnings, phases, and any exact confirmation token.") },
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
      ...toolPresentation("Generate Build Candidates", "Generating distinct plans…", "Build candidates ready"),
      name: "generate_build_candidates",
      description: "Generate and compare deterministic architectural candidates. Style changes plan geometry, room organization, structure, roof, openings, and landscape—not only blocks.",
      inputSchema: {
        ...buildInputSchema,
        candidateCount: z.number().int().min(1).max(5).default(3).describe("Number of structurally distinct candidates to generate."),
        recentPlans: z.array(architecturalPlanOutputSchema).max(20).optional().describe("Recent architectural plans to penalize for similarity."),
      },
      outputSchema: { candidates: z.array(buildCandidateOutputSchema).describe("Candidate summaries, plans, fingerprints, and maximum structural similarity scores.") },
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
      ...toolPresentation("Compile Exact Build", "Compiling exact placements…", "Exact build compiled"),
      name: "compile_build",
      description: "Compile a build specification into one exact deterministic Minecraft voxel record and open the Blockwright workbench.",
      inputSchema: buildInputSchema,
      outputSchema: { build: buildSummaryOutputSchema.describe("Immutable build summary with hash, bounds, plan, counts, validation, and registry provenance.") },
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
      ...toolPresentation("Validate Exact Build", "Validating build integrity…", "Build validation complete"),
      name: "validate_build",
      description: "Recompile and validate a canonical Blockwright build record, or use its cached build id from a prior response, for deterministic integrity, bounds, collisions, and budget status.",
      inputSchema: { build: buildReferenceSchema },
      outputSchema: {
        buildId: z.string().describe("Stable id derived from the deterministic build hash."),
        hash: z.string().describe("Full deterministic SHA-256 build hash."),
        bounds: outputBoundsSchema.describe("Exact occupied coordinate bounds."),
        materialCounts: z.record(z.string(), z.number().int()).describe("Occupied placement count by namespaced block identifier."),
        validation: buildValidationOutputSchema.describe("Integrity, budget, collision, and registry-coverage validation result."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ build: value }) => {
      const build = asBuild(value);
      return { structuredContent: { buildId: build.id, hash: build.hash, bounds: build.bounds, materialCounts: build.materialCounts, validation: build.validation }, content: [{ type: "text", text: build.validation.valid ? "Build validation passed." : `Build has ${build.validation.blockingIssues} blocking issue(s).` }] };
    },
  )
  .registerTool(
    {
      ...toolPresentation("Audit Build Structure", "Scanning structural defects…", "Structural audit complete"),
      name: "audit_build",
      description: "Scan the entire canonical build (or its cached build id) for recurring structural defect classes: incomplete block states, unsupported roof stairs and lights, dangling connection arms, isolated placements, and overlapping generator writes. Use this after annotations identify an example so analogous issues are checked globally.",
      inputSchema: { build: buildReferenceSchema },
      outputSchema: { audit: buildAuditOutputSchema.describe("Whole-build check inventory, categorized findings, counts, and affected coordinates.") },
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
      ...toolPresentation("Open 3D Build Reviewer", "Preparing 3D review…", "3D reviewer ready"),
      name: "review_build",
      description: "Open the state-aware 3D build reviewer from a canonical build or cached build id for exact block or region selection, measurements, layer clipping, roof hiding, reusable annotations, review JSON import/export, and whole-build structural audit findings.",
      inputSchema: { build: buildReferenceSchema },
      outputSchema: {
        review: z.object({
          buildId: z.string().describe("Stable build id being reviewed."),
          hash: z.string().describe("Full immutable build hash that review data must match."),
          name: z.string().describe("Human-readable build name."),
          blockCount: z.number().int().describe("Total exact placements in the build."),
          audit: auditTotalsOutputSchema.describe("Error, warning, info, and affected-placement totals from the whole-build audit."),
        }).describe("Review identity and structural-audit summary."),
      },
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
      ...toolPresentation("Analyze World Region", "Checking world conflicts…", "World analysis complete"),
      name: "analyze_world_region",
      description: "Compare a canonical Blockwright build against existing and protected world coordinates.",
      inputSchema: {
        build: buildReferenceSchema,
        region: worldRegionSchema,
      },
      outputSchema: {
        buildId: z.string().describe("Stable id of the analyzed build."),
        occupiedConflicts: z.array(vec3Schema).describe("First 250 planned coordinates already occupied in the snapshot."),
        protectedConflicts: z.array(vec3Schema).describe("First 250 planned coordinates marked protected in the snapshot."),
        totals: z.object({ occupied: z.number().int(), protected: z.number().int() }).describe("Complete conflict totals before coordinate truncation."),
        cutFill: z.object({ cutBlocks: z.number().int(), estimatedFillBlocks: z.number().int() }).describe("Current cut/fill estimate."),
      },
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
      ...toolPresentation("Prepare Build Rendering", "Preparing render data…", "Render data ready"),
      name: "render_build",
      description: "Return render-ready placement data for an exact Blockwright build or layer.",
      inputSchema: {
        build: buildReferenceSchema,
        layer: z.number().int().optional().describe("Exact y coordinate to render; omit for every layer."),
        mode: z.enum(["solid", "blueprint", "exploded"]).default("solid").describe("Requested rendering arrangement."),
      },
      outputSchema: {
        buildId: z.string().describe("Stable id of the rendered build."),
        mode: z.enum(["solid", "blueprint", "exploded"]).describe("Rendering arrangement that was prepared."),
        layer: z.number().int().optional().describe("Rendered y coordinate when a layer filter was supplied."),
        count: z.number().int().describe("Number of placements attached as private render metadata."),
        bounds: outputBoundsSchema.describe("Full build bounds."),
      },
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
      ...toolPresentation("Export Build", "Preparing build export…", "Build export ready"),
      name: "export_build",
      description: "Export a canonical build as JSON, CSV, Java commands, Bedrock commands, Sponge v3 .schem, a layer blueprint, or a checksummed ZIP bundle.",
      inputSchema: {
        build: buildReferenceSchema,
        format: z.enum(["json", "csv", "java_mcfunction", "bedrock_mcfunction", "blueprint", "schem", "bundle"]).describe("Export format to generate from the immutable build record."),
      },
      outputSchema: {
        buildId: z.string().describe("Stable id of the exported build."),
        format: z.enum(["json", "csv", "java_mcfunction", "bedrock_mcfunction", "blueprint", "schem", "bundle"]).describe("Generated export format."),
        filename: z.string().describe("Safe suggested download filename."),
        bytes: z.number().int().describe("Exact byte length of the generated export."),
        dataVersion: z.number().int().optional().describe("Java DataVersion embedded in a schematic export."),
        schematicVersion: z.number().int().optional().describe("Sponge Schematic format version, when applicable."),
      },
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
      ...toolPresentation("Export WorldEdit Schematic", "Building schematic file…", "Schematic export ready"),
      name: "export_schematic",
      description: "Export a Java build as a real GZip-compressed Sponge Schematic v3 file with DataVersion, block-state palette, varint data, offset, transforms, replacements, and supported block entities.",
      inputSchema: {
        build: buildReferenceSchema,
        name: z.string().optional().describe("Optional schematic display name and filename stem."),
        author: z.string().optional().describe("Optional author metadata embedded in the schematic."),
        offset: vec3Schema.optional().describe("Transform offset applied before schematic encoding."),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0).describe("Clockwise rotation in degrees."),
        mirror: z.enum(["none", "x", "z"]).default("none").describe("Optional mirror transform around the selected axis."),
        includeAir: z.boolean().default(false).describe("Include explicit air placements so pasting can clear space."),
        replacements: z.record(z.string(), z.string()).optional().describe("Namespaced block-id substitutions applied during export."),
      },
      outputSchema: {
        buildId: z.string().describe("Stable id of the exported build."),
        filename: z.string().describe("Safe suggested .schem filename."),
        bytes: z.number().int().describe("Exact compressed schematic size in bytes."),
        schematicVersion: z.literal(3).describe("Sponge Schematic format version."),
        dataVersion: z.number().int().describe("Java DataVersion embedded in the schematic."),
        dimensions: extentDimensionsSchema.describe("Transformed schematic dimensions."),
        paletteSize: z.number().int().describe("Number of distinct block states in the schematic palette."),
        blockCount: z.number().int().describe("Number of encoded occupied blocks."),
        includeAir: z.boolean().describe("Whether explicit air was included."),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).describe("Applied clockwise rotation."),
        mirror: z.enum(["none", "x", "z"]).describe("Applied mirror transform."),
        offset: vec3Schema.describe("Applied transform offset."),
      },
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
      ...toolPresentation("Import WorldEdit Schematic", "Reading schematic file…", "Schematic imported"),
      name: "import_schematic",
      description: "Parse a GZip-compressed Sponge Schematic v3 .schem for analysis, preview, revision, or palette replacement.",
      inputSchema: {
        base64: z.string().min(1).describe("Base64-encoded GZip Sponge Schematic v3 bytes."),
        origin: vec3Schema.optional().describe("Optional world origin assigned to decoded placements."),
      },
      outputSchema: {
        format: z.string().describe("Detected schematic format."),
        version: z.number().int().describe("Decoded schematic format version."),
        dataVersion: z.number().int().describe("Java DataVersion embedded in the file."),
        metadata: z.unknown().describe("Decoded schematic metadata."),
        dimensions: extentDimensionsSchema.describe("Decoded schematic dimensions."),
        offset: vec3Schema.describe("Decoded schematic offset."),
        paletteSize: z.number().int().describe("Number of decoded block states."),
        blockCount: z.number().int().describe("Number of decoded occupied placements."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ base64, origin }) => {
      const imported = await importSchematic(Buffer.from(base64, "base64"), origin);
      return { structuredContent: { format: imported.format, version: imported.version, dataVersion: imported.dataVersion, metadata: imported.metadata, dimensions: imported.dimensions, offset: imported.offset, paletteSize: imported.paletteSize, blockCount: imported.placements.length }, content: [{ type: "text", text: `Imported Sponge v3 schematic with ${imported.placements.length.toLocaleString()} occupied blocks.` }], _meta: { placements: imported.placements } };
    },
  )
  .registerTool(
    {
      ...toolPresentation("Discover Local Worlds", "Scanning authorized saves…", "World discovery complete"),
      name: "discover_worlds",
      description: "Safely discover Java saved worlds on this Windows PC from the standard saves folder or one explicitly authorized launcher/instance saves folder. Reads level.dat only.",
      inputSchema: { authorizedSavesFolder: z.string().optional().describe("Optional launcher, instance, or server saves directory explicitly authorized by the user.") },
      outputSchema: {
        roots: z.array(z.string()).describe("Canonical save roots that were scanned."),
        worlds: z.array(discoveredWorldOutputSchema).describe("Discovered Java world metadata and suggested WorldEdit folders."),
        warnings: z.array(z.string()).describe("Unreadable or unsupported save entries encountered during discovery."),
        localOnly: z.string().describe("Reminder that discovered paths are available only through this PC companion."),
      },
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
      ...toolPresentation("Check WorldEdit Compatibility", "Checking WorldEdit support…", "Compatibility check complete"),
      name: "get_worldedit_compatibility",
      description: "Return the currently verified WorldEdit compatibility boundary for Java 26.2.",
      inputSchema: {
        minecraftVersion: z.string().describe("Exact Minecraft version selected for the target world."),
        platform: z.enum(["vanilla", "fabric", "neoforge", "forge", "paper", "spigot", "unknown"]).describe("Detected or user-confirmed server/mod-loader platform."),
      },
      outputSchema: {
        minecraftVersion: z.string().describe("Minecraft version that was checked."),
        platform: z.enum(["vanilla", "fabric", "neoforge", "forge", "paper", "spigot", "unknown"]).describe("Platform that was checked."),
        compatible: z.boolean().describe("Whether Blockwright stores evidence for this exact version/platform pair."),
        worldEditVersion: z.string().optional().describe("Verified WorldEdit version when compatibility evidence exists."),
        evidence: z.string().describe("Stored compatibility evidence or explicit reason no claim is made."),
        verifiedAt: z.string().describe("Date the compatibility evidence was last verified."),
      },
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
      ...toolPresentation("Install WorldEdit Schematic", "Preparing guarded install…", "Schematic workflow complete"),
      name: "install_worldedit_schematic",
      description: "Preview, then install, a verified Sponge v3 schematic into the exact WorldEdit folder for a selected local world/instance. Reports dimension, anchor, affected bounds/chunks, conflicts, risk, and paste instructions. Never edits Minecraft region files.",
      inputSchema: {
        build: buildReferenceSchema,
        worldId: z.string().describe("Stable world id returned by discover_worlds."),
        canonicalWorldPath: z.string().describe("Exact canonical world path paired with the selected stable id."),
        targetFolder: z.string().describe("Exact suggested WorldEdit schematics folder returned for the selected world."),
        name: z.string().describe("Safe schematic filename stem."),
        confirmed: z.boolean().default(false).describe("False for the mandatory no-write preview; true only after explicit user confirmation of the identical plan."),
        overwrite: z.boolean().default(false).describe("Allow replacement only when the preview reported an existing target and the user confirmed it."),
        dimension: z.enum(["overworld", "the_nether", "the_end"]).default("overworld").describe("Target Minecraft dimension used in paste instructions and bounds reporting."),
        anchor: vec3Schema.optional().describe("World coordinate used as the paste anchor."),
        region: worldRegionSchema.optional().describe("Optional canonical snapshot for occupied/protected conflict analysis."),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0).describe("Clockwise schematic rotation in degrees."),
        mirror: z.enum(["none", "x", "z"]).default("none").describe("Optional schematic mirror transform."),
        offset: vec3Schema.optional().describe("Additional schematic transform offset."),
        includeAir: z.boolean().default(false).describe("Include explicit air placements so pasting can clear space."),
        replacements: z.record(z.string(), z.string()).optional().describe("Namespaced block-id substitutions applied before installation."),
      },
      outputSchema: installWorldEditResultOutputSchema,
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
      ...toolPresentation("Revise Exact Build", "Applying locked revision…", "Build revision compiled"),
      name: "revise_build",
      description: "Apply explicit changes to a canonical build input and return a newly compiled immutable build record.",
      inputSchema: {
        build: buildReferenceSchema,
        changes: buildChangesSchema,
      },
      outputSchema: {
        previousHash: z.string().describe("Full immutable hash of the source build."),
        build: buildSummaryOutputSchema.describe("New immutable build summary after applying only the explicit changes."),
      },
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
      ...toolPresentation("Load Build Placement Page", "Loading placement page…", "Placement page ready"),
      name: "get_build_chunk",
      description: "Private app-only helper for paginating large immutable placement records without exposing payload pages to the model.",
      inputSchema: {
        build: buildReferenceSchema,
        offset: z.number().int().min(0).default(0).describe("Zero-based placement offset in canonical sort order."),
        limit: z.number().int().min(1).max(2000).default(1000).describe("Maximum placements to attach to this page."),
      },
      outputSchema: {
        buildId: z.string().describe("Stable id of the paged build."),
        offset: z.number().int().describe("Zero-based offset of this page."),
        returned: z.number().int().describe("Number of placements attached in private response metadata."),
        total: z.number().int().describe("Total placement count across every page."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ...toolPresentation("Load Build Placement Page", "Loading placement page…", "Placement page ready")._meta,
        "openai/visibility": "private",
        ui: { visibility: ["app"] },
      },
    },
    async ({ build: value, offset, limit }) => {
      const build = asBuild(value);
      const placements = build.placements.slice(offset, offset + limit);
      return { structuredContent: { buildId: build.id, offset, returned: placements.length, total: build.placements.length }, content: [], _meta: { placements } };
    },
  );

function readinessChecks() {
  const checks: Record<string, { ok: boolean; detail: string }> = {
    runtime: { ok: true, detail: `Blockwright ${APP_VERSION} loaded on Node ${process.versions.node}.` },
    registry: { ok: false, detail: "No valid synchronized Java registry was found." },
    assets: { ok: false, detail: "Built view manifest is missing or invalid." },
  };
  try {
    const registries = listJavaRegistries();
    checks.registry = registries.length
      ? { ok: true, detail: `${registries.length} valid Java registry file(s); newest is ${registries[0].version}.` }
      : checks.registry;
  } catch (error) {
    checks.registry.detail = error instanceof Error ? error.message : "Java registry validation failed.";
  }
  try {
    const assetsRoot = resolve(process.cwd(), "dist", "assets");
    const manifestPath = resolve(assetsRoot, ".vite", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, { file?: string; css?: string[]; assets?: string[] }>;
    const files = [...new Set(Object.values(manifest).flatMap(({ file, css = [], assets = [] }) => [file, ...css, ...assets]).filter((file): file is string => Boolean(file)))];
    const invalid = files.filter((file) => {
      const target = resolve(assetsRoot, file);
      const value = relative(assetsRoot, target);
      return !value || value.startsWith("..") || isAbsolute(value);
    });
    const missing = files.filter((file) => !invalid.includes(file) && !existsSync(resolve(assetsRoot, file)));
    checks.assets = files.length && !invalid.length && !missing.length
      ? { ok: true, detail: `${files.length} built view asset(s) verified from the Vite manifest.` }
      : { ok: false, detail: invalid.length ? `Invalid built asset paths: ${invalid.slice(0, 3).join(", ")}.` : missing.length ? `Missing built assets: ${missing.slice(0, 3).join(", ")}.` : "Built view manifest contains no file entries." };
  } catch (error) {
    checks.assets.detail = error instanceof Error ? error.message : checks.assets.detail;
  }
  return checks;
}

server.express.get("/health", (_request: unknown, response: JsonResponse) => {
  response.setHeader("cache-control", "no-store");
  response.json({
    status: "ok",
    service: APP_NAME,
    version: APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

server.express.get("/ready", (_request: unknown, response: JsonResponse) => {
  const checks = readinessChecks();
  const ready = Object.values(checks).every(({ ok }) => ok);
  response.setHeader("cache-control", "no-store");
  response.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    service: APP_NAME,
    version: APP_VERSION,
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default await server.run();
export type AppType = typeof server;
