import { createHash } from "node:crypto";
import { REGISTRY_META } from "../data/registry-meta.js";
import { getStyleProfile } from "../data/styles.js";
import { defaultRolePalette, PALETTE_ROLES } from "./palette-studio.js";
const DEFAULT_ORIGIN = { x: 0, y: 0, z: 0 };
function clampDimension(value, minimum) {
    return Math.max(minimum, Math.min(65_535, Math.round(value)));
}
/** One canonical normalization shared by estimation, confirmation, and compilation. */
export function normalizeBuildInput(input) {
    const style = getStyleProfile(input.style || "nordic");
    const version = input.version.trim() || REGISTRY_META[input.edition].coverageVersion;
    const positionalPalette = Object.fromEntries((input.palette ?? []).slice(0, PALETTE_ROLES.length).map((block, index) => [PALETTE_ROLES[index], block]));
    const rolePalette = defaultRolePalette(style.id, input.edition, version, { ...positionalPalette, ...input.rolePalette });
    return {
        name: input.name.trim() || "Untitled Build",
        edition: input.edition,
        version,
        style: style.id,
        sourceBrief: input.sourceBrief?.trim() || input.features?.join("; ") || `${input.style} ${input.buildingType ?? "build"}`,
        dimensions: {
            width: clampDimension(input.dimensions.width, 5),
            depth: clampDimension(input.dimensions.depth, 5),
            height: clampDimension(input.dimensions.height, 5),
        },
        palette: input.palette?.length ? [...input.palette] : [...new Set(Object.values(rolePalette))],
        rolePalette,
        materialLibrary: { ...(input.materialLibrary ?? {}) },
        design: input.design ?? { schemaVersion: 1, description: "", requirements: [], elements: [] },
        origin: input.origin ? { ...input.origin } : { ...DEFAULT_ORIGIN },
        features: input.features ? [...input.features].sort() : [],
        blockBudget: Math.max(100, Math.round(input.blockBudget ?? 2_000_000)),
        seed: input.seed?.trim() || createHash("sha256").update(JSON.stringify({ name: input.name.trim(), edition: input.edition, version, style: style.id, dimensions: input.dimensions, buildingType: input.buildingType ?? "auto" })).digest("hex").slice(0, 12),
        buildingType: input.buildingType ?? (style.id === "japanese" ? "temple" : style.id === "medieval" ? "hall" : style.id === "megabase" ? "megabase" : "house"),
        confirmationToken: input.confirmationToken ?? "",
    };
}
//# sourceMappingURL=input-normalization.js.map