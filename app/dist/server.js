import { existsSync, readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import minecraftData from "minecraft-data";
import { REGISTRY_META } from "./data/registry-meta.js";
import { STYLE_PROFILES, getStyleProfile } from "./data/styles.js";
import { compileBuild, generateBuildCandidates, summarizeBuild } from "./lib/compiler.js";
import { createBundle, toBlueprint, toCsv, toJson, toMcfunction } from "./lib/exports.js";
import { assertConstructionExportable } from "./lib/export-policy.js";
import { listJavaRegistries, readJavaRegistry, registryMetadata } from "./lib/java-registry.js";
import { checkJavaUpdates, syncJavaVersion } from "./lib/java-version-sync.js";
import { architecturalPlanOutputSchema, auditTotalsOutputSchema, buildAuditOutputSchema, buildCandidateOutputSchema, buildContractResultOutputSchema, buildPreflightOutputSchema, buildSummaryOutputSchema, buildValidationOutputSchema, designMaterialOutputSchema, designProgramOutputSchema, discoveredWorldOutputSchema, installWorldEditResultOutputSchema, outputBoundsSchema, paletteInterviewOutputSchema, resourcePackVersionOutputSchema, savedPaletteOutputSchema, } from "./lib/output-schemas.js";
import { validateBuildContract } from "./lib/contract.js";
import { HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL, HOSTED_BUILD_VIEW_CACHE_TTL_MS, PrincipalBuildViewCache, } from "./lib/build-view-cache.js";
import { BUILD_VIEW_INITIAL_PAGE_SIZE, BUILD_VIEW_PAGE_SIZE, createBuildPlacementPage, createInitialBuildPlacementPage } from "./lib/build-view-paging.js";
import { createDeliveryBundle, createMaterialList } from "./lib/delivery.js";
import { BEDROCK_STABLE_VERSION, createBedrockMcpack } from "./lib/bedrock-structure.js";
import { exportLitematic, importLitematic } from "./lib/litematic.js";
import { continuePaletteInterview, deletePalette, listPalettes, loadPalette, renamePalette, savePalette } from "./lib/palette-studio.js";
import { estimateBuild } from "./lib/preflight.js";
import { auditBuild } from "./lib/reviewer.js";
import { reviseSelectedRegion } from "./lib/revision.js";
import { exportSchematic, importSchematic } from "./lib/schematic.js";
import { discoverWorlds, installWorldEditSchematic } from "./lib/worlds.js";
import { StripeBillingClient } from "./lib/billing.js";
import { configureHostedRoutes } from "./lib/hosted-routes.js";
import { importHostedSchematic } from "./lib/hosted-import.js";
import { FixedWindowRateLimiter, HostedServiceStore, loadHostedServiceConfig, sessionTokenFromHeaders, validateBase64Upload } from "./lib/hosted-service.js";
import { FileProjectStore, HOSTED_PROJECT_STORAGE_LIMITS, createHostedReviewService } from "./lib/projects.js";
import { mcpRequestTargetDisposition, runBlockwrightRuntime } from "./lib/runtime-listener.js";
const APP_NAME = "blockwright";
const APP_VERSION = "0.7.0";
const startedAt = Date.now();
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
const styleSchema = z.string().min(1).max(160).describe("Preset identifier or freeform custom design direction. Freeform styles require a generic design program and are never silently replaced by another style.");
const extentDimensionsSchema = z.object({
    width: z.number().int().min(1).max(65535).describe("Width in blocks along the x axis."),
    depth: z.number().int().min(1).max(65535).describe("Depth in blocks along the z axis."),
    height: z.number().int().min(1).max(65535).describe("Height in blocks along the y axis."),
});
const paletteRoles = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"];
const rolePaletteSchema = z.object(Object.fromEntries(paletteRoles.map((role) => [role, z.string().min(1).max(128).describe(`Namespaced Minecraft block identifier for the ${role} role.`)])));
const buildInputSchema = {
    name: z.string().min(1).max(80).describe("Human-readable build name used in reviews and export filenames."),
    edition: z.enum(["java", "bedrock"]).describe("Minecraft edition whose identifiers and commands must be used."),
    version: z.string().min(1).max(32).describe("Exact Minecraft version requested for registry coverage and export compatibility."),
    style: styleSchema.default("nordic"),
    sourceBrief: z.string().min(1).max(20000).optional().describe("The user's complete natural-language brief, retained verbatim enough to audit whether the structured requirements lost intent. Required for a generic design program."),
    dimensions: dimensionsSchema.describe("Requested exterior build envelope in blocks."),
    palette: z.array(z.string().min(1).max(128).describe("Namespaced Minecraft block identifier retained in the legacy ordered palette.")).optional().describe("Legacy ordered identifiers retained without a cardinality cap. Prefer materialLibrary for arbitrary designs."),
    rolePalette: rolePaletteSchema.partial().optional().describe("Optional compatibility mapping for common architectural roles. These eleven roles are defaults, not the complete material vocabulary."),
    materialLibrary: z.record(z.string().min(1).max(120).describe("Stable caller-defined material key referenced by generic design elements."), designMaterialOutputSchema).optional().describe("Open-ended named material library. There is intentionally no arbitrary entry-count limit; every entry is exact-version validated."),
    design: designProgramOutputSchema.optional().describe("Generic geometry program whose requirement mappings, elements, paths, basins, shells, fills, stairs, ramps, and sweeps are compiled without a domain-specific object catalog."),
    origin: vec3Schema.optional().describe("World-space coordinate for the minimum corner of the build; defaults to 0,0,0."),
    features: z.array(z.string().min(1).max(1000).describe("One complete hard feature requirement retained from the user's brief.")).optional().describe("Complete hard feature requirements with no arbitrary item-count cap. For generic designs, each entry must map exactly to generated design elements."),
    blockBudget: z.number().int().min(100).max(2000000).optional().describe("Maximum occupied-block count allowed for compilation."),
    seed: z.string().min(1).max(120).optional().describe("Visible deterministic seed; reuse it to reproduce the same normalized plan."),
    buildingType: z.enum(["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"]).optional().describe("High-level generator family for the architectural plan."),
    confirmationToken: z.string().max(256).optional().describe("Exact token returned by a red-risk preflight; never invent or paraphrase it."),
};
const buildReferenceSchema = z.union([
    z.string().min(1).max(128),
    z.object({
        id: z.string().max(128).optional().describe("Stable build identifier when the caller has one."),
        hash: z.string().max(128).optional().describe("Full immutable build hash when the caller has one."),
        input: z.object(buildInputSchema).passthrough().describe("Normalized build input used to deterministically reconstruct and integrity-check the build."),
    }).passthrough(),
]).describe("A PC-local build id, a hosted short-lived cacheRef returned with a build summary, or a canonical build summary/record containing normalized input. Hosted cache references are random capabilities; deterministic ids alone never cross a public cache boundary. Uncached summaries are recompiled and integrity-checked.");
const contractClauseInputSchema = z.union([
    z.string().min(1).max(500).describe("Requirement text; hard by default, or prefix with warning: or aesthetic: when appropriate."),
    z.object({
        requirement: z.string().min(1).max(500).describe("Human-readable requirement to add to the build contract."),
        severity: z.enum(["hard", "warning", "aesthetic"]).optional().describe("How the requirement affects delivery; omitted requirements are hard by default."),
    }),
]);
const buildContractOverrideSchema = z.object({
    features: z.array(z.string().min(1).max(500).describe("One additive contract requirement, hard by default unless prefixed with warning: or aesthetic:.")).optional().describe("Additional feature requirements with no arbitrary item-count cap; the build's locked features are retained."),
    clauses: z.array(contractClauseInputSchema).max(50).optional().describe("Additional hard, warning, or aesthetic clauses; hard clauses fail closed when unsupported."),
}).describe("Optional additive contract clauses. This cannot erase requirements already locked into the build input.");
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
        bounds: z.object({
            min: vec3Schema.describe("Minimum occupied coordinate of the existing structure."),
            max: vec3Schema.describe("Maximum occupied coordinate of the existing structure."),
        }).describe("Existing structure bounds."),
    })).optional().describe("Existing structures recorded in the snapshot."),
}).describe("Canonical world-region snapshot used for non-mutating conflict analysis.");
const buildChangesSchema = z.object({
    ...buildInputSchema,
    style: styleSchema,
    dimensions: dimensionsSchema.partial().optional().describe("Only the dimensions to change; omitted axes stay locked."),
}).partial().describe("Explicit build-input fields to change; all omitted constraints remain locked.");
const inclusiveCuboidSchema = z.object({
    min: vec3Schema.describe("First corner of the inclusive selected region."),
    max: vec3Schema.describe("Opposite corner of the inclusive selected region; corner order does not matter."),
});
const minecraftBlockIdSchema = z.string().max(128).regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/).describe("Lowercase namespaced Minecraft block identifier such as minecraft:stone_bricks.");
const minecraftStateKeySchema = z.string().max(64).regex(/^[a-z0-9_]+$/).describe("Lowercase Minecraft block-state property name.");
const minecraftStateValueSchema = z.union([
    z.string().max(128).regex(/^[a-z0-9_.-]+$/),
    z.number().int(),
    z.boolean(),
]);
const boundedBlockEntityDataSchema = z.record(z.string().max(128), z.unknown()).superRefine((data, context) => {
    if (Object.keys(data).length > 64) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Block-entity data is limited to 64 top-level fields." });
        return;
    }
    try {
        if (Buffer.byteLength(JSON.stringify(data)) > 4_096) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "Block-entity data is limited to 4,096 UTF-8 bytes." });
        }
    }
    catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Block-entity data must be bounded JSON." });
    }
});
const replacementPlacementSchema = vec3Schema.extend({
    block: minecraftBlockIdSchema.describe("Namespaced Minecraft block identifier for this replacement."),
    state: z.record(minecraftStateKeySchema, minecraftStateValueSchema).refine((state) => Object.keys(state).length <= 32, "At most 32 block-state properties are allowed.").optional().describe("Canonical Minecraft block-state properties with lowercase grammar."),
    phase: z.string().min(1).max(128).describe("Construction phase retained in the revised immutable record."),
    blockEntity: z.object({
        id: minecraftBlockIdSchema.describe("Namespaced Java block-entity identifier."),
        data: boundedBlockEntityDataSchema.describe("Bounded NBT-compatible block-entity payload."),
    }).optional().describe("Optional supported block entity at this coordinate."),
});
const projectIdSchema = z.string().regex(/^prj_[a-f0-9]{32}$/).describe("Stable local Blockwright project identifier.");
const projectVersionIdSchema = z.string().regex(/^ver_[a-f0-9]{32}$/).describe("Immutable project-version identifier.");
const projectVersionReasonSchema = z.enum(["manual", "autosave", "restore", "region_revision"]).describe("Reason this immutable version was appended.");
const projectSummarySchema = z.object({
    schemaVersion: z.literal(1).describe("Local project metadata schema version."),
    id: projectIdSchema,
    name: z.string().describe("Human-readable project name."),
    description: z.string().optional().describe("Optional project description."),
    private: z.literal(true).describe("Local projects are private by construction."),
    createdAt: z.string().describe("ISO creation timestamp."),
    updatedAt: z.string().describe("ISO timestamp of the latest immutable version."),
    headVersionId: projectVersionIdSchema.optional().describe("Current immutable head version, when the project has a build."),
    versionCount: z.number().int().min(0).describe("Total immutable versions retained for this project."),
});
const projectVersionMetadataSchema = z.object({
    schemaVersion: z.literal(1).describe("Immutable version metadata schema version."),
    id: projectVersionIdSchema,
    projectId: projectIdSchema,
    parentVersionId: projectVersionIdSchema.optional().describe("Previous immutable head version."),
    restoredFromVersionId: projectVersionIdSchema.optional().describe("Earlier version copied when this restore version was created."),
    reason: projectVersionReasonSchema,
    createdAt: z.string().describe("ISO version timestamp."),
    createdBy: z.string().optional().describe("Local actor label recorded for provenance."),
    contentHash: z.string().describe("SHA-256 binding the immutable version record and payload."),
});
const projectHeadSummarySchema = projectVersionMetadataSchema.extend({
    buildId: z.string().describe("Immutable build id stored by this version."),
    buildHash: z.string().describe("Full immutable build hash stored by this version."),
    blockCount: z.number().int().min(0).describe("Exact occupied placement count."),
    contractStatus: z.enum(["valid", "invalid"]).describe("Hash-bound semantic contract status."),
});
const projectSnapshotSummarySchema = z.object({
    project: projectSummarySchema,
    head: projectHeadSummarySchema.optional(),
    versions: z.array(projectVersionMetadataSchema).describe("Append-only version history without build payloads."),
});
const buildDiffSummarySchema = z.object({
    projectId: projectIdSchema.optional().describe("Project containing the compared versions, when this is a saved-version diff."),
    beforeVersionId: projectVersionIdSchema.optional().describe("Earlier immutable version identifier, when saved."),
    afterVersionId: projectVersionIdSchema.optional().describe("Later immutable version identifier, when saved."),
    beforeHash: z.string().describe("Full build hash before the change."),
    afterHash: z.string().describe("Full build hash after the change."),
    addedCount: z.number().int().min(0).describe("Coordinates occupied only after the change."),
    removedCount: z.number().int().min(0).describe("Coordinates occupied only before the change."),
    changedCount: z.number().int().min(0).describe("Coordinates whose block, state, phase, or block entity changed."),
    materialDeltaCount: z.number().int().min(0).describe("Distinct canonical block states whose counts changed."),
    contractChanged: z.boolean().optional().describe("Whether the hash-bound build contract changed."),
    certificateChanged: z.boolean().optional().describe("Whether the hash-bound contract certificate changed."),
});
const toolPresentation = (title, invoking, invoked) => ({
    title,
    _meta: {
        "openai/toolInvocation/invoking": invoking,
        "openai/toolInvocation/invoked": invoked,
    },
});
const buildCache = new Map();
const LOCAL_PROJECT_TENANT = "blockwright-local-user";
const LOCAL_PROJECT_ACTOR = "local-mcp";
const LOCAL_BUILD_PLACEMENT_CAP = 2_000_000;
const HOSTED_BUILD_PLACEMENT_CAP = 250_000;
const HOSTED_BUILD_ATTEMPT_CAP = 2_000_000;
const HOSTED_BUILD_AXIS_CAP = Object.freeze({ width: 512, depth: 512, height: 256 });
const HOSTED_BUILD_CHUNK_COLUMN_CAP = 1_024;
const HOSTED_IMPORT_PLACEMENT_CAP = 100_000;
const HOSTED_REVISION_PLACEMENT_CAP = 100_000;
const HOSTED_MCP_AUTH_ERROR = "HOSTED_MCP_AUTH_REQUIRED";
const HOSTED_MCP_RATE_ERROR = "HOSTED_MCP_RATE_LIMITED";
const HOSTED_MCP_PAYMENT_ERROR = "HOSTED_MCP_STUDIO_REQUIRED";
const HOSTED_MCP_PATH_ERROR = "HOSTED_MCP_PATH_INVALID";
const HOSTED_BUILD_WORK_PER_MINUTE = 30;
const HOSTED_BUILD_WORK_PER_TENANT_PER_MINUTE = 10;
const HOSTED_IMPORT_WORK_PER_MINUTE = 4;
const HOSTED_IMPORT_WORK_PER_TENANT_PER_MINUTE = 2;
const HOSTED_JAVA_UPDATE_WORK_PER_TENANT_PER_MINUTE = 4;
const HOSTED_ARTIFACT_WORK_PER_MINUTE = 8;
const HOSTED_ARTIFACT_WORK_PER_TENANT_PER_MINUTE = 4;
// Binary artifacts are base64 encoded in MCP metadata, so a 3 MiB raw cap
// keeps the encoded field at or below 4 MiB before the small JSON envelope.
const HOSTED_ARTIFACT_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const HOSTED_ARTIFACT_MAX_IN_FLIGHT = 2;
const HOSTED_MATERIAL_PAGE_SIZE = 100;
const HOSTED_BUILD_SUMMARY_MAX_BYTES = 1024 * 1024;
const PUBLIC_CONNECTOR_TOOLS = new Set([
    "get_supported_versions",
    "search_blocks",
    "get_style_profile",
    "estimate_build",
    "generate_build_candidates",
    "compile_build",
    "validate_build",
    "validate_build_contract",
    "audit_build",
    "review_build",
    "analyze_world_region",
    "export_build",
    "export_bedrock_project",
    "revise_build",
    "get_material_list",
    "get_build_chunk",
]);
function rememberBuild(build) {
    assertHostedCompiledBuild(build, "compiled build");
    if (boundedRemoteMode)
        return build;
    buildCache.delete(build.id);
    buildCache.set(build.id, build);
    while (buildCache.size > 32)
        buildCache.delete(buildCache.keys().next().value);
    return build;
}
function asBuild(value) {
    if (boundedRemoteMode) {
        const cached = cachedHostedBuild(value);
        if (cached)
            return cached;
    }
    if (typeof value === "string") {
        const cached = buildCache.get(value);
        if (cached)
            return cached;
        throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
    }
    if (!value || typeof value !== "object")
        throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
    if (!("input" in value) || !value.input)
        throw new Error("A canonical Blockwright build record or cached build id is required. Recompile if the local server restarted.");
    const suppliedId = "id" in value && typeof value.id === "string" ? value.id : undefined;
    const suppliedHash = "hash" in value && typeof value.hash === "string" ? value.hash : undefined;
    assertHostedBuildWorkload(value.input, "canonical build recompilation");
    consumeHostedBuildWork("canonical build recompilation");
    const compiled = compileBuildForRuntime(value.input);
    if (boundedRemoteMode && "revision" in value && value.revision && typeof value.revision === "object" && "kind" in value.revision && value.revision.kind === "selected_region") {
        return recompileHostedRegionalBuild(value, compiled, suppliedId, suppliedHash);
    }
    if (suppliedId && suppliedId !== compiled.id) {
        throw new Error(`Build integrity check failed: supplied id ${suppliedId} does not match deterministic build id ${compiled.id}.`);
    }
    if (suppliedHash && suppliedHash !== compiled.hash) {
        throw new Error(`Build integrity check failed: supplied hash ${suppliedHash.slice(0, 12)} does not match the deterministic input hash ${compiled.hash.slice(0, 12)}.`);
    }
    const cached = !boundedRemoteMode && suppliedId ? buildCache.get(suppliedId) : undefined;
    if (cached) {
        if (cached.hash !== compiled.hash) {
            throw new Error(`Build integrity check failed: cached build ${cached.hash.slice(0, 12)} does not match supplied input ${compiled.hash.slice(0, 12)}.`);
        }
        return cached;
    }
    const remembered = rememberBuild(compiled);
    if (!publicConnectorMode)
        cacheBuildForView(remembered);
    return remembered;
}
function canonicalIntegrityJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(canonicalIntegrityJson).join(",")}]`;
    return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalIntegrityJson(item)}`)
        .join(",")}}`;
}
function recompileHostedRegionalBuild(value, generatedBase, suppliedId, suppliedHash) {
    if (!suppliedId || !suppliedHash) {
        throw new Error("HOSTED_CANONICAL_BUILD_REQUIRED: selected-region records must include their full placements, id, and hash.");
    }
    const parsed = z.array(replacementPlacementSchema).max(HOSTED_REVISION_PLACEMENT_CAP).safeParse(value.placements);
    if (!parsed.success)
        throw new Error("HOSTED_CANONICAL_BUILD_INVALID: selected-region placements failed bounded canonical validation.");
    const placements = parsed.data;
    const suppliedByCoordinate = new Map();
    for (const placement of placements) {
        const key = `${placement.x},${placement.y},${placement.z}`;
        if (suppliedByCoordinate.has(key))
            throw new Error(`HOSTED_CANONICAL_BUILD_INVALID: duplicate placement coordinate ${key}.`);
        suppliedByCoordinate.set(key, placement);
    }
    const baseByCoordinate = new Map(generatedBase.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement]));
    const changedCoordinates = [];
    for (const [key, basePlacement] of baseByCoordinate) {
        const suppliedPlacement = suppliedByCoordinate.get(key);
        if (!suppliedPlacement || canonicalIntegrityJson(suppliedPlacement) !== canonicalIntegrityJson(basePlacement)) {
            changedCoordinates.push({ x: basePlacement.x, y: basePlacement.y, z: basePlacement.z });
        }
    }
    for (const [key, suppliedPlacement] of suppliedByCoordinate) {
        if (!baseByCoordinate.has(key))
            changedCoordinates.push({ x: suppliedPlacement.x, y: suppliedPlacement.y, z: suppliedPlacement.z });
    }
    if (!changedCoordinates.length) {
        if (suppliedHash !== generatedBase.hash || suppliedId !== generatedBase.id) {
            throw new Error("Build integrity check failed: the selected-region record claims a changed hash without any placement change.");
        }
        const remembered = rememberBuild(generatedBase);
        if (!publicConnectorMode)
            cacheBuildForView(remembered);
        return remembered;
    }
    const region = changedCoordinates.reduce((bounds, coordinate) => ({
        min: {
            x: Math.min(bounds.min.x, coordinate.x),
            y: Math.min(bounds.min.y, coordinate.y),
            z: Math.min(bounds.min.z, coordinate.z),
        },
        max: {
            x: Math.max(bounds.max.x, coordinate.x),
            y: Math.max(bounds.max.y, coordinate.y),
            z: Math.max(bounds.max.z, coordinate.z),
        },
    }), { min: { ...changedCoordinates[0] }, max: { ...changedCoordinates[0] } });
    const replacements = placements.filter((placement) => placement.x >= region.min.x && placement.x <= region.max.x
        && placement.y >= region.min.y && placement.y <= region.max.y
        && placement.z >= region.min.z && placement.z <= region.max.z);
    assertReplacementStateSemantics(generatedBase, replacements);
    assertHostedRegionRevision(generatedBase, region, replacements);
    consumeHostedBuildWork("canonical selected-region reconstruction");
    const reconstructed = reviseSelectedRegion(generatedBase, region, replacements).build;
    if (suppliedHash !== reconstructed.hash || suppliedId !== reconstructed.id) {
        throw new Error("Build integrity check failed: the selected-region id or hash does not match its canonical placement reconstruction.");
    }
    const remembered = rememberBuild(reconstructed);
    if (!publicConnectorMode)
        cacheBuildForView(remembered);
    return remembered;
}
const keyOf = ({ x, y, z }) => `${x},${y},${z}`;
const javaRegistry = minecraftData("1.21.8");
const fallbackJavaBlocks = Object.values(javaRegistry?.blocksByName ?? {}).map((block) => ({
    id: `minecraft:${block.name}`,
    displayName: block.displayName,
    hardness: block.hardness,
    stackSize: block.stackSize,
}));
const exactBedrockRegistry = minecraftData(`bedrock_${BEDROCK_STABLE_VERSION}`);
if (!exactBedrockRegistry) {
    throw new Error(`The exact Bedrock minecraft-data registry ${BEDROCK_STABLE_VERSION} is unavailable.`);
}
const bedrockBlocks = Object.values(exactBedrockRegistry.blocksByName).map(({ name, displayName }) => ({
    id: `minecraft:${name}`,
    displayName,
}));
const hostedConfig = loadHostedServiceConfig();
/**
 * Public connector mode is the deliberately stateless, rate-limited surface used
 * by the account-level ChatGPT/iPhone connection. It does not enable hosted
 * accounts, billing, project storage, or any PC-local filesystem tools.
 */
const publicConnectorMode = !hostedConfig.enabled && process.env.BLOCKWRIGHT_PUBLIC_CONNECTOR_MODE === "1";
if (publicConnectorMode && process.env.NODE_ENV === "production" && !/^[0-4]$/.test(process.env.BLOCKWRIGHT_TRUST_PROXY_HOPS?.trim() ?? "")) {
    throw new Error("Production public connector mode requires an explicit BLOCKWRIGHT_TRUST_PROXY_HOPS value from 0 through 4 so client isolation and quotas bind at the intended ingress boundary.");
}
const boundedRemoteMode = hostedConfig.enabled || publicConnectorMode;
const runtimeCompileLimits = boundedRemoteMode
    ? { maximumPlacements: HOSTED_BUILD_PLACEMENT_CAP, maximumPlacementAttempts: HOSTED_BUILD_ATTEMPT_CAP }
    : { maximumPlacements: LOCAL_BUILD_PLACEMENT_CAP, maximumPlacementAttempts: 8_000_000 };
function compileBuildForRuntime(input) {
    return compileBuild(input, runtimeCompileLimits);
}
let hostedStore;
let hostedStartupIssue;
if (hostedConfig.ready) {
    try {
        hostedStore = new HostedServiceStore(hostedConfig);
    }
    catch (error) {
        hostedStartupIssue = error instanceof Error ? error.message : "Hosted service storage failed to initialize.";
        console.error("Blockwright hosted storage failed to initialize; readiness will remain unavailable.", error);
    }
}
const stripeBilling = hostedStore && hostedConfig.stripeSecretKey && hostedConfig.stripePriceId && hostedConfig.baseUrl
    ? new StripeBillingClient({ secretKey: hostedConfig.stripeSecretKey, priceId: hostedConfig.stripePriceId, publicUrl: hostedConfig.baseUrl })
    : undefined;
const projectStore = new FileProjectStore({
    ...(hostedConfig.projectRoot ? { rootDirectory: hostedConfig.projectRoot } : {}),
    ...(hostedStore ? { dependentStores: [hostedStore] } : {}),
    ...(hostedConfig.enabled ? { limits: HOSTED_PROJECT_STORAGE_LIMITS } : {}),
});
const reviewService = hostedStore && hostedConfig.baseUrl && hostedConfig.reviewTokenPepper
    ? createHostedReviewService({
        enabled: true,
        baseUrl: hostedConfig.baseUrl,
        tokenPepper: hostedConfig.reviewTokenPepper,
        storage: hostedStore,
    })
    : undefined;
const hostedMcpLimiter = new FixedWindowRateLimiter(hostedConfig.rateLimitWindowMs, hostedConfig.rateLimitRequests);
const hostedMcpAuthLimiter = new FixedWindowRateLimiter(hostedConfig.rateLimitWindowMs, hostedConfig.authRateLimitRequests);
const hostedMcpPreAuthLimiter = new FixedWindowRateLimiter(hostedConfig.rateLimitWindowMs, hostedConfig.rateLimitRequests);
const hostedBuildWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_BUILD_WORK_PER_MINUTE);
const hostedTenantBuildWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_BUILD_WORK_PER_TENANT_PER_MINUTE);
const hostedImportWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_IMPORT_WORK_PER_MINUTE);
const hostedTenantImportWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_IMPORT_WORK_PER_TENANT_PER_MINUTE);
const hostedTenantJavaUpdateWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_JAVA_UPDATE_WORK_PER_TENANT_PER_MINUTE);
const hostedArtifactWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_ARTIFACT_WORK_PER_MINUTE);
const hostedTenantArtifactWorkLimiter = new FixedWindowRateLimiter(60_000, HOSTED_ARTIFACT_WORK_PER_TENANT_PER_MINUTE);
const hostedRequestContext = new AsyncLocalStorage();
const hostedBuildViewCache = new PrincipalBuildViewCache({
    maxRecords: HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS,
    maxPlacements: HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS,
    maxRecordsPerPrincipal: HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL,
    ttlMs: HOSTED_BUILD_VIEW_CACHE_TTL_MS,
});
let hostedImportsInFlight = 0;
let hostedArtifactsInFlight = 0;
const hostedArtifactTenantsInFlight = new Set();
function hostedCachePrincipal() {
    const principal = hostedRequestContext.getStore();
    if (!principal)
        throw new Error("HOSTED_MCP_AUTH_REQUIRED: hosted build access requires an authenticated request context.");
    return principal;
}
const PUBLIC_CACHE_REFERENCE_PATTERN = /^bwc_([A-Za-z0-9_-]{32})\.(bw_[a-f0-9]{12})$/;
function createPublicCacheReference(build) {
    return `bwc_${randomBytes(24).toString("base64url")}.${build.id}`;
}
function publicCacheLocation(value) {
    const cacheRef = typeof value === "string"
        ? value
        : value && typeof value === "object" && "cacheRef" in value && typeof value.cacheRef === "string"
            ? value.cacheRef
            : undefined;
    const match = cacheRef ? PUBLIC_CACHE_REFERENCE_PATTERN.exec(cacheRef) : undefined;
    if (!match)
        return undefined;
    return {
        cacheRef,
        buildId: match[2],
        principal: { tenantId: "public_cache_capability", userId: `public_cache_${match[1]}` },
    };
}
function cachedHostedBuild(value) {
    const publicLocation = publicConnectorMode ? publicCacheLocation(value) : undefined;
    if (publicConnectorMode && typeof value === "string" && !publicLocation) {
        throw new Error("VIEW_BUILD_CACHE_MISS: public cached builds require the short-lived cacheRef returned by the originating build tool.");
    }
    if (publicConnectorMode && value && typeof value === "object" && !publicLocation)
        return undefined;
    const principal = publicLocation?.principal ?? hostedCachePrincipal();
    if (typeof value === "string") {
        const lookupId = publicConnectorMode ? publicLocation?.buildId : value;
        const cached = lookupId ? hostedBuildViewCache.get(principal, lookupId) : undefined;
        if (!cached)
            throw new Error("VIEW_BUILD_CACHE_MISS: this build is no longer available in your bounded build cache. Rerun the originating build tool to reopen it.");
        return cached;
    }
    if (!value || typeof value !== "object")
        return undefined;
    const suppliedId = "id" in value && typeof value.id === "string" ? value.id : undefined;
    const suppliedHash = "hash" in value && typeof value.hash === "string" ? value.hash : undefined;
    if (!suppliedId || !suppliedHash)
        return undefined;
    if (publicLocation && publicLocation.buildId !== suppliedId) {
        throw new Error("Build integrity check failed: the hosted cache reference does not match the supplied deterministic build id.");
    }
    const cached = hostedBuildViewCache.get(principal, publicLocation?.buildId ?? suppliedId);
    if (!cached)
        return undefined;
    if (cached.hash !== suppliedHash) {
        throw new Error("Build integrity check failed: the supplied build hash does not match the authenticated cached build.");
    }
    return cached;
}
function cacheBuildForView(build) {
    if (!boundedRemoteMode)
        return build.id;
    const summaryBytes = Buffer.byteLength(JSON.stringify(summarizeBuild(build)));
    const cardinalities = {
        layers: Object.keys(build.layerCounts).length,
        phases: build.phases.length,
        regions: build.regions.length,
        validationIssues: build.validation.issues.length,
    };
    if (summaryBytes > HOSTED_BUILD_SUMMARY_MAX_BYTES) {
        throw new Error(`HOSTED_BUILD_SUMMARY_OUTPUT_LIMIT_EXCEEDED: this build's normalized summary is ${summaryBytes.toLocaleString()} bytes; hosted MCP permits at most ${HOSTED_BUILD_SUMMARY_MAX_BYTES.toLocaleString()} bytes. Reduce descriptive payload size or split the design, or use the local app.`);
    }
    if (cardinalities.layers > 1_024 || cardinalities.phases > 128 || cardinalities.regions > 1_024 || cardinalities.validationIssues > 256) {
        throw new Error("HOSTED_BUILD_SUMMARY_LIMIT_EXCEEDED: this build's summary cardinality exceeds the bounded hosted response envelope. Simplify or split the build, or use the local app.");
    }
    const cacheRef = publicConnectorMode ? createPublicCacheReference(build) : build.id;
    const principal = publicConnectorMode ? publicCacheLocation(cacheRef).principal : hostedCachePrincipal();
    if (!hostedBuildViewCache.set(principal, build)) {
        throw new Error("HOSTED_VIEW_BUILD_TOO_LARGE: this build cannot fit in the bounded view cache. Simplify or split the build, or use the local app.");
    }
    return cacheRef;
}
function cachedBuildForView(value) {
    const publicLocation = publicConnectorMode ? publicCacheLocation(value) : undefined;
    if (publicConnectorMode && !publicLocation) {
        throw new Error("VIEW_BUILD_CACHE_MISS: public placement pages require the short-lived cacheRef returned by review_build.");
    }
    const suppliedId = publicLocation?.buildId ?? (typeof value === "string"
        ? value
        : value && typeof value === "object" && "id" in value && typeof value.id === "string"
            ? value.id
            : undefined);
    const suppliedHash = value && typeof value === "object" && "hash" in value && typeof value.hash === "string" ? value.hash : undefined;
    if (!suppliedId)
        throw new Error("VIEW_BUILD_ID_REQUIRED: hosted placement pages require the cacheRef returned by review_build; local pages use the stable build id.");
    const build = boundedRemoteMode
        ? hostedBuildViewCache.get(publicLocation?.principal ?? hostedCachePrincipal(), suppliedId)
        : buildCache.get(suppliedId);
    if (!build) {
        throw new Error("VIEW_BUILD_CACHE_MISS: this build is no longer available in the bounded view cache. Rerun compile_build or review_build to reopen it.");
    }
    if (suppliedHash && suppliedHash !== build.hash)
        throw new Error("Build integrity check failed: the requested placement page hash does not match the cached build.");
    return build;
}
function buildSummaryForClient(build, cacheRef) {
    return { ...summarizeBuild(build), ...(publicConnectorMode ? { cacheRef } : {}) };
}
function buildViewMetadata(build, cacheRef = cacheBuildForView(build)) {
    const buildPage = createInitialBuildPlacementPage(build);
    buildPage.buildId = cacheRef;
    return { buildSummary: buildSummaryForClient(build, cacheRef), buildPage };
}
function assertLocalOperation(operation) {
    if (boundedRemoteMode) {
        throw new Error(`LOCAL_OPERATION_UNAVAILABLE: ${operation} is available only from a PC-local Blockwright instance.`);
    }
}
function assertHostedBuildWorkload(input, operation) {
    if (!boundedRemoteMode)
        return;
    const preflight = estimateBuild(input);
    const { width, depth, height } = preflight.dimensions;
    if (width > HOSTED_BUILD_AXIS_CAP.width || depth > HOSTED_BUILD_AXIS_CAP.depth || height > HOSTED_BUILD_AXIS_CAP.height || preflight.chunksTouched > HOSTED_BUILD_CHUNK_COLUMN_CAP) {
        throw new Error(`HOSTED_BUILD_SPAN_LIMIT_EXCEEDED: ${operation} spans ${width}×${depth}×${height} blocks and ${preflight.chunksTouched.toLocaleString()} chunk columns; the remote connector permits at most ${HOSTED_BUILD_AXIS_CAP.width}×${HOSTED_BUILD_AXIS_CAP.depth}×${HOSTED_BUILD_AXIS_CAP.height} and ${HOSTED_BUILD_CHUNK_COLUMN_CAP.toLocaleString()} chunk columns.`);
    }
    if (preflight.estimatedPlacementAttempts > HOSTED_BUILD_ATTEMPT_CAP) {
        throw new Error(`HOSTED_BUILD_WORK_LIMIT_EXCEEDED: ${operation} may attempt ${preflight.estimatedPlacementAttempts.toLocaleString()} coordinate operations; the remote connector permits at most ${HOSTED_BUILD_ATTEMPT_CAP.toLocaleString()}. Simplify repeated or overlapping design operations.`);
    }
}
function consumeHostedBuildWork(operation, explicitPrincipal) {
    if (!boundedRemoteMode)
        return;
    const principal = explicitPrincipal ?? hostedRequestContext.getStore();
    if (!principal)
        throw new Error("HOSTED_MCP_AUTH_REQUIRED: hosted build work requires an authenticated request context.");
    const tenantLimit = hostedTenantBuildWorkLimiter.consume(principal.tenantId);
    if (!tenantLimit.allowed) {
        throw new Error(`HOSTED_TENANT_BUILD_WORK_RATE_LIMITED: this workspace is limited to ${HOSTED_BUILD_WORK_PER_TENANT_PER_MINUTE} hosted compile/revision work units per minute. ${operation} was not started; retry after ${tenantLimit.resetAt}.`);
    }
    const limit = hostedBuildWorkLimiter.consume("global");
    if (!limit.allowed) {
        throw new Error(`HOSTED_BUILD_WORK_RATE_LIMITED: Blockwright is limited to ${HOSTED_BUILD_WORK_PER_MINUTE} hosted compile/revision work units per minute across all users. ${operation} was not started; retry after ${limit.resetAt}.`);
    }
}
function beginHostedImportWork() {
    if (!boundedRemoteMode)
        return () => undefined;
    const principal = hostedRequestContext.getStore();
    if (!principal)
        throw new Error("HOSTED_MCP_AUTH_REQUIRED: hosted import work requires an authenticated request context.");
    const tenantLimit = hostedTenantImportWorkLimiter.consume(principal.tenantId);
    if (!tenantLimit.allowed) {
        throw new Error(`HOSTED_TENANT_IMPORT_RATE_LIMITED: this workspace is limited to ${HOSTED_IMPORT_WORK_PER_TENANT_PER_MINUTE} hosted imports per minute. Retry after ${tenantLimit.resetAt}.`);
    }
    const globalLimit = hostedImportWorkLimiter.consume("global");
    if (!globalLimit.allowed) {
        throw new Error(`HOSTED_IMPORT_RATE_LIMITED: Blockwright is limited to ${HOSTED_IMPORT_WORK_PER_MINUTE} hosted imports per minute across all workspaces. Retry after ${globalLimit.resetAt}.`);
    }
    if (hostedImportsInFlight >= 1)
        throw new Error("HOSTED_IMPORT_BUSY: another isolated import is already running. Retry shortly.");
    hostedImportsInFlight += 1;
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        hostedImportsInFlight -= 1;
    };
}
function beginHostedArtifactWork() {
    if (!boundedRemoteMode)
        return () => undefined;
    const principal = hostedRequestContext.getStore();
    if (!principal)
        throw new Error("HOSTED_MCP_AUTH_REQUIRED: hosted artifact work requires an authenticated request context.");
    const tenantLimit = hostedTenantArtifactWorkLimiter.consume(principal.tenantId);
    if (!tenantLimit.allowed) {
        throw new Error(`HOSTED_TENANT_ARTIFACT_RATE_LIMITED: this workspace is limited to ${HOSTED_ARTIFACT_WORK_PER_TENANT_PER_MINUTE} hosted artifact generations per minute. Retry after ${tenantLimit.resetAt}.`);
    }
    const globalLimit = hostedArtifactWorkLimiter.consume("global");
    if (!globalLimit.allowed) {
        throw new Error(`HOSTED_ARTIFACT_RATE_LIMITED: Blockwright is limited to ${HOSTED_ARTIFACT_WORK_PER_MINUTE} hosted artifact generations per minute. Retry after ${globalLimit.resetAt}.`);
    }
    if (hostedArtifactsInFlight >= HOSTED_ARTIFACT_MAX_IN_FLIGHT || hostedArtifactTenantsInFlight.has(principal.tenantId)) {
        throw new Error("HOSTED_ARTIFACT_BUSY: artifact generation capacity is busy. Retry shortly.");
    }
    hostedArtifactsInFlight += 1;
    hostedArtifactTenantsInFlight.add(principal.tenantId);
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        hostedArtifactsInFlight -= 1;
        hostedArtifactTenantsInFlight.delete(principal.tenantId);
    };
}
function assertHostedArtifactOutputSize(byteLength) {
    if (boundedRemoteMode && byteLength > HOSTED_ARTIFACT_MAX_OUTPUT_BYTES) {
        throw new Error(`HOSTED_ARTIFACT_OUTPUT_LIMIT_EXCEEDED: hosted MCP artifacts are limited to ${HOSTED_ARTIFACT_MAX_OUTPUT_BYTES.toLocaleString()} bytes. Use the local app for this export.`);
    }
}
function consumeHostedJavaUpdateWork() {
    if (!boundedRemoteMode)
        return;
    const principal = hostedRequestContext.getStore();
    if (!principal)
        throw new Error("HOSTED_MCP_AUTH_REQUIRED: hosted Java update checks require an authenticated request context.");
    const limit = hostedTenantJavaUpdateWorkLimiter.consume(principal.tenantId);
    if (!limit.allowed) {
        throw new Error(`HOSTED_JAVA_UPDATE_RATE_LIMITED: this workspace is limited to ${HOSTED_JAVA_UPDATE_WORK_PER_TENANT_PER_MINUTE} Java update checks per minute. Retry after ${limit.resetAt}.`);
    }
}
function assertHostedCompiledBuild(build, operation) {
    if (boundedRemoteMode && build.placements.length > HOSTED_BUILD_PLACEMENT_CAP) {
        throw new Error(`HOSTED_BUILD_LIMIT_EXCEEDED: ${operation} produced ${build.placements.length.toLocaleString()} placements; hosted MCP is capped at ${HOSTED_BUILD_PLACEMENT_CAP.toLocaleString()}.`);
    }
}
function assertHostedRegionRevision(base, requestedRegion, replacements) {
    if (!boundedRemoteMode)
        return;
    const region = {
        min: {
            x: Math.min(requestedRegion.min.x, requestedRegion.max.x),
            y: Math.min(requestedRegion.min.y, requestedRegion.max.y),
            z: Math.min(requestedRegion.min.z, requestedRegion.max.z),
        },
        max: {
            x: Math.max(requestedRegion.min.x, requestedRegion.max.x),
            y: Math.max(requestedRegion.min.y, requestedRegion.max.y),
            z: Math.max(requestedRegion.min.z, requestedRegion.max.z),
        },
    };
    const regionDimensions = {
        width: region.max.x - region.min.x + 1,
        height: region.max.y - region.min.y + 1,
        depth: region.max.z - region.min.z + 1,
    };
    const regionVolume = regionDimensions.width * regionDimensions.height * regionDimensions.depth;
    if (!Number.isSafeInteger(regionVolume) || regionVolume > HOSTED_REVISION_PLACEMENT_CAP) {
        throw new Error(`HOSTED_REVISION_LIMIT_EXCEEDED: selected regions are capped at a ${HOSTED_REVISION_PLACEMENT_CAP.toLocaleString()}-block envelope.`);
    }
    if (replacements.length > HOSTED_REVISION_PLACEMENT_CAP) {
        throw new Error(`HOSTED_REVISION_LIMIT_EXCEEDED: selected-region replacement is capped at ${HOSTED_REVISION_PLACEMENT_CAP.toLocaleString()} placements.`);
    }
    const inside = (placement) => placement.x >= region.min.x && placement.x <= region.max.x
        && placement.y >= region.min.y && placement.y <= region.max.y
        && placement.z >= region.min.z && placement.z <= region.max.z;
    const projected = [...base.placements.filter((placement) => !inside(placement)), ...replacements];
    if (projected.length > HOSTED_REVISION_PLACEMENT_CAP) {
        throw new Error(`HOSTED_REVISION_LIMIT_EXCEEDED: selected-region revision would produce ${projected.length.toLocaleString()} placements; hosted revisions are capped at ${HOSTED_REVISION_PLACEMENT_CAP.toLocaleString()}.`);
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const placement of projected) {
        minX = Math.min(minX, placement.x);
        minY = Math.min(minY, placement.y);
        minZ = Math.min(minZ, placement.z);
        maxX = Math.max(maxX, placement.x);
        maxY = Math.max(maxY, placement.y);
        maxZ = Math.max(maxZ, placement.z);
    }
    const projectedDimensions = { width: maxX - minX + 1, height: maxY - minY + 1, depth: maxZ - minZ + 1 };
    const projectedChunkColumns = Math.ceil(projectedDimensions.width / 16) * Math.ceil(projectedDimensions.depth / 16);
    if (!Object.values(projectedDimensions).every(Number.isSafeInteger)
        || projectedDimensions.width > HOSTED_BUILD_AXIS_CAP.width
        || projectedDimensions.depth > HOSTED_BUILD_AXIS_CAP.depth
        || projectedDimensions.height > HOSTED_BUILD_AXIS_CAP.height
        || projectedChunkColumns > HOSTED_BUILD_CHUNK_COLUMN_CAP) {
        throw new Error(`HOSTED_REVISION_SPAN_LIMIT_EXCEEDED: selected-region revision would span ${projectedDimensions.width}×${projectedDimensions.depth}×${projectedDimensions.height} blocks and ${projectedChunkColumns} chunk columns.`);
    }
}
function assertReplacementStateSemantics(base, replacements) {
    const baseByCoordinate = new Map(base.placements.map((placement) => [`${placement.x},${placement.y},${placement.z}`, placement]));
    for (const replacement of replacements) {
        const original = baseByCoordinate.get(`${replacement.x},${replacement.y},${replacement.z}`);
        if (replacement.state !== undefined) {
            const unchangedVerifiedState = original
                && original.block === replacement.block
                && canonicalIntegrityJson(original.state ?? {}) === canonicalIntegrityJson(replacement.state);
            if (!unchangedVerifiedState) {
                throw new Error("UNVERIFIED_BLOCK_STATE: selected-region revision may preserve a compiler-verified state on the same block, but cannot introduce or alter state properties until exact-version state registries are available.");
            }
        }
        if (replacement.blockEntity !== undefined) {
            const unchangedVerifiedEntity = original
                && original.block === replacement.block
                && canonicalIntegrityJson(original.blockEntity) === canonicalIntegrityJson(replacement.blockEntity);
            if (!unchangedVerifiedEntity) {
                throw new Error("UNVERIFIED_BLOCK_ENTITY: selected-region revision may preserve an existing compiler-verified block entity, but cannot introduce or alter arbitrary NBT payloads.");
            }
        }
    }
}
function assertHostedImportedPlacements(count, format) {
    if (boundedRemoteMode && count > HOSTED_IMPORT_PLACEMENT_CAP) {
        throw new Error(`HOSTED_IMPORT_LIMIT_EXCEEDED: ${format} contains ${count.toLocaleString()} occupied placements; hosted imports are capped at ${HOSTED_IMPORT_PLACEMENT_CAP.toLocaleString()}.`);
    }
}
function hostedImportLimitError(error, format) {
    if (!boundedRemoteMode || !(error instanceof Error) || !/volume.*limit|occupied placements.*cap/i.test(error.message))
        return undefined;
    return new Error(`HOSTED_IMPORT_LIMIT_EXCEEDED: ${format} exceeds the hosted ${HOSTED_IMPORT_PLACEMENT_CAP.toLocaleString()}-block import envelope.`);
}
function projectVersionMetadata(version) {
    const { tenantDigest: _tenantDigest, ...metadata } = version;
    if ("payload" in metadata) {
        const { payload: _payload, ...withoutPayload } = metadata;
        return withoutPayload;
    }
    return metadata;
}
function projectHeadSummary(version) {
    return {
        ...projectVersionMetadata(version),
        buildId: version.payload.build.id,
        buildHash: version.payload.build.hash,
        blockCount: version.payload.build.placements.length,
        contractStatus: version.payload.build.contract.status,
    };
}
function projectSnapshotSummary(snapshot) {
    return {
        project: snapshot.project,
        ...(snapshot.head ? { head: projectHeadSummary(snapshot.head) } : {}),
        versions: snapshot.versions.map(projectVersionMetadata),
    };
}
function buildDiffSummary(diff) {
    return {
        ...(diff.projectId ? { projectId: diff.projectId } : {}),
        ...(diff.beforeVersionId ? { beforeVersionId: diff.beforeVersionId } : {}),
        ...(diff.afterVersionId ? { afterVersionId: diff.afterVersionId } : {}),
        beforeHash: diff.beforeHash,
        afterHash: diff.afterHash,
        addedCount: diff.added.length,
        removedCount: diff.removed.length,
        changedCount: diff.changed.length,
        materialDeltaCount: Object.keys(diff.materialDeltas).length,
        ...(diff.contractChanged !== undefined ? { contractChanged: diff.contractChanged } : {}),
        ...(diff.certificateChanged !== undefined ? { certificateChanged: diff.certificateChanged } : {}),
    };
}
function safeExportName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
}
function authenticateHostedMcp(request) {
    if (!hostedStore)
        return undefined;
    const token = sessionTokenFromHeaders(request.headers.authorization, request.headers.cookie);
    return token ? hostedStore.authenticate(token) : undefined;
}
function hostedMcpClientAddress(request) {
    return request.blockwrightIngressClientAddress
        || request.ip
        || request.socket.remoteAddress
        || "unknown";
}
function publicConnectorPrincipal(request) {
    const sessionHeader = request.headers["mcp-session-id"];
    const session = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    const address = hostedMcpClientAddress(request);
    // The MCP session id is supplied by the caller, so it must never define an
    // authorization or quota boundary on its own. Public work remains address-
    // bound; hosted build-cache access is separately protected by an unguessable,
    // short-lived capability generated by cacheBuildForView.
    const addressDigest = createHash("sha256")
        .update("blockwright-public-address\0")
        .update(address)
        .digest("hex")
        .slice(0, 24);
    const scope = `${address}\0${session?.trim() || "no-session"}`;
    const digest = createHash("sha256").update("blockwright-public-connector\0").update(scope).digest("hex").slice(0, 24);
    return {
        userId: `public_user_${digest}`,
        tenantId: `public_tenant_${addressDigest}`,
        email: `public-${digest}@invalid.example`,
        tenantName: "Public connector",
        role: "member",
        plan: "public",
        sessionExpiresAt: new Date(Date.now() + HOSTED_BUILD_VIEW_CACHE_TTL_MS).toISOString(),
    };
}
function hostedMcpRateError(limit) {
    const error = new Error("Too many hosted MCP requests. Try again after the rate-limit reset time.");
    error.code = HOSTED_MCP_RATE_ERROR;
    error.limit = limit;
    return error;
}
function verifyHostedMcpBeforeJson(request) {
    const path = request.originalUrl ?? request.url ?? "";
    if (!boundedRemoteMode)
        return;
    const disposition = mcpRequestTargetDisposition(path);
    if (disposition === "other")
        return;
    if (disposition === "invalid") {
        const error = new Error("The Blockwright MCP endpoint is available only at /mcp.");
        error.code = HOSTED_MCP_PATH_ERROR;
        throw error;
    }
    if (request.blockwrightHostedPreAuthRateLimit && request.blockwrightHostedPrincipal && request.blockwrightHostedRateLimit)
        return;
    const preAuthLimit = hostedMcpPreAuthLimiter.consume(hostedMcpClientAddress(request));
    request.blockwrightHostedPreAuthRateLimit = preAuthLimit;
    if (!preAuthLimit.allowed)
        throw hostedMcpRateError(preAuthLimit);
    if (publicConnectorMode) {
        const principal = publicConnectorPrincipal(request);
        const limit = hostedMcpLimiter.consume(`public:${hostedMcpClientAddress(request)}`);
        if (!limit.allowed)
            throw hostedMcpRateError(limit);
        request.blockwrightHostedPrincipal = principal;
        request.blockwrightHostedRateLimit = limit;
        return;
    }
    const principal = authenticateHostedMcp(request);
    if (!principal) {
        const limit = hostedMcpAuthLimiter.consume(hostedMcpClientAddress(request));
        if (!limit.allowed)
            throw hostedMcpRateError(limit);
        const error = new Error("Sign in to use hosted Blockwright MCP.");
        error.code = HOSTED_MCP_AUTH_ERROR;
        throw error;
    }
    if (stripeBilling && principal.plan !== "studio") {
        const error = new Error("A Studio subscription is required to use hosted Blockwright MCP.");
        error.code = HOSTED_MCP_PAYMENT_ERROR;
        throw error;
    }
    const limit = hostedMcpLimiter.consume(`${principal.tenantId}:${principal.userId}:${hostedMcpClientAddress(request)}`);
    if (!limit.allowed)
        throw hostedMcpRateError(limit);
    request.blockwrightHostedPrincipal = principal;
    request.blockwrightHostedRateLimit = limit;
}
function javaBlocksFor(version) {
    if (version) {
        const snapshot = readJavaRegistry(version);
        if (!snapshot) {
            const available = listJavaRegistries().map(({ version: installedVersion }) => installedVersion);
            throw new Error(`Java ${version} is not synchronized locally. Run check_java_updates, then sync_java_version before searching exact-version identifiers.${available.length ? ` Installed registries: ${available.join(", ")}.` : " No synchronized Java registries were found."}`);
        }
        return {
            blocks: snapshot.blocks.map(({ id, displayName }) => ({ id, displayName })),
            coverage: registryMetadata(version),
        };
    }
    const snapshot = listJavaRegistries()[0];
    if (snapshot) {
        return {
            blocks: snapshot.blocks.map(({ id, displayName }) => ({ id, displayName })),
            coverage: registryMetadata(snapshot.version),
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
const server = new McpServer({ name: APP_NAME, version: APP_VERSION }, { capabilities: {} }, {
    json: {
        limit: `${Math.ceil((hostedConfig.maxUploadBytes * 4 / 3 + 1024 * 1024) / (1024 * 1024))}mb`,
        verify: (request) => verifyHostedMcpBeforeJson(request),
    },
})
    .registerTool({
    ...toolPresentation("Get Supported Versions", "Checking registry coverage…", "Registry coverage ready"),
    name: "get_supported_versions",
    description: "Get current Java and Bedrock block-registry coverage and source metadata.",
    inputSchema: { edition: z.enum(["java", "bedrock"]).optional().describe("Optional edition filter; omit it to return both Java and Bedrock coverage.") },
    outputSchema: { versions: z.record(z.string(), z.unknown()).describe("Registry coverage keyed by Minecraft edition.") },
    annotations: { title: "Get Supported Versions", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ edition }) => {
    const installedJava = listJavaRegistries().map(({ version, type, releaseTime, syncedAt, blockCount, client, protocolVersion, worldVersion, resourcePackVersion }) => ({ version, type, releaseTime, syncedAt, blockCount, clientSha1: client.sha1, protocolVersion, worldVersion, resourcePackVersion }));
    const versionData = { ...REGISTRY_META, java: { ...REGISTRY_META.java, installed: installedJava } };
    const versions = edition ? { [edition]: versionData[edition] } : versionData;
    return { structuredContent: { versions }, content: [{ type: "text", text: "Returned registry coverage with source and synchronization metadata." }] };
})
    .registerTool({
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
    annotations: { title: "Check Java Updates", readOnlyHint: true, openWorldHint: true, destructiveHint: false },
}, async ({ channel }) => {
    consumeHostedJavaUpdateWork();
    const result = await checkJavaUpdates(channel);
    return { structuredContent: result, content: [{ type: "text", text: result.updateAvailable ? `Java ${result.latestVersion} is available to synchronize.` : `Java ${result.latestVersion} is already synchronized.` }] };
})
    .registerTool({
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
    annotations: { title: "Synchronize Java Version", readOnlyHint: false, openWorldHint: true, destructiveHint: false },
}, async ({ version, includeTextures }) => {
    assertLocalOperation("Java registry synchronization");
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
})
    .registerTool({
    ...toolPresentation("Search Minecraft Blocks", "Searching exact block ids…", "Block search complete"),
    name: "search_blocks",
    description: "Search edition-specific Minecraft block identifiers. Java and Bedrock identifiers are never mixed.",
    inputSchema: {
        query: z.string().min(1).max(128).describe("Partial namespaced id or human-readable block name to match."),
        edition: z.enum(["java", "bedrock"]).describe("Minecraft edition whose registry should be searched."),
        version: z.string().max(32).optional().describe("Exact Java registry version; Java searches fail clearly when it is not synchronized."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of matches to return."),
    },
    outputSchema: {
        edition: z.enum(["java", "bedrock"]).describe("Edition whose identifiers were searched."),
        requestedVersion: z.string().optional().describe("Version requested by the caller, when supplied."),
        coverage: z.unknown().describe("Exact registry source and coverage metadata for these results."),
        matches: z.array(z.object({ id: z.string(), displayName: z.string() }).passthrough()).describe("Matching namespaced block identifiers."),
    },
    annotations: { title: "Search Minecraft Blocks", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ query, edition, version, limit }) => {
    const needle = query.toLowerCase().replaceAll(" ", "_");
    if (edition === "bedrock" && version && !/^(?:stable|latest)$/i.test(version) && version !== BEDROCK_STABLE_VERSION) {
        throw new Error(`BEDROCK_REGISTRY_VERSION_UNAVAILABLE: search is synchronized to exact minecraft-data ${BEDROCK_STABLE_VERSION}; requested ${version}.`);
    }
    const source = edition === "java"
        ? javaBlocksFor(version)
        : {
            blocks: bedrockBlocks,
            coverage: {
                ...REGISTRY_META.bedrock,
                requestedVersion: version ?? REGISTRY_META.bedrock.requestedVersion,
                resolvedVersion: BEDROCK_STABLE_VERSION,
            },
        };
    const matches = source.blocks.filter((block) => block.id.includes(needle) || block.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
    const coverage = source.coverage;
    return { structuredContent: { edition, requestedVersion: version, coverage, matches }, content: [{ type: "text", text: `Found ${matches.length} ${edition} block identifiers matching “${query}”.` }] };
})
    .registerTool({
    ...toolPresentation("Get Style Profile", "Loading style rules…", "Style rules ready"),
    name: "get_style_profile",
    description: "Return an original architectural rule profile for a Minecraft build style.",
    inputSchema: { style: z.string().min(1).describe("Architectural style profile id or name to resolve.") },
    outputSchema: {
        profile: z.unknown().describe("Resolved architectural principles, features, palette roles, and plan rules."),
        availableStyles: z.array(z.object({ id: z.string(), name: z.string() })).describe("Available profile ids and display names."),
    },
    annotations: { title: "Get Style Profile", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ style }) => {
    const profile = getStyleProfile(style);
    return { structuredContent: { profile, availableStyles: STYLE_PROFILES.map(({ id, name }) => ({ id, name })) }, content: [{ type: "text", text: `Returned the ${profile.name} profile: ${profile.principles.join(", ")}.` }] };
})
    .registerTool({
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
    annotations: { title: "Continue Palette Interview", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    view: { component: "palette-studio", description: "Adaptive role-palette interview with exact-version validation, role locking, replacement, and local texture preview." },
}, async (input) => {
    assertLocalOperation("palette interviews");
    const result = continuePaletteInterview(input);
    return { structuredContent: result, content: [{ type: "text", text: result.nextQuestion ? result.nextQuestion.question : "Palette interview is complete and every role is valid for the selected version." }] };
})
    .registerTool({
    ...toolPresentation("Save Palette", "Saving palette…", "Palette saved"),
    name: "save_palette",
    description: "Save or update a completed palette interview as a named local palette.",
    inputSchema: {
        sessionId: z.string().describe("Completed palette-session id returned by continue_palette_interview."),
        name: z.string().min(1).max(80).describe("Name to store with the reusable local palette."),
    },
    outputSchema: { palette: savedPaletteOutputSchema.describe("Saved palette record with stable id, roles, locks, and version metadata.") },
    annotations: { title: "Save Palette", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ sessionId, name }) => {
    assertLocalOperation("saved palette storage");
    const palette = savePalette(sessionId, name);
    return { structuredContent: { palette }, content: [{ type: "text", text: `Saved palette “${palette.name}”.` }] };
})
    .registerTool({
    ...toolPresentation("List Saved Palettes", "Loading saved palettes…", "Saved palettes ready"),
    name: "list_palettes",
    description: "List named local Blockwright palettes with stable identifiers, versions, locks, and role blocks.",
    inputSchema: {},
    outputSchema: { palettes: z.array(savedPaletteOutputSchema).describe("Saved local palette records.") },
    annotations: { title: "List Saved Palettes", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async () => {
    assertLocalOperation("saved palette storage");
    const palettes = listPalettes();
    return { structuredContent: { palettes }, content: [{ type: "text", text: `Found ${palettes.length} saved palette(s).` }] };
})
    .registerTool({
    ...toolPresentation("Load Saved Palette", "Loading palette…", "Palette loaded"),
    name: "load_palette",
    description: "Load one named palette by stable identifier.",
    inputSchema: { paletteId: z.string().describe("Stable palette id returned by list_palettes or save_palette.") },
    outputSchema: { palette: savedPaletteOutputSchema.describe("Saved palette record.") },
    annotations: { title: "Load Saved Palette", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ paletteId }) => {
    assertLocalOperation("saved palette storage");
    return { structuredContent: { palette: loadPalette(paletteId) }, content: [{ type: "text", text: "Loaded the saved palette." }] };
})
    .registerTool({
    ...toolPresentation("Rename Saved Palette", "Renaming palette…", "Palette renamed"),
    name: "rename_palette",
    description: "Rename a saved local palette.",
    inputSchema: {
        paletteId: z.string().describe("Stable id of the saved palette to rename."),
        name: z.string().min(1).max(80).describe("New human-readable palette name."),
    },
    outputSchema: { palette: savedPaletteOutputSchema.describe("Renamed saved palette record.") },
    annotations: { title: "Rename Saved Palette", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ paletteId, name }) => {
    assertLocalOperation("saved palette storage");
    return { structuredContent: { palette: renamePalette(paletteId, name) }, content: [{ type: "text", text: `Renamed palette to “${name}”.` }] };
})
    .registerTool({
    ...toolPresentation("Delete Saved Palette", "Deleting palette…", "Palette deleted"),
    name: "delete_palette",
    description: "Delete a saved local palette by stable identifier.",
    inputSchema: { paletteId: z.string().describe("Stable id of the saved palette to delete.") },
    outputSchema: {
        id: z.string().describe("Stable id of the deleted palette."),
        deleted: z.literal(true).describe("Confirms that the palette record was removed."),
    },
    annotations: { title: "Delete Saved Palette", readOnlyHint: false, openWorldHint: false, destructiveHint: true },
}, async ({ paletteId }) => {
    assertLocalOperation("saved palette storage");
    return { structuredContent: deletePalette(paletteId), content: [{ type: "text", text: "Deleted the selected palette." }] };
})
    .registerTool({
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
    annotations: { title: "Estimate Build Risk", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async (input) => {
    const { riskThresholds, ...buildInput } = input;
    const preflight = estimateBuild(buildInput, riskThresholds);
    return { structuredContent: { preflight }, content: [{ type: "text", text: `${preflight.overallRisk.toUpperCase()} risk: approximately ${preflight.estimatedOccupiedBlocks.toLocaleString()} occupied blocks across ${preflight.chunksTouched.toLocaleString()} chunks.${preflight.requiresConfirmation ? " Explicit confirmation is required." : ""}` }] };
})
    .registerTool({
    ...toolPresentation("Generate Build Candidates", "Generating distinct plans…", "Build candidates ready"),
    name: "generate_build_candidates",
    description: "Generate and compare deterministic architectural candidates. Style changes plan geometry, room organization, structure, roof, openings, and landscape—not only blocks.",
    inputSchema: {
        ...buildInputSchema,
        candidateCount: z.number().int().min(1).max(5).default(1).describe("Number of structurally distinct candidates to generate. Local mode supports up to five; hosted MCP permits exactly one per request."),
        recentPlans: z.array(architecturalPlanOutputSchema).max(20).optional().describe("Recent architectural plans to penalize for similarity."),
    },
    outputSchema: { candidates: z.array(buildCandidateOutputSchema).describe("Candidate summaries, plans, fingerprints, and maximum structural similarity scores.") },
    annotations: { title: "Generate Build Candidates", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async (input) => {
    const { candidateCount, recentPlans, ...buildInput } = input;
    assertHostedBuildWorkload(buildInput, "candidate generation");
    if (boundedRemoteMode && candidateCount > 1) {
        throw new Error("HOSTED_CANDIDATE_LIMIT_EXCEEDED: hosted MCP can generate at most 1 candidate per request. Use the local app for broader searches.");
    }
    consumeHostedBuildWork("candidate generation");
    const candidates = generateBuildCandidates(buildInput, candidateCount, (recentPlans ?? []), runtimeCompileLimits);
    const cachedCandidates = candidates.map(({ build, ...candidate }) => {
        rememberBuild(build);
        return { build, ...candidate, cacheRef: cacheBuildForView(build) };
    });
    const summaries = cachedCandidates.map(({ build, candidate, maximumSimilarity, cacheRef }) => ({ candidate, maximumSimilarity, build: buildSummaryForClient(build, cacheRef), plan: build.plan }));
    return {
        structuredContent: { candidates: summaries },
        content: [{ type: "text", text: `Generated ${summaries.length} structurally compared candidate(s).` }],
        _meta: { candidates: cachedCandidates.map(({ build, cacheRef }) => buildViewMetadata(build, cacheRef)) },
    };
})
    .registerTool({
    ...toolPresentation("Compile Exact Build", "Compiling exact placements…", "Exact build compiled"),
    name: "compile_build",
    description: "Compile one exact deterministic Minecraft voxel record. Complex or large briefs must include the complete sourceBrief plus a generic design program whose hard requirements map to generated elements. Unsupported or omitted coverage is rejected; no generic shell is substituted. This tool returns data only and never opens a webpage or 3D viewer. Call review_build once only when the user explicitly requests visual review.",
    inputSchema: buildInputSchema,
    outputSchema: { build: buildSummaryOutputSchema.describe("Immutable build summary with hash, bounds, plan, counts, validation, and registry provenance.") },
    annotations: { title: "Compile Exact Build", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async (input) => {
    assertHostedBuildWorkload(input, "build compilation");
    consumeHostedBuildWork("build compilation");
    const build = rememberBuild(compileBuildForRuntime(input));
    const cacheRef = cacheBuildForView(build);
    const contractStatus = build.contract.status === "valid"
        ? `Contract valid: ${build.contract.summary.passed} hard requirement(s) passed.`
        : `Contract invalid: ${build.contract.summary.failed} failed, ${build.contract.summary.unsupported} unsupported, ${build.contract.summary.unevaluated} unevaluated.`;
    return { structuredContent: { build: buildSummaryForClient(build, cacheRef) }, content: [{ type: "text", text: `${build.input.name} compiled to ${build.placements.length.toLocaleString()} exact placements. ${contractStatus} Hash: ${build.hash.slice(0, 12)}. No viewer was opened.` }] };
})
    .registerTool({
    ...toolPresentation("Validate Exact Build", "Validating build integrity…", "Build validation complete"),
    name: "validate_build",
    description: "Recompile and validate a canonical Blockwright build record, or use its short-lived hosted cacheRef from a prior response, for deterministic integrity, bounds, collisions, and budget status.",
    inputSchema: { build: buildReferenceSchema },
    outputSchema: {
        buildId: z.string().describe("Stable id derived from the deterministic build hash."),
        hash: z.string().describe("Full deterministic SHA-256 build hash."),
        bounds: outputBoundsSchema.describe("Exact occupied coordinate bounds."),
        materialCounts: z.record(z.string(), z.number().int()).describe("Occupied placement count by namespaced block identifier."),
        validation: buildValidationOutputSchema.describe("Integrity, budget, collision, and registry-coverage validation result."),
    },
    annotations: { title: "Validate Exact Build", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value }) => {
    const build = asBuild(value);
    return { structuredContent: { buildId: build.id, hash: build.hash, bounds: build.bounds, materialCounts: build.materialCounts, validation: build.validation }, content: [{ type: "text", text: build.validation.valid ? "Build validation passed." : `Build has ${build.validation.blockingIssues} blocking issue(s).` }] };
})
    .registerTool({
    ...toolPresentation("Validate Build Contract", "Evaluating hard requirements…", "Contract validation complete"),
    name: "validate_build_contract",
    description: "Reproduce the hash-bound semantic contract for a canonical build or hosted cacheRef. Every locked hard requirement is evaluated against canonical geometry or returned as unsupported/unevaluated, and any non-pass result makes the aggregate contract invalid. Operational warnings and subjective aesthetic observations remain separate.",
    inputSchema: {
        build: buildReferenceSchema,
        contract: buildContractOverrideSchema.optional(),
    },
    outputSchema: {
        contract: buildContractResultOutputSchema.describe("Normalized clauses, fail-closed hard results, separate warnings and aesthetics, and the deterministic hash-bound certificate."),
    },
    annotations: { title: "Validate Build Contract", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, contract: contractOverride }) => {
    const build = asBuild(value);
    const contract = validateBuildContract(build, contractOverride);
    const summary = contract.summary;
    return {
        structuredContent: { contract },
        content: [{
                type: "text",
                text: contract.status === "valid"
                    ? `Build contract passed ${summary.passed} hard requirement(s). Certificate: ${build.hash.slice(0, 12)}.`
                    : `Build contract is invalid: ${summary.failed} failed, ${summary.unsupported} unsupported, and ${summary.unevaluated} unevaluated hard requirement(s). Certificate: ${build.hash.slice(0, 12)}.`,
            }],
    };
})
    .registerTool({
    ...toolPresentation("Audit Build Structure", "Scanning structural defects…", "Structural audit complete"),
    name: "audit_build",
    description: "Scan the entire canonical build (or its hosted cacheRef) for entrances, clearance, spawn safety, room-access evidence, lighting, functional interiors, support/contact, block states, connections, isolation, overlaps, palette legality, exact version, paste origin, and budget. Returns the reproduced semantic contract and a human-readable certificate bound to the immutable build hash.",
    inputSchema: { build: buildReferenceSchema },
    outputSchema: { audit: buildAuditOutputSchema.describe("Whole-build semantic and structural findings, exact totals, bounded coordinate evidence, fail-closed contract, and hash-bound certificate.") },
    annotations: { title: "Audit Build Structure", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value }) => {
    const build = asBuild(value);
    const audit = auditBuild(build);
    return {
        structuredContent: { audit },
        content: [{ type: "text", text: `Scanned all ${audit.scannedPlacements.toLocaleString()} placements across ${audit.checks.length} structural checks; found ${audit.totals.errors} errors and ${audit.totals.warnings} warnings.` }],
    };
})
    .registerTool({
    ...toolPresentation("Open 3D Build Reviewer", "Preparing 3D review…", "3D reviewer ready"),
    name: "review_build",
    description: "Open the state-aware 3D build reviewer from a canonical build or hosted cacheRef for exact block or region selection, measurements, layer clipping, roof hiding, reusable annotations, review JSON import/export, and whole-build structural audit findings.",
    inputSchema: { build: buildReferenceSchema },
    outputSchema: {
        review: z.object({
            buildId: z.string().describe("Stable build id being reviewed."),
            cacheRef: z.string().optional().describe("Refreshed short-lived hosted cache capability for later review paging or export."),
            hash: z.string().describe("Full immutable build hash that review data must match."),
            name: z.string().describe("Human-readable build name."),
            blockCount: z.number().int().describe("Total exact placements in the build."),
            audit: auditTotalsOutputSchema.describe("Error, warning, info, and affected-placement totals from the whole-build audit."),
        }).describe("Review identity and structural-audit summary."),
    },
    annotations: { title: "Open 3D Build Reviewer", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    view: { component: "review-build", description: "State-aware 3D reviewer with exact-coordinate annotations, measurements, roof hiding, and global defect-class findings." },
}, async ({ build: value }) => {
    const build = asBuild(value);
    const audit = auditBuild(build);
    const cacheRef = cacheBuildForView(build);
    return {
        structuredContent: {
            review: {
                buildId: build.id,
                ...(publicConnectorMode ? { cacheRef } : {}),
                hash: build.hash,
                name: build.input.name,
                blockCount: build.placements.length,
                audit: audit.totals,
            },
        },
        content: [{ type: "text", text: `Opened the state-aware reviewer for ${build.input.name}. The global audit scanned ${audit.scannedPlacements.toLocaleString()} placements and found ${audit.findings.length} finding categories.` }],
        _meta: { ...buildViewMetadata(build, cacheRef), audit },
    };
})
    .registerTool({
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
    annotations: { title: "Analyze World Region", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, region: regionValue }) => {
    const build = asBuild(value);
    const region = regionValue;
    const occupied = new Set((region.blocks ?? []).map(keyOf));
    const protectedSet = new Set((region.protectedCoordinates ?? []).map(keyOf));
    const occupiedConflicts = build.placements.filter((p) => occupied.has(keyOf(p))).map(({ x, y, z }) => ({ x, y, z }));
    const protectedConflicts = build.placements.filter((p) => protectedSet.has(keyOf(p))).map(({ x, y, z }) => ({ x, y, z }));
    return { structuredContent: { buildId: build.id, occupiedConflicts: occupiedConflicts.slice(0, 250), protectedConflicts: protectedConflicts.slice(0, 250), totals: { occupied: occupiedConflicts.length, protected: protectedConflicts.length }, cutFill: { cutBlocks: occupiedConflicts.length, estimatedFillBlocks: 0 } }, content: [{ type: "text", text: `World analysis found ${occupiedConflicts.length} occupied and ${protectedConflicts.length} protected-coordinate conflicts.` }] };
})
    .registerTool({
    ...toolPresentation("Prepare Build Rendering", "Preparing render data…", "Render data ready"),
    name: "render_build",
    description: "Return render-ready placement data for an exact Blockwright build or layer.",
    inputSchema: {
        build: buildReferenceSchema,
        layer: z.number().int().optional().describe("Exact y coordinate to render; omit for every layer."),
        mode: z.enum(["solid", "blueprint", "exploded"]).default("solid").describe("Requested rendering arrangement."),
        offset: z.number().int().min(0).optional().describe("Zero-based placement offset. Hosted rendering defaults to the bounded initial page."),
        limit: z.number().int().min(1).max(BUILD_VIEW_PAGE_SIZE).optional().describe("Maximum render placements to attach. Hosted rendering defaults to the bounded initial page."),
    },
    outputSchema: {
        buildId: z.string().describe("Stable id of the rendered build."),
        mode: z.enum(["solid", "blueprint", "exploded"]).describe("Rendering arrangement that was prepared."),
        layer: z.number().int().optional().describe("Rendered y coordinate when a layer filter was supplied."),
        count: z.number().int().describe("Number of placements attached as private render metadata."),
        offset: z.number().int().min(0).describe("Zero-based placement offset returned."),
        returned: z.number().int().min(0).describe("Number of placements attached in this response."),
        total: z.number().int().min(0).describe("Total placements matching the requested render layer."),
        bounds: outputBoundsSchema.describe("Full build bounds."),
    },
    annotations: { title: "Prepare Build Rendering", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, layer, mode, offset, limit }) => {
    const build = asBuild(value);
    const matchingPlacements = layer === undefined ? build.placements : build.placements.filter((p) => p.y === layer);
    const pageOffset = offset ?? 0;
    const pageLimit = limit ?? (boundedRemoteMode ? BUILD_VIEW_INITIAL_PAGE_SIZE : matchingPlacements.length);
    const placements = pageOffset === 0 && pageLimit >= matchingPlacements.length
        ? matchingPlacements
        : matchingPlacements.slice(pageOffset, pageOffset + pageLimit);
    return {
        structuredContent: { buildId: build.id, mode, layer, count: placements.length, offset: pageOffset, returned: placements.length, total: matchingPlacements.length, bounds: build.bounds },
        content: [{ type: "text", text: `Prepared ${placements.length.toLocaleString()} of ${matchingPlacements.length.toLocaleString()} placements for ${mode} rendering.` }],
        _meta: { placements },
    };
})
    .registerTool({
    ...toolPresentation("Export Build", "Preparing build export…", "Build export ready"),
    name: "export_build",
    description: "Export diagnostic JSON/CSV/blueprints or a certified construction artifact. Executable commands, schematics, Litematics, Bedrock mcpack structure packs, and bundles require a valid hash-bound contract and the matching edition. The mcpack path uses tiled .mcstructure files rather than one command per block; its package and NBT are internally verified, while exact-version import, activation, placement, and readback on iPhone remain unverified until a client round trip is recorded. For the explicit iPhone download card, use export_bedrock_project with one or more builds.",
    inputSchema: {
        build: buildReferenceSchema,
        format: z.enum(["json", "csv", "java_mcfunction", "bedrock_mcfunction", "mcpack", "blueprint", "schem", "litematic", "bundle"]).describe("Export format to generate from the immutable build record; choose mcpack for a Bedrock behavior pack containing tiled structures."),
    },
    outputSchema: {
        buildId: z.string().describe("Stable id of the exported build."),
        format: z.enum(["json", "csv", "java_mcfunction", "bedrock_mcfunction", "mcpack", "blueprint", "schem", "litematic", "bundle"]).describe("Generated export format."),
        filename: z.string().describe("Safe suggested download filename."),
        bytes: z.number().int().describe("Exact byte length of the generated export."),
        dataVersion: z.number().int().optional().describe("Java DataVersion embedded in a schematic export."),
        schematicVersion: z.number().int().optional().describe("Sponge Schematic format version, when applicable."),
        litematicVersion: z.number().int().optional().describe("Litematica format version, when applicable."),
        litematicSubVersion: z.number().int().optional().describe("Litematica sub-version, when applicable."),
        structureTiles: z.number().int().positive().optional().describe("Number of tiled .mcstructure payloads inside a Bedrock mcpack."),
        bedrockRegistryVersion: z.string().optional().describe("Exact minecraft-data Bedrock registry version used to encode an mcpack."),
        compatibilityStatus: z.enum(["verified", "unverified"]).optional().describe("External application compatibility status for this artifact."),
    },
    annotations: { title: "Export Build", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, format }) => {
    const build = asBuild(value);
    if (["java_mcfunction", "bedrock_mcfunction", "mcpack", "schem", "litematic", "bundle"].includes(format)) {
        assertConstructionExportable(build, format);
    }
    const releaseArtifact = beginHostedArtifactWork();
    try {
        const safeName = safeExportName(build.input.name);
        if (format === "bundle") {
            const bytes = await createBundle(build);
            assertHostedArtifactOutputSize(bytes.byteLength);
            return { structuredContent: { buildId: build.id, format, filename: `${safeName}.zip`, bytes: bytes.byteLength }, content: [{ type: "text", text: `Prepared checksummed ZIP bundle for ${build.input.name}.` }], _meta: { mimeType: "application/zip", base64: Buffer.from(bytes).toString("base64") } };
        }
        if (format === "schem") {
            const schematic = exportSchematic(build);
            assertHostedArtifactOutputSize(schematic.bytes.byteLength);
            return { structuredContent: { buildId: build.id, format, filename: `${safeName}.schem`, bytes: schematic.bytes.byteLength, dataVersion: build.registry.worldVersion, schematicVersion: 3 }, content: [{ type: "text", text: `Prepared Sponge Schematic v3 export for ${build.input.name}.` }], _meta: { mimeType: "application/octet-stream", base64: Buffer.from(schematic.bytes).toString("base64") } };
        }
        if (format === "litematic") {
            const litematic = exportLitematic(build);
            assertHostedArtifactOutputSize(litematic.bytes.byteLength);
            return {
                structuredContent: {
                    buildId: build.id,
                    format,
                    filename: `${safeName}.litematic`,
                    bytes: litematic.bytes.byteLength,
                    dataVersion: build.registry.worldVersion,
                    litematicVersion: litematic.version,
                    litematicSubVersion: litematic.subVersion,
                    compatibilityStatus: litematic.compatibility.status,
                },
                content: [{ type: "text", text: `Prepared Litematica v${litematic.version} export for ${build.input.name}. Compatibility is unverified: ${litematic.compatibility.note}` }],
                _meta: { mimeType: "application/octet-stream", base64: Buffer.from(litematic.bytes).toString("base64"), compatibility: litematic.compatibility },
            };
        }
        if (format === "mcpack") {
            const mcpack = await createBedrockMcpack(build);
            assertHostedArtifactOutputSize(mcpack.bytes.byteLength);
            return {
                structuredContent: {
                    buildId: build.id,
                    format,
                    filename: mcpack.fileName,
                    bytes: mcpack.bytes.byteLength,
                    structureTiles: mcpack.tiles.length,
                    bedrockRegistryVersion: mcpack.compatibility.registryVersion,
                    compatibilityStatus: "unverified",
                },
                content: [{ type: "text", text: `Prepared ${mcpack.tiles.length.toLocaleString()}-tile Bedrock mcpack for ${build.input.name}. Internal package checks passed; iPhone client import and placement remain unverified.` }],
                _meta: {
                    mimeType: "application/zip",
                    base64: Buffer.from(mcpack.bytes).toString("base64"),
                    compatibility: mcpack.compatibility,
                    manifest: mcpack.manifest,
                    metadata: mcpack.metadata,
                },
            };
        }
        const exports = {
            json: { extension: "json", mimeType: "application/json", render: () => toJson(build) },
            csv: { extension: "csv", mimeType: "text/csv", render: () => toCsv(build) },
            java_mcfunction: { extension: "java.mcfunction", mimeType: "text/plain", render: () => toMcfunction(build, "java") },
            bedrock_mcfunction: { extension: "bedrock.mcfunction", mimeType: "text/plain", render: () => toMcfunction(build, "bedrock") },
            blueprint: { extension: "blueprint.txt", mimeType: "text/plain", render: () => toBlueprint(build) },
        };
        const selected = exports[format];
        const file = { ...selected, text: selected.render() };
        const byteLength = Buffer.byteLength(file.text);
        assertHostedArtifactOutputSize(byteLength);
        return { structuredContent: { buildId: build.id, format, filename: `${safeName}.${file.extension}`, bytes: byteLength }, content: [{ type: "text", text: `Prepared ${format} export for ${build.input.name}.` }], _meta: { mimeType: file.mimeType, text: file.text } };
    }
    finally {
        releaseArtifact();
    }
})
    .registerTool({
    ...toolPresentation("Export Bedrock Project", "Packaging Bedrock project…", "Bedrock project ready"),
    name: "export_bedrock_project",
    description: "Package one or more non-overlapping, contract-valid Bedrock builds, using each build's hosted cacheRef or canonical summary, into one iPhone-installable .mcpack. Every build is independently edition/contract gated, exact coordinates are retained across sectors, and the pack loads one bounded .mcstructure tile per tick. Package and NBT checks are internal; exact-version iPhone import, activation, placement, and readback remain unverified until a client round trip is recorded. Opens only a lightweight download card, never the 3D reviewer.",
    inputSchema: {
        builds: z.array(buildReferenceSchema.describe("Hosted Bedrock cacheRef or canonical normalized build summary to include in this project pack.")).min(1).describe("One or more non-overlapping Bedrock sector builds. Short-lived cacheRef capabilities avoid recompilation; canonical summaries are deterministically recompiled and integrity-checked."),
        name: z.string().min(1).max(80).describe("Human-readable project and behavior-pack name shown by Minecraft."),
        description: z.string().min(1).max(256).optional().describe("Optional behavior-pack description shown by Minecraft; defaults to a Blockwright project description."),
        packId: z.string().min(1).max(256).describe("Stable logical pack identity. Reuse this exact value and increment manifestVersion when replacing an installed pack."),
        manifestVersion: z.tuple([
            z.number().int().min(0).max(65_535).describe("Manifest major version."),
            z.number().int().min(0).max(65_535).describe("Manifest minor version."),
            z.number().int().min(0).max(65_535).describe("Manifest patch version."),
        ]).default([1, 0, 0]).describe("Three-part Bedrock manifest version. Increase it when publishing an update with the same stable packId."),
    },
    outputSchema: {
        projectName: z.string().describe("Human-readable name embedded in the Bedrock behavior pack."),
        packId: z.string().describe("Stable logical identity used to derive deterministic manifest UUIDs."),
        manifestVersion: z.tuple([z.number().int(), z.number().int(), z.number().int()]).describe("Three-part version embedded in the pack manifest."),
        format: z.literal("mcpack").describe("Generated Bedrock behavior-pack container format."),
        filename: z.string().describe("Safe suggested .mcpack download filename."),
        bytes: z.number().int().positive().describe("Exact compressed artifact size in bytes."),
        buildIds: z.array(z.string()).describe("Stable ids of every canonical sector build included in the pack."),
        buildHashes: z.array(z.string()).describe("Immutable hashes of every canonical sector build included in the pack."),
        structureTiles: z.number().int().positive().describe("Total tiled .mcstructure payload count across all included builds."),
        bedrockRegistryVersion: z.string().describe("Exact minecraft-data Bedrock registry version used for NBT encoding."),
        compatibilityStatus: z.literal("unverified").describe("External iPhone client compatibility status; internal package validation alone does not count as a client round trip."),
    },
    annotations: { title: "Export Bedrock Project", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    view: { component: "export-bedrock-project", description: "Lightweight Bedrock .mcpack download card with package size, structure-tile count, compatibility status, explicit device handoff, and close control.", prefersBorder: true },
}, async ({ builds: values, name, description, packId, manifestVersion }) => {
    const builds = values.map((value) => asBuild(value));
    builds.forEach((build) => assertConstructionExportable(build, "mcpack"));
    const releaseArtifact = beginHostedArtifactWork();
    try {
        const mcpack = await createBedrockMcpack({
            schemaVersion: 1,
            name,
            ...(description ? { description } : {}),
            packId,
            builds,
        }, { manifestVersion });
        assertHostedArtifactOutputSize(mcpack.bytes.byteLength);
        return {
            structuredContent: {
                projectName: mcpack.metadata.pack.name,
                packId: mcpack.metadata.pack.id,
                manifestVersion: mcpack.metadata.pack.manifestVersion,
                format: "mcpack",
                filename: mcpack.fileName,
                bytes: mcpack.bytes.byteLength,
                buildIds: mcpack.metadata.builds.map((build) => build.id),
                buildHashes: mcpack.metadata.builds.map((build) => build.hash),
                structureTiles: mcpack.tiles.length,
                bedrockRegistryVersion: mcpack.compatibility.registryVersion,
                compatibilityStatus: "unverified",
            },
            content: [{
                    type: "text",
                    text: `Prepared one Bedrock mcpack containing ${builds.length.toLocaleString()} non-overlapping build(s) and ${mcpack.tiles.length.toLocaleString()} structure tile(s). Internal checks passed; iPhone client import and placement remain unverified.`,
                }],
            _meta: {
                mimeType: "application/zip",
                base64: Buffer.from(mcpack.bytes).toString("base64"),
                compatibility: mcpack.compatibility,
                manifest: mcpack.manifest,
                metadata: mcpack.metadata,
            },
        };
    }
    finally {
        releaseArtifact();
    }
})
    .registerTool({
    ...toolPresentation("Export WorldEdit Schematic", "Building schematic file…", "Schematic export ready"),
    name: "export_schematic",
    description: "Export a contract-valid Java build as a real GZip-compressed Sponge Schematic v3 file with DataVersion, block-state palette, varint data, offset, transforms, replacements, and supported block entities. Invalid, uncertified, and Bedrock builds fail closed.",
    inputSchema: {
        build: buildReferenceSchema,
        name: z.string().max(120).optional().describe("Optional schematic display name and filename stem."),
        author: z.string().max(256).optional().describe("Optional author metadata embedded in the schematic."),
        offset: vec3Schema.optional().describe("Transform offset applied before schematic encoding."),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0).describe("Clockwise rotation in degrees."),
        mirror: z.enum(["none", "x", "z"]).default("none").describe("Optional mirror transform around the selected axis."),
        includeAir: z.boolean().default(false).describe("Include explicit air placements so pasting can clear space."),
        replacements: z.record(minecraftBlockIdSchema, minecraftBlockIdSchema).refine((items) => Object.keys(items).length <= 256, "At most 256 schematic block replacements are allowed.").optional().describe("Namespaced block-id substitutions applied during export."),
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
    annotations: { title: "Export WorldEdit Schematic", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, name, author, offset, rotation, mirror, includeAir, replacements }) => {
    const build = asBuild(value);
    assertConstructionExportable(build, "schem");
    const releaseArtifact = beginHostedArtifactWork();
    try {
        const schematic = exportSchematic(build, { name, author, offset, rotation, mirror, includeAir, replacements });
        assertHostedArtifactOutputSize(schematic.bytes.byteLength);
        const safeName = (name || build.input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
        return { structuredContent: { buildId: build.id, filename: `${safeName}.schem`, bytes: schematic.bytes.byteLength, schematicVersion: 3, dataVersion: build.registry.worldVersion, dimensions: { width: schematic.width, height: schematic.height, depth: schematic.length }, paletteSize: schematic.paletteSize, blockCount: schematic.blockCount, includeAir, rotation, mirror, offset: offset ?? { x: 0, y: 0, z: 0 } }, content: [{ type: "text", text: `Prepared WorldEdit-compatible Sponge v3 schematic ${safeName}.schem.` }], _meta: { mimeType: "application/octet-stream", base64: Buffer.from(schematic.bytes).toString("base64") } };
    }
    finally {
        releaseArtifact();
    }
})
    .registerTool({
    ...toolPresentation("Import Java Schematic", "Reading schematic file…", "Schematic imported"),
    name: "import_schematic",
    description: "Parse a GZip-compressed Sponge Schematic v3 .schem or Litematica v7 .litematic for analysis and preview. Litematica compatibility is reported as unverified and unsupported entity/tick content is counted rather than silently claimed as preserved.",
    inputSchema: {
        base64: z.string().min(1).describe("Base64-encoded GZip Sponge Schematic v3 or Litematica v7 bytes."),
        format: z.enum(["auto", "schem", "litematic"]).default("auto").describe("Expected input format, or auto to try strict Litematica detection before strict Sponge v3 parsing."),
        origin: vec3Schema.optional().describe("Optional world origin assigned to decoded placements."),
    },
    outputSchema: {
        format: z.enum(["sponge_schematic_v3", "litematic"]).describe("Detected schematic format."),
        version: z.number().int().describe("Decoded schematic format version."),
        subVersion: z.number().int().optional().describe("Litematica sub-version, when present."),
        dataVersion: z.number().int().optional().describe("Java DataVersion embedded in the file, when present."),
        dimensions: extentDimensionsSchema.describe("Decoded schematic dimensions."),
        origin: vec3Schema.describe("World origin applied to decoded occupied placements."),
        offset: vec3Schema.optional().describe("Decoded Sponge schematic offset, when present."),
        paletteSize: z.number().int().describe("Decoded Sponge palette size, or the sum of per-region Litematica palette entries (states repeated across regions count once per region)."),
        blockCount: z.number().int().describe("Number of decoded occupied placements."),
        regionCount: z.number().int().positive().optional().describe("Number of decoded Litematica regions."),
        compatibilityStatus: z.enum(["unverified"]).optional().describe("Litematica external-client compatibility status."),
        unsupportedEntities: z.number().int().min(0).optional().describe("Litematica entities not represented as Blockwright placements."),
        unsupportedPendingTicks: z.number().int().min(0).optional().describe("Litematica pending block/fluid ticks not represented as placements."),
        placementsIncluded: z.boolean().describe("Whether the full decoded placement array is attached in response metadata. Hosted MCP returns summary-only imports."),
    },
    annotations: { title: "Import Java Schematic", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ base64, format, origin }) => {
    validateBase64Upload(base64, hostedConfig.maxUploadBytes);
    const bytes = Buffer.from(base64, "base64");
    const limits = {
        maximumCompressedBytes: hostedConfig.maxUploadBytes,
        maximumExpandedBytes: hostedConfig.maxExpandedBytes,
        maximumVolume: boundedRemoteMode ? HOSTED_IMPORT_PLACEMENT_CAP : LOCAL_BUILD_PLACEMENT_CAP,
    };
    if (boundedRemoteMode) {
        const releaseImport = beginHostedImportWork();
        try {
            let imported;
            try {
                imported = await importHostedSchematic(bytes, { ...limits, format, origin });
            }
            catch (error) {
                const limitError = hostedImportLimitError(error, "Schematic file");
                throw limitError ?? new Error("HOSTED_IMPORT_INVALID: the uploaded schematic could not be parsed or did not match the requested format.");
            }
            assertHostedImportedPlacements(imported.blockCount, imported.format === "litematic" ? "Litematica file" : "Sponge schematic");
            if (imported.format === "litematic") {
                return {
                    structuredContent: {
                        format: imported.format,
                        version: imported.version,
                        subVersion: imported.subVersion,
                        dataVersion: imported.dataVersion,
                        dimensions: imported.dimensions,
                        origin: imported.origin,
                        paletteSize: imported.paletteSize,
                        blockCount: imported.blockCount,
                        regionCount: imported.regionCount,
                        compatibilityStatus: imported.compatibilityStatus,
                        unsupportedEntities: imported.unsupportedEntities,
                        unsupportedPendingTicks: imported.unsupportedPendingTicks,
                        placementsIncluded: false,
                    },
                    content: [{ type: "text", text: `Imported Litematica v${imported.version} with ${imported.blockCount.toLocaleString()} occupied blocks across ${imported.regionCount} region(s). External-client compatibility remains unverified.` }],
                    _meta: {
                        placementsOmitted: true,
                        placementCount: imported.blockCount,
                        regionCount: imported.regionCount,
                        unsupportedEntities: imported.unsupportedEntities,
                        unsupportedPendingTicks: imported.unsupportedPendingTicks,
                        compatibilityStatus: imported.compatibilityStatus,
                    },
                };
            }
            return {
                structuredContent: {
                    format: imported.format,
                    version: imported.version,
                    dataVersion: imported.dataVersion,
                    dimensions: imported.dimensions,
                    origin: imported.origin,
                    offset: imported.offset,
                    paletteSize: imported.paletteSize,
                    blockCount: imported.blockCount,
                    placementsIncluded: false,
                },
                content: [{ type: "text", text: `Imported Sponge v3 schematic with ${imported.blockCount.toLocaleString()} occupied blocks.` }],
                _meta: { placementsOmitted: true, placementCount: imported.blockCount },
            };
        }
        finally {
            releaseImport();
        }
    }
    if (format === "litematic" || format === "auto") {
        try {
            const imported = importLitematic(bytes, { ...limits, origin });
            assertHostedImportedPlacements(imported.placements.length, "Litematica file");
            const paletteSize = imported.regions.reduce((total, region) => total + region.paletteSize, 0);
            return {
                structuredContent: {
                    format: imported.format,
                    version: imported.version,
                    subVersion: imported.subVersion,
                    dataVersion: imported.minecraftDataVersion,
                    dimensions: imported.bounds.dimensions,
                    origin: imported.origin,
                    paletteSize,
                    blockCount: imported.placements.length,
                    regionCount: imported.regions.length,
                    compatibilityStatus: imported.compatibility.status,
                    unsupportedEntities: imported.unsupportedContent.entities,
                    unsupportedPendingTicks: imported.unsupportedContent.pendingTicks,
                    placementsIncluded: !boundedRemoteMode,
                },
                content: [{ type: "text", text: `Imported Litematica v${imported.version} with ${imported.placements.length.toLocaleString()} occupied blocks across ${imported.regions.length} region(s). Compatibility remains unverified: ${imported.compatibility.note}` }],
                _meta: {
                    ...(boundedRemoteMode
                        ? { placementsOmitted: true, placementCount: imported.placements.length }
                        : { placements: imported.placements }),
                    metadata: imported.metadata,
                    regions: imported.regions,
                    unsupportedContent: imported.unsupportedContent,
                    compatibility: imported.compatibility,
                },
            };
        }
        catch (litematicError) {
            const limitError = hostedImportLimitError(litematicError, "Litematica file");
            if (limitError)
                throw limitError;
            if (format === "litematic")
                throw litematicError;
        }
    }
    try {
        const imported = await importSchematic(bytes, origin, limits);
        assertHostedImportedPlacements(imported.placements.length, "Sponge schematic");
        return {
            structuredContent: {
                format: imported.format,
                version: imported.version,
                dataVersion: imported.dataVersion,
                dimensions: imported.dimensions,
                origin: origin ?? { x: 0, y: 0, z: 0 },
                offset: imported.offset,
                paletteSize: imported.paletteSize,
                blockCount: imported.placements.length,
                placementsIncluded: !boundedRemoteMode,
            },
            content: [{ type: "text", text: `Imported Sponge v3 schematic with ${imported.placements.length.toLocaleString()} occupied blocks.` }],
            _meta: {
                ...(boundedRemoteMode
                    ? { placementsOmitted: true, placementCount: imported.placements.length }
                    : { placements: imported.placements }),
                metadata: imported.metadata,
            },
        };
    }
    catch (schematicError) {
        const limitError = hostedImportLimitError(schematicError, "Sponge schematic");
        if (limitError)
            throw limitError;
        if (format !== "auto")
            throw schematicError;
        throw new Error(`Unsupported schematic input: expected Litematica v7 or Sponge Schematic v3. ${schematicError instanceof Error ? schematicError.message : "Parsing failed."}`);
    }
})
    .registerTool({
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
    annotations: { title: "Discover Local Worlds", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    view: { component: "world-browser", description: "Local Java world picker with version, game mode, platform, lock, and WorldEdit location details." },
}, async ({ authorizedSavesFolder }) => {
    assertLocalOperation("local world discovery");
    const result = await discoverWorlds(authorizedSavesFolder);
    return { structuredContent: result, content: [{ type: "text", text: `Discovered ${result.worlds.length} local Java world(s). ${result.localOnly}` }] };
})
    .registerTool({
    ...toolPresentation("Check WorldEdit Compatibility", "Checking WorldEdit support…", "Compatibility check complete"),
    name: "get_worldedit_compatibility",
    description: "Return the currently verified WorldEdit compatibility boundary for Java 26.2.",
    inputSchema: {
        minecraftVersion: z.string().min(1).max(32).describe("Exact Minecraft version selected for the target world."),
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
    annotations: { title: "Check WorldEdit Compatibility", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ minecraftVersion, platform }) => {
    const compatible = minecraftVersion === "26.2" && ["fabric", "neoforge", "paper", "spigot"].includes(platform);
    const result = compatible
        ? { compatible: true, worldEditVersion: "7.4.4", evidence: "Stable WorldEdit 7.4.4 artifacts include Minecraft 26.2 Fabric, NeoForge, and Bukkit distributions.", verifiedAt: "2026-09-02" }
        : { compatible: false, worldEditVersion: undefined, evidence: "No compatibility claim is stored for this exact version/platform pair. Use vanilla commands or verify a current WorldEdit release first.", verifiedAt: "2026-09-02" };
    return { structuredContent: { minecraftVersion, platform, ...result }, content: [{ type: "text", text: result.evidence }] };
})
    .registerTool({
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
    annotations: { title: "Install WorldEdit Schematic", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, worldId, canonicalWorldPath, targetFolder, name, confirmed, overwrite, dimension, anchor, region, rotation, mirror, offset, includeAir, replacements }) => {
    assertLocalOperation("WorldEdit schematic installation");
    const build = asBuild(value);
    assertConstructionExportable(build, "schem");
    const result = await installWorldEditSchematic({ worldId, canonicalWorldPath, targetFolder, name, build, confirmed, overwrite, dimension, anchor, region: region, includeAir, schematicOptions: { rotation, mirror, offset, replacements } });
    const text = result.status === "installed"
        ? `Installed and re-read ${result.installedPath}. In game: ${result.instructions.join(" then ")}.`
        : `Installation preview only; no file was written. Review ${result.blockCount.toLocaleString()} blocks across ${result.chunksTouched} chunks at ${result.anchor.x}, ${result.anchor.y}, ${result.anchor.z}, then repeat with confirmed=true.`;
    return { structuredContent: result, content: [{ type: "text", text }] };
})
    .registerTool({
    ...toolPresentation("Revise Exact Build", "Applying locked revision…", "Build revision compiled"),
    name: "revise_build",
    description: "Revise a canonical build in one of two exclusive modes: recompile explicit build-input changes, or replace every occupied placement inside an inclusive selected cuboid while preserving placements outside it. Both modes re-run the hash-bound contract; selected-region revisions reject any hard requirement that no longer passes.",
    inputSchema: {
        build: buildReferenceSchema,
        changes: buildChangesSchema.optional().describe("Whole-build input changes. Omit this when using selected-region replacement."),
        region: inclusiveCuboidSchema.optional().describe("Inclusive cuboid to replace. Requires replacementPlacements and cannot be combined with changes."),
        replacementPlacements: z.array(replacementPlacementSchema).max(LOCAL_BUILD_PLACEMENT_CAP).optional().describe("Complete occupied placement set for the selected region; an empty array clears the region. Local mode supports up to Blockwright's 2,000,000-placement ceiling; hosted mode applies a lower server-side cap."),
    },
    outputSchema: {
        mode: z.enum(["whole_build", "selected_region"]).describe("Revision mode that produced the new build."),
        previousHash: z.string().describe("Full immutable hash of the source build."),
        build: buildSummaryOutputSchema.describe("New immutable build summary after applying only the explicit changes."),
        region: inclusiveCuboidSchema.optional().describe("Normalized inclusive region used by a selected-region revision."),
        preservedOutsideCount: z.number().int().min(0).optional().describe("Placements copied byte-for-byte from outside the selected region."),
        diff: buildDiffSummarySchema.optional().describe("Exact before/after change counts for a selected-region revision."),
    },
    annotations: { title: "Revise Exact Build", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: value, changes, region, replacementPlacements }) => {
    const current = asBuild(value);
    assertHostedBuildWorkload(current.input, "build revision");
    const selectedRegionMode = region !== undefined || replacementPlacements !== undefined;
    if (selectedRegionMode) {
        if (!region || replacementPlacements === undefined || changes !== undefined) {
            throw new Error("REVISION_MODE_INVALID: selected-region revision requires region and replacementPlacements, with changes omitted.");
        }
        assertReplacementStateSemantics(current, replacementPlacements);
        assertHostedRegionRevision(current, region, replacementPlacements);
        consumeHostedBuildWork("selected-region revision");
        const result = reviseSelectedRegion(current, region, replacementPlacements);
        const next = rememberBuild(result.build);
        const cacheRef = cacheBuildForView(next);
        const diff = buildDiffSummary(result.diff);
        return {
            structuredContent: { mode: "selected_region", previousHash: current.hash, build: buildSummaryForClient(next, cacheRef), region: result.region, preservedOutsideCount: result.preservedOutsideCount, diff },
            content: [{ type: "text", text: `Revised the inclusive selected region while preserving ${result.preservedOutsideCount.toLocaleString()} placements outside it. New hash: ${next.hash.slice(0, 12)}; contract ${next.contract.status}.` }],
            _meta: { ...buildViewMetadata(next, cacheRef), diff },
        };
    }
    if (changes === undefined)
        throw new Error("REVISION_MODE_INVALID: provide changes, or provide both region and replacementPlacements.");
    const patch = changes;
    const nextInput = { ...current.input, ...patch, dimensions: { ...current.input.dimensions, ...(patch.dimensions ?? {}) } };
    assertHostedBuildWorkload(nextInput, "whole-build revision");
    consumeHostedBuildWork("whole-build revision");
    const next = rememberBuild(compileBuildForRuntime(nextInput));
    const cacheRef = cacheBuildForView(next);
    return {
        structuredContent: { mode: "whole_build", previousHash: current.hash, build: buildSummaryForClient(next, cacheRef) },
        content: [{ type: "text", text: `Revised ${current.input.name}. New hash: ${next.hash.slice(0, 12)}.` }],
        _meta: buildViewMetadata(next, cacheRef),
    };
})
    .registerTool({
    ...toolPresentation("Create Local Project", "Creating private project…", "Private project created"),
    name: "create_project",
    description: "Create a durable private project in this PC-local Blockwright store, optionally with an initial canonical build version. This tool is unavailable in hosted mode, where authenticated browser routes own tenant projects.",
    inputSchema: {
        name: z.string().min(1).max(120).describe("Human-readable project name."),
        description: z.string().max(2000).optional().describe("Optional project description."),
        build: buildReferenceSchema.optional().describe("Optional canonical build or cached build id to save as version one."),
    },
    outputSchema: projectSnapshotSummarySchema,
    annotations: { title: "Create Local Project", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ name, description, build: buildValue }) => {
    assertLocalOperation("durable local projects");
    const build = buildValue === undefined ? undefined : asBuild(buildValue);
    const snapshot = await projectStore.createProject({
        tenantId: LOCAL_PROJECT_TENANT,
        name,
        description,
        ...(build ? { initialVersion: { build, contract: build.contract, certificate: build.certificate } } : {}),
        createdBy: LOCAL_PROJECT_ACTOR,
    });
    if (snapshot.head)
        rememberBuild(snapshot.head.payload.build);
    return {
        structuredContent: projectSnapshotSummary(snapshot),
        content: [{ type: "text", text: `Created private local project “${snapshot.project.name}”${snapshot.head ? " with its first immutable version" : ""}.` }],
        _meta: snapshot.head ? { build: snapshot.head.payload.build, projectPayload: snapshot.head.payload } : {},
    };
})
    .registerTool({
    ...toolPresentation("List Local Projects", "Loading private projects…", "Private projects ready"),
    name: "list_projects",
    description: "List durable private projects in this PC-local Blockwright store without loading build payloads. This tool is unavailable in hosted mode.",
    inputSchema: {},
    outputSchema: { projects: z.array(projectSummarySchema).describe("Private local projects ordered by most recent update.") },
    annotations: { title: "List Local Projects", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async () => {
    assertLocalOperation("durable local projects");
    const projects = await projectStore.listProjects(LOCAL_PROJECT_TENANT);
    return { structuredContent: { projects }, content: [{ type: "text", text: `Found ${projects.length} private local project(s).` }] };
})
    .registerTool({
    ...toolPresentation("Get Local Project", "Loading project history…", "Project history ready"),
    name: "get_project",
    description: "Load one private local project, its append-only version metadata, and its current build payload. The full head payload is returned only in response metadata. This tool is unavailable in hosted mode.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: projectSnapshotSummarySchema,
    annotations: { title: "Get Local Project", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ projectId }) => {
    assertLocalOperation("durable local projects");
    const snapshot = await projectStore.getProject(LOCAL_PROJECT_TENANT, projectId);
    if (snapshot.head)
        rememberBuild(snapshot.head.payload.build);
    return {
        structuredContent: projectSnapshotSummary(snapshot),
        content: [{ type: "text", text: `Loaded “${snapshot.project.name}” with ${snapshot.project.versionCount} immutable version(s).` }],
        _meta: snapshot.head ? { build: snapshot.head.payload.build, projectPayload: snapshot.head.payload } : {},
    };
})
    .registerTool({
    ...toolPresentation("Save Project Version", "Saving immutable version…", "Immutable version saved"),
    name: "save_project_version",
    description: "Append a manual, autosave, or selected-region build version to a private local project. Existing versions are never overwritten. Pass expectedHeadVersionId to reject stale concurrent saves. This tool is unavailable in hosted mode.",
    inputSchema: {
        projectId: projectIdSchema,
        build: buildReferenceSchema,
        reason: z.enum(["manual", "autosave", "region_revision"]).default("manual").describe("Why this immutable version was created."),
        expectedHeadVersionId: projectVersionIdSchema.optional().describe("Head observed by the caller; a mismatch fails instead of overwriting newer work."),
    },
    outputSchema: { version: projectHeadSummarySchema.describe("New immutable project head summary.") },
    annotations: { title: "Save Project Version", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ projectId, build: buildValue, reason, expectedHeadVersionId }) => {
    assertLocalOperation("durable local projects");
    const build = asBuild(buildValue);
    const version = await projectStore.saveVersion({
        tenantId: LOCAL_PROJECT_TENANT,
        projectId,
        payload: { build, contract: build.contract, certificate: build.certificate },
        reason,
        createdBy: LOCAL_PROJECT_ACTOR,
        expectedHeadVersionId,
    });
    rememberBuild(version.payload.build);
    return {
        structuredContent: { version: projectHeadSummary(version) },
        content: [{ type: "text", text: `Saved immutable ${reason} version ${version.id}.` }],
        _meta: { build: version.payload.build, projectPayload: version.payload },
    };
})
    .registerTool({
    ...toolPresentation("Diff Project Versions", "Comparing immutable versions…", "Version diff ready"),
    name: "diff_project_versions",
    description: "Compare two immutable versions of one private local project. The model receives exact change counts; full added, removed, changed, and material-delta records stay in response metadata. This tool is unavailable in hosted mode.",
    inputSchema: {
        projectId: projectIdSchema,
        beforeVersionId: projectVersionIdSchema,
        afterVersionId: projectVersionIdSchema,
    },
    outputSchema: { diff: buildDiffSummarySchema.describe("Before/after build, material, contract, and certificate change summary.") },
    annotations: { title: "Diff Project Versions", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ projectId, beforeVersionId, afterVersionId }) => {
    assertLocalOperation("durable local projects");
    const diff = await projectStore.compareVersions(LOCAL_PROJECT_TENANT, projectId, beforeVersionId, afterVersionId);
    const summary = buildDiffSummary(diff);
    return {
        structuredContent: { diff: summary },
        content: [{ type: "text", text: `Compared immutable versions: ${summary.addedCount} added, ${summary.removedCount} removed, and ${summary.changedCount} changed placements.` }],
        _meta: { diff },
    };
})
    .registerTool({
    ...toolPresentation("Restore Project Version", "Restoring as a new version…", "Restore version created"),
    name: "restore_project_version",
    description: "Restore an earlier private-project version by copying it into a new immutable head. History is preserved and no prior version is deleted. This tool is unavailable in hosted mode.",
    inputSchema: {
        projectId: projectIdSchema,
        versionId: projectVersionIdSchema.describe("Earlier immutable version to copy."),
        expectedHeadVersionId: projectVersionIdSchema.optional().describe("Head observed by the caller; a mismatch fails instead of replacing newer work."),
    },
    outputSchema: { version: projectHeadSummarySchema.describe("New restore version at the project head.") },
    annotations: { title: "Restore Project Version", readOnlyHint: false, openWorldHint: false, destructiveHint: false },
}, async ({ projectId, versionId, expectedHeadVersionId }) => {
    assertLocalOperation("durable local projects");
    const version = await projectStore.restoreVersion({
        tenantId: LOCAL_PROJECT_TENANT,
        projectId,
        versionId,
        createdBy: LOCAL_PROJECT_ACTOR,
        expectedHeadVersionId,
    });
    rememberBuild(version.payload.build);
    return {
        structuredContent: { version: projectHeadSummary(version) },
        content: [{ type: "text", text: `Restored ${versionId} as new immutable head ${version.id}; earlier history remains intact.` }],
        _meta: { build: version.payload.build, projectPayload: version.payload },
    };
})
    .registerTool({
    ...toolPresentation("Delete Local Project", "Deleting exact project data…", "Project data deleted"),
    name: "delete_project",
    description: "Permanently delete exactly one private local project, all of its immutable versions, and registered dependent review data after ownership validation. Other projects and unrecognized files are not touched. This tool is unavailable in hosted mode.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: {
        deleted: z.literal(true).describe("Confirms exact project deletion completed."),
        projectId: projectIdSchema,
        deletedVersionCount: z.number().int().min(0).describe("Immutable version files removed with this project."),
        deletedDependentRecords: z.number().int().min(0).describe("Registered dependent review or share records removed with this project."),
    },
    annotations: { title: "Delete Local Project", readOnlyHint: false, openWorldHint: false, destructiveHint: true },
}, async ({ projectId }) => {
    assertLocalOperation("durable local projects");
    const result = await projectStore.deleteProject(LOCAL_PROJECT_TENANT, projectId);
    return { structuredContent: result, content: [{ type: "text", text: `Deleted project ${projectId}, ${result.deletedVersionCount} immutable version(s), and ${result.deletedDependentRecords} dependent record(s). This cannot be undone.` }] };
})
    .registerTool({
    ...toolPresentation("Create Material List", "Counting exact materials…", "Material list ready"),
    name: "get_material_list",
    description: "Create exact canonical block-state and base-block counts for a build, plus clearly labeled stack and shulker planning estimates. The full material list stays in response metadata.",
    inputSchema: {
        build: buildReferenceSchema,
        includeAir: z.boolean().default(false).describe("Include explicit air placements in exact counts."),
    },
    outputSchema: {
        buildId: z.string().describe("Stable identifier of the counted build."),
        buildHash: z.string().describe("Full immutable build hash bound to these counts."),
        exact: z.literal(true).describe("Canonical block-state and base-block counts are exact."),
        totalBlocks: z.number().int().min(0).describe("Exact number of included occupied placements."),
        uniqueBlockStates: z.number().int().min(0).describe("Distinct canonical block-state strings."),
        uniqueBaseBlocks: z.number().int().min(0).describe("Distinct namespaced block identifiers after state aggregation."),
        estimatedStacks: z.number().int().min(0).describe("Planning estimate using 64-item stacks."),
        estimatedShulkerBoxes: z.number().int().min(0).describe("Planning estimate using 27 stacks per shulker box."),
        planningAid: z.literal(true).describe("Stack and container values are estimates, not exact item or recipe requirements."),
    },
    annotations: { title: "Create Material List", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: buildValue, includeAir }) => {
    const build = asBuild(buildValue);
    const materialList = createMaterialList(build, { includeAir });
    const summary = {
        buildId: build.id,
        buildHash: build.hash,
        exact: true,
        totalBlocks: materialList.totalBlocks,
        uniqueBlockStates: materialList.uniqueBlockStates,
        uniqueBaseBlocks: materialList.baseBlockTotals.length,
        estimatedStacks: materialList.planningAid.estimatedStacks,
        estimatedShulkerBoxes: materialList.planningAid.estimatedShulkerBoxes,
        planningAid: true,
    };
    return {
        structuredContent: summary,
        content: [{ type: "text", text: `Counted ${summary.totalBlocks.toLocaleString()} exact blocks across ${summary.uniqueBlockStates} canonical states. Stack and shulker values are planning aids and assume 64-item stacks.` }],
        _meta: {
            materialList: boundedRemoteMode
                ? {
                    ...materialList,
                    lines: materialList.lines.slice(0, HOSTED_MATERIAL_PAGE_SIZE),
                    baseBlockTotals: materialList.baseBlockTotals.slice(0, HOSTED_MATERIAL_PAGE_SIZE),
                    linesPage: { offset: 0, returned: Math.min(materialList.lines.length, HOSTED_MATERIAL_PAGE_SIZE), total: materialList.lines.length },
                    baseBlocksPage: { offset: 0, returned: Math.min(materialList.baseBlockTotals.length, HOSTED_MATERIAL_PAGE_SIZE), total: materialList.baseBlockTotals.length },
                }
                : materialList,
        },
    };
})
    .registerTool({
    ...toolPresentation("Create Client Delivery Bundle", "Packaging verified delivery…", "Delivery bundle ready"),
    name: "create_delivery_bundle",
    description: "Create a client-ready ZIP containing the selected Java schematic, canonical build, material list, hash-bound contract and certificate, checksums, compatibility metadata, origin/rotation instructions, and optional review decision. Delivery is blocked unless every hard contract clause has a valid certificate.",
    inputSchema: {
        build: buildReferenceSchema,
        format: z.enum(["schem", "litematic"]).default("schem").describe("Primary Java artifact to package. Litematica compatibility remains unverified."),
        origin: vec3Schema.optional().describe("Declared paste origin; defaults to the build's occupied minimum corner."),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0).describe("Clockwise schematic rotation. Litematic delivery currently requires zero."),
        reviewToken: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/).optional().describe("Optional active hosted Blockwright review token. Its persisted latest decision must approve this exact build hash; caller-authored approvals are not accepted."),
    },
    outputSchema: {
        buildId: z.string().describe("Stable identifier of the packaged build."),
        buildHash: z.string().describe("Full immutable build hash bound to every manifest record."),
        artifactFormat: z.enum(["schem", "litematic"]).describe("Primary Java build artifact included in the ZIP."),
        filename: z.string().describe("Safe suggested client-delivery ZIP filename."),
        bytes: z.number().int().positive().describe("Exact compressed ZIP size in bytes."),
        fileCount: z.number().int().positive().describe("Manifest plus checksummed payload-file count."),
        compatibilityStatus: z.enum(["verified", "unverified"]).describe("Explicit external-client compatibility evidence status."),
    },
    annotations: { title: "Create Client Delivery Bundle", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
}, async ({ build: buildValue, format, origin, rotation, reviewToken }) => {
    const build = asBuild(buildValue);
    const releaseArtifact = beginHostedArtifactWork();
    try {
        let reviewApproval;
        if (reviewToken) {
            if (!reviewService)
                throw new Error("HOSTED_REVIEW_UNAVAILABLE: verified review storage is not configured.");
            const review = await reviewService.resolve(reviewToken);
            if (review.buildHash !== build.hash)
                throw new Error("REVIEW_BUILD_MISMATCH: the review link is bound to a different immutable build hash.");
            const latestDecision = review.decisions.at(-1);
            if (!latestDecision || latestDecision.decision !== "approved") {
                throw new Error("REVIEW_APPROVAL_REQUIRED: the review link's latest persisted decision must approve this exact build.");
            }
            reviewApproval = {
                ...latestDecision,
                decision: "approved",
                buildHash: build.hash,
                provenance: "verified_blockwright_review_link",
                reviewLinkId: review.id,
                actorIdentityAssurance: "self_asserted",
            };
        }
        const delivery = await createDeliveryBundle({
            build,
            format,
            contract: build.contract,
            certificate: build.certificate,
            origin,
            rotation,
            ...(reviewApproval ? { reviewApproval } : {}),
        });
        assertHostedArtifactOutputSize(delivery.bytes.byteLength);
        const filename = `${safeExportName(build.input.name)}-delivery-${format}.zip`;
        return {
            structuredContent: {
                buildId: build.id,
                buildHash: build.hash,
                artifactFormat: format,
                filename,
                bytes: delivery.bytes.byteLength,
                fileCount: delivery.manifest.files.length + 1,
                compatibilityStatus: delivery.compatibility.verificationStatus,
            },
            content: [{ type: "text", text: `Packaged ${filename} with a ${delivery.compatibility.verificationStatus} compatibility label, one manifest, and ${delivery.manifest.files.length} checksummed payload files.` }],
            _meta: { mimeType: "application/zip", base64: Buffer.from(delivery.bytes).toString("base64"), manifest: delivery.manifest, materialList: delivery.materialList, compatibility: delivery.compatibility },
        };
    }
    finally {
        releaseArtifact();
    }
})
    .registerTool({
    ...toolPresentation("Load Build Placement Page", "Loading placement page…", "Placement page ready"),
    name: "get_build_chunk",
    description: "Private app-only helper for paginating large immutable placement records without exposing payload pages to the model.",
    inputSchema: {
        build: buildReferenceSchema,
        offset: z.number().int().min(0).default(0).describe("Zero-based placement offset in canonical sort order."),
        limit: z.number().int().min(1).max(BUILD_VIEW_PAGE_SIZE).default(BUILD_VIEW_PAGE_SIZE).describe("Maximum placements to attach to this bounded page."),
    },
    outputSchema: {
        buildId: z.string().describe("Stable id of the paged build."),
        offset: z.number().int().describe("Zero-based offset of this page."),
        returned: z.number().int().describe("Number of placements attached in private response metadata."),
        total: z.number().int().describe("Total placement count across every page."),
    },
    annotations: { title: "Load Build Placement Page", readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: {
        ...toolPresentation("Load Build Placement Page", "Loading placement page…", "Placement page ready")._meta,
        "openai/visibility": "private",
        ui: { visibility: ["app"] },
    },
}, async ({ build: value, offset, limit }) => {
    const build = cachedBuildForView(value);
    const { placements, ...page } = createBuildPlacementPage(build, offset, limit);
    return { structuredContent: page, content: [], _meta: { placements } };
});
server.mcpMiddleware("tools/list", async (_request, _extra, next) => {
    const result = await next();
    if (!publicConnectorMode)
        return result;
    return { ...result, tools: result.tools.filter(({ name }) => PUBLIC_CONNECTOR_TOOLS.has(name)) };
});
server.mcpMiddleware("tools/call", async (request, _extra, next) => {
    if (!publicConnectorMode || PUBLIC_CONNECTOR_TOOLS.has(request.params.name))
        return next();
    return {
        isError: true,
        content: [{ type: "text", text: `PUBLIC_CONNECTOR_TOOL_UNAVAILABLE: ${request.params.name} is not available on the stateless public connector.` }],
    };
});
if (boundedRemoteMode) {
    server.express.set("trust proxy", hostedConfig.trustProxyHops);
}
configureHostedRoutes(server.express, {
    config: hostedConfig,
    store: hostedStore,
    billing: stripeBilling,
    projectStore,
    reviewService,
    resolveBuild: (value, principal) => hostedRequestContext.run(principal, () => asBuild(value)),
});
server.use("/mcp", async (request, response, next) => {
    if (mcpRequestTargetDisposition(request.originalUrl ?? request.url) === "invalid") {
        response.status(404).json({ ok: false, error: "The Blockwright MCP endpoint is available only at /mcp." });
        return;
    }
    if (!boundedRemoteMode) {
        next();
        return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (publicConnectorMode) {
        const preAuthLimit = request.blockwrightHostedPreAuthRateLimit
            ?? hostedMcpPreAuthLimiter.consume(hostedMcpClientAddress(request));
        request.blockwrightHostedPreAuthRateLimit = preAuthLimit;
        if (!preAuthLimit.allowed) {
            const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(preAuthLimit.resetAt) - Date.now()) / 1000));
            response.setHeader("retry-after", String(retryAfterSeconds));
            response.status(429).json({ ok: false, error: "Too many public connector requests. Try again after the rate-limit reset time.", resetAt: preAuthLimit.resetAt });
            return;
        }
        const principal = request.blockwrightHostedPrincipal ?? publicConnectorPrincipal(request);
        const limit = request.blockwrightHostedRateLimit
            ?? hostedMcpLimiter.consume(`public:${hostedMcpClientAddress(request)}`);
        request.blockwrightHostedPrincipal = principal;
        request.blockwrightHostedRateLimit = limit;
        response.setHeader("ratelimit-limit", String(limit.limit));
        response.setHeader("ratelimit-remaining", String(limit.remaining));
        response.setHeader("ratelimit-reset", limit.resetAt);
        if (!limit.allowed) {
            const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
            response.setHeader("retry-after", String(retryAfterSeconds));
            response.status(429).json({ ok: false, error: "Too many public connector requests. Try again after the rate-limit reset time.", resetAt: limit.resetAt });
            return;
        }
        hostedRequestContext.run(principal, next);
        return;
    }
    if (!hostedStore) {
        response.setHeader("www-authenticate", "Bearer realm=\"Blockwright\"");
        response.status(401).json({ ok: false, error: "Hosted MCP authentication is unavailable until hosted identity storage is configured." });
        return;
    }
    const preAuthLimit = request.blockwrightHostedPreAuthRateLimit
        ?? hostedMcpPreAuthLimiter.consume(hostedMcpClientAddress(request));
    if (!preAuthLimit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(preAuthLimit.resetAt) - Date.now()) / 1000));
        response.setHeader("retry-after", String(retryAfterSeconds));
        response.status(429).json({ ok: false, error: "Too many hosted MCP requests. Try again after the rate-limit reset time.", resetAt: preAuthLimit.resetAt });
        return;
    }
    const principal = request.blockwrightHostedPrincipal ?? authenticateHostedMcp(request);
    if (!principal) {
        const limit = hostedMcpAuthLimiter.consume(hostedMcpClientAddress(request));
        if (!limit.allowed) {
            const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
            response.setHeader("retry-after", String(retryAfterSeconds));
            response.status(429).json({ ok: false, error: "Too many hosted MCP authentication attempts. Try again after the rate-limit reset time.", resetAt: limit.resetAt });
            return;
        }
        response.setHeader("www-authenticate", "Bearer realm=\"Blockwright\"");
        response.status(401).json({ ok: false, error: "Sign in to use hosted Blockwright MCP." });
        return;
    }
    if (stripeBilling && hostedStore) {
        let billingState = hostedStore.billingState(principal.tenantId);
        const stale = Date.now() - Date.parse(billingState.updatedAt) > 15 * 60_000;
        if (stale) {
            if (!billingState.subscriptionId || !billingState.customerId) {
                response.status(402).json({ ok: false, error: "A verified Studio subscription is required to use hosted Blockwright MCP." });
                return;
            }
            try {
                billingState = hostedStore.setBillingState(await stripeBilling.refreshSubscription(principal, billingState.subscriptionId, billingState.customerId));
            }
            catch {
                response.status(503).json({ ok: false, error: "Subscription status could not be verified. No MCP tool was run." });
                return;
            }
        }
        if (billingState.status !== "active" && billingState.status !== "trialing") {
            response.status(402).json({ ok: false, error: "An active Studio subscription is required to use hosted Blockwright MCP." });
            return;
        }
    }
    const limit = request.blockwrightHostedRateLimit
        ?? hostedMcpLimiter.consume(`${principal.tenantId}:${principal.userId}:${hostedMcpClientAddress(request)}`);
    response.setHeader("ratelimit-limit", String(limit.limit));
    response.setHeader("ratelimit-remaining", String(limit.remaining));
    response.setHeader("ratelimit-reset", limit.resetAt);
    if (!limit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
        response.setHeader("retry-after", String(retryAfterSeconds));
        response.status(429).json({ ok: false, error: "Too many hosted MCP requests. Try again after the rate-limit reset time.", resetAt: limit.resetAt });
        return;
    }
    hostedRequestContext.run(principal, next);
});
server.useOnError("/mcp", (error, _request, response, next) => {
    if (boundedRemoteMode && error instanceof Error && error.code === HOSTED_MCP_PATH_ERROR) {
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.status(404).json({ ok: false, error: error.message });
        return;
    }
    if (boundedRemoteMode && error instanceof Error && error.code === HOSTED_MCP_PAYMENT_ERROR) {
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.status(402).json({ ok: false, error: error.message });
        return;
    }
    if (boundedRemoteMode && error instanceof Error && error.code === HOSTED_MCP_RATE_ERROR) {
        const limit = error.limit;
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("ratelimit-limit", String(limit.limit));
        response.setHeader("ratelimit-remaining", String(limit.remaining));
        response.setHeader("ratelimit-reset", limit.resetAt);
        response.setHeader("retry-after", String(retryAfterSeconds));
        response.status(429).json({ ok: false, error: error.message, resetAt: limit.resetAt });
        return;
    }
    if (boundedRemoteMode && error instanceof Error && error.code === HOSTED_MCP_AUTH_ERROR) {
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("www-authenticate", "Bearer realm=\"Blockwright\"");
        response.status(401).json({ ok: false, error: "Sign in to use hosted Blockwright MCP." });
        return;
    }
    next(error);
});
const readinessDiagnosticsLogged = new Set();
function logReadinessDiagnosticOnce(code, error) {
    if (readinessDiagnosticsLogged.has(code) || readinessDiagnosticsLogged.size >= 4)
        return;
    readinessDiagnosticsLogged.add(code);
    console.error(`Blockwright readiness diagnostic (${code}).`, error);
}
function readinessChecks() {
    const checks = {
        runtime: { ok: true, code: "runtime_ready" },
        registry: { ok: false, code: "registry_unavailable" },
        assets: { ok: false, code: "assets_unavailable" },
        hostedService: hostedConfig.enabled
            ? hostedStore
                ? { ok: Boolean(reviewService), code: reviewService ? "hosted_ready" : "hosted_review_unavailable" }
                : { ok: false, code: hostedStartupIssue ? "hosted_storage_unavailable" : "hosted_configuration_unavailable" }
            : { ok: true, code: "local_mode" },
    };
    try {
        const registries = listJavaRegistries();
        checks.registry = registries.length
            ? { ok: true, code: "registry_ready" }
            : checks.registry;
    }
    catch (error) {
        logReadinessDiagnosticOnce("registry_unavailable", error);
    }
    try {
        const assetsRoot = resolve(process.cwd(), "dist", "assets");
        const manifestPath = resolve(assetsRoot, ".vite", "manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const files = [...new Set(Object.values(manifest).flatMap(({ file, css = [], assets = [] }) => [file, ...css, ...assets]).filter((file) => Boolean(file)))];
        const invalid = files.filter((file) => {
            const target = resolve(assetsRoot, file);
            const value = relative(assetsRoot, target);
            return !value || value.startsWith("..") || isAbsolute(value);
        });
        const missing = files.filter((file) => !invalid.includes(file) && !existsSync(resolve(assetsRoot, file)));
        checks.assets = files.length && !invalid.length && !missing.length
            ? { ok: true, code: "assets_ready" }
            : { ok: false, code: invalid.length ? "assets_invalid" : missing.length ? "assets_missing" : "assets_unavailable" };
    }
    catch (error) {
        logReadinessDiagnosticOnce("assets_unavailable", error);
    }
    return checks;
}
server.express.get("/health", (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.json({
        status: "ok",
        service: APP_NAME,
        version: APP_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
    });
});
server.express.get(["/", "/app"], (_request, response) => {
    response.redirect(302, "/assets/blockwright/index.html");
});
server.express.get("/ready", (_request, response) => {
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
export default await runBlockwrightRuntime(server, {
    hostedMode: boundedRemoteMode,
    maximumJsonBodyBytes: Math.ceil(hostedConfig.maxUploadBytes * 4 / 3 + 1024 * 1024),
    maximumConcurrentJsonBodies: 8,
    maximumJsonBodiesPerMinute: 240,
    maximumJsonBodiesPerClientPerMinute: 60,
    maximumConcurrentJsonBodiesPerClient: 2,
    incompleteJsonBodyTimeoutMs: 10_000,
    trustProxyHops: hostedConfig.trustProxyHops,
    verifyHostedMcpBeforeJson: (request) => verifyHostedMcpBeforeJson(request),
});
//# sourceMappingURL=server.js.map