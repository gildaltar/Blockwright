import { createHash } from "node:crypto";
import { estimateDesignPlacementAttempts } from "./design-resource.js";
import { BEDROCK_FUNCTION_COMMAND_LIMIT } from "./export-policy.js";
import { normalizeBuildInput } from "./input-normalization.js";
export const DEFAULT_RISK_THRESHOLDS = {
    amberOccupiedBlocks: 100_000,
    redOccupiedBlocks: 500_000,
    amberChunks: 128,
    redChunks: 1024,
    hardPlacementLimit: 2_000_000,
    hardAttemptLimit: 8_000_000,
    regionSize: 16,
};
const BEDROCK_FUNCTION_AMBER_COMMANDS = 5_000;
function level(value, amber, red) {
    return value >= red ? "red" : value >= amber ? "amber" : "green";
}
const rank = { green: 0, amber: 1, red: 2 };
const maxLevel = (...levels) => levels.reduce((a, b) => rank[a] >= rank[b] ? a : b);
function canonicalValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([key, child]) => key !== "confirmationToken" && child !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, canonicalValue(child)]));
    }
    return value;
}
/** A confirmation authorizes one exact normalized request, including its full generic program and materials. */
export function preflightConfirmationToken(input) {
    return createHash("sha256").update(JSON.stringify(canonicalValue(normalizeBuildInput(input)))).digest("hex").slice(0, 20);
}
export function estimateBuild(input, overrides = {}) {
    input = normalizeBuildInput(input);
    const thresholds = { ...DEFAULT_RISK_THRESHOLDS, ...overrides };
    const { width, depth, height } = input.dimensions;
    if (![width, depth, height].every((value) => Number.isSafeInteger(value) && value > 0))
        throw new Error("Dimensions must be positive whole numbers.");
    if (width > 65_535 || depth > 65_535 || height > 65_535)
        throw new Error("Sponge schematic dimensions cannot exceed 65,535 blocks on any axis.");
    const totalVolume = width * depth * height;
    if (!Number.isSafeInteger(totalVolume))
        throw new Error("Requested dimensions exceed safe numeric limits.");
    const perimeter = Math.max(0, 2 * width + 2 * depth - 4);
    const occupiedShell = width * depth * 2 + perimeter * Math.max(3, Math.floor(height * 0.55)) + width * depth * 1.25;
    const complexity = input.buildingType === "megabase" ? 1.35 : input.style.toLowerCase().includes("organic") ? 1.22 : 1;
    const legacyOccupiedEstimate = Math.max(1, Math.min(totalVolume, Math.ceil(occupiedShell * complexity)));
    const estimatedPlacementAttempts = input.design?.elements.length
        ? estimateDesignPlacementAttempts(input.design)
        : legacyOccupiedEstimate;
    const estimatedOccupiedBlocks = input.design?.elements.length
        ? Math.max(1, Math.min(totalVolume, estimatedPlacementAttempts))
        : legacyOccupiedEstimate;
    const chunkColumns = Math.ceil(width / 16) * Math.ceil(depth / 16);
    const materialLibraryBlocks = Object.values(input.materialLibrary ?? {}).map((material) => typeof material === "string" ? material : material.block);
    const estimatedUniqueMaterials = new Set([
        ...(input.palette ?? []),
        ...Object.values(input.rolePalette ?? {}),
        ...materialLibraryBlocks,
    ].filter((value) => typeof value === "string" && Boolean(value))).size || 11;
    const estimatedCommandCount = estimatedOccupiedBlocks;
    const estimatedExportBytes = estimatedOccupiedBlocks * 8 + estimatedUniqueMaterials * 72 + 2048;
    const estimatedMemoryBytes = estimatedOccupiedBlocks * 190 + estimatedExportBytes * 2;
    const estimatedGenerationMs = Math.ceil(20 + estimatedOccupiedBlocks / 18_000 * 1000);
    const commandRisk = input.edition === "bedrock"
        ? level(estimatedCommandCount, BEDROCK_FUNCTION_AMBER_COMMANDS, BEDROCK_FUNCTION_COMMAND_LIMIT + 1)
        : level(estimatedCommandCount, thresholds.amberOccupiedBlocks, thresholds.redOccupiedBlocks);
    const generationRisk = level(estimatedPlacementAttempts, thresholds.amberOccupiedBlocks, thresholds.redOccupiedBlocks);
    const minecraftRisk = maxLevel(commandRisk, generationRisk, level(chunkColumns, thresholds.amberChunks, thresholds.redChunks));
    const worldEditRisk = maxLevel(level(estimatedOccupiedBlocks, thresholds.amberOccupiedBlocks * 2, thresholds.redOccupiedBlocks * 2), generationRisk, level(chunkColumns, thresholds.amberChunks * 2, thresholds.redChunks * 2));
    const overallRisk = maxLevel(minecraftRisk, worldEditRisk);
    const requiresConfirmation = overallRisk === "red" || estimatedOccupiedBlocks > thresholds.hardPlacementLimit || estimatedPlacementAttempts > thresholds.hardAttemptLimit;
    const warnings = [];
    if (input.edition === "bedrock" && estimatedCommandCount > BEDROCK_FUNCTION_COMMAND_LIMIT) {
        warnings.push(`A Bedrock function call cannot exceed ${BEDROCK_FUNCTION_COMMAND_LIMIT.toLocaleString()} commands. Use the tiled .mcstructure/.mcpack delivery path rather than a single .mcfunction.`);
    }
    else if (input.edition === "bedrock" && estimatedCommandCount >= BEDROCK_FUNCTION_AMBER_COMMANDS) {
        warnings.push(`This Bedrock estimate approaches the ${BEDROCK_FUNCTION_COMMAND_LIMIT.toLocaleString()}-command function-call ceiling and may stall a low-end or mobile client.`);
    }
    if (overallRisk === "amber")
        warnings.push("This build spans enough blocks or chunks to justify phased generation and a WorldEdit paste review.");
    if (overallRisk === "red")
        warnings.push("This build may cause a long main-thread stall, a large undo history, or client/server timeouts when pasted at once.");
    if (estimatedOccupiedBlocks > thresholds.hardPlacementLimit)
        warnings.push(`The ${estimatedOccupiedBlocks.toLocaleString()}-block estimate exceeds Blockwright's ${thresholds.hardPlacementLimit.toLocaleString()} in-memory placement limit; split it into phases or regions.`);
    if (estimatedPlacementAttempts > thresholds.hardAttemptLimit)
        warnings.push(`The generic program may attempt ${estimatedPlacementAttempts.toLocaleString()} coordinate operations, above Blockwright's ${thresholds.hardAttemptLimit.toLocaleString()} generation-work limit; simplify repeated or overlapping operations.`);
    const regionColumns = Math.ceil(width / thresholds.regionSize) * Math.ceil(depth / thresholds.regionSize);
    return {
        dimensions: { ...input.dimensions }, totalVolume, estimatedOccupiedBlocks, estimatedPlacementAttempts, estimatedUniqueMaterials,
        chunksTouched: chunkColumns, estimatedCommandCount, estimatedExportBytes, estimatedMemoryBytes,
        estimatedGenerationMs, minecraftRisk, worldEditRisk, overallRisk, requiresConfirmation,
        ...(requiresConfirmation ? { confirmationToken: preflightConfirmationToken(input) } : {}), warnings,
        choices: overallRisk === "green" ? ["continue"] : ["continue", "simplify", "split_into_phases", "cancel"],
        regionSize: thresholds.regionSize, estimatedRegions: regionColumns,
    };
}
export function assertPreflightConfirmed(input, preflight = estimateBuild(input)) {
    if (preflight.estimatedOccupiedBlocks > DEFAULT_RISK_THRESHOLDS.hardPlacementLimit) {
        throw new Error("BUILD_MUST_BE_SPLIT: This request exceeds the safe in-memory placement limit. Generate it in regional phases.");
    }
    if (preflight.estimatedPlacementAttempts > DEFAULT_RISK_THRESHOLDS.hardAttemptLimit) {
        throw new Error("DESIGN_OPERATION_LIMIT_EXCEEDED: This request exceeds the safe coordinate-operation limit. Simplify repeated or overlapping Design IR operations before generation.");
    }
    if (!preflight.requiresConfirmation)
        return;
    if (input.confirmationToken !== preflight.confirmationToken) {
        throw new Error(`EXTREME_BUILD_CONFIRMATION_REQUIRED: Review the preflight and resubmit with confirmationToken=${preflight.confirmationToken}.`);
    }
}
//# sourceMappingURL=preflight.js.map