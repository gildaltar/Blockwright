import { createHash } from "node:crypto";
import type { BuildInput, BuildPreflight, RiskLevel } from "./types.js";

export type RiskThresholds = {
  amberOccupiedBlocks: number;
  redOccupiedBlocks: number;
  amberChunks: number;
  redChunks: number;
  hardPlacementLimit: number;
  regionSize: number;
};

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  amberOccupiedBlocks: 100_000,
  redOccupiedBlocks: 500_000,
  amberChunks: 128,
  redChunks: 1024,
  hardPlacementLimit: 2_000_000,
  regionSize: 16,
};

function level(value: number, amber: number, red: number): RiskLevel {
  return value >= red ? "red" : value >= amber ? "amber" : "green";
}

const rank: Record<RiskLevel, number> = { green: 0, amber: 1, red: 2 };
const maxLevel = (...levels: RiskLevel[]) => levels.reduce((a, b) => rank[a] >= rank[b] ? a : b);

export function preflightConfirmationToken(input: Pick<BuildInput, "edition" | "version" | "dimensions" | "style" | "seed">) {
  return createHash("sha256").update(JSON.stringify({
    edition: input.edition,
    version: input.version?.trim() || "unknown",
    dimensions: input.dimensions,
    style: input.style?.trim().toLowerCase() || "nordic",
    seed: input.seed?.trim() || "default",
  })).digest("hex").slice(0, 20);
}

export function estimateBuild(input: BuildInput, overrides: Partial<RiskThresholds> = {}): BuildPreflight {
  const thresholds = { ...DEFAULT_RISK_THRESHOLDS, ...overrides };
  const { width, depth, height } = input.dimensions;
  if (![width, depth, height].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Dimensions must be positive whole numbers.");
  if (width > 65_535 || depth > 65_535 || height > 65_535) throw new Error("Sponge schematic dimensions cannot exceed 65,535 blocks on any axis.");

  const totalVolume = width * depth * height;
  if (!Number.isSafeInteger(totalVolume)) throw new Error("Requested dimensions exceed safe numeric limits.");
  const perimeter = Math.max(0, 2 * width + 2 * depth - 4);
  const occupiedShell = width * depth * 2 + perimeter * Math.max(3, Math.floor(height * 0.55)) + width * depth * 1.25;
  const complexity = input.buildingType === "megabase" ? 1.35 : input.buildingType === "waterpark" ? 1.18 : input.style.toLowerCase().includes("organic") ? 1.22 : 1;
  const estimatedOccupiedBlocks = Math.max(1, Math.min(totalVolume, Math.ceil(occupiedShell * complexity)));
  const chunkColumns = Math.ceil(width / 16) * Math.ceil(depth / 16);
  const estimatedUniqueMaterials = Math.max(6, Math.min(16, input.rolePalette ? Object.keys(input.rolePalette).length : input.palette?.length ?? 11));
  const estimatedCommandCount = estimatedOccupiedBlocks;
  const estimatedExportBytes = estimatedOccupiedBlocks * 8 + estimatedUniqueMaterials * 72 + 2048;
  const estimatedMemoryBytes = estimatedOccupiedBlocks * 190 + estimatedExportBytes * 2;
  const estimatedGenerationMs = Math.ceil(20 + estimatedOccupiedBlocks / 18_000 * 1000);
  const minecraftRisk = maxLevel(level(estimatedCommandCount, thresholds.amberOccupiedBlocks, thresholds.redOccupiedBlocks), level(chunkColumns, thresholds.amberChunks, thresholds.redChunks));
  const worldEditRisk = maxLevel(level(estimatedOccupiedBlocks, thresholds.amberOccupiedBlocks * 2, thresholds.redOccupiedBlocks * 2), level(chunkColumns, thresholds.amberChunks * 2, thresholds.redChunks * 2));
  const overallRisk = maxLevel(minecraftRisk, worldEditRisk);
  const requiresConfirmation = overallRisk === "red" || estimatedOccupiedBlocks > thresholds.hardPlacementLimit;
  const warnings: string[] = [];
  if (overallRisk === "amber") warnings.push("This build spans enough blocks or chunks to justify phased generation and a WorldEdit paste review.");
  if (overallRisk === "red") warnings.push("This build may cause a long main-thread stall, a large undo history, or client/server timeouts when pasted at once.");
  if (estimatedOccupiedBlocks > thresholds.hardPlacementLimit) warnings.push(`The ${estimatedOccupiedBlocks.toLocaleString()}-block estimate exceeds Blockwright's ${thresholds.hardPlacementLimit.toLocaleString()} in-memory placement limit; split it into phases or regions.`);
  const regionColumns = Math.ceil(width / thresholds.regionSize) * Math.ceil(depth / thresholds.regionSize);
  return {
    dimensions: { ...input.dimensions }, totalVolume, estimatedOccupiedBlocks, estimatedUniqueMaterials,
    chunksTouched: chunkColumns, estimatedCommandCount, estimatedExportBytes, estimatedMemoryBytes,
    estimatedGenerationMs, minecraftRisk, worldEditRisk, overallRisk, requiresConfirmation,
    ...(requiresConfirmation ? { confirmationToken: preflightConfirmationToken(input) } : {}), warnings,
    choices: overallRisk === "green" ? ["continue"] : ["continue", "simplify", "split_into_phases", "cancel"],
    regionSize: thresholds.regionSize, estimatedRegions: regionColumns,
  };
}

export function assertPreflightConfirmed(input: BuildInput, preflight = estimateBuild(input)) {
  if (!preflight.requiresConfirmation) return;
  if (input.confirmationToken !== preflight.confirmationToken) {
    throw new Error(`EXTREME_BUILD_CONFIRMATION_REQUIRED: Review the preflight and resubmit with confirmationToken=${preflight.confirmationToken}.`);
  }
  if (preflight.estimatedOccupiedBlocks > DEFAULT_RISK_THRESHOLDS.hardPlacementLimit) {
    throw new Error("BUILD_MUST_BE_SPLIT: This request exceeds the safe in-memory placement limit. Generate it in regional phases.");
  }
}
