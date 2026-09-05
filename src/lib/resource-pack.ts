import JSZip, { type JSZipObject } from "jszip";
import type { Placement } from "./types.js";

export type FaceTextures = {
  right: string;
  left: string;
  top: string;
  bottom: string;
  front: string;
  back: string;
};

export type LoadedResourcePack = {
  name: string;
  packFormat?: number;
  resolved: number;
  requested: number;
  textures: Map<string, FaceTextures>;
  dispose: () => void;
};

type JsonObject = Record<string, unknown>;
type ModelJson = { parent?: string; textures?: Record<string, string | { sprite?: string }> };

export type ResourcePackLimits = {
  maximumInputBytes?: number;
  maximumEntries?: number;
  maximumExpandedBytes?: number;
  maximumJsonBytes?: number;
  maximumTextureBytes?: number;
  maximumTextureDimension?: number;
  maximumTexturePixels?: number;
  maximumDecodedTexturePixels?: number;
  maximumTextureRequests?: number;
  maximumModelDepth?: number;
};

type SizedZipObject = JSZipObject & {
  _data?: { compressedSize?: number; uncompressedSize?: number };
};
type ZipStream = {
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipStream;
  on(event: "error", callback: (error: unknown) => void): ZipStream;
  on(event: "end", callback: () => void): ZipStream;
  pause(): void;
  resume(): void;
};
type StreamableZipObject = JSZipObject & { internalStream(type: "uint8array"): ZipStream };
type ExpandedByteBudget = { used: number; maximum: number };

const DEFAULT_RESOURCE_PACK_LIMITS = {
  maximumInputBytes: 64 * 1024 * 1024,
  maximumEntries: 20_000,
  maximumExpandedBytes: 256 * 1024 * 1024,
  maximumJsonBytes: 128 * 1024,
  maximumTextureBytes: 4 * 1024 * 1024,
  maximumTextureDimension: 2048,
  maximumTexturePixels: 4 * 1024 * 1024,
  maximumDecodedTexturePixels: 32 * 1024 * 1024,
  maximumTextureRequests: 512,
  maximumModelDepth: 64,
} as const;

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE = 0x05054b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_MAXIMUM_COMMENT_BYTES = 0xffff;

function zipMetadataError(detail: string): never {
  throw new Error(`Resource pack has invalid ZIP central-directory metadata: ${detail}.`);
}

function checkedZipRange(offset: number, length: number, boundary: number, label: string) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
    || offset > boundary || length > boundary - offset) {
    zipMetadataError(`${label} is outside the archive bounds`);
  }
  return offset + length;
}

function readZipUint64(view: DataView, offset: number, boundary: number, label: string) {
  checkedZipRange(offset, 8, boundary, label);
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (high > 0x1fffff) zipMetadataError(`${label} exceeds JavaScript's safe integer range`);
  const value = (high * 0x1_0000_0000) + low;
  if (!Number.isSafeInteger(value)) zipMetadataError(`${label} exceeds JavaScript's safe integer range`);
  return value;
}

function findZipEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
  if (bytes.byteLength < ZIP_END_OF_CENTRAL_DIRECTORY_BYTES) zipMetadataError("the end record is missing");
  const earliest = Math.max(0, bytes.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES - ZIP_MAXIMUM_COMMENT_BYTES);
  for (let offset = bytes.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_END_OF_CENTRAL_DIRECTORY_BYTES + commentLength === bytes.byteLength) return offset;
  }
  return zipMetadataError("the end record is missing or truncated");
}

/**
 * Validate and count the ZIP central directory before JSZip creates an object
 * for every entry. Resource packs are single-volume ZIP files; rejecting other
 * layouts also keeps JSZip's offset-recovery behavior outside this trust boundary.
 */
export function assertResourcePackZipDirectory(bytes: Uint8Array, maximumEntries: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEndOfCentralDirectory(bytes, view);
  let diskNumber = view.getUint16(endOffset + 4, true);
  let centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  let entriesOnDisk = view.getUint16(endOffset + 8, true);
  let declaredEntries = view.getUint16(endOffset + 10, true);
  let centralDirectorySize = view.getUint32(endOffset + 12, true);
  let centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  let centralDirectoryBoundary = endOffset;
  const needsZip64 = diskNumber === 0xffff || centralDirectoryDisk === 0xffff
    || entriesOnDisk === 0xffff || declaredEntries === 0xffff
    || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff;

  if (needsZip64) {
    const locatorOffset = endOffset - 20;
    if (locatorOffset < 0 || view.getUint32(locatorOffset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR) {
      zipMetadataError("the ZIP64 locator is missing");
    }
    const zip64Disk = view.getUint32(locatorOffset + 4, true);
    const zip64EndOffset = readZipUint64(view, locatorOffset + 8, endOffset, "the ZIP64 end-record offset");
    const diskCount = view.getUint32(locatorOffset + 16, true);
    if (zip64Disk !== 0 || diskCount !== 1) zipMetadataError("multi-volume archives are not supported");
    checkedZipRange(zip64EndOffset, 56, locatorOffset, "the ZIP64 end record");
    if (view.getUint32(zip64EndOffset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
      zipMetadataError("the ZIP64 end-record signature is missing");
    }
    const zip64RecordSize = readZipUint64(view, zip64EndOffset + 4, locatorOffset, "the ZIP64 end-record size");
    if (zip64RecordSize < 44) zipMetadataError("the ZIP64 end record is too short");
    if (checkedZipRange(zip64EndOffset, 12 + zip64RecordSize, locatorOffset, "the ZIP64 end record") !== locatorOffset) {
      zipMetadataError("the ZIP64 end record does not meet its locator");
    }
    diskNumber = view.getUint32(zip64EndOffset + 16, true);
    centralDirectoryDisk = view.getUint32(zip64EndOffset + 20, true);
    entriesOnDisk = readZipUint64(view, zip64EndOffset + 24, locatorOffset, "the ZIP64 per-disk entry count");
    declaredEntries = readZipUint64(view, zip64EndOffset + 32, locatorOffset, "the ZIP64 entry count");
    centralDirectorySize = readZipUint64(view, zip64EndOffset + 40, locatorOffset, "the ZIP64 central-directory size");
    centralDirectoryOffset = readZipUint64(view, zip64EndOffset + 48, locatorOffset, "the ZIP64 central-directory offset");
    centralDirectoryBoundary = zip64EndOffset;
  }

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== declaredEntries) {
    zipMetadataError("multi-volume or inconsistent entry counts are not supported");
  }
  if (declaredEntries > maximumEntries) {
    throw new Error(`Resource pack exceeds the configured ${maximumEntries.toLocaleString()}-entry limit.`);
  }
  const centralDirectoryEnd = checkedZipRange(
    centralDirectoryOffset,
    centralDirectorySize,
    centralDirectoryBoundary,
    "the central directory",
  );
  if (centralDirectoryEnd !== centralDirectoryBoundary) {
    zipMetadataError("the central directory does not meet the end metadata");
  }

  let cursor = centralDirectoryOffset;
  let countedEntries = 0;
  while (cursor < centralDirectoryEnd) {
    checkedZipRange(cursor, 4, centralDirectoryEnd, "a central-directory record");
    const signature = view.getUint32(cursor, true);
    if (signature === ZIP_CENTRAL_DIRECTORY_ENTRY) {
      checkedZipRange(cursor, 46, centralDirectoryEnd, "a central-directory entry");
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      cursor = checkedZipRange(cursor, 46 + nameLength + extraLength + commentLength, centralDirectoryEnd, "a central-directory entry");
      countedEntries += 1;
      if (countedEntries > maximumEntries) {
        throw new Error(`Resource pack exceeds the configured ${maximumEntries.toLocaleString()}-entry limit.`);
      }
      continue;
    }
    if (signature === ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE) {
      checkedZipRange(cursor, 6, centralDirectoryEnd, "the central-directory digital signature");
      const signatureLength = view.getUint16(cursor + 4, true);
      cursor = checkedZipRange(cursor, 6 + signatureLength, centralDirectoryEnd, "the central-directory digital signature");
      if (cursor !== centralDirectoryEnd) zipMetadataError("the central-directory digital signature is not last");
      continue;
    }
    zipMetadataError("an unexpected central-directory record was found");
  }
  if (countedEntries !== declaredEntries) zipMetadataError("the declared and actual entry counts differ");
}

function positiveLimit(value: number | undefined, fallback: number, label: string) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive safe integer.`);
  return result;
}

function declaredExpandedBytes(entry: JSZipObject) {
  const size = (entry as SizedZipObject)._data?.uncompressedSize;
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function readEntryBounded(entry: JSZipObject, maximumBytes: number, aggregate: ExpandedByteBudget, label: string): Promise<Uint8Array> {
  return new Promise((resolveEntry, rejectEntry) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (entry as StreamableZipObject).internalStream("uint8array");
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      rejectEntry(error instanceof Error ? error : new Error(String(error)));
    };
    stream.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      total += chunk.byteLength;
      if (!Number.isSafeInteger(total) || total > maximumBytes) {
        fail(new Error(`${label} exceeds the configured ${maximumBytes}-byte expanded limit.`));
        return;
      }
      aggregate.used += chunk.byteLength;
      if (!Number.isSafeInteger(aggregate.used) || aggregate.used > aggregate.maximum) {
        fail(new Error(`Resource pack exceeds the configured ${aggregate.maximum}-byte aggregate expanded limit.`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      resolveEntry(result);
    });
    stream.resume();
  });
}

function assertPngDimensions(bytes: Uint8Array, reference: string, maximumDimension: number, maximumPixels: number) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
    throw new Error(`Resource-pack texture is not a valid PNG header: ${reference}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const pixels = width * height;
  if (!width || !height || width > maximumDimension || height > maximumDimension || !Number.isSafeInteger(pixels) || pixels > maximumPixels) {
    throw new Error(`Resource-pack texture dimensions exceed the configured ${maximumDimension}px/${maximumPixels.toLocaleString()}-pixel limit: ${reference}`);
  }
  return pixels;
}

export function placementTextureKey(block: string, state: Placement["state"] = {}) {
  const normalized = Object.entries(state ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return `${block}|${normalized.map(([key, value]) => `${key}=${String(value)}`).join(",")}`;
}

function namespaced(ref: string, fallbackNamespace = "minecraft") {
  const separator = ref.indexOf(":");
  return separator < 0 ? { namespace: fallbackNamespace, path: ref } : { namespace: ref.slice(0, separator), path: ref.slice(separator + 1) };
}

function asModelChoice(value: unknown): JsonObject | undefined {
  const choice = Array.isArray(value) ? value[0] : value;
  return choice && typeof choice === "object" ? choice as JsonObject : undefined;
}

function variantMatches(key: string, state: Placement["state"]) {
  if (!state || !key) return true;
  const values = Object.fromEntries(key.split(",").filter(Boolean).map((part) => part.split("=", 2)));
  return Object.entries(state).every(([name, value]) => values[name] === undefined || values[name] === String(value));
}

export function chooseModelReference(blockstate: JsonObject | undefined, state: Placement["state"]): string | undefined {
  if (!blockstate) return undefined;
  const variants = blockstate.variants && typeof blockstate.variants === "object" ? blockstate.variants as Record<string, unknown> : undefined;
  if (variants) {
    const entries = Object.entries(variants);
    const selected = entries.find(([key]) => variantMatches(key, state)) ?? entries[0];
    const choice = selected ? asModelChoice(selected[1]) : undefined;
    return typeof choice?.model === "string" ? choice.model : undefined;
  }
  const multipart = Array.isArray(blockstate.multipart) ? blockstate.multipart : [];
  const choice = asModelChoice((multipart[0] as JsonObject | undefined)?.apply);
  return typeof choice?.model === "string" ? choice.model : undefined;
}

function textureValue(value: string | { sprite?: string } | undefined) {
  return typeof value === "string" ? value : value?.sprite;
}

function dereference(key: string, textures: ModelJson["textures"]) {
  let value = textureValue(textures?.[key]);
  const visited = new Set<string>();
  while (value?.startsWith("#") && !visited.has(value)) {
    visited.add(value);
    value = textureValue(textures?.[value.slice(1)]);
  }
  return value;
}

function firstTexture(textures: ModelJson["textures"], keys: string[]) {
  for (const key of keys) {
    const value = dereference(key, textures);
    if (value && !value.startsWith("#")) return value;
  }
  for (const key of Object.keys(textures ?? {})) {
    const value = dereference(key, textures);
    if (value && !value.startsWith("#")) return value;
  }
  return undefined;
}

export async function loadResourcePack(
  file: Blob & { name?: string },
  placements: Placement[],
  configuredLimits: ResourcePackLimits = {},
): Promise<LoadedResourcePack> {
  const limits = {
    maximumInputBytes: positiveLimit(configuredLimits.maximumInputBytes, DEFAULT_RESOURCE_PACK_LIMITS.maximumInputBytes, "Resource-pack input limit"),
    maximumEntries: positiveLimit(configuredLimits.maximumEntries, DEFAULT_RESOURCE_PACK_LIMITS.maximumEntries, "Resource-pack entry limit"),
    maximumExpandedBytes: positiveLimit(configuredLimits.maximumExpandedBytes, DEFAULT_RESOURCE_PACK_LIMITS.maximumExpandedBytes, "Resource-pack expanded-byte limit"),
    maximumJsonBytes: positiveLimit(configuredLimits.maximumJsonBytes, DEFAULT_RESOURCE_PACK_LIMITS.maximumJsonBytes, "Resource-pack JSON limit"),
    maximumTextureBytes: positiveLimit(configuredLimits.maximumTextureBytes, DEFAULT_RESOURCE_PACK_LIMITS.maximumTextureBytes, "Resource-pack texture limit"),
    maximumTextureDimension: positiveLimit(configuredLimits.maximumTextureDimension, DEFAULT_RESOURCE_PACK_LIMITS.maximumTextureDimension, "Resource-pack texture-dimension limit"),
    maximumTexturePixels: positiveLimit(configuredLimits.maximumTexturePixels, DEFAULT_RESOURCE_PACK_LIMITS.maximumTexturePixels, "Resource-pack texture-pixel limit"),
    maximumDecodedTexturePixels: positiveLimit(configuredLimits.maximumDecodedTexturePixels, DEFAULT_RESOURCE_PACK_LIMITS.maximumDecodedTexturePixels, "Resource-pack decoded-texture-pixel limit"),
    maximumTextureRequests: positiveLimit(configuredLimits.maximumTextureRequests, DEFAULT_RESOURCE_PACK_LIMITS.maximumTextureRequests, "Resource-pack texture-request limit"),
    maximumModelDepth: positiveLimit(configuredLimits.maximumModelDepth, DEFAULT_RESOURCE_PACK_LIMITS.maximumModelDepth, "Resource-pack model-depth limit"),
  };
  if (file.size > limits.maximumInputBytes) throw new Error(`Resource pack exceeds the configured ${limits.maximumInputBytes}-byte input limit.`);
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  assertResourcePackZipDirectory(archiveBytes, limits.maximumEntries);
  const archive = await JSZip.loadAsync(archiveBytes);
  const paths = Object.keys(archive.files);
  if (paths.length > limits.maximumEntries) throw new Error(`Resource pack exceeds the configured ${limits.maximumEntries.toLocaleString()}-entry limit.`);
  let declaredExpandedTotal = 0;
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const size = declaredExpandedBytes(entry);
    if (size === undefined) throw new Error("Resource pack contains an entry without trustworthy expanded-size metadata.");
    declaredExpandedTotal += size;
    if (!Number.isSafeInteger(declaredExpandedTotal) || declaredExpandedTotal > limits.maximumExpandedBytes) {
      throw new Error(`Resource pack exceeds the configured ${limits.maximumExpandedBytes}-byte expanded limit.`);
    }
  }
  const assetsPath = paths.find((path) => path.includes("assets/"));
  const prefix = assetsPath ? assetsPath.slice(0, assetsPath.indexOf("assets/")) : "";
  const jsonCache = new Map<string, JsonObject | undefined>();
  const modelCache = new Map<string, ModelJson>();
  const objectUrls = new Map<string, string>();
  const textureLoads = new Map<string, Promise<string | undefined>>();
  const expandedBudget: ExpandedByteBudget = { used: 0, maximum: limits.maximumExpandedBytes };
  let decodedTexturePixels = 0;

  const getEntry = (path: string): JSZipObject | null => archive.file(`${prefix}${path}`) ?? archive.file(path);
  const readJson = async (path: string) => {
    if (jsonCache.has(path)) return jsonCache.get(path);
    const entry = getEntry(path);
    if (!entry) { jsonCache.set(path, undefined); return undefined; }
    const declaredSize = declaredExpandedBytes(entry);
    if (declaredSize === undefined || declaredSize > limits.maximumJsonBytes) throw new Error(`Resource-pack JSON exceeds the configured ${limits.maximumJsonBytes}-byte limit: ${path}`);
    const bytes = await readEntryBounded(entry, limits.maximumJsonBytes, expandedBudget, `Resource-pack JSON ${path}`);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(`Resource-pack JSON is not valid UTF-8: ${path}`); }
    try {
      const value = JSON.parse(content) as JsonObject;
      jsonCache.set(path, value);
      return value;
    } catch {
      jsonCache.set(path, undefined);
      return undefined;
    }
  };
  const resolvingModels = new Set<string>();
  const resolveModel = async (reference: string, depth = 0): Promise<ModelJson> => {
    if (modelCache.has(reference)) return modelCache.get(reference)!;
    if (resolvingModels.has(reference)) throw new Error(`Resource-pack model inheritance cycle detected at ${reference}.`);
    if (depth >= limits.maximumModelDepth) throw new Error(`Resource-pack model inheritance exceeds ${limits.maximumModelDepth} levels.`);
    resolvingModels.add(reference);
    const { namespace, path } = namespaced(reference);
    try {
      const model = (await readJson(`assets/${namespace}/models/${path}.json`) ?? {}) as ModelJson;
      const parent = model.parent ? await resolveModel(model.parent, depth + 1) : {};
      const merged = { ...parent, ...model, textures: { ...(parent.textures ?? {}), ...(model.textures ?? {}) } };
      modelCache.set(reference, merged);
      return merged;
    } finally {
      resolvingModels.delete(reference);
    }
  };
  const textureUrl = async (reference: string | undefined) => {
    if (!reference) return undefined;
    if (objectUrls.has(reference)) return objectUrls.get(reference);
    const existing = textureLoads.get(reference);
    if (existing) return existing;
    const pending = (async () => {
      const { namespace, path } = namespaced(reference);
      const entry = getEntry(`assets/${namespace}/textures/${path}.png`);
      if (!entry) return undefined;
      const declaredSize = declaredExpandedBytes(entry);
      if (declaredSize === undefined || declaredSize > limits.maximumTextureBytes) throw new Error(`Resource-pack texture exceeds the configured ${limits.maximumTextureBytes}-byte limit: ${reference}`);
      const zippedBytes = await readEntryBounded(entry, limits.maximumTextureBytes, expandedBudget, `Resource-pack texture ${reference}`);
      const pixels = assertPngDimensions(zippedBytes, reference, limits.maximumTextureDimension, limits.maximumTexturePixels);
      decodedTexturePixels += pixels;
      if (!Number.isSafeInteger(decodedTexturePixels) || decodedTexturePixels > limits.maximumDecodedTexturePixels) {
        throw new Error(`Resource-pack textures exceed the configured ${limits.maximumDecodedTexturePixels.toLocaleString()}-pixel aggregate decoded limit.`);
      }
      const bytes = new Uint8Array(zippedBytes.byteLength);
      bytes.set(zippedBytes);
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "image/png" }));
      objectUrls.set(reference, url);
      return url;
    })();
    textureLoads.set(reference, pending);
    try {
      return await pending;
    } finally {
      textureLoads.delete(reference);
    }
  };

  try {
  const requests = new Map<string, { block: string; state: Placement["state"] }>();
  for (const placement of placements) requests.set(placementTextureKey(placement.block, placement.state), { block: placement.block, state: placement.state });
  if (requests.size > limits.maximumTextureRequests) throw new Error(`Resource pack preview exceeds the configured ${limits.maximumTextureRequests.toLocaleString()} unique block-state limit.`);
  const textures = new Map<string, FaceTextures>();
  for (const [key, request] of requests) {
    const { namespace, path } = namespaced(request.block);
    const blockstate = await readJson(`assets/${namespace}/blockstates/${path}.json`);
    const modelReference = chooseModelReference(blockstate, request.state) ?? `${namespace}:block/${path}`;
    const model = await resolveModel(modelReference);
    const side = firstTexture(model.textures, ["side", "all", "texture", "pane", "particle"]);
    const top = firstTexture(model.textures, ["top", "end", "all", "side", "particle"]);
    const bottom = firstTexture(model.textures, ["bottom", "end", "all", "side", "particle"]);
    const front = firstTexture(model.textures, ["front", "side", "all", "pane", "particle"]);
    const back = firstTexture(model.textures, ["back", "side", "all", "pane", "particle"]);
    const [rightUrl, leftUrl, topUrl, bottomUrl, frontUrl, backUrl] = await Promise.all([
      textureUrl(side), textureUrl(side), textureUrl(top), textureUrl(bottom), textureUrl(front), textureUrl(back),
    ]);
    const fallback = rightUrl ?? topUrl ?? frontUrl;
    if (!fallback) continue;
    textures.set(key, {
      right: rightUrl ?? fallback,
      left: leftUrl ?? fallback,
      top: topUrl ?? fallback,
      bottom: bottomUrl ?? fallback,
      front: frontUrl ?? fallback,
      back: backUrl ?? fallback,
    });
  }

  const metadata = await readJson("pack.mcmeta");
  const pack = metadata?.pack && typeof metadata.pack === "object" ? metadata.pack as JsonObject : undefined;
  return {
    name: file.name || "Local resource pack",
    packFormat: typeof pack?.pack_format === "number" ? pack.pack_format : undefined,
    resolved: textures.size,
    requested: requests.size,
    textures,
    dispose: () => { for (const url of objectUrls.values()) URL.revokeObjectURL(url); },
  };
  } catch (error) {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    throw error;
  }
}
