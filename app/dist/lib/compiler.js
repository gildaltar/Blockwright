import { createHash } from "node:crypto";
import { REGISTRY_META } from "../data/registry-meta.js";
import { getStyleProfile } from "../data/styles.js";
import { registryMetadata } from "./java-registry.js";
import { validatePaletteIdentifiers } from "./palette-studio.js";
import { assertPreflightConfirmed, estimateBuild } from "./preflight.js";
import { calculateBuildHash, normalizeBuildContract, validateBuildContract } from "./contract.js";
import { BEDROCK_STABLE_VERSION, resolveBedrockBlockPermutation } from "./bedrock-structure.js";
import { compileDesignProgram } from "./design-kernel.js";
import { normalizeBuildInput } from "./input-normalization.js";
export const normalizeInput = normalizeBuildInput;
function materialBlocks(input) {
    return Object.fromEntries(Object.entries(input.materialLibrary).map(([name, material]) => [name, typeof material === "string" ? material : material.block]));
}
function orderedUnique(values) {
    return [...new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value)))];
}
function normalizePlanBox(left, right) {
    return {
        min: { x: Math.min(left.x, right.x), y: Math.min(left.y, right.y), z: Math.min(left.z, right.z) },
        max: { x: Math.max(left.x, right.x), y: Math.max(left.y, right.y), z: Math.max(left.z, right.z) },
    };
}
function translatePlanBox(box, offset) {
    return {
        min: { x: box.min.x + offset.x, y: box.min.y + offset.y, z: box.min.z + offset.z },
        max: { x: box.max.x + offset.x, y: box.max.y + offset.y, z: box.max.z + offset.z },
    };
}
function baseDesignElementBox(element) {
    if (element.kind === "fill" || element.kind === "shell" || element.kind === "carve" || element.kind === "basin") {
        return normalizePlanBox(element.min, element.max);
    }
    if (element.kind === "cylinder") {
        const radius = Math.max(1, Math.round(element.radius));
        const height = Math.max(1, Math.round(element.height));
        return {
            min: { x: element.center.x - radius, y: element.center.y, z: element.center.z - radius },
            max: { x: element.center.x + radius, y: element.center.y + height - 1, z: element.center.z + radius },
        };
    }
    if (element.kind === "stairs" || element.kind === "ramp") {
        const box = normalizePlanBox(element.from, element.to);
        const lateral = Math.max(0, Math.floor(Math.max(1, Math.round(element.width)) / 2));
        return {
            min: { x: box.min.x - lateral, y: box.min.y, z: box.min.z - lateral },
            max: { x: box.max.x + lateral, y: box.max.y, z: box.max.z + lateral },
        };
    }
    if (element.kind !== "sweep")
        throw new Error(`Unsupported generic design element kind in plan metadata: ${String(element.kind)}.`);
    const width = Math.max(1, Math.round(element.width));
    const height = Math.max(1, Math.round(element.height ?? width));
    const thickness = Math.max(1, Math.round(element.thickness ?? 1));
    const lateral = Math.ceil(width / 2);
    const verticalBelow = element.crossSection === "tube" ? Math.floor(height / 2) : element.crossSection === "open_channel" ? thickness - 1 : 0;
    const verticalAbove = element.crossSection === "tube" ? Math.ceil(height / 2) : height - 1;
    const minimum = {
        x: Math.min(...element.points.map(({ x }) => x)) - lateral,
        y: Math.min(...element.points.map(({ y }) => y)) - verticalBelow,
        z: Math.min(...element.points.map(({ z }) => z)) - lateral,
    };
    const maximum = {
        x: Math.max(...element.points.map(({ x }) => x)) + lateral,
        y: Math.max(...element.points.map(({ y }) => y)) + verticalAbove,
        z: Math.max(...element.points.map(({ z }) => z)) + lateral,
    };
    if (element.supports)
        minimum.y = Math.min(minimum.y, Math.round(element.supports.toY));
    return { min: minimum, max: maximum };
}
function designElementBox(element, dimensions) {
    const base = baseDesignElementBox(element);
    const instances = (element.offsets?.length ? element.offsets : [{ x: 0, y: 0, z: 0 }]).map((offset) => translatePlanBox(base, offset));
    const box = {
        min: {
            x: Math.min(...instances.map(({ min }) => min.x)),
            y: Math.min(...instances.map(({ min }) => min.y)),
            z: Math.min(...instances.map(({ min }) => min.z)),
        },
        max: {
            x: Math.max(...instances.map(({ max }) => max.x)),
            y: Math.max(...instances.map(({ max }) => max.y)),
            z: Math.max(...instances.map(({ max }) => max.z)),
        },
    };
    return {
        min: { x: Math.max(0, box.min.x), y: Math.max(0, box.min.y), z: Math.max(0, box.min.z) },
        max: {
            x: Math.min(dimensions.width - 1, box.max.x),
            y: Math.min(dimensions.height - 1, box.max.y),
            z: Math.min(dimensions.depth - 1, box.max.z),
        },
    };
}
function designMaterialBlock(input, reference) {
    if (!reference)
        return undefined;
    const material = input.materialLibrary[reference] ?? input.rolePalette[reference] ?? reference;
    return typeof material === "string" ? material : material.block;
}
function designElementMaterialReferences(element) {
    if (element.kind === "carve")
        return [];
    if (element.kind === "basin")
        return [element.wallMaterial, element.floorMaterial, element.rimMaterial, element.liquidMaterial];
    if (element.kind === "stairs" || element.kind === "ramp")
        return [element.material, element.railingMaterial];
    if (element.kind === "sweep")
        return [element.material, element.innerMaterial, element.supports?.material];
    return [element.material];
}
function planForInput(input) {
    const legacyPlan = createArchitecturalPlan(input);
    if (!input.design.elements.length)
        return legacyPlan;
    const boxes = new Map(input.design.elements.map((element) => [element.id, designElementBox(element, input.dimensions)]));
    const solidElements = input.design.elements.filter(({ kind }) => kind !== "carve");
    const volumes = solidElements.map((element) => ({
        id: element.id,
        ...boxes.get(element.id),
        purpose: element.intent.trim() || `${element.kind} element ${element.id}`,
    }));
    const massCenters = volumes.map(({ min, max }) => ({ x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 }));
    const averageCenter = massCenters.length ? {
        x: massCenters.reduce((sum, { x }) => sum + x, 0) / massCenters.length,
        z: massCenters.reduce((sum, { z }) => sum + z, 0) / massCenters.length,
    } : { x: (input.dimensions.width - 1) / 2, z: (input.dimensions.depth - 1) / 2 };
    const normalizedOffsetX = Math.abs(averageCenter.x - (input.dimensions.width - 1) / 2) / Math.max(1, (input.dimensions.width - 1) / 2);
    const normalizedOffsetZ = Math.abs(averageCenter.z - (input.dimensions.depth - 1) / 2) / Math.max(1, (input.dimensions.depth - 1) / 2);
    const asymmetry = Number(Math.min(1, Math.hypot(normalizedOffsetX, normalizedOffsetZ) / Math.SQRT2).toFixed(3));
    const boundaryAssertions = input.design.requirements.flatMap((requirement) => requirement.assertions
        .filter((assertion) => assertion.kind === "boundary_contact")
        .flatMap((assertion) => assertion.sides.filter((side) => side !== "top" && side !== "bottom").map((side) => ({
        side,
        elementIds: assertion.elementIds?.length ? assertion.elementIds : requirement.elementIds,
        emphasis: requirement.text,
    }))));
    const doorElements = solidElements.filter((element) => designElementMaterialReferences(element)
        .some((reference) => /(?:^|:)\w*(?:door|gate)\w*$/.test(designMaterialBlock(input, reference) ?? "")));
    const inferredDoorBoundaries = doorElements.flatMap((element) => {
        const box = boxes.get(element.id);
        return [
            ...(box.min.z === 0 ? [{ side: "north", elementIds: [element.id], emphasis: element.intent }] : []),
            ...(box.max.z === input.dimensions.depth - 1 ? [{ side: "south", elementIds: [element.id], emphasis: element.intent }] : []),
            ...(box.min.x === 0 ? [{ side: "west", elementIds: [element.id], emphasis: element.intent }] : []),
            ...(box.max.x === input.dimensions.width - 1 ? [{ side: "east", elementIds: [element.id], emphasis: element.intent }] : []),
        ];
    });
    const accessBySide = new Map();
    for (const access of boundaryAssertions) {
        const entries = accessBySide.get(access.side) ?? [];
        entries.push({ elementIds: access.elementIds, emphasis: access.emphasis, isDoor: false });
        accessBySide.set(access.side, entries);
    }
    for (const access of inferredDoorBoundaries) {
        const entries = accessBySide.get(access.side) ?? [];
        entries.push({ elementIds: access.elementIds, emphasis: access.emphasis, isDoor: true });
        accessBySide.set(access.side, entries);
    }
    const sideOrder = ["north", "south", "east", "west"];
    const entrances = sideOrder.flatMap((side) => {
        const candidates = accessBySide.get(side) ?? [];
        if (!candidates.length)
            return [];
        const doorCandidates = candidates.filter(({ isDoor }) => isDoor);
        const selected = doorCandidates.length ? doorCandidates : candidates;
        const widths = selected.flatMap(({ elementIds }) => elementIds.map((id) => boxes.get(id)).filter(Boolean).map((box) => side === "north" || side === "south" ? box.max.x - box.min.x + 1 : box.max.z - box.min.z + 1));
        return [{ side, width: Math.max(1, ...widths), emphasis: orderedUnique(selected.map(({ emphasis }) => emphasis)).join("; ") }];
    });
    const circulationElementIds = new Set(input.design.requirements.flatMap((requirement) => requirement.assertions
        .filter((assertion) => assertion.kind === "path_geometry" || assertion.kind === "boundary_contact")
        .flatMap((assertion) => assertion.elementIds?.length ? assertion.elementIds : requirement.elementIds)));
    const circulationElements = solidElements.filter((element) => circulationElementIds.has(element.id)
        || element.kind === "sweep" || element.kind === "stairs" || element.kind === "ramp");
    const circulationIntents = orderedUnique(circulationElements.map(({ intent }) => intent));
    const verticalIntents = orderedUnique(circulationElements.filter((element) => {
        if (element.kind === "stairs" || element.kind === "ramp")
            return true;
        const box = boxes.get(element.id);
        return box.max.y > box.min.y && element.kind === "sweep";
    }).map(({ intent }) => intent));
    const boundaryElementIds = new Set([...boundaryAssertions, ...inferredDoorBoundaries].flatMap(({ elementIds }) => elementIds));
    const exterior = orderedUnique(solidElements.filter((element) => boundaryElementIds.has(element.id)).map(({ intent }) => intent));
    const phases = orderedUnique(input.design.elements.map((element) => element.phase || element.intent));
    const rooms = phases.map((purpose, index) => ({ id: `zone-${index + 1}`, purpose, floor: 0 }));
    const footprintKind = input.buildingType === "tower"
        ? "tower" : input.buildingType === "courtyard" ? "courtyard" : "rectangle";
    const boundaryCounts = Object.fromEntries(sideOrder.map((side) => [side, solidElements.filter((element) => {
            const box = boxes.get(element.id);
            return side === "north" ? box.min.z === 0 : side === "south" ? box.max.z === input.dimensions.depth - 1 : side === "west" ? box.min.x === 0 : box.max.x === input.dimensions.width - 1;
        }).length]));
    const supportElements = solidElements.filter((element) => element.kind === "sweep" && element.supports);
    const roofElements = solidElements.filter(({ intent }) => /\b(?:roof|canopy|shade|eave|pergola)\b/i.test(intent));
    const landscapeElements = solidElements.filter(({ intent }) => /\b(?:landscap|plant|garden|tree|palm|rock|island|planter)\w*\b/i.test(intent));
    const planWithoutFingerprint = {
        ...legacyPlan,
        program: { buildingType: input.buildingType, spaces: orderedUnique(input.design.elements.map(({ intent }) => intent)) },
        footprint: { kind: footprintKind, width: input.dimensions.width, depth: input.dimensions.depth, inset: 0 },
        massing: { volumes: volumes.length ? volumes : [{ id: "design-envelope", min: { x: 0, y: 0, z: 0 }, max: { x: input.dimensions.width - 1, y: input.dimensions.height - 1, z: input.dimensions.depth - 1 }, purpose: input.design.description }], asymmetry },
        roomGraph: { rooms, links: [] },
        circulation: {
            primary: circulationIntents.length ? `Authored circulation: ${circulationIntents.join("; ")}` : "No circulation route declared by the generic design",
            vertical: verticalIntents.length ? `Authored vertical circulation: ${verticalIntents.join("; ")}` : "No vertical circulation declared by the generic design",
            exterior,
        },
        facadeBays: sideOrder.filter((side) => boundaryCounts[side] > 0)
            .map((side) => ({ side: side, count: boundaryCounts[side], rhythm: "authored boundary geometry" })),
        structuralFrame: {
            system: supportElements.length ? "authored generic supports" : "no separate structural-frame system declared",
            bayWidth: Math.max(1, ...supportElements.map((element) => element.kind === "sweep" && element.supports ? Math.round(element.supports.interval) : 1)),
            supports: orderedUnique(supportElements.map(({ intent }) => intent)),
        },
        roofGrammar: roofElements.length ? { ...legacyPlan.roofGrammar, type: "flat", pitch: 0, tiers: 1 } : { type: "flat", pitch: 0, overhang: 0, tiers: 1 },
        entrances,
        windows: { ...legacyPlan.windows, pattern: "derived from authored glazing elements" },
        details: input.design.elements.map(({ id, kind, intent }) => `${id}:${kind}:${intent}`),
        landscaping: orderedUnique(landscapeElements.map(({ intent }) => intent)),
    };
    const fingerprint = createHash("sha256").update(planFingerprintPayload(planWithoutFingerprint)).digest("hex");
    return { ...planWithoutFingerprint, fingerprint };
}
const DEFAULT_MAXIMUM_PLACEMENTS = 2_000_000;
const DEFAULT_MAXIMUM_PLACEMENT_ATTEMPTS = 8_000_000;
function checkedLimit(value, fallback, label) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1)
        throw new Error(`${label} must be a positive safe integer.`);
    return resolved;
}
function createAccumulator(origin, limits = {}) {
    const map = new Map();
    const maximumPlacements = checkedLimit(limits.maximumPlacements, DEFAULT_MAXIMUM_PLACEMENTS, "maximumPlacements");
    const maximumPlacementAttempts = checkedLimit(limits.maximumPlacementAttempts, DEFAULT_MAXIMUM_PLACEMENT_ATTEMPTS, "maximumPlacementAttempts");
    let attempts = 0;
    const countAttempt = () => {
        attempts += 1;
        if (attempts > maximumPlacementAttempts)
            throw new Error(`DESIGN_OPERATION_LIMIT_EXCEEDED: generation attempted more than ${maximumPlacementAttempts.toLocaleString()} coordinate operations.`);
    };
    const accumulator = {
        map,
        attemptedCollisions: 0,
        put(x, y, z, block, phase, state) {
            countAttempt();
            const placement = { x: x + origin.x, y: y + origin.y, z: z + origin.z, block, phase, ...(state ? { state } : {}) };
            const key = `${placement.x},${placement.y},${placement.z}`;
            if (map.has(key))
                accumulator.attemptedCollisions += 1;
            map.set(key, placement);
            if (map.size > maximumPlacements)
                throw new Error(`BUILD_PLACEMENT_LIMIT_EXCEEDED: generation retained more than ${maximumPlacements.toLocaleString()} occupied coordinates.`);
        },
        remove(x, y, z) {
            countAttempt();
            map.delete(`${x + origin.x},${y + origin.y},${z + origin.z}`);
        },
    };
    return accumulator;
}
function seedNumber(seed) {
    return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) || 1;
}
function seededRandom(seed) {
    let state = seedNumber(seed) >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}
function planFingerprintPayload(plan) {
    return JSON.stringify({
        program: plan.program, footprint: plan.footprint,
        volumes: plan.massing.volumes.map(({ min, max, purpose }) => ({ min, max, purpose })),
        floorHeights: plan.floorHeights, frame: plan.structuralFrame,
        roof: plan.roofGrammar, entrances: plan.entrances, windows: plan.windows,
    });
}
export function createArchitecturalPlan(input) {
    const random = seededRandom(input.seed);
    const { width, depth, height } = input.dimensions;
    const style = input.style.toLowerCase();
    const japanese = style === "japanese";
    const modern = style === "modern" || style === "warm-modern" || style === "brutalist";
    const tower = input.buildingType === "tower" || style === "fantasy";
    const footprint = {
        kind: japanese || input.buildingType === "courtyard" ? "courtyard" : modern ? "interlocking" : tower ? "tower" : "rectangle",
        width, depth, inset: japanese ? Math.max(2, Math.floor(Math.min(width, depth) * (0.22 + random() * 0.08))) : Math.max(1, Math.floor(Math.min(width, depth) * 0.12)),
    };
    const floorHeight = Math.max(4, Math.min(7, 4 + Math.floor(random() * 3)));
    const floors = Math.max(1, Math.floor((height - 2) / floorHeight));
    const asymmetry = Number((0.12 + random() * 0.48).toFixed(3));
    const secondaryWidth = Math.max(3, Math.floor(width * (0.38 + random() * 0.18)));
    const secondaryDepth = Math.max(3, Math.floor(depth * (0.38 + random() * 0.18)));
    const volumes = footprint.kind === "interlocking"
        ? [
            { id: "primary", min: { x: 0, y: 0, z: 0 }, max: { x: Math.max(3, width - secondaryWidth), y: Math.max(4, height - floorHeight), z: depth - 1 }, purpose: "main living bar" },
            { id: "cross", min: { x: Math.max(1, width - secondaryWidth - Math.floor(random() * 3)), y: 0, z: Math.max(1, depth - secondaryDepth - Math.floor(random() * 3)) }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: "raised cross volume" },
        ]
        : footprint.kind === "tower"
            ? [
                { id: "hall", min: { x: 0, y: 0, z: 0 }, max: { x: width - 1, y: Math.max(4, Math.floor(height * 0.55)), z: depth - 1 }, purpose: "great hall" },
                { id: "tower", min: { x: Math.max(0, width - Math.max(5, Math.floor(width * 0.38))), y: 0, z: Math.max(0, depth - Math.max(5, Math.floor(depth * 0.38))) }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: "vertical lookout" },
            ]
            : [{ id: "main", min: { x: 0, y: 0, z: 0 }, max: { x: width - 1, y: height - 1, z: depth - 1 }, purpose: japanese ? "courtyard ring" : "main hall" }];
    const spaces = japanese ? ["genkan", "main hall", "engawa", "courtyard", "service room"] : modern ? ["entry", "living core", "service spine", "terrace"] : tower ? ["great hall", "stair tower", "lookout", "service room"] : ["entry", "main room", "storage", "loft"];
    const rooms = spaces.map((purpose, index) => ({ id: `room-${index + 1}`, purpose, floor: Math.min(floors - 1, Math.floor(index / 3)) }));
    const links = rooms.slice(1).map((room, index) => ({ from: rooms[index].id, to: room.id }));
    const roofType = japanese ? "pagoda" : modern ? "flat" : tower ? "stepped" : "gable";
    const planWithoutFingerprint = {
        schemaVersion: 1, seed: input.seed,
        program: { buildingType: input.buildingType, spaces }, footprint,
        massing: { volumes, asymmetry }, roomGraph: { rooms, links },
        circulation: { primary: japanese ? "engawa loop around courtyard" : modern ? "linear service spine" : tower ? "hall-to-tower hinge" : "central entry to loft stair", vertical: tower ? "spiral tower stair" : floors > 1 ? "compact stair" : "none", exterior: japanese ? ["covered engawa", "garden threshold"] : modern ? ["terrace"] : ["entry porch"] },
        floorHeights: Array.from({ length: floors }, () => floorHeight),
        facadeBays: ["north", "south", "east", "west"].map((side, index) => ({ side, count: Math.max(2, Math.floor((index < 2 ? width : depth) / Math.max(3, 3 + Math.floor(random() * 3)))), rhythm: japanese ? "post-screen-post" : modern ? "solid-glass-solid" : "frame-infill" })),
        structuralFrame: { system: japanese ? "post-and-beam courtyard ring" : modern ? "interlocking shear volumes" : tower ? "masonry hall with corner tower" : "timber frame over masonry base", bayWidth: Math.max(3, Math.min(7, 3 + Math.floor(random() * 5))), supports: japanese ? ["perimeter posts", "courtyard posts"] : ["corners", "facade bays", "roof ridge"] },
        roofGrammar: { type: roofType, pitch: modern ? 0 : Number((0.45 + random() * 0.45).toFixed(2)), overhang: japanese ? 2 : modern ? 1 : 1, tiers: japanese ? Math.max(1, Math.min(3, Math.floor(height / 8))) : tower ? 2 : 1 },
        entrances: [{ side: "south", width: japanese ? 3 : Math.max(1, 1 + Math.floor(random() * 2)), emphasis: japanese ? "recessed genkan" : modern ? "shadow reveal" : "framed threshold" }],
        windows: { pattern: japanese ? "screen bays facing courtyard" : modern ? "continuous bands at living volume" : tower ? "narrow grouped openings" : "paired bays", sill: japanese ? 2 : 3, height: japanese ? 3 : modern ? 3 : 2 },
        details: japanese ? ["deep eaves", "engawa", "layered roof edges"] : modern ? ["shadow gaps", "cantilever", "roof terrace"] : tower ? ["battlements", "buttresses", "tower cap"] : ["porch", "chimney", "exposed frame"],
        landscaping: japanese ? ["courtyard garden", "stepping path", "water or gravel focus"] : modern ? ["terrace", "planter bands"] : ["path", "foundation planting"],
    };
    const fingerprint = createHash("sha256").update(planFingerprintPayload(planWithoutFingerprint)).digest("hex");
    return { ...planWithoutFingerprint, fingerprint };
}
function shellBox(acc, min, max, palette, phase, flatRoof = false) {
    for (let x = min.x; x <= max.x; x += 1)
        for (let z = min.z; z <= max.z; z += 1) {
            acc.put(x, min.y, z, palette.foundation, `${phase}: foundation`);
            acc.put(x, min.y + 1, z, palette.wall, `${phase}: floor`);
            if (flatRoof)
                acc.put(x, max.y, z, palette.roof, `${phase}: roof`);
        }
    for (let y = min.y + 2; y < max.y; y += 1) {
        for (let x = min.x; x <= max.x; x += 1) {
            acc.put(x, y, min.z, palette.wall, `${phase}: walls`);
            acc.put(x, y, max.z, palette.wall, `${phase}: walls`);
        }
        for (let z = min.z + 1; z < max.z; z += 1) {
            acc.put(min.x, y, z, palette.wall, `${phase}: walls`);
            acc.put(max.x, y, z, palette.wall, `${phase}: walls`);
        }
    }
}
function carveDoor(acc, x, z, facing, palette, width = 1) {
    for (let dx = 0; dx < width; dx += 1) {
        acc.put(x + dx, 2, z, palette.doors, "openings", { half: "lower", facing, hinge: dx % 2 ? "right" : "left", open: false, powered: false });
        acc.put(x + dx, 3, z, palette.doors, "openings", { half: "upper", facing, hinge: dx % 2 ? "right" : "left", open: false, powered: false });
    }
}
function generateNordic(plan, dimensions, origin, palette, limits) {
    const acc = createAccumulator(origin, limits);
    const { width: w, depth: d, height: h } = dimensions;
    const roofRise = Math.max(2, Math.min(Math.floor(w / 2), Math.floor(h * 0.42)));
    const wallTop = h - roofRise - 1;
    shellBox(acc, { x: 0, y: 0, z: 0 }, { x: w - 1, y: wallTop, z: d - 1 }, palette, "main");
    const bay = plan.structuralFrame.bayWidth;
    for (let x = 0; x < w; x += bay)
        for (const z of [0, d - 1])
            for (let y = 2; y <= wallTop; y += 1)
                acc.put(x, y, z, palette.frame, "frame");
    for (let level = 0; level < roofRise; level += 1) {
        const y = wallTop + level;
        for (let z = 0; z < d; z += 1) {
            acc.put(level, y, z, palette.roof, "roof", { facing: "east", half: "bottom", shape: "straight", waterlogged: false });
            acc.put(w - 1 - level, y, z, palette.roof, "roof", { facing: "west", half: "bottom", shape: "straight", waterlogged: false });
        }
    }
    for (let z = 0; z < d; z += 1)
        acc.put(Math.floor(w / 2), h - 1, z, palette.roof, "roof ridge");
    const entranceX = Math.max(1, Math.min(w - 3, Math.floor(w * (0.32 + plan.massing.asymmetry * 0.35))));
    carveDoor(acc, entranceX, 0, "south", palette);
    for (let x = 2; x < w - 2; x += bay)
        for (const z of [0, d - 1])
            for (let y = 3; y <= Math.min(4, wallTop - 1); y += 1)
                acc.put(x, y, z, palette.glazing, "openings");
    for (let x = 1; x < w - 1; x += 1)
        acc.put(x, 1, 0, palette.trim, "porch");
    acc.put(Math.max(1, w - 3), 3, 1, palette.lighting, "lighting", { hanging: false });
    return acc;
}
function generateJapanese(plan, dimensions, origin, palette, limits) {
    const acc = createAccumulator(origin, limits);
    const { width: w, depth: d, height: h } = dimensions;
    const inset = Math.min(plan.footprint.inset, Math.floor(Math.min(w, d) / 2) - 1);
    const wallTop = Math.max(4, h - Math.max(2, plan.roofGrammar.tiers * 2));
    for (let x = 0; x < w; x += 1)
        for (let z = 0; z < d; z += 1) {
            const courtyard = x >= inset && x < w - inset && z >= inset && z < d - inset;
            if (!courtyard) {
                acc.put(x, 0, z, palette.foundation, "foundation");
                acc.put(x, 1, z, palette.wall, "floor");
            }
            else
                acc.put(x, 0, z, palette.landscaping, "courtyard");
        }
    const boundaries = (x, z) => x === 0 || z === 0 || x === w - 1 || z === d - 1 || x === inset - 1 || z === inset - 1 || x === w - inset || z === d - inset;
    for (let y = 2; y <= wallTop; y += 1)
        for (let x = 0; x < w; x += 1)
            for (let z = 0; z < d; z += 1) {
                if (!boundaries(x, z))
                    continue;
                const post = (x % plan.structuralFrame.bayWidth === 0 || z % plan.structuralFrame.bayWidth === 0);
                acc.put(x, y, z, post ? palette.frame : (y >= plan.windows.sill && y < plan.windows.sill + plan.windows.height ? palette.glazing : palette.wall), post ? "post frame" : "screen walls");
            }
    for (let tier = 0; tier < plan.roofGrammar.tiers; tier += 1) {
        const y = Math.min(h - 1, wallTop + tier * 2);
        const edge = Math.min(tier, Math.floor(Math.min(w, d) / 4));
        for (let x = edge; x < w - edge; x += 1)
            for (let z = edge; z < d - edge; z += 1) {
                if (x <= edge + 1 || z <= edge + 1 || x >= w - edge - 2 || z >= d - edge - 2) {
                    const distances = [
                        { facing: "east", distance: x - edge },
                        { facing: "west", distance: w - edge - 1 - x },
                        { facing: "south", distance: z - edge },
                        { facing: "north", distance: d - edge - 1 - z },
                    ].sort((a, b) => a.distance - b.distance || a.facing.localeCompare(b.facing));
                    acc.put(x, y, z, palette.roof, "tiered roof", { facing: distances[0].facing, half: "bottom", shape: "straight", waterlogged: false });
                }
            }
    }
    const doorX = Math.max(1, Math.min(w - 4, Math.floor(w * (0.35 + plan.massing.asymmetry * 0.25))));
    carveDoor(acc, doorX, 0, "south", palette, Math.min(2, w - doorX - 1));
    for (let x = inset; x < w - inset; x += 1) {
        acc.put(x, 1, inset - 1, palette.trim, "engawa");
        acc.put(x, 1, d - inset, palette.trim, "engawa");
    }
    return acc;
}
function generateModern(plan, dimensions, origin, palette, limits) {
    const acc = createAccumulator(origin, limits);
    for (const volume of plan.massing.volumes)
        shellBox(acc, volume.min, volume.max, palette, volume.id, true);
    for (const volume of plan.massing.volumes) {
        const y0 = Math.min(volume.max.y - 1, volume.min.y + 3);
        const y1 = Math.min(volume.max.y - 1, y0 + plan.windows.height - 1);
        for (let x = volume.min.x + 1; x < volume.max.x; x += 1)
            for (let y = y0; y <= y1; y += 1)
                acc.put(x, y, volume.min.z, palette.glazing, `${volume.id}: glazing`);
    }
    const entranceX = Math.max(1, Math.min(dimensions.width - 3, Math.floor(dimensions.width * plan.massing.asymmetry)));
    carveDoor(acc, entranceX, 0, "south", palette);
    return acc;
}
function generateTower(plan, dimensions, origin, palette, limits) {
    const acc = createAccumulator(origin, limits);
    for (const volume of plan.massing.volumes)
        shellBox(acc, volume.min, volume.max, palette, volume.id, true);
    const tower = plan.massing.volumes.find(({ id }) => id === "tower");
    if (tower)
        for (let x = tower.min.x; x <= tower.max.x; x += 2)
            for (const z of [tower.min.z, tower.max.z])
                acc.put(x, tower.max.y, z, palette.accents, "battlements");
    carveDoor(acc, Math.max(1, Math.floor(dimensions.width * (0.25 + plan.massing.asymmetry * 0.2))), 0, "south", palette);
    return acc;
}
function generateFromPlan(plan, dimensions, origin, palette, limits) {
    if (plan.footprint.kind === "courtyard")
        return generateJapanese(plan, dimensions, origin, palette, limits);
    if (plan.footprint.kind === "interlocking")
        return generateModern(plan, dimensions, origin, palette, limits);
    if (plan.footprint.kind === "tower")
        return generateTower(plan, dimensions, origin, palette, limits);
    return generateNordic(plan, dimensions, origin, palette, limits);
}
function structuralTokens(plan) {
    return new Set([
        plan.program.buildingType, plan.footprint.kind, plan.roofGrammar.type, String(plan.roofGrammar.tiers),
        plan.circulation.primary, plan.circulation.vertical, plan.structuralFrame.system, String(plan.structuralFrame.bayWidth),
        ...plan.program.spaces, ...plan.details,
        ...plan.massing.volumes.map((v) => `${v.purpose}:${v.max.x - v.min.x}:${v.max.y - v.min.y}:${v.max.z - v.min.z}`),
    ]);
}
export function structuralSimilarity(a, b) {
    const aa = structuralTokens(a);
    const bb = structuralTokens(b);
    const intersection = [...aa].filter((token) => bb.has(token)).length;
    return intersection / Math.max(1, new Set([...aa, ...bb]).size);
}
function groupRegions(placements, size) {
    const groups = new Map();
    for (const placement of placements) {
        const rx = Math.floor(placement.x / size);
        const rz = Math.floor(placement.z / size);
        const key = `${rx},${rz}`;
        const group = groups.get(key) ?? [];
        group.push(placement);
        groups.set(key, group);
    }
    return [...groups.entries()].map(([id, group]) => {
        const bounds = calculateBounds(group);
        return { id: `region-${id}`, chunkMin: { x: Math.floor(bounds.min.x / 16), z: Math.floor(bounds.min.z / 16) }, chunkMax: { x: Math.floor(bounds.max.x / 16), z: Math.floor(bounds.max.z / 16) }, bounds: { min: bounds.min, max: bounds.max }, placementCount: group.length };
    }).sort((a, b) => a.id.localeCompare(b.id));
}
function calculateBounds(placements) {
    const first = placements[0];
    if (!first)
        throw new Error("Cannot calculate bounds for an empty placement set.");
    const min = { x: first.x, y: first.y, z: first.z };
    const max = { x: first.x, y: first.y, z: first.z };
    for (let index = 1; index < placements.length; index += 1) {
        const placement = placements[index];
        min.x = Math.min(min.x, placement.x);
        min.y = Math.min(min.y, placement.y);
        min.z = Math.min(min.z, placement.z);
        max.x = Math.max(max.x, placement.x);
        max.y = Math.max(max.y, placement.y);
        max.z = Math.max(max.z, placement.z);
    }
    return {
        min,
        max,
        dimensions: { width: max.x - min.x + 1, depth: max.z - min.z + 1, height: max.y - min.y + 1 },
    };
}
function completePlacementStates(placements, edition) {
    const keyOf = ({ x, y, z }) => `${x},${y},${z}`;
    const map = new Map(placements.map((placement) => [keyOf(placement), placement]));
    const connected = (placement, dx, dz) => map.has(`${placement.x + dx},${placement.y},${placement.z + dz}`);
    return placements.map((placement) => {
        const state = { ...(placement.state ?? {}) };
        if (edition === "bedrock") {
            const native = {};
            const consumed = new Set();
            for (const [key, value] of Object.entries(state)) {
                if (key.startsWith("minecraft:") || key === "liquid_depth" || key === "pillar_axis" || key === "weirdo_direction" || key.endsWith("_bit")) {
                    native[key] = value;
                    consumed.add(key);
                }
            }
            if (state.axis !== undefined) {
                native.pillar_axis = state.axis;
                consumed.add("axis");
            }
            if (placement.block.endsWith("_stairs")) {
                const facing = String(state.facing ?? "north");
                if (state.shape !== undefined && state.shape !== "straight")
                    throw new Error(`UNREPRESENTABLE_BEDROCK_STATE: ${placement.block} stair shape ${String(state.shape)} cannot be represented in one Bedrock structure block layer.`);
                if (state.waterlogged === true || state.waterlogged === 1)
                    throw new Error(`UNREPRESENTABLE_BEDROCK_STATE: waterlogged ${placement.block} requires a secondary liquid layer, which this placement model cannot represent.`);
                native.upside_down_bit = state.half === "top" || state.upside_down_bit === true || state.upside_down_bit === 1;
                native.weirdo_direction = typeof state.weirdo_direction === "number" ? state.weirdo_direction : { east: 0, west: 1, south: 2, north: 3 }[facing] ?? 3;
                for (const key of ["facing", "half", "shape", "waterlogged"])
                    consumed.add(key);
            }
            if (placement.block.endsWith("_door") && !placement.block.endsWith("_trapdoor")) {
                native.door_hinge_bit = state.hinge === "right" || state.door_hinge_bit === true || state.door_hinge_bit === 1;
                native["minecraft:cardinal_direction"] = String(state["minecraft:cardinal_direction"] ?? state.facing ?? "north");
                native.open_bit = state.open === true || state.open_bit === true || state.open_bit === 1;
                native.upper_block_bit = state.half === "upper" || state.upper_block_bit === true || state.upper_block_bit === 1;
                for (const key of ["hinge", "facing", "open", "half", "powered"])
                    consumed.add(key);
            }
            if (/(^|:)lantern$|soul_lantern$/.test(placement.block)) {
                if (state.waterlogged === true || state.waterlogged === 1)
                    throw new Error(`UNREPRESENTABLE_BEDROCK_STATE: waterlogged ${placement.block} requires a secondary liquid layer, which this placement model cannot represent.`);
                native.hanging = state.hanging === true || state.hanging === 1;
                consumed.add("hanging");
                consumed.add("waterlogged");
            }
            if (placement.block === "minecraft:water" || placement.block === "minecraft:flowing_water") {
                native.liquid_depth = Number(state.liquid_depth ?? 0);
                consumed.add("liquid_depth");
            }
            for (const [key, value] of Object.entries(state)) {
                if (!consumed.has(key))
                    native[key] = value;
            }
            return Object.keys(native).length ? { ...placement, state: native } : { ...placement, state: undefined };
        }
        if (placement.block.endsWith("_stairs"))
            Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "bottom", shape: state.shape ?? "straight", waterlogged: state.waterlogged ?? false });
        if (placement.block.endsWith("_slab"))
            Object.assign(state, { type: state.type ?? "bottom", waterlogged: state.waterlogged ?? false });
        if (placement.block.endsWith("_trapdoor"))
            Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "bottom", open: state.open ?? false, powered: state.powered ?? false, waterlogged: state.waterlogged ?? false });
        if (placement.block.endsWith("_door") && !placement.block.endsWith("_trapdoor"))
            Object.assign(state, { facing: state.facing ?? "north", half: state.half ?? "lower", hinge: state.hinge ?? "left", open: state.open ?? false, powered: state.powered ?? false });
        if (/(^|:)lantern$|soul_lantern$/.test(placement.block))
            Object.assign(state, { hanging: state.hanging ?? false, waterlogged: state.waterlogged ?? false });
        if (/glass_pane|iron_bars/.test(placement.block))
            Object.assign(state, { north: connected(placement, 0, -1), south: connected(placement, 0, 1), west: connected(placement, -1, 0), east: connected(placement, 1, 0), waterlogged: state.waterlogged ?? false });
        if (/_fence$/.test(placement.block))
            Object.assign(state, { north: connected(placement, 0, -1), south: connected(placement, 0, 1), west: connected(placement, -1, 0), east: connected(placement, 1, 0), waterlogged: state.waterlogged ?? false });
        if (/_wall$/.test(placement.block))
            Object.assign(state, { north: connected(placement, 0, -1) ? "low" : "none", south: connected(placement, 0, 1) ? "low" : "none", west: connected(placement, -1, 0) ? "low" : "none", east: connected(placement, 1, 0) ? "low" : "none", up: state.up ?? true, waterlogged: state.waterlogged ?? false });
        return Object.keys(state).length ? { ...placement, state } : placement;
    });
}
export function compileBuild(rawInput, limits = {}) {
    const input = normalizeInput(rawInput);
    const maximumPlacements = checkedLimit(limits.maximumPlacements, DEFAULT_MAXIMUM_PLACEMENTS, "maximumPlacements");
    const maximumPlacementAttempts = checkedLimit(limits.maximumPlacementAttempts, DEFAULT_MAXIMUM_PLACEMENT_ATTEMPTS, "maximumPlacementAttempts");
    const requestedVolume = input.dimensions.width * input.dimensions.depth * input.dimensions.height;
    if (input.design.elements.length && !rawInput.sourceBrief?.trim()) {
        throw new Error("SOURCE_BRIEF_REQUIRED: generic design compilation requires the user's complete sourceBrief so intent loss can be audited.");
    }
    if (getStyleProfile(input.style).custom && !input.design.elements.length) {
        throw new Error(`CUSTOM_STYLE_DESIGN_REQUIRED: style “${input.style}” has no generic design program. Blockwright will not silently substitute Nordic or another preset.`);
    }
    const unsupportedHardRequirements = normalizeBuildContract(input)
        .filter(({ severity, supported }) => severity === "hard" && !supported);
    if (unsupportedHardRequirements.length) {
        const requirements = unsupportedHardRequirements.map(({ requirement }) => requirement).join("; ");
        throw new Error(`UNSUPPORTED_HARD_REQUIREMENT: Blockwright cannot generate this brief because it cannot verify: ${requirements}. Revise the brief to supported requirements; no generic substitute was generated.`);
    }
    const preflight = estimateBuild(input);
    if (preflight.estimatedPlacementAttempts > maximumPlacementAttempts) {
        throw new Error(`DESIGN_OPERATION_LIMIT_EXCEEDED: preflight estimates ${preflight.estimatedPlacementAttempts.toLocaleString()} coordinate operations, above this runtime's ${maximumPlacementAttempts.toLocaleString()} limit.`);
    }
    assertPreflightConfirmed(input, preflight);
    if (!input.design.elements.length && requestedVolume > 100_000) {
        throw new Error(`GENERIC_DESIGN_REQUIRED: the ${requestedVolume.toLocaleString()}-block envelope is too large for a legacy shell generator. Supply a sourceBrief and generic design program; no massing substitute was generated.`);
    }
    const paletteValidation = validatePaletteIdentifiers(input.edition, input.version, { ...input.rolePalette, ...materialBlocks(input) });
    if (!paletteValidation.valid)
        throw new Error(`INVALID_BLOCK_IDENTIFIERS: ${paletteValidation.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
    if (input.edition === "bedrock") {
        const exactBedrockVersion = input.version === "stable" || input.version === "latest" ? undefined : input.version;
        const exactMaterials = [
            ...Object.entries(input.rolePalette).map(([name, block]) => ({ name: `rolePalette.${name}`, block, state: undefined })),
            ...input.palette.map((block, index) => ({ name: `palette[${index}]`, block, state: undefined })),
            ...Object.entries(input.materialLibrary).map(([name, material]) => ({
                name: `materialLibrary.${name}`,
                block: typeof material === "string" ? material : material.block,
                state: typeof material === "string" ? undefined : material.state,
            })),
        ];
        for (const material of exactMaterials) {
            try {
                resolveBedrockBlockPermutation({ block: material.block, state: material.state }, exactBedrockVersion);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`INVALID_BEDROCK_MATERIAL ${material.name}: ${message}`);
            }
        }
    }
    const plan = planForInput(input);
    const compileLimits = { maximumPlacements, maximumPlacementAttempts };
    const legacy = input.design.elements.length ? undefined : generateFromPlan(plan, input.dimensions, input.origin, input.rolePalette, compileLimits);
    const generated = input.design.elements.length
        ? compileDesignProgram(input.design, { dimensions: input.dimensions, origin: input.origin, edition: input.edition, rolePalette: input.rolePalette, materialLibrary: input.materialLibrary, ...compileLimits })
        : undefined;
    const placements = completePlacementStates(generated?.placements ?? [...legacy.map.values()], input.edition).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
    if (input.edition === "bedrock") {
        const exactBedrockVersion = input.version === "stable" || input.version === "latest" ? undefined : input.version;
        for (const placement of placements) {
            try {
                resolveBedrockBlockPermutation(placement, exactBedrockVersion);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`INVALID_BEDROCK_PERMUTATION at ${placement.x},${placement.y},${placement.z}: ${message}`);
            }
        }
    }
    const materialCounts = {};
    const layerCounts = {};
    const phaseCounts = {};
    for (const placement of placements) {
        materialCounts[placement.block] = (materialCounts[placement.block] ?? 0) + 1;
        layerCounts[String(placement.y)] = (layerCounts[String(placement.y)] ?? 0) + 1;
        phaseCounts[placement.phase] = (phaseCounts[placement.phase] ?? 0) + 1;
    }
    const hash = calculateBuildHash(input, placements);
    const overBudget = placements.length > input.blockBudget;
    const staticRegistry = REGISTRY_META[input.edition];
    const exactJavaRegistry = input.edition === "java" ? registryMetadata(input.version) : undefined;
    const resolvedBedrockVersion = input.edition === "bedrock"
        ? (input.version === "stable" || input.version === "latest" ? BEDROCK_STABLE_VERSION : input.version)
        : undefined;
    const coverageGap = input.edition === "java" && !exactJavaRegistry
        ? `Java ${input.version} is not synchronized locally. Available fallback coverage is ${staticRegistry.coverageVersion}; run check_java_updates and sync_java_version before relying on identifiers added after that coverage.`
        : undefined;
    const registry = exactJavaRegistry ?? (input.edition === "bedrock"
        ? {
            requestedVersion: input.version,
            resolvedVersion: resolvedBedrockVersion,
            coverageVersion: resolvedBedrockVersion,
            source: "minecraft-data",
            sourceUrl: "https://github.com/PrismarineJS/minecraft-data",
            syncedAt: staticRegistry.syncedAt,
        }
        : { ...staticRegistry, ...(coverageGap ? { note: coverageGap } : {}) });
    const draft = {
        schemaVersion: 2,
        id: `bw_${hash.slice(0, 12)}`,
        hash,
        input,
        plan,
        preflight,
        structuralFingerprint: plan.fingerprint,
        bounds: calculateBounds(placements),
        placements,
        regions: groupRegions(placements, preflight.regionSize),
        materialCounts,
        layerCounts,
        phases: Object.entries(phaseCounts).map(([name, count]) => ({ name, count })),
        validation: {
            valid: !overBudget,
            blockingIssues: overBudget ? 1 : 0,
            warnings: coverageGap ? 1 : 0,
            issues: coverageGap ? [{ code: "REGISTRY_COVERAGE_GAP", severity: "warning", message: coverageGap }] : [],
            attemptedCollisions: generated?.attemptedCollisions ?? legacy.attemptedCollisions,
        },
        registry: { edition: input.edition, ...registry },
        createdAt: "deterministic",
    };
    const contract = validateBuildContract(draft);
    const hardIssues = contract.hardResults
        .filter(({ status }) => status !== "pass")
        .map((result) => ({
        code: result.evaluator === "block-budget"
            ? "BLOCK_BUDGET_EXCEEDED"
            : result.status === "unsupported"
                ? "UNSUPPORTED_HARD_REQUIREMENT"
                : result.status === "unevaluated"
                    ? "UNEVALUATED_HARD_REQUIREMENT"
                    : `CONTRACT_${(result.evaluator ?? result.clauseId).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_FAILED`,
        severity: "error",
        message: `${result.requirement}: ${result.message}`,
        ...(result.coordinates?.length ? { coordinates: result.coordinates } : {}),
    }));
    const warningIssues = contract.warnings.filter(({ clauseId }) => clauseId !== "audit-registry-note").map((result) => ({
        code: `CONTRACT_${(result.evaluator ?? result.clauseId).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_WARNING`,
        severity: "warning",
        message: result.message,
        ...(result.coordinates?.length ? { coordinates: result.coordinates } : {}),
    }));
    return {
        ...draft,
        validation: {
            valid: contract.status === "valid",
            blockingIssues: hardIssues.length,
            warnings: draft.validation.warnings + warningIssues.length,
            issues: [...draft.validation.issues, ...hardIssues, ...warningIssues],
            attemptedCollisions: draft.validation.attemptedCollisions,
        },
        contract,
        certificate: contract.certificate,
    };
}
export function generateBuildCandidates(rawInput, count = 3, recentPlans = [], limits = {}) {
    const target = Math.max(1, Math.min(5, Math.round(count)));
    const baseSeed = rawInput.seed?.trim() || createHash("sha256").update(`${rawInput.name}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12);
    const builds = [];
    for (let attempt = 0; attempt < target * 12 && builds.length < target; attempt += 1) {
        const seed = attempt === 0 ? baseSeed : `${baseSeed}-${attempt}`;
        const candidate = compileBuild({ ...rawInput, seed }, limits);
        const compared = [...recentPlans, ...builds.map(({ plan }) => plan)];
        const maximumSimilarity = compared.length ? Math.max(...compared.map((plan) => structuralSimilarity(candidate.plan, plan))) : 0;
        if (maximumSimilarity < 0.82 || attempt >= target * 8)
            builds.push(candidate);
    }
    return builds.map((build, index) => ({ build, candidate: index + 1, maximumSimilarity: Math.max(0, ...[...recentPlans, ...builds.filter((other) => other !== build).map(({ plan }) => plan)].map((plan) => structuralSimilarity(build.plan, plan))) }));
}
export function summarizeBuild(build) {
    const { placements: _placements, ...summary } = build;
    return { ...summary, blockCount: build.placements.length };
}
//# sourceMappingURL=compiler.js.map