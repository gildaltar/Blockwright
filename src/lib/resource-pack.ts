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

export async function loadResourcePack(file: Blob & { name?: string }, placements: Placement[]): Promise<LoadedResourcePack> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const paths = Object.keys(archive.files);
  const assetsPath = paths.find((path) => path.includes("assets/"));
  const prefix = assetsPath ? assetsPath.slice(0, assetsPath.indexOf("assets/")) : "";
  const jsonCache = new Map<string, JsonObject | undefined>();
  const modelCache = new Map<string, ModelJson>();
  const objectUrls = new Map<string, string>();

  const getEntry = (path: string): JSZipObject | null => archive.file(`${prefix}${path}`) ?? archive.file(path);
  const readJson = async (path: string) => {
    if (jsonCache.has(path)) return jsonCache.get(path);
    const entry = getEntry(path);
    if (!entry) { jsonCache.set(path, undefined); return undefined; }
    try {
      const value = JSON.parse(await entry.async("string")) as JsonObject;
      jsonCache.set(path, value);
      return value;
    } catch {
      jsonCache.set(path, undefined);
      return undefined;
    }
  };
  const resolveModel = async (reference: string): Promise<ModelJson> => {
    if (modelCache.has(reference)) return modelCache.get(reference)!;
    const { namespace, path } = namespaced(reference);
    const model = (await readJson(`assets/${namespace}/models/${path}.json`) ?? {}) as ModelJson;
    const parent = model.parent ? await resolveModel(model.parent) : {};
    const merged = { ...parent, ...model, textures: { ...(parent.textures ?? {}), ...(model.textures ?? {}) } };
    modelCache.set(reference, merged);
    return merged;
  };
  const textureUrl = async (reference: string | undefined) => {
    if (!reference) return undefined;
    if (objectUrls.has(reference)) return objectUrls.get(reference);
    const { namespace, path } = namespaced(reference);
    const entry = getEntry(`assets/${namespace}/textures/${path}.png`);
    if (!entry) return undefined;
    const zippedBytes = await entry.async("uint8array");
    const bytes = new Uint8Array(zippedBytes.byteLength);
    bytes.set(zippedBytes);
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "image/png" }));
    objectUrls.set(reference, url);
    return url;
  };

  const requests = new Map<string, { block: string; state: Placement["state"] }>();
  for (const placement of placements) requests.set(placementTextureKey(placement.block, placement.state), { block: placement.block, state: placement.state });
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
}
