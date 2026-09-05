import { createHash } from "node:crypto";
import JSZip from "jszip";
import minecraftData from "minecraft-data";
import { writeUncompressed } from "prismarine-nbt";
import { calculateBuildHash, validateBuildContract } from "./contract.js";
const tag = {
    byte: (value) => ({ type: "byte", value }),
    int: (value) => ({ type: "int", value }),
    string: (value) => ({ type: "string", value }),
    compound: (value, name) => ({
        type: "compound",
        value,
        ...(name === undefined ? {} : { name }),
    }),
    list: (type, value) => ({ type: "list", value: { type, value } }),
    byteArray: (value) => ({ type: "byteArray", value }),
    intArray: (value) => ({ type: "intArray", value }),
};
export const BEDROCK_STABLE_VERSION = minecraftData.supportedVersions.bedrock.at(-1);
export const DEFAULT_BEDROCK_TILE_DIMENSIONS = Object.freeze({ width: 32, height: 32, depth: 32 });
export const BEDROCK_STRUCTURE_COMPATIBILITY = Object.freeze({
    format: "bedrock_mcstructure_v1",
    nbtEncoding: "uncompressed_little_endian",
    registryPackage: "minecraft-data",
    registryVersion: BEDROCK_STABLE_VERSION,
    internalValidation: "verified",
    iphoneRuntime: "unverified",
    note: "The NBT and behavior-pack layout are internally validated. Import, activation, structure placement, and performance still require an exact-version Bedrock client test on iPhone.",
});
const registryCache = new Map();
const permutationCache = new Map();
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const FUNCTION_PAGE_SIZE = 128;
function checkedRegistry(version) {
    if (!minecraftData.supportedVersions.bedrock.includes(version)) {
        throw new Error(`minecraft-data does not contain an exact Bedrock ${version} registry.`);
    }
    const cached = registryCache.get(version);
    if (cached)
        return cached;
    const registry = minecraftData(`bedrock_${version}`);
    if (!registry || registry.type !== "bedrock" || registry.version.minecraftVersion !== version || !registry.blockStates) {
        throw new Error(`minecraft-data did not resolve the exact Bedrock ${version} block-state registry.`);
    }
    registryCache.set(version, registry);
    return registry;
}
function checkedText(value, label, maximum) {
    const result = value.trim();
    if (!result || result.length > maximum)
        throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
    return result;
}
function checkedInt32(value, label) {
    if (!Number.isSafeInteger(value) || value < INT32_MIN || value > INT32_MAX)
        throw new Error(`${label} must be a signed 32-bit integer.`);
    return value;
}
function checkedVec3(value, label) {
    return {
        x: checkedInt32(value.x, `${label}.x`),
        y: checkedInt32(value.y, `${label}.y`),
        z: checkedInt32(value.z, `${label}.z`),
    };
}
function checkedDimensions(value) {
    const dimensions = { width: value.width, height: value.height, depth: value.depth };
    for (const [axis, size] of Object.entries(dimensions)) {
        if (!Number.isSafeInteger(size) || size < 1)
            throw new Error(`Bedrock tile ${axis} must be a positive safe integer.`);
    }
    if (dimensions.width > 64 || dimensions.depth > 64 || dimensions.height > 256) {
        throw new Error("Bedrock tiles may be at most 64×256×64 blocks; use smaller tile dimensions.");
    }
    const tileVolume = dimensions.width * dimensions.height * dimensions.depth;
    if (!Number.isSafeInteger(tileVolume) || tileVolume > 1_048_576)
        throw new Error("Bedrock tile volume exceeds 1,048,576 cells.");
    return dimensions;
}
function resolvedVersion(builds, requested) {
    const version = requested ?? BEDROCK_STABLE_VERSION;
    checkedRegistry(version);
    for (const build of builds) {
        const declared = build.input.version;
        if (declared !== "stable" && declared !== "latest" && declared !== version) {
            throw new Error(`Build ${build.id} targets Bedrock ${declared}, not the selected exact ${version} registry.`);
        }
    }
    return version;
}
function normalizeStateValue(value, expected, block, key) {
    if (expected.type === "byte") {
        if (typeof value === "boolean")
            return value ? 1 : 0;
        if (typeof value === "number" && Number.isInteger(value) && (value === 0 || value === 1))
            return value;
        throw new Error(`${block} state ${key} requires a Bedrock byte/Boolean value (true, false, 0, or 1).`);
    }
    if (expected.type === "int") {
        if (typeof value === "number" && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX)
            return value;
        throw new Error(`${block} state ${key} requires a Bedrock integer value.`);
    }
    if (typeof value !== "string")
        throw new Error(`${block} state ${key} requires a Bedrock string value.`);
    return value;
}
function permutationKey(name, states) {
    return `${name}[${Object.entries(states).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, state]) => `${key}:${state.type}=${String(state.value)}`).join(",")}]`;
}
export function resolveBedrockBlockPermutation(placement, bedrockVersion = BEDROCK_STABLE_VERSION) {
    const rawStateKey = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${typeof value}=${String(value)}`).join(",");
    const cacheKey = `${bedrockVersion}\u0000${placement.block}\u0000${rawStateKey}`;
    const cached = permutationCache.get(cacheKey);
    if (cached)
        return cached;
    const registry = checkedRegistry(bedrockVersion);
    if (!/^minecraft:[a-z0-9_]+$/.test(placement.block)) {
        throw new Error(`Bedrock structure export requires a stable vanilla namespaced block identifier; received ${placement.block}.`);
    }
    const localName = placement.block.slice("minecraft:".length);
    const block = registry.blocksByName[localName];
    const states = registry.blockStates;
    if (!block)
        throw new Error(`Unknown Bedrock ${bedrockVersion} block: ${placement.block}.`);
    const defaultPermutation = states[block.defaultState];
    if (!defaultPermutation || defaultPermutation.name !== localName)
        throw new Error(`Bedrock registry has no default permutation for ${placement.block}.`);
    const desired = Object.fromEntries(Object.entries(defaultPermutation.states).map(([key, state]) => [key, { ...state }]));
    for (const [key, rawValue] of Object.entries(placement.state ?? {})) {
        const expected = defaultPermutation.states[key];
        if (!expected)
            throw new Error(`${placement.block} has no Bedrock ${bedrockVersion} state named ${key}.`);
        desired[key] = { type: expected.type, value: normalizeStateValue(rawValue, expected, placement.block, key) };
    }
    const canonical = permutationKey(localName, desired);
    const match = states.slice(block.minStateId, block.maxStateId + 1)
        .find((candidate) => candidate.name === localName && permutationKey(candidate.name, candidate.states) === canonical);
    if (!match) {
        const requestedState = Object.entries(desired).sort(([left], [right]) => left.localeCompare(right))
            .map(([key, state]) => `${key}=${String(state.value)}`).join(", ");
        throw new Error(`No Bedrock ${bedrockVersion} permutation exists for ${placement.block}${requestedState ? ` (${requestedState})` : ""}.`);
    }
    const normalizedStates = Object.fromEntries(Object.entries(match.states).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, state]) => [key, { ...state }]));
    const resolved = {
        name: `minecraft:${match.name}`,
        states: normalizedStates,
        version: match.version,
        canonical: permutationKey(match.name, normalizedStates),
    };
    permutationCache.set(cacheKey, resolved);
    return resolved;
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalize(item)]));
    }
    if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Canonical metadata cannot contain non-finite numbers.");
    return value;
}
function canonicalJson(value) {
    return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function deterministicUuid(seed) {
    const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
    // RFC 9562 UUIDv8 reserves this version for application-defined deterministic bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function safeSlug(value, fallback) {
    const result = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    return result || fallback;
}
function checkedNamespace(value) {
    const namespace = value ?? "blockwright";
    if (!/^[a-z0-9_][a-z0-9_.-]{0,31}$/.test(namespace))
        throw new Error("Bedrock namespace must be 1-32 lowercase identifier characters.");
    return namespace;
}
function sameVec3(left, right) {
    return left.x === right.x && left.y === right.y && left.z === right.z;
}
function sameDimensions(left, right) {
    return left.width === right.width && left.height === right.height && left.depth === right.depth;
}
function calculateBounds(placements) {
    const first = placements[0];
    if (!first)
        throw new Error("A Bedrock structure build must contain at least one placement.");
    const min = checkedVec3(first, "Placement");
    const max = { ...min };
    for (let index = 1; index < placements.length; index += 1) {
        const placement = checkedVec3(placements[index], "Placement");
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
        dimensions: { width: max.x - min.x + 1, height: max.y - min.y + 1, depth: max.z - min.z + 1 },
    };
}
function validateBuild(build, bedrockVersion) {
    if (build.schemaVersion !== 2)
        throw new Error(`Build ${build.id} is not a canonical BuildRecord schema version 2.`);
    checkedText(build.id, "Build id", 256);
    checkedText(build.hash, "Build hash", 256);
    if (build.input.edition !== "bedrock" || build.registry.edition !== "bedrock")
        throw new Error(`Build ${build.id} is not a Bedrock build.`);
    if (build.registry.requestedVersion !== build.input.version)
        throw new Error(`Build ${build.id} has mismatched requested-version metadata.`);
    if (!build.validation.valid || build.validation.blockingIssues !== 0)
        throw new Error(`Build ${build.id} has blocking validation failures.`);
    if (build.contract.status !== "valid" || build.certificate.status !== "valid" || build.contract.certificate.status !== "valid") {
        throw new Error(`Build ${build.id} does not have a valid contract and certificate.`);
    }
    if (build.contract.buildHash !== build.hash || build.certificate.buildHash !== build.hash || build.contract.certificate.buildHash !== build.hash) {
        throw new Error(`Build ${build.id} has stale hash-bound contract or certificate metadata.`);
    }
    if (build.certificate.buildId !== build.id || build.contract.certificate.buildId !== build.id) {
        throw new Error(`Build ${build.id} has a certificate bound to a different build id.`);
    }
    if (canonicalJson(build.certificate) !== canonicalJson(build.contract.certificate)) {
        throw new Error(`Build ${build.id} certificate does not match the contract's embedded certificate.`);
    }
    if (build.contract.summary.failed || build.contract.summary.unsupported || build.contract.summary.unevaluated
        || build.certificate.hard.failed || build.certificate.hard.unsupported || build.certificate.hard.unevaluated) {
        throw new Error(`Build ${build.id} certificate still contains failed, unsupported, or unevaluated hard clauses.`);
    }
    const calculatedHash = calculateBuildHash(build.input, build.placements);
    if (calculatedHash !== build.hash || build.id !== `bw_${calculatedHash.slice(0, 12)}`) {
        throw new Error(`Build ${build.id} canonical input or placements do not match its immutable build hash.`);
    }
    const recomputedContract = validateBuildContract(build);
    if (recomputedContract.status !== "valid" || canonicalJson(recomputedContract) !== canonicalJson(build.contract)
        || canonicalJson(recomputedContract.certificate) !== canonicalJson(build.certificate)) {
        throw new Error(`Build ${build.id} contract or certificate does not match fresh semantic validation of the canonical record.`);
    }
    const seen = new Set();
    for (const placement of build.placements) {
        checkedVec3(placement, "Placement");
        const coordinate = `${placement.x},${placement.y},${placement.z}`;
        if (seen.has(coordinate))
            throw new Error(`Build ${build.id} contains duplicate placement coordinate ${coordinate}.`);
        seen.add(coordinate);
        resolveBedrockBlockPermutation(placement, bedrockVersion);
        if (placement.blockEntity && !/^[A-Za-z0-9_.:-]+$/.test(placement.blockEntity.id)) {
            throw new Error(`Build ${build.id} has an invalid Bedrock block-entity id at ${coordinate}.`);
        }
    }
    const calculated = calculateBounds(build.placements);
    checkedVec3(build.bounds.min, "Build bounds minimum");
    checkedVec3(build.bounds.max, "Build bounds maximum");
    if (!sameVec3(calculated.min, build.bounds.min) || !sameVec3(calculated.max, build.bounds.max)
        || !sameDimensions(calculated.dimensions, build.bounds.dimensions)) {
        throw new Error(`Build ${build.id} declared bounds do not exactly match its canonical placements.`);
    }
    return calculated;
}
function overlap(left, right) {
    return left.min.x <= right.max.x && left.max.x >= right.min.x
        && left.min.y <= right.max.y && left.max.y >= right.min.y
        && left.min.z <= right.max.z && left.max.z >= right.min.z;
}
function validateBuildSet(builds, bedrockVersion) {
    if (!builds.length)
        throw new Error("A Bedrock pack must contain at least one build.");
    const ids = new Set();
    for (const build of builds) {
        if (ids.has(build.id))
            throw new Error(`Bedrock pack contains duplicate build id ${build.id}.`);
        ids.add(build.id);
        validateBuild(build, bedrockVersion);
    }
    for (let left = 0; left < builds.length; left += 1) {
        for (let right = left + 1; right < builds.length; right += 1) {
            if (overlap(builds[left].bounds, builds[right].bounds)) {
                throw new Error(`Bedrock build bounds overlap: ${builds[left].id} and ${builds[right].id}.`);
            }
        }
    }
}
function primitiveNbt(value) {
    if (typeof value === "string")
        return tag.string(value);
    if (typeof value === "boolean")
        return tag.byte(value ? 1 : 0);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Bedrock block-entity NBT cannot contain non-finite numbers.");
        if (Number.isInteger(value))
            return tag.int(checkedInt32(value, "Bedrock block-entity integer"));
        return { type: "double", value };
    }
    if (value instanceof Uint8Array)
        return tag.byteArray([...value].map((item) => item > 127 ? item - 256 : item));
    if (Array.isArray(value)) {
        if (!value.length)
            return tag.list("end", []);
        if (value.every((item) => Number.isInteger(item) && item >= INT32_MIN && item <= INT32_MAX))
            return tag.intArray(value);
        const items = value.map(primitiveNbt);
        if (!items.every((item) => item.type === items[0].type))
            throw new Error("Bedrock block-entity NBT lists must use one homogeneous tag type.");
        return tag.list(items[0].type, items.map((item) => item.value));
    }
    if (value && typeof value === "object") {
        return tag.compound(Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== null && item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, primitiveNbt(item)])));
    }
    throw new Error("Bedrock block-entity NBT cannot contain null or undefined values.");
}
function permutationNbt(permutation) {
    return {
        name: tag.string(permutation.name),
        states: tag.compound(Object.fromEntries(Object.entries(permutation.states).map(([key, state]) => [key, {
                type: state.type,
                value: state.value,
            }]))),
        version: tag.int(permutation.version),
    };
}
function createTileNbt(origin, size, placements) {
    const volume = size.width * size.height * size.depth;
    const palette = [...new Map(placements.map(({ permutation }) => [permutation.canonical, permutation])).values()]
        .sort((left, right) => left.canonical.localeCompare(right.canonical));
    const paletteIndices = new Map(palette.map((entry, index) => [entry.canonical, index]));
    const primary = new Array(volume).fill(-1);
    const secondary = new Array(volume).fill(-1);
    const positionData = {};
    for (const { placement, permutation } of placements) {
        const x = placement.x - origin.x;
        const y = placement.y - origin.y;
        const z = placement.z - origin.z;
        const index = ((x * size.height) + y) * size.depth + z;
        primary[index] = paletteIndices.get(permutation.canonical);
        if (placement.blockEntity) {
            const data = Object.fromEntries(Object.entries(placement.blockEntity.data ?? {})
                .filter(([, value]) => value !== null && value !== undefined)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, value]) => [key, primitiveNbt(value)]));
            positionData[String(index)] = tag.compound({
                block_entity_data: tag.compound({
                    ...data,
                    id: tag.string(placement.blockEntity.id),
                    x: tag.int(placement.x),
                    y: tag.int(placement.y),
                    z: tag.int(placement.z),
                }),
            });
        }
    }
    const root = tag.compound({
        format_version: tag.int(1),
        size: tag.list("int", [size.width, size.height, size.depth]),
        structure: tag.compound({
            block_indices: tag.list("list", [
                { type: "int", value: primary },
                { type: "int", value: secondary },
            ]),
            entities: tag.list("end", []),
            palette: tag.compound({
                default: tag.compound({
                    block_palette: tag.list("compound", palette.map(permutationNbt)),
                    block_position_data: tag.compound(positionData),
                }),
            }),
        }),
        structure_world_origin: tag.list("int", [origin.x, origin.y, origin.z]),
    }, "");
    return { root, primary, secondary, palette };
}
export function createBedrockStructureTiles(build, options = {}) {
    const namespace = checkedNamespace(options.namespace);
    const tileDimensions = checkedDimensions(options.tileDimensions ?? DEFAULT_BEDROCK_TILE_DIMENSIONS);
    const bedrockVersion = resolvedVersion([build], options.bedrockVersion);
    validateBuild(build, bedrockVersion);
    const includeExplicitAir = options.includeExplicitAir ?? true;
    const tilePlacements = new Map();
    for (const placement of build.placements) {
        if (!includeExplicitAir && placement.block === "minecraft:air")
            continue;
        const tile = {
            x: Math.floor((placement.x - build.bounds.min.x) / tileDimensions.width),
            y: Math.floor((placement.y - build.bounds.min.y) / tileDimensions.height),
            z: Math.floor((placement.z - build.bounds.min.z) / tileDimensions.depth),
        };
        const key = `${tile.x},${tile.y},${tile.z}`;
        const group = tilePlacements.get(key) ?? { tile, placements: [] };
        group.placements.push({ placement, permutation: resolveBedrockBlockPermutation(placement, bedrockVersion) });
        tilePlacements.set(key, group);
    }
    if (!tilePlacements.size)
        throw new Error(`Build ${build.id} has no placements after applying the explicit-air policy.`);
    const buildName = `${safeSlug(build.input.name, "build")}_${sha256(`${build.id}\n${build.hash}`).slice(0, 10)}`;
    return [...tilePlacements.values()].sort((left, right) => left.tile.x - right.tile.x || left.tile.y - right.tile.y || left.tile.z - right.tile.z)
        .map(({ tile, placements }) => {
        const origin = {
            x: build.bounds.min.x + tile.x * tileDimensions.width,
            y: build.bounds.min.y + tile.y * tileDimensions.height,
            z: build.bounds.min.z + tile.z * tileDimensions.depth,
        };
        const size = {
            width: Math.min(tileDimensions.width, build.bounds.max.x - origin.x + 1),
            height: Math.min(tileDimensions.height, build.bounds.max.y - origin.y + 1),
            depth: Math.min(tileDimensions.depth, build.bounds.max.z - origin.z + 1),
        };
        const tileName = `${buildName}/x${tile.x}_y${tile.y}_z${tile.z}`;
        const structureId = `${namespace}:${tileName}`;
        const filePath = `structures/${namespace}/${tileName}.mcstructure`;
        const created = createTileNbt(origin, size, placements);
        const raw = writeUncompressed(created.root, "little");
        const bytes = new Uint8Array(raw);
        const explicitAirCount = placements.filter(({ placement }) => placement.block === "minecraft:air").length;
        return {
            buildId: build.id,
            buildHash: build.hash,
            structureId,
            filePath,
            origin,
            size,
            placementCount: placements.length,
            explicitAirCount,
            sparseCellCount: created.primary.filter((index) => index === -1).length,
            palette: created.palette,
            bytes,
            sha256: sha256(bytes),
        };
    });
}
function isBuildArray(source) {
    return Array.isArray(source);
}
function normalizeSource(source, options) {
    if (isBuildArray(source)) {
        return {
            builds: [...source],
            name: options.name ?? (source.length === 1 ? source[0].input.name : "Blockwright Bedrock Project"),
            description: options.description ?? "Deterministic Blockwright Bedrock structure project",
            packId: options.packId,
        };
    }
    if ("builds" in source) {
        if (source.schemaVersion !== undefined && source.schemaVersion !== 1)
            throw new Error("Bedrock pack project schemaVersion must be 1.");
        return {
            builds: [...source.builds],
            name: options.name ?? source.name,
            description: options.description ?? source.description ?? `Blockwright Bedrock structures for ${source.name}`,
            packId: options.packId ?? source.packId,
        };
    }
    return {
        builds: [source],
        name: options.name ?? source.input.name,
        description: options.description ?? `Blockwright Bedrock structures for ${source.input.name}`,
        packId: options.packId,
    };
}
function checkedManifestVersion(value) {
    const result = value ? [...value] : [1, 0, 0];
    if (result.length !== 3 || !result.every((item) => Number.isSafeInteger(item) && item >= 0 && item <= 65_535)) {
        throw new Error("Bedrock manifest version must contain three integers from 0 through 65,535.");
    }
    return result;
}
function engineVersion(value) {
    const values = value.split(".").map(Number);
    if (values.length !== 3 || !values.every((item) => Number.isSafeInteger(item) && item >= 0)) {
        throw new Error(`Bedrock registry version ${value} cannot be represented as min_engine_version.`);
    }
    return values;
}
function addText(files, path, value) {
    files.set(path, typeof value === "string" ? value : canonicalJson(value));
}
function fileRecords(files) {
    return [...files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({
        path,
        bytes: typeof content === "string" ? Buffer.byteLength(content) : content.byteLength,
        sha256: sha256(content),
    }));
}
function createFunctions(namespace, tiles, identity) {
    const suffix = sha256(identity).slice(0, 10);
    const objective = `bw${suffix}`;
    const activeTag = `bw_${suffix}_active`;
    const prefix = `functions/${namespace}`;
    const files = new Map();
    const loadFunctionIds = [];
    for (let index = 0; index < tiles.length; index += 1) {
        const stage = index + 1;
        const id = `${namespace}/internal/load_${String(stage).padStart(5, "0")}`;
        loadFunctionIds.push(id);
        const tile = tiles[index];
        const last = stage === tiles.length;
        files.set(`functions/${id}.mcfunction`, [
            `structure load ${tile.structureId} ${tile.origin.x} ${tile.origin.y} ${tile.origin.z}`,
            ...(last ? [
                `scoreboard players set @s ${objective} 0`,
                `tag @s remove ${activeTag}`,
                `tellraw @s {"rawtext":[{"text":"Blockwright installation complete: ${tiles.length} structure tiles loaded."}]}`,
            ] : [`scoreboard players add @s ${objective} 1`]),
        ].join("\n") + "\n");
    }
    const pageCount = Math.ceil(tiles.length / FUNCTION_PAGE_SIZE);
    const controller = [];
    // Descending pages and descending stages are both required: an increment at a page
    // boundary must not match a later command and load a second tile in the same tick.
    for (let page = pageCount - 1; page >= 0; page -= 1) {
        const first = page * FUNCTION_PAGE_SIZE + 1;
        const last = Math.min((page + 1) * FUNCTION_PAGE_SIZE, tiles.length);
        const pageId = `${namespace}/internal/page_${String(page + 1).padStart(4, "0")}`;
        controller.push(`execute if score @s ${objective} matches ${first}..${last} run function ${pageId}`);
        const lines = [];
        for (let stage = last; stage >= first; stage -= 1) {
            lines.push(`execute if score @s ${objective} matches ${stage} run function ${loadFunctionIds[stage - 1]}`);
        }
        files.set(`functions/${pageId}.mcfunction`, `${lines.join("\n")}\n`);
    }
    files.set(`${prefix}/controller.mcfunction`, `${controller.join("\n")}\n`);
    files.set(`${prefix}/tick.mcfunction`, `execute as @a[tag=${activeTag}] run function ${namespace}/controller\n`);
    files.set(`${prefix}/install.mcfunction`, [
        `scoreboard objectives add ${objective} dummy`,
        `scoreboard players set @s ${objective} 1`,
        `tag @s add ${activeTag}`,
        `tellraw @s {"rawtext":[{"text":"Blockwright installation started: ${tiles.length} structure tiles, one per tick. Stay online and keep the target area loaded."}]}`,
    ].join("\n") + "\n");
    files.set(`${prefix}/cancel.mcfunction`, [
        `tag @s remove ${activeTag}`,
        `scoreboard players set @s ${objective} 0`,
        `tellraw @s {"rawtext":[{"text":"Blockwright installation cancelled. Already placed tiles were not removed."}]}`,
    ].join("\n") + "\n");
    files.set(`${prefix}/status.mcfunction`, `tellraw @s {"rawtext":[{"text":"Blockwright next tile: "},{"score":{"name":"@s","objective":"${objective}"}},{"text":" of ${tiles.length}. Zero means idle or complete."}]}\n`);
    files.set(`${prefix}/cleanup.mcfunction`, [
        `tag @a remove ${activeTag}`,
        `scoreboard objectives remove ${objective}`,
        `tellraw @s {"rawtext":[{"text":"Blockwright scheduler state removed. Placed structures remain in the world."}]}`,
    ].join("\n") + "\n");
    files.set("functions/tick.json", canonicalJson({ values: [`${namespace}/tick`] }));
    return {
        files,
        functionIds: {
            install: `${namespace}/install`,
            cancel: `${namespace}/cancel`,
            status: `${namespace}/status`,
            cleanup: `${namespace}/cleanup`,
        },
    };
}
function instructionText(metadata) {
    const bounds = metadata.builds.map((build) => `${build.name}: ${build.bounds.min.x},${build.bounds.min.y},${build.bounds.min.z} to ${build.bounds.max.x},${build.bounds.max.y},${build.bounds.max.z}`).join("\n");
    return [
        `${metadata.pack.name} — Bedrock behavior pack`,
        `Exact validated block-state registry: Bedrock ${metadata.minecraft.resolvedVersion}`,
        "",
        "1. Open this .mcpack with Minecraft and activate the behavior pack on the intended world.",
        "2. Back up the world, enable cheats, and keep every target chunk loaded.",
        `3. As a player, run /function ${metadata.delivery.functions.install}`,
        `4. Check progress with /function ${metadata.delivery.functions.status}`,
        `5. Stop future tiles with /function ${metadata.delivery.functions.cancel}`,
        `6. After completion/cancellation, remove scheduler state with /function ${metadata.delivery.functions.cleanup}`,
        "",
        "Cancel and cleanup do not remove blocks already placed. There are no permanent ticking areas and no setblock command stream; one bounded .mcstructure tile is loaded per tick.",
        "If a target chunk is unloaded, Bedrock may reject that tile. Client import, activation, chunk-loading behavior, and performance on iPhone are not yet verified.",
        "",
        "Absolute build bounds:",
        bounds,
        "",
    ].join("\n");
}
export async function createBedrockMcpack(source, options = {}) {
    const normalized = normalizeSource(source, options);
    const builds = normalized.builds.sort((left, right) => left.bounds.min.x - right.bounds.min.x
        || left.bounds.min.y - right.bounds.min.y || left.bounds.min.z - right.bounds.min.z || left.id.localeCompare(right.id));
    const bedrockVersion = resolvedVersion(builds, options.bedrockVersion);
    validateBuildSet(builds, bedrockVersion);
    const namespace = checkedNamespace(options.namespace);
    const name = checkedText(normalized.name, "Bedrock pack name", 80);
    const description = checkedText(normalized.description, "Bedrock pack description", 256);
    const manifestVersion = checkedManifestVersion(options.manifestVersion);
    const defaultIdentity = `blockwright:${name}:${sha256(builds.map((build) => build.input.name).join("\n")).slice(0, 16)}`;
    const identity = checkedText(normalized.packId ?? defaultIdentity, "Bedrock pack id", 256);
    const headerUuid = deterministicUuid(`${identity}\nbehavior-header`);
    const moduleUuid = deterministicUuid(`${identity}\nbehavior-data-module`);
    const manifest = {
        format_version: 2,
        header: { name, description, uuid: headerUuid, version: manifestVersion, min_engine_version: engineVersion(bedrockVersion) },
        modules: [{ type: "data", uuid: moduleUuid, version: manifestVersion, description }],
    };
    const tiles = builds.flatMap((build) => createBedrockStructureTiles(build, {
        namespace,
        tileDimensions: options.tileDimensions,
        includeExplicitAir: options.includeExplicitAir,
        bedrockVersion,
    }));
    const functions = createFunctions(namespace, tiles, identity);
    const files = new Map();
    addText(files, "manifest.json", manifest);
    for (const [path, content] of functions.files)
        files.set(path, content);
    for (const tile of tiles)
        files.set(tile.filePath, tile.bytes);
    const buildMetadata = [];
    for (const build of builds) {
        const slug = `${safeSlug(build.input.name, "build")}_${sha256(`${build.id}\n${build.hash}`).slice(0, 10)}`;
        const buildPath = `blockwright/builds/${slug}.json`;
        const contractPath = `blockwright/contracts/${slug}.json`;
        const certificatePath = `blockwright/certificates/${slug}.json`;
        addText(files, buildPath, build);
        addText(files, contractPath, build.contract);
        addText(files, certificatePath, build.certificate);
        buildMetadata.push({
            id: build.id,
            hash: build.hash,
            name: build.input.name,
            createdAt: build.createdAt,
            origin: { ...build.bounds.min },
            bounds: canonicalize(build.bounds),
            placementCount: build.placements.length,
            buildPath,
            contractPath,
            certificatePath,
            tiles: tiles.filter((tile) => tile.buildId === build.id).map((tile) => ({
                structureId: tile.structureId,
                path: tile.filePath,
                origin: { ...tile.origin },
                size: { ...tile.size },
                placements: tile.placementCount,
                paletteSize: tile.palette.length,
                sha256: tile.sha256,
            })),
        });
    }
    const contentFiles = fileRecords(files);
    const contentDigestSha256 = sha256(contentFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n");
    const metadata = {
        schemaVersion: 1,
        format: "blockwright_bedrock_structure_pack",
        pack: { id: identity, name, description, namespace, manifestVersion, headerUuid, moduleUuid },
        minecraft: {
            edition: "bedrock",
            resolvedVersion: bedrockVersion,
            registry: "minecraft-data",
            requestedVersions: [...new Set(builds.map((build) => build.input.version))].sort(),
        },
        builds: buildMetadata,
        delivery: {
            mode: "one_structure_tile_per_tick",
            functions: functions.functionIds,
            tileCount: tiles.length,
            usesPermanentTickingAreas: false,
            iphoneRuntime: "unverified",
            limitations: [
                "Generated NBT and package structure are internally validated, but this pack has not been imported, activated, placed, and read back on an iPhone Bedrock client.",
                "Target chunks must remain loaded; a failed structure command cannot be transactionally rolled back by an mcfunction.",
                "Cancel and cleanup stop/remove scheduler state only; they do not remove already placed blocks.",
                "The current BuildRecord model has one block layer per coordinate, so co-located secondary-layer waterlogging is not represented.",
            ],
        },
        contentDigestSha256,
        contentFiles,
    };
    addText(files, "blockwright/project.json", metadata);
    files.set("HOW_TO_INSTALL.txt", instructionText(metadata));
    const checksums = fileRecords(files);
    const checksumsText = checksums.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
    files.set("blockwright/checksums.sha256", checksumsText);
    const allFiles = fileRecords(files);
    const zip = new JSZip();
    for (const [path, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        zip.file(path, content, { date: ZIP_DATE, createFolders: false });
    }
    const bytes = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
        platform: "DOS",
        streamFiles: false,
    });
    return {
        bytes,
        fileName: `${safeSlug(name, "blockwright-bedrock")}.mcpack`,
        manifest,
        metadata,
        tiles,
        files: allFiles,
        checksumsSha256: sha256(checksumsText),
        compatibility: { ...BEDROCK_STRUCTURE_COMPATIBILITY, registryVersion: bedrockVersion },
    };
}
//# sourceMappingURL=bedrock-structure.js.map