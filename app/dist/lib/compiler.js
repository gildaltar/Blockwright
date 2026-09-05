import { createHash } from "node:crypto";
import { REGISTRY_META } from "../data/registry-meta.js";
import { getStyleProfile } from "../data/styles.js";
import { registryMetadata } from "./java-registry.js";
import { defaultRolePalette, PALETTE_ROLES, validatePaletteIdentifiers } from "./palette-studio.js";
import { assertPreflightConfirmed, estimateBuild } from "./preflight.js";
import { calculateBuildHash, validateBuildContract } from "./contract.js";
const DEFAULT_ORIGIN = { x: 0, y: 0, z: 0 };
const WATERPARK_INTRINSIC_BLOCKS = [
    "minecraft:water",
    "minecraft:quartz_block",
    "minecraft:glass",
    "minecraft:light_blue_concrete",
    "minecraft:cyan_concrete",
    "minecraft:blue_concrete",
    "minecraft:yellow_concrete",
    "minecraft:orange_concrete",
    "minecraft:red_concrete",
    "minecraft:lime_concrete",
];
function clampDimension(value, min) {
    return Math.max(min, Math.min(65_535, Math.round(value)));
}
export function normalizeInput(input) {
    const style = getStyleProfile(input.style || "nordic");
    const version = input.version.trim() || REGISTRY_META[input.edition].coverageVersion;
    const buildingType = input.buildingType ?? (style.id === "japanese" ? "temple" : style.id === "medieval" ? "hall" : style.id === "megabase" ? "megabase" : "house");
    const positionalPalette = Object.fromEntries((input.palette ?? []).slice(0, PALETTE_ROLES.length).map((block, index) => [PALETTE_ROLES[index], block]));
    const rolePalette = defaultRolePalette(style.id, input.edition, version, { ...positionalPalette, ...input.rolePalette });
    const intrinsicBlocks = buildingType === "waterpark" ? WATERPARK_INTRINSIC_BLOCKS : [];
    return {
        name: input.name.trim() || "Untitled Build",
        edition: input.edition,
        version,
        style: style.id,
        dimensions: {
            width: clampDimension(input.dimensions.width, 5),
            depth: clampDimension(input.dimensions.depth, 5),
            height: clampDimension(input.dimensions.height, 5),
        },
        palette: [...new Set([...Object.values(rolePalette), ...(input.palette ?? []), ...intrinsicBlocks])],
        rolePalette,
        origin: input.origin ? { ...input.origin } : { ...DEFAULT_ORIGIN },
        // Omitted features mean no feature promise. Inventing attractive defaults here
        // would turn unrequested, unbuilt amenities into a misleading hard contract.
        features: input.features ? [...input.features].sort() : [],
        blockBudget: Math.max(100, Math.round(input.blockBudget ?? 2_000_000)),
        seed: input.seed?.trim() || createHash("sha256").update(JSON.stringify({ name: input.name.trim(), edition: input.edition, version, style: style.id, dimensions: input.dimensions, buildingType: input.buildingType ?? "auto" })).digest("hex").slice(0, 12),
        buildingType,
        confirmationToken: input.confirmationToken ?? "",
    };
}
function createAccumulator(origin) {
    const map = new Map();
    const accumulator = {
        map,
        attemptedCollisions: 0,
        put(x, y, z, block, phase, state) {
            const placement = { x: x + origin.x, y: y + origin.y, z: z + origin.z, block, phase, ...(state ? { state } : {}) };
            const key = `${placement.x},${placement.y},${placement.z}`;
            if (map.has(key))
                accumulator.attemptedCollisions += 1;
            map.set(key, placement);
        },
        remove(x, y, z) {
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
    const waterpark = input.buildingType === "waterpark";
    const tower = input.buildingType === "tower" || style === "fantasy";
    const footprint = {
        kind: waterpark ? "campus" : japanese || input.buildingType === "courtyard" ? "courtyard" : modern ? "interlocking" : tower ? "tower" : "rectangle",
        width, depth, inset: japanese ? Math.max(2, Math.floor(Math.min(width, depth) * (0.22 + random() * 0.08))) : Math.max(1, Math.floor(Math.min(width, depth) * 0.12)),
    };
    const floorHeight = Math.max(4, Math.min(7, 4 + Math.floor(random() * 3)));
    const floors = Math.max(1, Math.floor((height - 2) / floorHeight));
    const asymmetry = Number((0.12 + random() * 0.48).toFixed(3));
    const secondaryWidth = Math.max(3, Math.floor(width * (0.38 + random() * 0.18)));
    const secondaryDepth = Math.max(3, Math.floor(depth * (0.38 + random() * 0.18)));
    const volumes = footprint.kind === "campus"
        ? [
            { id: "arrival", min: { x: Math.floor(width * 0.38), y: 0, z: 0 }, max: { x: Math.ceil(width * 0.62), y: Math.max(5, Math.floor(height * 0.18)), z: Math.max(7, Math.floor(depth * 0.16)) }, purpose: "arrival pavilion" },
            { id: "slide-tower", min: { x: Math.floor(width * 0.08), y: 0, z: Math.floor(depth * 0.08) }, max: { x: Math.floor(width * 0.28), y: height - 1, z: Math.floor(depth * 0.32) }, purpose: "multi-slide tower" },
            { id: "wave-pool", min: { x: Math.floor(width * 0.57), y: 0, z: Math.floor(depth * 0.10) }, max: { x: width - 4, y: Math.max(3, Math.floor(height * 0.10)), z: Math.floor(depth * 0.46) }, purpose: "wave pool" },
            { id: "family-zone", min: { x: 3, y: 0, z: Math.floor(depth * 0.38) }, max: { x: Math.floor(width * 0.55), y: Math.max(5, Math.floor(height * 0.16)), z: depth - 4 }, purpose: "lazy river and family attractions" },
            { id: "hospitality", min: { x: Math.floor(width * 0.58), y: 0, z: Math.floor(depth * 0.70) }, max: { x: width - 4, y: Math.max(6, Math.floor(height * 0.20)), z: depth - 4 }, purpose: "locker and food court buildings" },
        ]
        : footprint.kind === "interlocking"
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
    const spaces = waterpark ? ["arrival", "wave pool", "lazy river", "slide tower", "splash pad", "locker rooms", "food court", "lifeguard stations"] : japanese ? ["genkan", "main hall", "engawa", "courtyard", "service room"] : modern ? ["entry", "living core", "service spine", "terrace"] : tower ? ["great hall", "stair tower", "lookout", "service room"] : ["entry", "main room", "storage", "loft"];
    const rooms = spaces.map((purpose, index) => ({ id: `room-${index + 1}`, purpose, floor: Math.min(floors - 1, Math.floor(index / 3)) }));
    const links = rooms.slice(1).map((room, index) => ({ from: rooms[index].id, to: room.id }));
    const roofType = waterpark ? "flat" : japanese ? "pagoda" : modern ? "flat" : tower ? "stepped" : "gable";
    const planWithoutFingerprint = {
        schemaVersion: 1, seed: input.seed,
        program: { buildingType: input.buildingType, spaces }, footprint,
        massing: { volumes, asymmetry }, roomGraph: { rooms, links },
        circulation: { primary: waterpark ? "central promenade with attraction loop" : japanese ? "engawa loop around courtyard" : modern ? "linear service spine" : tower ? "hall-to-tower hinge" : "central entry to loft stair", vertical: waterpark ? "slide-tower stairs and supported chutes" : tower ? "spiral tower stair" : floors > 1 ? "compact stair" : "none", exterior: waterpark ? ["arrival boulevard", "pool decks", "lazy-river bridges"] : japanese ? ["covered engawa", "garden threshold"] : modern ? ["terrace"] : ["entry porch"] },
        floorHeights: Array.from({ length: floors }, () => floorHeight),
        facadeBays: ["north", "south", "east", "west"].map((side, index) => ({ side, count: Math.max(2, Math.floor((index < 2 ? width : depth) / Math.max(3, 3 + Math.floor(random() * 3)))), rhythm: japanese ? "post-screen-post" : modern ? "solid-glass-solid" : "frame-infill" })),
        structuralFrame: { system: waterpark ? "reinforced attraction campus with supported slide tower" : japanese ? "post-and-beam courtyard ring" : modern ? "interlocking shear volumes" : tower ? "masonry hall with corner tower" : "timber frame over masonry base", bayWidth: Math.max(3, Math.min(7, 3 + Math.floor(random() * 5))), supports: waterpark ? ["slide columns", "canopy posts", "pool walls"] : japanese ? ["perimeter posts", "courtyard posts"] : ["corners", "facade bays", "roof ridge"] },
        roofGrammar: { type: roofType, pitch: modern ? 0 : Number((0.45 + random() * 0.45).toFixed(2)), overhang: japanese ? 2 : modern ? 1 : 1, tiers: japanese ? Math.max(1, Math.min(3, Math.floor(height / 8))) : tower ? 2 : 1 },
        entrances: [{ side: "south", width: waterpark ? 5 : japanese ? 3 : Math.max(1, 1 + Math.floor(random() * 2)), emphasis: waterpark ? "illuminated resort gate" : japanese ? "recessed genkan" : modern ? "shadow reveal" : "framed threshold" }],
        windows: { pattern: japanese ? "screen bays facing courtyard" : modern ? "continuous bands at living volume" : tower ? "narrow grouped openings" : "paired bays", sill: japanese ? 2 : 3, height: japanese ? 3 : modern ? 3 : 2 },
        details: waterpark ? ["layered pools", "color-coded slide chutes", "shade canopies", "lifeguard sightlines"] : japanese ? ["deep eaves", "engawa", "layered roof edges"] : modern ? ["shadow gaps", "cantilever", "roof terrace"] : tower ? ["battlements", "buttresses", "tower cap"] : ["porch", "chimney", "exposed frame"],
        landscaping: waterpark ? ["palm planters", "pool decks", "waterfront seating"] : japanese ? ["courtyard garden", "stepping path", "water or gravel focus"] : modern ? ["terrace", "planter bands"] : ["path", "foundation planting"],
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
function generateNordic(plan, dimensions, origin, palette) {
    const acc = createAccumulator(origin);
    const { width: w, depth: d, height: h } = dimensions;
    const roofRise = Math.max(2, Math.min(Math.floor(w / 2), Math.floor(h * 0.42)));
    const wallTop = h - roofRise - 1;
    shellBox(acc, { x: 0, y: 0, z: 0 }, { x: w - 1, y: wallTop, z: d - 1 }, palette, "main");
    const bay = plan.structuralFrame.bayWidth;
    for (let x = 0; x < w; x += bay)
        for (const z of [0, d - 1])
            for (let y = 2; y <= wallTop; y += 1)
                acc.put(x, y, z, palette.frame, "frame", { axis: "y" });
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
function generateJapanese(plan, dimensions, origin, palette) {
    const acc = createAccumulator(origin);
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
                acc.put(x, y, z, post ? palette.frame : (y >= plan.windows.sill && y < plan.windows.sill + plan.windows.height ? palette.glazing : palette.wall), post ? "post frame" : "screen walls", post ? { axis: "y" } : undefined);
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
function generateWaterpark(plan, dimensions, origin, palette) {
    const { width: w, depth: d, height: h } = dimensions;
    if (w < 64 || d < 64 || h < 24) {
        throw new Error("WATERPARK_MINIMUM_DIMENSIONS: a functional waterpark requires at least 64x64x24 blocks.");
    }
    const acc = createAccumulator(origin);
    const furnishingBay = Math.max(3, plan.structuralFrame.bayWidth);
    const box = (x0, y0, z0, x1, y1, z1, block, phase) => {
        for (let y = y0; y <= y1; y += 1)
            for (let z = z0; z <= z1; z += 1)
                for (let x = x0; x <= x1; x += 1)
                    acc.put(x, y, z, block, phase);
    };
    const ellipse = (cx, cz, rx, rz) => {
        const cells = [];
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z += 1)
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
                if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1)
                    cells.push({ x, y: 0, z });
            }
        return cells;
    };
    const addPavilion = (x0, z0, x1, z1, phase) => {
        box(x0, 0, z0, x1, 0, z1, palette.wall, `${phase} interior floor`);
        for (const x of [x0, x1])
            for (const z of [z0, z1])
                box(x, 1, z, x, 6, z, palette.frame, `${phase} structural posts`);
        box(x0, 6, z0, x1, 6, z1, "minecraft:quartz_block", `${phase} canopy roof`);
        for (let x = x0 + 2; x < x1 - 1; x += furnishingBay)
            for (let z = z0 + 2; z < z1 - 1; z += furnishingBay) {
                acc.put(x, 1, z, palette.accents, `${phase} seating table`);
                acc.put(x - 1, 1, z, palette.trim, `${phase} seating`);
                acc.put(x + 1, 1, z, palette.trim, `${phase} seating`);
            }
    };
    // One-block site slab provides a predictable paste floor while leaving the park open above it.
    box(0, 0, 0, w - 1, 0, d - 1, palette.foundation, "waterpark site foundation");
    for (let x = 0; x < w; x += 1)
        for (const z of [0, d - 1])
            acc.put(x, 1, z, palette.trim, "waterpark perimeter coping");
    for (let z = 1; z < d - 1; z += 1)
        for (const x of [0, w - 1])
            acc.put(x, 1, z, palette.trim, "waterpark perimeter coping");
    // A five-block promenade makes the overall campus readable and keeps a clear route from the arrival gate.
    const centerX = Math.floor(w / 2);
    const centerZ = Math.floor(d / 2);
    box(centerX - 2, 0, 0, centerX + 2, 0, d - 1, palette.accents, "arrival promenade");
    box(0, 0, centerZ - 2, w - 1, 0, centerZ + 2, palette.accents, "cross promenade");
    // Wave pool: tapered plan, bright basin, full water surface, and a stepped wave wall.
    const waveX0 = Math.floor(w * 0.58);
    const waveX1 = w - 5;
    const waveZ0 = Math.floor(d * 0.10);
    const waveZ1 = Math.floor(d * 0.43);
    for (let z = waveZ0; z <= waveZ1; z += 1) {
        const progress = (z - waveZ0) / Math.max(1, waveZ1 - waveZ0);
        const inset = Math.floor((1 - progress) * Math.max(2, Math.floor((waveX1 - waveX0) * 0.16)));
        for (let x = waveX0 + inset; x <= waveX1 - inset; x += 1) {
            acc.put(x, 0, z, "minecraft:light_blue_concrete", "wave pool basin");
            acc.put(x, 1, z, "minecraft:water", "wave pool water");
        }
    }
    for (let x = waveX0; x <= waveX1; x += 1) {
        acc.put(x, 1, waveZ1 + 1, "minecraft:quartz_block", "wave pool coping");
        if (x % 3 === 0)
            for (let y = 2; y <= 4; y += 1)
                acc.put(x, y, waveZ1 + 1, "minecraft:blue_concrete", "wave pool wave wall");
    }
    // Lazy river: a real elliptical water channel rather than a labeled empty volume.
    const riverCx = Math.floor(w * 0.28);
    const riverCz = Math.floor(d * 0.67);
    const riverRx = Math.max(12, Math.floor(w * 0.22));
    const riverRz = Math.max(12, Math.floor(d * 0.24));
    const innerRx = Math.max(5, riverRx - Math.max(4, Math.floor(Math.min(w, d) * 0.045)));
    const innerRz = Math.max(5, riverRz - Math.max(4, Math.floor(Math.min(w, d) * 0.045)));
    const riverCells = new Set();
    for (const point of ellipse(riverCx, riverCz, riverRx, riverRz)) {
        const insideInner = ((point.x - riverCx) / innerRx) ** 2 + ((point.z - riverCz) / innerRz) ** 2 < 1;
        if (!insideInner)
            riverCells.add(`${point.x},${point.z}`);
    }
    for (const key of riverCells) {
        const [x, z] = key.split(",").map(Number);
        acc.put(x, 0, z, "minecraft:cyan_concrete", "lazy river basin");
        const boundary = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !riverCells.has(`${x + dx},${z + dz}`));
        acc.put(x, 1, z, boundary ? "minecraft:quartz_block" : "minecraft:water", boundary ? "lazy river coping" : "lazy river water channel");
    }
    // Slide tower and three independently colored, water-filled descending chutes.
    const towerX = Math.floor(w * 0.20);
    const towerZ = Math.floor(d * 0.24);
    const towerRadius = 4;
    for (const dx of [-towerRadius, towerRadius])
        for (const dz of [-towerRadius, towerRadius])
            box(towerX + dx, 1, towerZ + dz, towerX + dx, h - 1, towerZ + dz, palette.frame, "water slide tower supports");
    for (let y = 5; y < h - 1; y += 6)
        box(towerX - towerRadius, y, towerZ - towerRadius, towerX + towerRadius, y, towerZ + towerRadius, "minecraft:quartz_block", "water slide tower platforms");
    const slideColors = ["minecraft:red_concrete", "minecraft:orange_concrete", "minecraft:yellow_concrete"];
    for (let slide = 0; slide < slideColors.length; slide += 1) {
        const radius = Math.max(7, Math.floor(Math.min(w, d) * (0.075 + slide * 0.018)));
        const steps = Math.max(96, h * 3);
        const turns = 1.65 + slide * 0.35;
        for (let step = 0; step < steps; step += 1) {
            const t = step / (steps - 1);
            const angle = slide * 2.05 + t * Math.PI * 2 * turns;
            const x = Math.max(2, Math.min(w - 3, Math.round(towerX + Math.cos(angle) * radius)));
            const z = Math.max(2, Math.min(d - 3, Math.round(towerZ + Math.sin(angle) * radius)));
            const y = Math.max(3, Math.min(h - 3, Math.round(h - 3 - t * (h - 7))));
            const sideAngle = angle + Math.PI / 2;
            const sideX = Math.abs(Math.cos(sideAngle)) >= Math.abs(Math.sin(sideAngle)) ? Math.sign(Math.cos(sideAngle)) : 0;
            const sideZ = sideX === 0 ? Math.sign(Math.sin(sideAngle)) : 0;
            acc.put(x, y, z, slideColors[slide], `water slide ${slide + 1} chute`);
            acc.put(x, y + 1, z, "minecraft:water", `water slide ${slide + 1} water`);
            acc.put(x + sideX, y + 1, z + sideZ, "minecraft:glass", `water slide ${slide + 1} rail`);
            acc.put(x - sideX, y + 1, z - sideZ, "minecraft:glass", `water slide ${slide + 1} rail`);
            if (step % 18 === 0)
                box(x, 1, z, x, Math.max(1, y - 1), z, palette.frame, `water slide ${slide + 1} supports`);
        }
    }
    // Splash pad with a patterned non-slip surface and multiple visible water jets.
    const splashCx = Math.floor(w * 0.76);
    const splashCz = Math.floor(d * 0.60);
    const splashR = Math.max(7, Math.floor(Math.min(w, d) * 0.075));
    for (const point of ellipse(splashCx, splashCz, splashR, splashR)) {
        const checker = (point.x + point.z) % 2 === 0;
        acc.put(point.x, 0, point.z, checker ? "minecraft:lime_concrete" : "minecraft:light_blue_concrete", "splash pad surface");
    }
    for (const [dx, dz, jetHeight] of [[0, 0, 5], [4, 0, 3], [-4, 0, 3], [0, 4, 3], [0, -4, 3]]) {
        for (let y = 1; y <= jetHeight; y += 1)
            acc.put(splashCx + dx, y, splashCz + dz, "minecraft:water", "splash pad water jets");
    }
    const serviceX0 = Math.floor(w * 0.58);
    const serviceX1 = w - 5;
    const serviceZ0 = Math.floor(d * 0.76);
    const serviceZ1 = d - 5;
    const serviceMid = Math.floor((serviceX0 + serviceX1) / 2);
    addPavilion(serviceX0, serviceZ0, serviceMid - 2, serviceZ1, "locker room");
    addPavilion(serviceMid + 2, serviceZ0, serviceX1, serviceZ1, "food court");
    // Four sightline stations, shade umbrellas, and quadrant lighting make the campus operationally legible.
    const stations = [[waveX0 - 3, waveZ0], [waveX1, waveZ1 + 3], [riverCx - riverRx, riverCz], [riverCx + riverRx, riverCz]];
    for (const [x, z] of stations) {
        box(x, 1, z, x, 3, z, palette.frame, "lifeguard station supports");
        box(x - 1, 4, z - 1, x + 1, 4, z + 1, "minecraft:yellow_concrete", "lifeguard station platform");
        acc.put(x, 5, z, "minecraft:red_concrete", "lifeguard station marker");
    }
    for (const [x, z, color] of [[Math.floor(w * 0.47), Math.floor(d * 0.27), "minecraft:cyan_concrete"], [Math.floor(w * 0.47), Math.floor(d * 0.72), "minecraft:orange_concrete"], [Math.floor(w * 0.82), Math.floor(d * 0.50), "minecraft:lime_concrete"]]) {
        box(x, 1, z, x, 4, z, palette.frame, "shade canopy posts");
        box(x - 2, 5, z, x + 2, 5, z, color, "shade canopy");
        box(x, 5, z - 2, x, 5, z + 2, color, "shade canopy");
    }
    for (const [x, z] of [[Math.floor(w * 0.2), Math.floor(d * 0.2)], [Math.floor(w * 0.8), Math.floor(d * 0.2)], [Math.floor(w * 0.2), Math.floor(d * 0.8)], [Math.floor(w * 0.8), Math.floor(d * 0.8)], [centerX, Math.floor(d * 0.2)], [centerX, Math.floor(d * 0.8)]]) {
        acc.put(x, 0, z, palette.lighting, "distributed waterpark lighting");
    }
    // Central safe spawn and four boundary gates are applied last so attractions cannot obstruct them.
    for (let x = centerX - 2; x <= centerX + 2; x += 1)
        for (let z = centerZ - 2; z <= centerZ + 2; z += 1) {
            acc.put(x, 0, z, palette.lighting, "central spawn pedestal");
            for (let y = 1; y <= 3; y += 1)
                acc.remove(x, y, z);
        }
    carveDoor(acc, centerX - 1, 0, "south", palette, 3);
    carveDoor(acc, centerX - 1, d - 1, "north", palette, 3);
    for (let dz = -1; dz <= 1; dz += 1) {
        acc.put(0, 2, centerZ + dz, palette.doors, "west waterpark gate", { half: "lower", facing: "west", hinge: dz % 2 ? "right" : "left", open: false, powered: false });
        acc.put(0, 3, centerZ + dz, palette.doors, "west waterpark gate", { half: "upper", facing: "west", hinge: dz % 2 ? "right" : "left", open: false, powered: false });
        acc.put(w - 1, 2, centerZ + dz, palette.doors, "east waterpark gate", { half: "lower", facing: "east", hinge: dz % 2 ? "right" : "left", open: false, powered: false });
        acc.put(w - 1, 3, centerZ + dz, palette.doors, "east waterpark gate", { half: "upper", facing: "east", hinge: dz % 2 ? "right" : "left", open: false, powered: false });
    }
    return acc;
}
function generateModern(plan, dimensions, origin, palette) {
    const acc = createAccumulator(origin);
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
function generateTower(plan, dimensions, origin, palette) {
    const acc = createAccumulator(origin);
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
function generateFromPlan(plan, dimensions, origin, palette) {
    if (plan.program.buildingType === "waterpark")
        return generateWaterpark(plan, dimensions, origin, palette);
    if (plan.footprint.kind === "courtyard")
        return generateJapanese(plan, dimensions, origin, palette);
    if (plan.footprint.kind === "interlocking")
        return generateModern(plan, dimensions, origin, palette);
    if (plan.footprint.kind === "tower")
        return generateTower(plan, dimensions, origin, palette);
    return generateNordic(plan, dimensions, origin, palette);
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
function completePlacementStates(placements) {
    const keyOf = ({ x, y, z }) => `${x},${y},${z}`;
    const map = new Map(placements.map((placement) => [keyOf(placement), placement]));
    const connected = (placement, dx, dz) => map.has(`${placement.x + dx},${placement.y},${placement.z + dz}`);
    return placements.map((placement) => {
        const state = { ...(placement.state ?? {}) };
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
export function compileBuild(rawInput) {
    const input = normalizeInput(rawInput);
    const preflight = estimateBuild(input);
    assertPreflightConfirmed(input, preflight);
    const paletteValidation = validatePaletteIdentifiers(input.edition, input.version, input.rolePalette);
    if (!paletteValidation.valid)
        throw new Error(`INVALID_BLOCK_IDENTIFIERS: ${paletteValidation.invalid.map(({ role, block }) => `${role}=${block}`).join(", ")}`);
    const plan = createArchitecturalPlan(input);
    const acc = generateFromPlan(plan, input.dimensions, input.origin, input.rolePalette);
    const placements = completePlacementStates([...acc.map.values()]).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.block.localeCompare(b.block));
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
    const coverageGap = input.edition === "java" && !exactJavaRegistry
        ? `Java ${input.version} is not synchronized locally. Available fallback coverage is ${staticRegistry.coverageVersion}; run check_java_updates and sync_java_version before relying on identifiers added after that coverage.`
        : input.edition === "bedrock" && input.version !== staticRegistry.requestedVersion && input.version !== staticRegistry.coverageVersion
            ? `Requested ${input.edition} ${input.version}; packaged coverage is ${staticRegistry.coverageVersion}.`
            : undefined;
    const registry = exactJavaRegistry ?? { ...staticRegistry, ...(coverageGap ? { note: coverageGap } : {}) };
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
            attemptedCollisions: acc.attemptedCollisions,
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
export function generateBuildCandidates(rawInput, count = 3, recentPlans = []) {
    const target = Math.max(1, Math.min(5, Math.round(count)));
    const baseSeed = rawInput.seed?.trim() || createHash("sha256").update(`${rawInput.name}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12);
    const builds = [];
    for (let attempt = 0; attempt < target * 12 && builds.length < target; attempt += 1) {
        const seed = attempt === 0 ? baseSeed : `${baseSeed}-${attempt}`;
        const candidate = compileBuild({ ...rawInput, seed });
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