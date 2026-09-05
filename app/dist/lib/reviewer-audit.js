import { auditBuildSemantics, validateBuildContract } from "./contract.js";
import { isRoofPlacement } from "./reviewer.js";
const directions = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    west: { x: -1, y: 0, z: 0 },
    east: { x: 1, y: 0, z: 0 },
};
const coordinateKey = ({ x, y, z }) => `${x},${y},${z}`;
const offset = (value, delta) => ({ x: value.x + delta.x, y: value.y + delta.y, z: value.z + delta.z });
const isAir = (placement) => !placement || /(^|:)air$/.test(placement.block);
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
/**
 * Server-side whole-build audit. Kept separate from the browser reviewer so
 * its contract hashing dependency never enters a Vite/Skybridge view bundle.
 */
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
//# sourceMappingURL=reviewer-audit.js.map