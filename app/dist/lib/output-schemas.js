import { z } from "zod";
const paletteRoleNames = ["foundation", "wall", "frame", "roof", "trim", "glazing", "lighting", "doors", "railings", "accents", "landscaping"];
const buildingTypes = ["house", "temple", "tower", "workshop", "hall", "courtyard", "megabase"];
const interviewTopics = ["buildType", "architecturalDirection", "biome", "mood", "interpretation", "constraints", "dominantMaterials", "contrast", "weathering", "landscaping", "avoidBlocks", "resourcePack"];
const riskLevels = ["green", "amber", "red"];
const nonNegativeInteger = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a full SHA-256 digest.");
export const outputVec3Schema = z.object({
    x: z.number().int().describe("Integer east-west block coordinate."),
    y: z.number().int().describe("Integer vertical block coordinate."),
    z: z.number().int().describe("Integer north-south block coordinate."),
});
export const outputDimensionsSchema = z.object({
    width: z.number().int().positive().describe("Width in blocks along the x axis."),
    depth: z.number().int().positive().describe("Depth in blocks along the z axis."),
    height: z.number().int().positive().describe("Height in blocks along the y axis."),
});
export const outputBoundsSchema = z.object({
    min: outputVec3Schema.describe("Minimum occupied coordinate."),
    max: outputVec3Schema.describe("Maximum occupied coordinate."),
    dimensions: outputDimensionsSchema.describe("Inclusive occupied dimensions."),
});
export const resourcePackVersionOutputSchema = z.union([
    nonNegativeInteger,
    z.object({ major: nonNegativeInteger, minor: nonNegativeInteger }).passthrough(),
]).describe("Minecraft resource-pack format version, represented by either a legacy integer or major/minor object.");
export const riskLevelOutputSchema = z.enum(riskLevels);
export const buildPreflightOutputSchema = z.object({
    dimensions: outputDimensionsSchema,
    totalVolume: nonNegativeInteger.describe("Total requested envelope volume in blocks."),
    estimatedOccupiedBlocks: nonNegativeInteger.describe("Estimated non-air placement count."),
    estimatedUniqueMaterials: nonNegativeInteger.describe("Estimated number of distinct block materials."),
    chunksTouched: nonNegativeInteger.describe("Estimated number of touched chunk columns."),
    estimatedCommandCount: nonNegativeInteger.describe("Estimated setblock-equivalent command count."),
    estimatedExportBytes: nonNegativeInteger.describe("Estimated uncompressed export size in bytes."),
    estimatedMemoryBytes: nonNegativeInteger.describe("Estimated peak working memory in bytes."),
    estimatedGenerationMs: nonNegativeInteger.describe("Estimated generation duration in milliseconds."),
    minecraftRisk: riskLevelOutputSchema.describe("Risk of applying the result through ordinary Minecraft commands."),
    worldEditRisk: riskLevelOutputSchema.describe("Risk of applying the result through WorldEdit."),
    overallRisk: riskLevelOutputSchema.describe("Highest applicable risk level."),
    requiresConfirmation: z.boolean().describe("Whether the exact confirmation token is required before compilation."),
    confirmationToken: z.string().regex(/^[a-f0-9]{20}$/i).optional().describe("Exact token required for a red-risk build."),
    warnings: z.array(z.string()).describe("Concrete scale or execution warnings."),
    choices: z.array(z.enum(["continue", "simplify", "split_into_phases", "cancel"])).describe("Safe next actions for this estimate."),
    regionSize: z.number().int().positive().describe("Width and depth of one deterministic generation region."),
    estimatedRegions: nonNegativeInteger.describe("Estimated number of deterministic regions."),
});
export const architecturalPlanOutputSchema = z.object({
    schemaVersion: z.literal(1),
    seed: z.string().describe("Visible seed used to derive this plan."),
    program: z.object({
        buildingType: z.enum(buildingTypes),
        spaces: z.array(z.string()),
    }),
    footprint: z.object({
        kind: z.enum(["rectangle", "courtyard", "interlocking", "tower"]),
        width: z.number().int().positive(),
        depth: z.number().int().positive(),
        inset: nonNegativeInteger,
    }),
    massing: z.object({
        volumes: z.array(z.object({ id: z.string(), min: outputVec3Schema, max: outputVec3Schema, purpose: z.string() })),
        asymmetry: z.number().min(0).max(1),
    }),
    roomGraph: z.object({
        rooms: z.array(z.object({ id: z.string(), purpose: z.string(), floor: nonNegativeInteger })),
        links: z.array(z.object({ from: z.string(), to: z.string() })),
    }),
    circulation: z.object({ primary: z.string(), vertical: z.string(), exterior: z.array(z.string()) }),
    floorHeights: z.array(z.number().int().positive()),
    facadeBays: z.array(z.object({
        side: z.enum(["north", "south", "east", "west"]),
        count: z.number().int().positive(),
        rhythm: z.string(),
    })),
    structuralFrame: z.object({ system: z.string(), bayWidth: z.number().int().positive(), supports: z.array(z.string()) }),
    roofGrammar: z.object({
        type: z.enum(["gable", "hipped", "flat", "pagoda", "stepped"]),
        pitch: z.number().nonnegative(),
        overhang: nonNegativeInteger,
        tiers: z.number().int().positive(),
    }),
    entrances: z.array(z.object({ side: z.string(), width: z.number().int().positive(), emphasis: z.string() })),
    windows: z.object({ pattern: z.string(), sill: nonNegativeInteger, height: z.number().int().positive() }),
    details: z.array(z.string()),
    landscaping: z.array(z.string()),
    fingerprint: sha256Schema.describe("SHA-256 fingerprint of the normalized architectural plan."),
});
const rolePaletteShape = Object.fromEntries(paletteRoleNames.map((role) => [role, z.string().describe(`Namespaced block identifier assigned to the ${role} role.`)]));
export const rolePaletteOutputSchema = z.object(rolePaletteShape);
export const normalizedBuildInputOutputSchema = z.object({
    name: z.string(),
    edition: z.enum(["java", "bedrock"]),
    version: z.string(),
    style: z.string(),
    dimensions: outputDimensionsSchema,
    palette: z.array(z.string()),
    rolePalette: rolePaletteOutputSchema.partial(),
    origin: outputVec3Schema,
    features: z.array(z.string()),
    blockBudget: z.number().int().positive(),
    seed: z.string(),
    buildingType: z.enum(buildingTypes),
    confirmationToken: z.string(),
});
export const validationIssueOutputSchema = z.object({
    code: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    message: z.string(),
    coordinates: z.array(outputVec3Schema).optional(),
});
export const buildValidationOutputSchema = z.object({
    valid: z.boolean(),
    blockingIssues: nonNegativeInteger,
    warnings: nonNegativeInteger,
    issues: z.array(validationIssueOutputSchema),
    attemptedCollisions: nonNegativeInteger,
});
export const buildRegistryOutputSchema = z.object({
    edition: z.enum(["java", "bedrock"]),
    requestedVersion: z.string(),
    coverageVersion: z.string(),
    source: z.string(),
    sourceUrl: z.string(),
    syncedAt: z.string(),
    clientSha1: z.string().optional(),
    blockCount: nonNegativeInteger.optional(),
    protocolVersion: z.number().int().optional(),
    worldVersion: z.number().int().optional(),
    resourcePackVersion: resourcePackVersionOutputSchema.optional(),
    note: z.string().optional(),
}).passthrough();
export const buildSummaryOutputSchema = z.object({
    schemaVersion: z.literal(2),
    id: z.string().describe("Stable id derived from the deterministic build hash."),
    hash: sha256Schema.describe("Full deterministic SHA-256 build hash."),
    input: normalizedBuildInputOutputSchema,
    plan: architecturalPlanOutputSchema,
    preflight: buildPreflightOutputSchema,
    structuralFingerprint: sha256Schema,
    bounds: outputBoundsSchema,
    regions: z.array(z.object({
        id: z.string(),
        chunkMin: z.object({ x: z.number().int(), z: z.number().int() }),
        chunkMax: z.object({ x: z.number().int(), z: z.number().int() }),
        bounds: z.object({ min: outputVec3Schema, max: outputVec3Schema }),
        placementCount: nonNegativeInteger,
    })),
    materialCounts: z.record(z.string(), nonNegativeInteger),
    layerCounts: z.record(z.string(), nonNegativeInteger),
    phases: z.array(z.object({ name: z.string(), count: nonNegativeInteger })),
    validation: buildValidationOutputSchema,
    registry: buildRegistryOutputSchema,
    createdAt: z.string(),
    blockCount: nonNegativeInteger.describe("Exact number of canonical placements; placements themselves remain private view metadata."),
});
export const buildCandidateOutputSchema = z.object({
    candidate: z.number().int().min(1).max(5).describe("One-based candidate number."),
    maximumSimilarity: z.number().min(0).max(1).describe("Highest structural similarity to the comparison set."),
    build: buildSummaryOutputSchema,
    plan: architecturalPlanOutputSchema,
});
export const auditTotalsOutputSchema = z.object({
    errors: nonNegativeInteger,
    warnings: nonNegativeInteger,
    info: nonNegativeInteger,
    affectedPlacements: nonNegativeInteger,
});
export const buildAuditOutputSchema = z.object({
    buildId: z.string(),
    hash: sha256Schema,
    scannedPlacements: nonNegativeInteger,
    statefulPlacements: nonNegativeInteger,
    findings: z.array(z.object({
        code: z.string(),
        severity: z.enum(["error", "warning", "info"]),
        message: z.string(),
        total: nonNegativeInteger,
        coordinates: z.array(outputVec3Schema).describe("Bounded coordinate sample; total remains the full count."),
    })),
    totals: auditTotalsOutputSchema,
    checks: z.array(z.string()),
});
export const savedPaletteOutputSchema = z.object({
    id: z.string(),
    name: z.string(),
    edition: z.enum(["java", "bedrock"]),
    version: z.string(),
    roles: rolePaletteOutputSchema,
    lockedRoles: z.array(z.enum(paletteRoleNames)),
    rejectedBlocks: z.array(z.string()),
    answers: z.record(z.string(), z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export const paletteInterviewOutputSchema = z.object({
    session: savedPaletteOutputSchema.extend({ complete: z.boolean() }),
    nextQuestion: z.object({ key: z.enum(interviewTopics), question: z.string() }).optional(),
    remainingTopics: z.array(z.enum(interviewTopics)),
});
export const discoveredWorldOutputSchema = z.object({
    id: z.string(),
    canonicalPath: z.string(),
    folderName: z.string(),
    displayName: z.string(),
    dataVersion: z.number().int().optional(),
    minecraftVersion: z.string().optional(),
    lastPlayed: z.number().int().optional(),
    gameMode: z.string().optional(),
    location: z.string(),
    locked: z.boolean(),
    platform: z.enum(["vanilla", "fabric", "neoforge", "forge", "paper", "spigot", "unknown"]),
    suggestedSchematicFolders: z.array(z.string()),
});
const installResultBaseSchema = z.object({
    world: discoveredWorldOutputSchema,
    dimension: z.enum(["overworld", "the_nether", "the_end"]),
    anchor: outputVec3Schema,
    affectedBounds: z.object({ min: outputVec3Schema, max: outputVec3Schema }),
    chunkRange: z.object({
        min: z.object({ x: z.number().int(), z: z.number().int() }),
        max: z.object({ x: z.number().int(), z: z.number().int() }),
    }),
    chunksTouched: nonNegativeInteger,
    blockCount: nonNegativeInteger,
    paletteSize: nonNegativeInteger,
    conflicts: z.object({
        status: z.enum(["not_scanned", "scanned"]),
        occupied: nonNegativeInteger.nullable(),
        protected: nonNegativeInteger.nullable(),
        note: z.string(),
    }),
    risk: z.object({ minecraft: riskLevelOutputSchema, worldEdit: riskLevelOutputSchema, warnings: z.array(z.string()) }),
    installedPath: z.string(),
    targetExists: z.boolean(),
    overwrite: z.boolean(),
    transform: z.object({
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        mirror: z.enum(["none", "x", "z"]),
        offset: outputVec3Schema,
        includeAir: z.boolean(),
    }),
    instructions: z.array(z.string()),
    directWorldEditing: z.literal("unimplemented"),
    bytes: nonNegativeInteger,
    sha256: sha256Schema,
});
export const installWorldEditResultOutputSchema = z.discriminatedUnion("status", [
    installResultBaseSchema.extend({ status: z.literal("confirmation_required"), verified: z.literal(false) }),
    installResultBaseSchema.extend({ status: z.literal("installed"), verified: z.boolean() }),
]).describe("Complete no-write preview or post-write verification result for a WorldEdit schematic installation.");
//# sourceMappingURL=output-schemas.js.map