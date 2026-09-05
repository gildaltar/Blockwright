import { gunzipSync, gzipSync } from "node:zlib";
import { parseUncompressed, simplify, writeUncompressed } from "prismarine-nbt";
export const LITEMATIC_FORMAT_VERSION = 7;
export const LITEMATIC_FORMAT_SUBVERSION = 1;
export const LITEMATIC_COMPATIBILITY = Object.freeze({
    status: "unverified",
    note: "Blockwright parser and independent NBT/packed-index tests pass, but this output has not yet been opened, placed, and re-saved by Litematica itself.",
});
const tag = {
    byte: (value) => ({ type: "byte", value }),
    int: (value) => ({ type: "int", value }),
    long: (value) => ({ type: "long", value }),
    string: (value) => ({ type: "string", value }),
    intArray: (value) => ({ type: "intArray", value }),
    longArray: (value) => ({ type: "longArray", value }),
    compound: (value, name) => ({ type: "compound", value, ...(name !== undefined ? { name } : {}) }),
    list: (type, value) => ({ type: "list", value: { type, value } }),
};
function checkedText(value, fallback, maximum) {
    const result = (value ?? fallback).trim();
    if (!result || result.length > maximum)
        throw new Error(`Litematic text fields must contain between 1 and ${maximum} characters.`);
    return result;
}
function checkedVec3(value, label) {
    for (const coordinate of [value.x, value.y, value.z]) {
        if (!Number.isSafeInteger(coordinate) || coordinate < -2_147_483_648 || coordinate > 2_147_483_647) {
            throw new Error(`${label} coordinates must be signed 32-bit integers.`);
        }
    }
    return { ...value };
}
function vec3Tag(value) {
    return tag.compound({ x: tag.int(value.x), y: tag.int(value.y), z: tag.int(value.z) });
}
function primitiveTag(value) {
    if (typeof value === "string")
        return tag.string(value);
    if (typeof value === "boolean")
        return tag.byte(value ? 1 : 0);
    if (typeof value === "bigint")
        return tag.long(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Block-entity NBT cannot contain non-finite numbers.");
        if (!Number.isInteger(value))
            return { type: "double", value };
        if (value >= -2_147_483_648 && value <= 2_147_483_647)
            return tag.int(value);
        if (Number.isSafeInteger(value))
            return tag.long(BigInt(value));
        throw new Error("Block-entity integer exceeds JavaScript's safe integer range.");
    }
    if (Array.isArray(value)) {
        if (!value.length)
            return tag.list("end", []);
        if (value.every((item) => Number.isInteger(item) && Number.isSafeInteger(item)))
            return tag.intArray(value);
        const entries = value.map(primitiveTag);
        if (!entries.every((entry) => entry.type === entries[0].type))
            throw new Error("Block-entity NBT lists must contain one homogeneous tag type.");
        return tag.list(entries[0].type, entries.map((entry) => entry.value));
    }
    if (value && typeof value === "object") {
        return tag.compound(Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined && item !== null)
            .map(([key, item]) => [key, primitiveTag(item)])));
    }
    throw new Error("Block-entity NBT cannot contain null or undefined values.");
}
function canonicalState(placement) {
    const entries = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right));
    return entries.length
        ? `${placement.block}[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
        : placement.block;
}
function parseCanonicalState(value) {
    const bracket = value.indexOf("[");
    if (bracket < 0)
        return { block: value };
    if (!value.endsWith("]"))
        throw new Error(`Invalid canonical block state: ${value}`);
    const state = Object.fromEntries(value.slice(bracket + 1, -1).split(",").filter(Boolean).map((entry) => {
        const separator = entry.indexOf("=");
        if (separator < 1)
            throw new Error(`Invalid canonical block-state property: ${entry}`);
        return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    return { block: value.slice(0, bracket), ...(Object.keys(state).length ? { state } : {}) };
}
function blockStateTag(value) {
    const parsed = parseCanonicalState(value);
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(parsed.block))
        throw new Error(`Invalid Java block identifier in Litematic palette: ${parsed.block}`);
    return {
        Name: tag.string(parsed.block),
        ...(parsed.state ? {
            Properties: tag.compound(Object.fromEntries(Object.entries(parsed.state).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, tag.string(item)]))),
        } : {}),
    };
}
function blockStateFromTag(value) {
    if (!value || typeof value !== "object")
        throw new Error("Litematic palette entry must be a compound.");
    const entry = value;
    if (typeof entry.Name !== "string" || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(entry.Name))
        throw new Error("Litematic palette entry has an invalid block identifier.");
    const properties = entry.Properties;
    if (properties !== undefined && (!properties || typeof properties !== "object" || Array.isArray(properties)))
        throw new Error("Litematic block-state properties must be a compound.");
    const state = properties;
    if (state && !Object.values(state).every((item) => typeof item === "string"))
        throw new Error("Litematic block-state properties must be strings.");
    return canonicalState({ block: entry.Name, ...(state ? { state: state } : {}) });
}
function bitsPerEntry(paletteSize) {
    if (!Number.isSafeInteger(paletteSize) || paletteSize < 1)
        throw new Error("Litematic palette cannot be empty.");
    const bits = Math.max(2, Math.ceil(Math.log2(paletteSize)));
    if (bits > 32)
        throw new Error("Litematic palette exceeds the 32-bit entry limit.");
    return bits;
}
export function packLitematicPaletteIndices(values, paletteSize) {
    const bits = bitsPerEntry(paletteSize);
    const mask = (1n << BigInt(bits)) - 1n;
    const unsigned = new Array(Math.ceil(values.length * bits / 64)).fill(0n);
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!Number.isSafeInteger(value) || value < 0 || value >= paletteSize)
            throw new Error(`Palette index ${value} is outside the palette.`);
        const startOffset = index * bits;
        const startArrayIndex = Math.floor(startOffset / 64);
        const endArrayIndex = Math.floor(((index + 1) * bits - 1) / 64);
        const startBitOffset = startOffset % 64;
        unsigned[startArrayIndex] = (unsigned[startArrayIndex] & ~(mask << BigInt(startBitOffset)))
            | ((BigInt(value) & mask) << BigInt(startBitOffset));
        unsigned[startArrayIndex] &= (1n << 64n) - 1n;
        if (startArrayIndex !== endArrayIndex) {
            const firstBits = 64 - startBitOffset;
            const remainingBits = bits - firstBits;
            const lowMask = (1n << BigInt(remainingBits)) - 1n;
            unsigned[endArrayIndex] = (unsigned[endArrayIndex] & ~lowMask) | ((BigInt(value) >> BigInt(firstBits)) & lowMask);
        }
    }
    return { bitsPerEntry: bits, longs: unsigned.map((value) => BigInt.asIntN(64, value)) };
}
function unsignedLong(value) {
    if (typeof value === "bigint")
        return BigInt.asUintN(64, value);
    if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)) {
        return BigInt.asUintN(64, (BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0));
    }
    throw new Error("Litematic BlockStates contains an invalid long value.");
}
export function unpackLitematicPaletteIndices(rawLongs, count, paletteSize) {
    const bits = bitsPerEntry(paletteSize);
    const expectedLongs = Math.ceil(count * bits / 64);
    if (rawLongs.length !== expectedLongs)
        throw new Error(`Litematic BlockStates contains ${rawLongs.length} longs; expected ${expectedLongs}.`);
    const longs = rawLongs.map(unsignedLong);
    const mask = (1n << BigInt(bits)) - 1n;
    const values = [];
    for (let index = 0; index < count; index += 1) {
        const startOffset = index * bits;
        const startArrayIndex = Math.floor(startOffset / 64);
        const endArrayIndex = Math.floor(((index + 1) * bits - 1) / 64);
        const startBitOffset = startOffset % 64;
        let value = longs[startArrayIndex] >> BigInt(startBitOffset);
        if (startArrayIndex !== endArrayIndex)
            value |= longs[endArrayIndex] << BigInt(64 - startBitOffset);
        const decoded = Number(value & mask);
        if (decoded >= paletteSize)
            throw new Error(`Litematic BlockStates references missing palette index ${decoded}.`);
        values.push(decoded);
    }
    return values;
}
function volume(dimensions) {
    return dimensions.width * dimensions.height * dimensions.depth;
}
function calculateBounds(placements) {
    const first = placements[0];
    if (!first)
        throw new Error("Cannot calculate Litematic bounds for an empty placement set.");
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
    return { min, max, dimensions: { width: max.x - min.x + 1, height: max.y - min.y + 1, depth: max.z - min.z + 1 } };
}
function epochMilliseconds(value, fallback) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 0)
        throw new Error("Litematic timestamps must be non-negative epoch milliseconds.");
    return result;
}
function uniquePlacementCoordinates(placements) {
    const seen = new Set();
    for (const placement of placements) {
        checkedVec3(placement, "Placement");
        const key = `${placement.x},${placement.y},${placement.z}`;
        if (seen.has(key))
            throw new Error(`Build contains duplicate placement coordinate ${key}.`);
        seen.add(key);
    }
}
export function createLitematicNbt(build, options = {}) {
    if (build.input.edition !== "java")
        throw new Error(".litematic export is available for Java Edition builds only.");
    if (!build.placements.length)
        throw new Error("Cannot export an empty Litematic region.");
    uniquePlacementCoordinates(build.placements);
    const bounds = calculateBounds(build.placements);
    const maximumVolume = options.maximumVolume ?? 2_000_000;
    if (!Number.isSafeInteger(maximumVolume) || maximumVolume < 1 || volume(bounds.dimensions) > maximumVolume) {
        throw new Error(`Litematic region volume exceeds the configured ${maximumVolume.toLocaleString()}-block limit.`);
    }
    const origin = checkedVec3(options.origin ?? build.input.origin, "Litematic origin");
    const minecraftDataVersion = build.registry.worldVersion;
    if (typeof minecraftDataVersion !== "number" || !Number.isSafeInteger(minecraftDataVersion) || minecraftDataVersion <= 0) {
        throw new Error("Litematic export requires an exact positive Minecraft DataVersion from the synchronized Java registry.");
    }
    const regionPosition = checkedVec3({ x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: bounds.min.z - origin.z }, "Litematic region position");
    const size = checkedVec3({ x: bounds.dimensions.width, y: bounds.dimensions.height, z: bounds.dimensions.depth }, "Litematic region size");
    const regionName = checkedText(options.regionName, "Blockwright", 128).replace(/[^A-Za-z0-9_. -]/g, "_");
    const now = Date.now();
    const timeCreated = epochMilliseconds(options.timeCreated, now);
    const timeModified = epochMilliseconds(options.timeModified, timeCreated);
    const states = [...new Set(build.placements.filter(({ block }) => block !== "minecraft:air").map(canonicalState))].sort();
    const palette = ["minecraft:air", ...states];
    const paletteIndex = new Map(palette.map((state, index) => [state, index]));
    const indices = new Array(volume(bounds.dimensions)).fill(0);
    const blockEntities = [];
    for (const placement of build.placements) {
        const x = placement.x - bounds.min.x;
        const y = placement.y - bounds.min.y;
        const z = placement.z - bounds.min.z;
        const index = y * bounds.dimensions.width * bounds.dimensions.depth + z * bounds.dimensions.width + x;
        if (placement.block !== "minecraft:air")
            indices[index] = paletteIndex.get(canonicalState(placement));
        if (placement.blockEntity) {
            const data = Object.fromEntries(Object.entries(placement.blockEntity.data ?? {})
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([key, value]) => [key, primitiveTag(value)]));
            blockEntities.push({
                ...data,
                id: tag.string(placement.blockEntity.id),
                x: tag.int(x),
                y: tag.int(y),
                z: tag.int(z),
            });
        }
    }
    const packed = packLitematicPaletteIndices(indices, palette.length);
    const region = tag.compound({
        Position: vec3Tag(regionPosition),
        Size: vec3Tag(size),
        BlockStatePalette: tag.list("compound", palette.map(blockStateTag)),
        BlockStates: tag.longArray(packed.longs),
        TileEntities: tag.list("compound", blockEntities),
        Entities: tag.list("compound", []),
        PendingBlockTicks: tag.list("compound", []),
        PendingFluidTicks: tag.list("compound", []),
    });
    const metadata = tag.compound({
        Name: tag.string(checkedText(options.name, build.input.name, 256)),
        Author: tag.string(checkedText(options.author, "Blockwright", 256)),
        Description: tag.string((options.description ?? `Deterministic Blockwright build ${build.hash}`).slice(0, 4_000)),
        RegionCount: tag.int(1),
        TotalVolume: tag.int(volume(bounds.dimensions)),
        TotalBlocks: tag.int(build.placements.filter(({ block }) => block !== "minecraft:air").length),
        TimeCreated: tag.long(BigInt(timeCreated)),
        TimeModified: tag.long(BigInt(timeModified)),
        EnclosingSize: vec3Tag(size),
    });
    const root = tag.compound({
        MinecraftDataVersion: tag.int(minecraftDataVersion),
        Version: tag.int(LITEMATIC_FORMAT_VERSION),
        SubVersion: tag.int(LITEMATIC_FORMAT_SUBVERSION),
        Metadata: metadata,
        Regions: tag.compound({ [regionName]: region }),
        Blockwright: tag.compound({
            SchemaVersion: tag.int(1),
            BuildHash: tag.string(build.hash),
            Origin: vec3Tag(origin),
            BoundsMin: vec3Tag(bounds.min),
            BoundsMax: vec3Tag(bounds.max),
            CompatibilityStatus: tag.string(LITEMATIC_COMPATIBILITY.status),
        }),
    }, "");
    return {
        root,
        format: "litematic",
        version: LITEMATIC_FORMAT_VERSION,
        subVersion: LITEMATIC_FORMAT_SUBVERSION,
        regionName,
        origin,
        bounds,
        paletteSize: palette.length,
        bitsPerEntry: packed.bitsPerEntry,
        blockCount: build.placements.filter(({ block }) => block !== "minecraft:air").length,
        timeCreated,
        timeModified,
        compatibility: LITEMATIC_COMPATIBILITY,
    };
}
export function exportLitematic(build, options = {}) {
    const created = createLitematicNbt(build, options);
    const raw = writeUncompressed(created.root, "big");
    return { ...created, bytes: gzipSync(raw, { level: 9 }) };
}
function readVec3(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be a coordinate compound.`);
    const result = value;
    if (![result.x, result.y, result.z].every((coordinate) => Number.isInteger(coordinate)))
        throw new Error(`${label} must contain integer x, y, and z values.`);
    return checkedVec3({ x: result.x, y: result.y, z: result.z }, label);
}
function longAsNumber(value, label) {
    const result = typeof value === "bigint"
        ? value
        : Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)
            ? (BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)
            : undefined;
    if (result === undefined || result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error(`${label} is outside the supported timestamp range.`);
    return Number(result);
}
function regionMinimum(position, size) {
    return {
        x: position.x + (size.x < 0 ? size.x + 1 : 0),
        y: position.y + (size.y < 0 ? size.y + 1 : 0),
        z: position.z + (size.z < 0 ? size.z + 1 : 0),
    };
}
function cloneBlockEntityData(entity) {
    const { id: _id, x: _x, y: _y, z: _z, ...data } = entity;
    return data;
}
export function importLitematic(bytes, options = {}) {
    const compressedLimit = options.maximumCompressedBytes ?? 16 * 1024 * 1024;
    const expandedLimit = options.maximumExpandedBytes ?? 64 * 1024 * 1024;
    const maximumVolume = options.maximumVolume ?? 2_000_000;
    if (bytes.byteLength > compressedLimit)
        throw new Error(`Litematic input exceeds the configured ${compressedLimit}-byte compressed limit.`);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
        throw new Error("Litematic input must be gzip-compressed Java NBT.");
    const expanded = options.expandedBytes ? Buffer.from(options.expandedBytes) : gunzipSync(Buffer.from(bytes), { maxOutputLength: expandedLimit });
    if (expanded.byteLength > expandedLimit)
        throw new Error(`Litematic input exceeds the configured ${expandedLimit}-byte expanded limit.`);
    const parsed = parseUncompressed(expanded, "big");
    const value = simplify(parsed);
    const version = value.Version;
    if (version !== LITEMATIC_FORMAT_VERSION)
        throw new Error(`Only Litematic format v${LITEMATIC_FORMAT_VERSION} is supported; received ${String(version)}.`);
    if (!value.Regions || typeof value.Regions !== "object" || Array.isArray(value.Regions))
        throw new Error("Litematic file does not contain a valid Regions compound.");
    const metadata = value.Metadata && typeof value.Metadata === "object" ? value.Metadata : {};
    const extensionOrigin = value.Blockwright?.Origin ? readVec3(value.Blockwright.Origin, "Blockwright origin") : undefined;
    const origin = checkedVec3(options.origin ?? extensionOrigin ?? { x: 0, y: 0, z: 0 }, "Litematic placement origin");
    const placements = [];
    const occupied = new Set();
    const regions = [];
    let totalVolume = 0;
    let unsupportedEntities = 0;
    let unsupportedPendingTicks = 0;
    for (const [name, rawRegion] of Object.entries(value.Regions).sort(([left], [right]) => left.localeCompare(right))) {
        if (!rawRegion || typeof rawRegion !== "object")
            throw new Error(`Litematic region ${name} must be a compound.`);
        const position = readVec3(rawRegion.Position, `Region ${name} Position`);
        const size = readVec3(rawRegion.Size, `Region ${name} Size`);
        if ([size.x, size.y, size.z].some((coordinate) => coordinate === 0))
            throw new Error(`Litematic region ${name} has a zero dimension.`);
        const dimensions = { width: Math.abs(size.x), height: Math.abs(size.y), depth: Math.abs(size.z) };
        const regionVolume = volume(dimensions);
        totalVolume += regionVolume;
        if (!Number.isSafeInteger(regionVolume) || !Number.isSafeInteger(totalVolume) || regionVolume > maximumVolume || totalVolume > maximumVolume) {
            throw new Error(`Litematic regions exceed the configured ${maximumVolume.toLocaleString()}-block volume limit.`);
        }
        if (!Array.isArray(rawRegion.BlockStatePalette) || !rawRegion.BlockStatePalette.length)
            throw new Error(`Litematic region ${name} has no block-state palette.`);
        const palette = rawRegion.BlockStatePalette.map(blockStateFromTag);
        const indices = unpackLitematicPaletteIndices(rawRegion.BlockStates ?? [], regionVolume, palette.length);
        const localMinimum = regionMinimum(position, size);
        const absoluteMinimum = {
            x: origin.x + localMinimum.x,
            y: origin.y + localMinimum.y,
            z: origin.z + localMinimum.z,
        };
        const tileEntities = Array.isArray(rawRegion.TileEntities) ? rawRegion.TileEntities : [];
        const tileByCoordinate = new Map();
        for (const entity of tileEntities) {
            const local = readVec3(entity, `Region ${name} tile entity`);
            if (local.x < 0 || local.y < 0 || local.z < 0 || local.x >= dimensions.width || local.y >= dimensions.height || local.z >= dimensions.depth) {
                throw new Error(`Region ${name} tile entity lies outside its block container.`);
            }
            const tileKey = `${local.x},${local.y},${local.z}`;
            if (tileByCoordinate.has(tileKey))
                throw new Error(`Region ${name} contains duplicate tile entity coordinate ${tileKey}.`);
            tileByCoordinate.set(tileKey, entity);
        }
        let blockCount = 0;
        for (let y = 0; y < dimensions.height; y += 1)
            for (let z = 0; z < dimensions.depth; z += 1)
                for (let x = 0; x < dimensions.width; x += 1) {
                    const index = y * dimensions.width * dimensions.depth + z * dimensions.width + x;
                    const state = parseCanonicalState(palette[indices[index]]);
                    if (state.block === "minecraft:air")
                        continue;
                    const coordinate = { x: absoluteMinimum.x + x, y: absoluteMinimum.y + y, z: absoluteMinimum.z + z };
                    const key = `${coordinate.x},${coordinate.y},${coordinate.z}`;
                    if (occupied.has(key))
                        throw new Error(`Litematic regions overlap at occupied coordinate ${key}.`);
                    occupied.add(key);
                    const blockEntity = tileByCoordinate.get(`${x},${y},${z}`);
                    placements.push({
                        ...coordinate,
                        ...state,
                        phase: `imported:${name}`,
                        ...(blockEntity && typeof blockEntity.id === "string" ? { blockEntity: { id: blockEntity.id, data: cloneBlockEntityData(blockEntity) } } : {}),
                    });
                    blockCount += 1;
                }
        const maximum = {
            x: absoluteMinimum.x + dimensions.width - 1,
            y: absoluteMinimum.y + dimensions.height - 1,
            z: absoluteMinimum.z + dimensions.depth - 1,
        };
        regions.push({
            name,
            position,
            size,
            bounds: { min: absoluteMinimum, max: maximum },
            dimensions,
            paletteSize: palette.length,
            volume: regionVolume,
            blockCount,
            tileEntityCount: tileEntities.length,
        });
        unsupportedEntities += Array.isArray(rawRegion.Entities) ? rawRegion.Entities.length : 0;
        unsupportedPendingTicks += (Array.isArray(rawRegion.PendingBlockTicks) ? rawRegion.PendingBlockTicks.length : 0)
            + (Array.isArray(rawRegion.PendingFluidTicks) ? rawRegion.PendingFluidTicks.length : 0);
    }
    if (!regions.length)
        throw new Error("Litematic file contains no regions.");
    const firstRegion = regions[0];
    const minimum = { ...firstRegion.bounds.min };
    const maximum = { ...firstRegion.bounds.max };
    for (let index = 1; index < regions.length; index += 1) {
        const bounds = regions[index].bounds;
        minimum.x = Math.min(minimum.x, bounds.min.x);
        minimum.y = Math.min(minimum.y, bounds.min.y);
        minimum.z = Math.min(minimum.z, bounds.min.z);
        maximum.x = Math.max(maximum.x, bounds.max.x);
        maximum.y = Math.max(maximum.y, bounds.max.y);
        maximum.z = Math.max(maximum.z, bounds.max.z);
    }
    placements.sort((left, right) => left.y - right.y || left.z - right.z || left.x - right.x || left.block.localeCompare(right.block));
    return {
        format: "litematic",
        version,
        subVersion: Number.isInteger(value.SubVersion) ? value.SubVersion : 0,
        minecraftDataVersion: Number.isInteger(value.MinecraftDataVersion) ? value.MinecraftDataVersion : undefined,
        metadata: {
            name: typeof metadata.Name === "string" ? metadata.Name : "",
            author: typeof metadata.Author === "string" ? metadata.Author : "",
            description: typeof metadata.Description === "string" ? metadata.Description : "",
            regionCount: Number.isInteger(metadata.RegionCount) ? metadata.RegionCount : regions.length,
            totalVolume: Number.isInteger(metadata.TotalVolume) ? metadata.TotalVolume : totalVolume,
            totalBlocks: Number.isInteger(metadata.TotalBlocks) ? metadata.TotalBlocks : placements.length,
            timeCreated: metadata.TimeCreated !== undefined ? longAsNumber(metadata.TimeCreated, "Litematic TimeCreated") : undefined,
            timeModified: metadata.TimeModified !== undefined ? longAsNumber(metadata.TimeModified, "Litematic TimeModified") : undefined,
            enclosingSize: metadata.EnclosingSize ? readVec3(metadata.EnclosingSize, "Litematic EnclosingSize") : undefined,
        },
        buildHash: typeof value.Blockwright?.BuildHash === "string" ? value.Blockwright.BuildHash : undefined,
        origin,
        bounds: {
            min: minimum,
            max: maximum,
            dimensions: { width: maximum.x - minimum.x + 1, height: maximum.y - minimum.y + 1, depth: maximum.z - minimum.z + 1 },
        },
        regions,
        placements,
        unsupportedContent: { entities: unsupportedEntities, pendingTicks: unsupportedPendingTicks },
        compatibility: LITEMATIC_COMPATIBILITY,
    };
}
//# sourceMappingURL=litematic.js.map