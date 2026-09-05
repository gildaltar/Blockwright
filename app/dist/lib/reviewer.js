import { auditBuildSemantics, validateBuildContract } from "./contract.js";
export const REVIEW_CATEGORIES = ["change", "fix", "remove", "liked"];
export const MAX_REVIEW_IMPORT_BYTES = 1_000_000;
export const MAX_REVIEW_ANNOTATIONS = 500;
export const MAX_REVIEW_NOTE_LENGTH = 4_000;
export const MAX_REVIEW_VALIDATION_WORK = 12_000_000;
export const MAX_REVIEW_SEARCH_RESULTS = 500;
export const MAX_REVIEW_STATE_STRING_LENGTH = 256;
export const MIN_REVIEW_TEXT_SEARCH_LENGTH = 2;
const directions = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    west: { x: -1, y: 0, z: 0 },
    east: { x: 1, y: 0, z: 0 },
};
const coordinateKey = ({ x, y, z }) => `${x},${y},${z}`;
const offset = (value, delta) => ({ x: value.x + delta.x, y: value.y + delta.y, z: value.z + delta.z });
const isAir = (placement) => !placement || /(^|:)air$/.test(placement.block);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIntegerVec3(value) {
    return isRecord(value) && [value.x, value.y, value.z].every((part) => typeof part === "number" && Number.isSafeInteger(part));
}
function isWithinBounds(point, bounds) {
    return point.x >= bounds.min.x && point.x <= bounds.max.x
        && point.y >= bounds.min.y && point.y <= bounds.max.y
        && point.z >= bounds.min.z && point.z <= bounds.max.z;
}
function isOrderedBounds(bounds) {
    return bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}
function stateSignature(state) {
    return JSON.stringify(Object.entries(state ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}
function validState(value) {
    return isRecord(value)
        && Object.keys(value).length <= 64
        && Object.entries(value).every(([key, part]) => key.length > 0
            && key.length <= 100
            && (typeof part === "boolean"
                || (typeof part === "number" && Number.isFinite(part))
                || (typeof part === "string" && part.length <= MAX_REVIEW_STATE_STRING_LENGTH)));
}
function validDate(value) {
    return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function invalidReview(message) {
    throw new Error(`Invalid review: ${message}`);
}
export function countPlacementsWithin(build, bounds) {
    return build.placements.reduce((total, placement) => total + (isWithinBounds(placement, bounds) ? 1 : 0), 0);
}
export function getReviewBoundsMetrics(bounds, blockCount) {
    const width = bounds.max.x - bounds.min.x + 1;
    const height = bounds.max.y - bounds.min.y + 1;
    const depth = bounds.max.z - bounds.min.z + 1;
    const volume = Math.max(0, width * height * depth);
    return { width, height, depth, volume, blockCount, density: volume ? blockCount / volume : 0 };
}
export function getReviewMeasurement(bounds) {
    const dx = bounds.max.x - bounds.min.x;
    const dy = bounds.max.y - bounds.min.y;
    const dz = bounds.max.z - bounds.min.z;
    return {
        dx,
        dy,
        dz,
        horizontal: Math.hypot(dx, dz),
        direct: Math.hypot(dx, dy, dz),
        manhattan: Math.abs(dx) + Math.abs(dy) + Math.abs(dz),
    };
}
export function parseReviewCoordinate(query) {
    const text = query.trim();
    const coordinate = text.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)
        ?? text.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)
        ?? text.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);
    if (!coordinate)
        return undefined;
    const [x, y, z] = coordinate.slice(1).map(Number);
    return [x, y, z].every(Number.isSafeInteger) ? { x, y, z } : undefined;
}
export function searchReviewPlacements(placements, query) {
    const normalized = query.trim().toLowerCase().replace(/^minecraft:/, "");
    if (normalized.length < MIN_REVIEW_TEXT_SEARCH_LENGTH)
        return { matches: [], capped: false, tooShort: Boolean(normalized) };
    const matches = [];
    let capped = false;
    for (const placement of placements) {
        const blockName = placement.block.replace("minecraft:", "");
        const state = Object.entries(placement.state ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => `${key}=${String(part)}`).join(" ");
        const searchable = `${blockName} ${blockName.replaceAll("_", " ")} ${placement.phase} ${state}`.toLowerCase();
        if (!searchable.includes(normalized))
            continue;
        if (matches.length === MAX_REVIEW_SEARCH_RESULTS) {
            capped = true;
            break;
        }
        matches.push(placement);
    }
    return { matches, capped, tooShort: false };
}
/**
 * Classify persisted view state before any build-bound values are rendered.
 * Older reviewer state has no identity and is migrated separately; a partial
 * identity is treated as different so an interrupted write cannot leak state.
 */
export function getReviewStateBuildStatus(state, build) {
    const hasId = typeof state.reviewBuildId === "string";
    const hasHash = typeof state.reviewBuildHash === "string";
    if (!hasId && !hasHash)
        return "unbound";
    if (!hasId || !hasHash)
        return "different";
    return state.reviewBuildId === build.id && state.reviewBuildHash === build.hash ? "current" : "different";
}
/**
 * Produce an import-safe annotation id and deterministically disambiguate the
 * candidate against every id already in the review. The optional candidate is
 * useful for deterministic callers and tests; normal UI callers use a UUID.
 */
export function createReviewAnnotationId(existingIds, candidate) {
    const generated = candidate
        ?? globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    const token = generated.replace(/[^A-Za-z0-9._:]/g, "_").slice(0, 96) || "annotation";
    const base = `review_${token}`;
    const existing = new Set(existingIds);
    if (!existing.has(base))
        return base;
    let suffix = 2;
    while (existing.has(`${base}_${suffix}`))
        suffix += 1;
    return `${base}_${suffix}`;
}
/** Return a new newest-first collection, or undefined at the hard limit. */
export function prependReviewAnnotation(annotations, annotation, idCandidate) {
    if (annotations.length >= MAX_REVIEW_ANNOTATIONS)
        return undefined;
    const id = createReviewAnnotationId(annotations.map((item) => item.id), idCandidate);
    return [{ ...annotation, id }, ...annotations];
}
/**
 * Validate a portable review before it can replace persisted annotations.
 * Schema version 1 remains unchanged; `resolved` and `updatedAt` are optional,
 * so review files produced before annotation resolution was added still import.
 */
export function validateReviewDocument(value, build) {
    if (!isRecord(value))
        invalidReview("the JSON root must be an object.");
    if (value.type !== "blockwright-review" || value.schemaVersion !== 1)
        invalidReview("unsupported type or schema version.");
    if (!isRecord(value.build) || value.build.hash !== build.hash)
        invalidReview("the immutable build hash does not match this build.");
    if (typeof value.build.id !== "string" || value.build.id !== build.id)
        invalidReview("the build id does not match this build.");
    if (!Array.isArray(value.annotations))
        invalidReview("annotations must be an array.");
    if (value.annotations.length > MAX_REVIEW_ANNOTATIONS)
        invalidReview(`at most ${MAX_REVIEW_ANNOTATIONS} annotations may be imported at once.`);
    if (value.annotations.length * build.placements.length > MAX_REVIEW_VALIDATION_WORK)
        invalidReview("this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.");
    const seenIds = new Set();
    return value.annotations.map((candidate, index) => {
        const label = `annotation ${index + 1}`;
        if (!isRecord(candidate))
            invalidReview(`${label} must be an object.`);
        if (typeof candidate.id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id))
            invalidReview(`${label} has an invalid id.`);
        if (seenIds.has(candidate.id))
            invalidReview(`${label} repeats id ${candidate.id}.`);
        seenIds.add(candidate.id);
        if (typeof candidate.category !== "string" || !REVIEW_CATEGORIES.includes(candidate.category))
            invalidReview(`${label} has an unsupported category.`);
        if (typeof candidate.note !== "string" || candidate.note.length > MAX_REVIEW_NOTE_LENGTH)
            invalidReview(`${label} has an invalid or oversized note.`);
        if (!validDate(candidate.createdAt))
            invalidReview(`${label} has an invalid createdAt timestamp.`);
        if (candidate.updatedAt !== undefined && !validDate(candidate.updatedAt))
            invalidReview(`${label} has an invalid updatedAt timestamp.`);
        if (candidate.resolved !== undefined && typeof candidate.resolved !== "boolean")
            invalidReview(`${label} has an invalid resolved flag.`);
        if (!isRecord(candidate.bounds) || !isIntegerVec3(candidate.bounds.min) || !isIntegerVec3(candidate.bounds.max))
            invalidReview(`${label} bounds must contain exact integer coordinates.`);
        const bounds = { min: { ...candidate.bounds.min }, max: { ...candidate.bounds.max } };
        if (!isOrderedBounds(bounds))
            invalidReview(`${label} bounds are reversed.`);
        if (!isWithinBounds(bounds.min, build.bounds) || !isWithinBounds(bounds.max, build.bounds))
            invalidReview(`${label} is outside the immutable build bounds.`);
        const canonicalCount = countPlacementsWithin(build, bounds);
        if (typeof candidate.blockCount !== "number" || !Number.isSafeInteger(candidate.blockCount) || candidate.blockCount !== canonicalCount)
            invalidReview(`${label} block count does not match the canonical build.`);
        if (candidate.pickedBlock !== undefined && (typeof candidate.pickedBlock !== "string" || candidate.pickedBlock.length > 200))
            invalidReview(`${label} has an invalid picked block.`);
        if (candidate.pickedState !== undefined && !validState(candidate.pickedState))
            invalidReview(`${label} has an invalid picked state.`);
        if (candidate.pickedState !== undefined && candidate.pickedBlock === undefined)
            invalidReview(`${label} has block state without a picked block.`);
        if (candidate.pickedBlock !== undefined) {
            const expectedState = candidate.pickedState === undefined ? undefined : stateSignature(candidate.pickedState);
            const hasCanonicalPlacement = build.placements.some((placement) => isWithinBounds(placement, bounds)
                && placement.block === candidate.pickedBlock
                && (expectedState === undefined || stateSignature(placement.state) === expectedState));
            if (!hasCanonicalPlacement)
                invalidReview(`${label} picked block or state is not canonical within its bounds.`);
        }
        return {
            id: candidate.id,
            category: candidate.category,
            note: candidate.note,
            bounds,
            blockCount: candidate.blockCount,
            ...(candidate.pickedBlock !== undefined ? { pickedBlock: candidate.pickedBlock } : {}),
            ...(candidate.pickedState !== undefined ? { pickedState: { ...candidate.pickedState } } : {}),
            createdAt: candidate.createdAt,
            ...(candidate.resolved !== undefined ? { resolved: candidate.resolved } : {}),
            ...(candidate.updatedAt !== undefined ? { updatedAt: candidate.updatedAt } : {}),
        };
    });
}
export function isRoofPlacement(placement, build) {
    const paletteRoof = build?.input.rolePalette?.roof;
    return placement.block === paletteRoof
        || /roof|eave|ridge|gable|tile|finial|soffit/i.test(placement.phase)
        || /roof_tile/.test(placement.block);
}
function stateValue(placement, name) {
    const value = placement.state?.[name];
    return value === undefined ? undefined : String(value);
}
function binaryStateValue(value) {
    return typeof value === "boolean" || value === 0 || value === 1;
}
function binaryStateBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (value === 0)
        return false;
    if (value === 1)
        return true;
    return undefined;
}
function bedrockDoorState(placement) {
    const facing = placement.state?.["minecraft:cardinal_direction"];
    const hinge = binaryStateBoolean(placement.state?.door_hinge_bit);
    const open = binaryStateBoolean(placement.state?.open_bit);
    const upper = binaryStateBoolean(placement.state?.upper_block_bit);
    if (typeof facing !== "string" || !(facing in directions) || hinge === undefined || open === undefined || upper === undefined) {
        return undefined;
    }
    return { facing: facing, hinge, open, upper };
}
function isDoorPlacement(placement) {
    return Boolean(placement && /_door$/.test(placement.block) && !/_trapdoor$/.test(placement.block));
}
function bedrockStairFacing(placement) {
    const value = placement.state?.weirdo_direction;
    if (typeof value !== "number" || !Number.isInteger(value))
        return undefined;
    return { 0: "east", 1: "west", 2: "south", 3: "north" }[value];
}
function canConnect(placement) {
    if (isAir(placement))
        return false;
    return !/torch|button|lever|flower|grass|carpet|snow|rail/.test(placement.block);
}
function collect(findings, code, severity, message, coordinate) {
    const existing = findings.get(code) ?? { code, severity, message, total: 0, coordinates: [] };
    existing.total += 1;
    if (existing.coordinates.length < 250)
        existing.coordinates.push({ x: coordinate.x, y: coordinate.y, z: coordinate.z });
    findings.set(code, existing);
}
export function auditBuild(build) {
    const byCoordinate = new Map(build.placements.map((placement) => [coordinateKey(placement), placement]));
    const findings = new Map();
    const semantic = auditBuildSemantics(build);
    const contract = validateBuildContract(build, undefined, semantic);
    const bedrock = build.input.edition === "bedrock";
    let statefulPlacements = 0;
    for (const placement of build.placements) {
        const state = placement.state ?? {};
        if (Object.keys(state).length)
            statefulPlacements += 1;
        const below = byCoordinate.get(coordinateKey(offset(placement, { x: 0, y: -1, z: 0 })));
        const above = byCoordinate.get(coordinateKey(offset(placement, { x: 0, y: 1, z: 0 })));
        if (/_stairs$/.test(placement.block)) {
            const nativeDirection = placement.state?.weirdo_direction;
            const nativeUpsideDown = placement.state?.upside_down_bit;
            const facing = bedrock ? bedrockStairFacing(placement) : stateValue(placement, "facing");
            const half = stateValue(placement, "half");
            const valid = bedrock
                ? typeof nativeDirection === "number" && Number.isInteger(nativeDirection) && nativeDirection >= 0 && nativeDirection <= 3 && binaryStateValue(nativeUpsideDown)
                : Boolean(facing && facing in directions && half && ["top", "bottom"].includes(half));
            if (!valid) {
                collect(findings, "INCOMPLETE_STAIR_STATE", "error", bedrock
                    ? "Bedrock stairs must preserve native weirdo_direction 0-3 and a boolean/0-or-1 upside_down_bit in the canonical build."
                    : "Java stairs must preserve a cardinal facing and top/bottom half in the canonical build.", placement);
            }
            if (isRoofPlacement(placement, build) && isAir(below) && facing && facing in directions) {
                const direction = directions[facing];
                const backing = byCoordinate.get(coordinateKey(offset(placement, { x: -direction.x, y: 0, z: -direction.z })));
                const uphill = byCoordinate.get(coordinateKey(offset(placement, { x: -direction.x, y: 1, z: -direction.z })));
                if (isAir(backing) && isAir(uphill)) {
                    collect(findings, "UNSUPPORTED_ROOF_STAIR", "warning", "Roof stairs with no block below, behind, or uphill may read as detached eaves; review every reported coordinate.", placement);
                }
            }
        }
        if (/_slab$/.test(placement.block)) {
            const type = stateValue(placement, "type");
            if (type !== undefined && !["top", "bottom", "double"].includes(type)) {
                collect(findings, "INCOMPLETE_SLAB_STATE", "warning", "Slabs should preserve their top, bottom, or double state for trustworthy review rendering.", placement);
            }
        }
        if (/_trapdoor$/.test(placement.block)) {
            const trapdoorValues = { facing: stateValue(placement, "facing"), half: stateValue(placement, "half"), open: stateValue(placement, "open") };
            if ((trapdoorValues.facing !== undefined && !(trapdoorValues.facing in directions)) || (trapdoorValues.half !== undefined && !["top", "bottom"].includes(trapdoorValues.half)) || (trapdoorValues.open !== undefined && !["true", "false"].includes(trapdoorValues.open))) {
                collect(findings, "INVALID_TRAPDOOR_STATE", "warning", "Trapdoor facing, half, or open state contains an unsupported value.", placement);
            }
        }
        if (/_door$/.test(placement.block) && !/_trapdoor$/.test(placement.block)) {
            const nativeBedrockDoorState = bedrock ? bedrockDoorState(placement) : undefined;
            const valid = bedrock
                ? nativeBedrockDoorState !== undefined
                : Boolean(stateValue(placement, "facing") && stateValue(placement, "facing") in directions
                    && ["upper", "lower"].includes(stateValue(placement, "half") ?? "")
                    && ["left", "right"].includes(stateValue(placement, "hinge") ?? "")
                    && ["true", "false"].includes(stateValue(placement, "open") ?? ""));
            if (!valid) {
                collect(findings, "INVALID_DOOR_STATE", "error", bedrock
                    ? "Bedrock doors must preserve native minecraft:cardinal_direction plus boolean/0-or-1 door_hinge_bit, open_bit, and upper_block_bit values."
                    : "Java doors must preserve cardinal facing, upper/lower half, left/right hinge, and boolean open state.", placement);
            }
            if (nativeBedrockDoorState) {
                const partner = byCoordinate.get(coordinateKey(offset(placement, {
                    x: 0,
                    y: nativeBedrockDoorState.upper ? -1 : 1,
                    z: 0,
                })));
                const partnerState = isDoorPlacement(partner) ? bedrockDoorState(partner) : undefined;
                const compatible = partner !== undefined
                    && partner.block === placement.block
                    && partnerState !== undefined
                    && partnerState.upper !== nativeBedrockDoorState.upper
                    && partnerState.facing === nativeBedrockDoorState.facing
                    && partnerState.hinge === nativeBedrockDoorState.hinge
                    && partnerState.open === nativeBedrockDoorState.open;
                if (!compatible) {
                    collect(findings, "INVALID_BEDROCK_DOOR_PAIR", "error", "Each Bedrock door half must have the opposite half directly above or below, using the same door block, cardinal direction, hinge side, and open state.", placement);
                }
            }
        }
        if (/(^|:)lantern$|soul_lantern$/.test(placement.block)) {
            const hanging = stateValue(placement, "hanging") === "true";
            if ((hanging && isAir(above)) || (!hanging && isAir(below))) {
                collect(findings, "UNSUPPORTED_LIGHT", "warning", "Lantern support does not match its hanging state.", placement);
            }
        }
        if (/glass_pane|iron_bars|_fence$|_wall$/.test(placement.block)) {
            for (const [name, delta] of Object.entries(directions)) {
                const declared = stateValue(placement, name);
                if (declared === undefined)
                    continue;
                const neighbor = byCoordinate.get(coordinateKey(offset(placement, delta)));
                const connected = declared === "true" || declared === "low" || declared === "tall";
                if (connected && !canConnect(neighbor)) {
                    collect(findings, "DANGLING_CONNECTION_STATE", "warning", "A pane, fence, bars, or wall arm points toward empty or non-connectable space.", placement);
                    break;
                }
            }
        }
    }
    if (build.validation.attemptedCollisions > 0) {
        findings.set("OVERLAPPING_GENERATOR_WRITES", {
            code: "OVERLAPPING_GENERATOR_WRITES",
            severity: "info",
            message: "The generator attempted to write more than one block at the same coordinate. The canonical record kept one placement; inspect phase boundaries for roof or trim overlap.",
            total: build.validation.attemptedCollisions,
            coordinates: [],
        });
    }
    const semanticCodes = {
        "hash-integrity": "BUILD_HASH_MISMATCH",
        "canonical-grid": "NON_CANONICAL_GRID",
        entrances: "NO_BOUNDARY_ENTRANCE",
        "entrance-clearance": "BLOCKED_ENTRANCE_CLEARANCE",
        "spawn-safety": "UNSAFE_CENTRAL_SPAWN",
        "room-access": "ROOM_ACCESS_NOT_GEOMETRICALLY_EVALUATED",
        lighting: "NO_EXPLICIT_INTERIOR_LIGHTING",
        "functional-interior": "FUNCTIONAL_INTERIOR_NOT_CONSTRUCTED",
        "support-contact": "ISOLATED_PLACEMENT",
        "palette-legality": "PLACEMENT_OUTSIDE_ROLE_PALETTE",
        "exact-version": "EXACT_VERSION_NOT_PROVEN",
        dimensions: "REQUESTED_ENVELOPE_EXCEEDED",
        "paste-origin": "PASTE_ORIGIN_MISMATCH",
        "block-budget": "BLOCK_BUDGET_EXCEEDED",
    };
    for (const check of semantic.checks) {
        if (check.status === "pass")
            continue;
        const code = semanticCodes[check.id] ?? `SEMANTIC_${check.id.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
        const severity = check.status === "fail" ? "error" : "warning";
        findings.set(code, {
            code,
            severity,
            message: `${check.message} Expected ${check.expected}; observed ${check.actual}.`,
            total: Math.max(1, check.total ?? check.coordinates.length),
            coordinates: check.coordinates,
        });
    }
    const failedContractClauses = contract.hardResults.filter(({ status }) => status !== "pass");
    if (failedContractClauses.length) {
        findings.set("BUILD_CONTRACT_INVALID", {
            code: "BUILD_CONTRACT_INVALID",
            severity: "error",
            message: "At least one declared hard requirement failed, is unsupported, or remained unevaluated. The hash-bound semantic certificate is invalid.",
            total: failedContractClauses.length,
            coordinates: failedContractClauses.flatMap(({ coordinates }) => coordinates ?? []).slice(0, 250),
        });
    }
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const result = [...findings.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.total - a.total);
    const totals = result.reduce((summary, finding) => {
        summary[finding.severity === "error" ? "errors" : finding.severity === "warning" ? "warnings" : "info"] += finding.total;
        summary.affectedPlacements += finding.total;
        return summary;
    }, { errors: 0, warnings: 0, info: 0, affectedPlacements: 0 });
    return {
        buildId: build.id,
        hash: build.hash,
        scannedPlacements: build.placements.length,
        statefulPlacements,
        findings: result,
        totals,
        checks: [
            "state preservation for stairs, slabs, doors, and trapdoors, including deliberate vertical Bedrock door pairs",
            "lantern support versus hanging state",
            "roof-stair contact below, behind, or uphill",
            "pane, fence, bars, and wall connection arms",
            "isolated non-landscape placements",
            "overlapping generator writes across all phases",
            "boundary entrances and immediate two-block clearance",
            "central spawn support and headroom",
            "room-graph reachability with explicit geometric-evidence limits",
            "explicit lighting and constructed functional interiors",
            "face-adjacent structural contact",
            "role-palette legality and exact-version registry coverage",
            "requested dimensions, paste origin, and block budget",
            "canonical payload hash and every normalized hard contract clause",
        ],
        semantic,
        contract,
        certificate: contract.certificate,
    };
}
//# sourceMappingURL=reviewer.js.map