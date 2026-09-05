import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export type JavaBlockRecord = {
  id: string;
  displayName: string;
  blockstatePath: string;
};

export type JavaRegistrySnapshot = {
  schemaVersion: 1;
  edition: "java";
  version: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  releaseTime: string;
  syncedAt: string;
  source: "Mojang Java client JAR blockstate assets";
  sourceUrl: string;
  manifestUrl: string;
  client: { sha1: string; size: number };
  worldVersion: number;
  protocolVersion: number;
  resourcePackVersion: { major: number; minor: number };
  dataPackVersion: { major: number; minor: number };
  blockCount: number;
  blocks: JavaBlockRecord[];
};

export const JAVA_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function isValidJavaRegistrySnapshot(value: unknown, expectedVersion: string): value is JavaRegistrySnapshot {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.edition !== "java"
    || value.version !== expectedVersion
    || !["release", "snapshot", "old_beta", "old_alpha"].includes(String(value.type))
    || typeof value.releaseTime !== "string" || Number.isNaN(Date.parse(value.releaseTime))
    || typeof value.syncedAt !== "string" || Number.isNaN(Date.parse(value.syncedAt))
    || value.source !== "Mojang Java client JAR blockstate assets"
    || typeof value.sourceUrl !== "string" || !value.sourceUrl.startsWith("https://")
    || typeof value.manifestUrl !== "string" || !value.manifestUrl.startsWith("https://")
    || !isRecord(value.client)
    || typeof value.client.sha1 !== "string" || !/^[a-f0-9]{40}$/i.test(value.client.sha1)
    || !Number.isInteger(value.client.size) || Number(value.client.size) <= 0
    || !isNonNegativeInteger(value.worldVersion)
    || !isNonNegativeInteger(value.protocolVersion)
    || !isRecord(value.resourcePackVersion)
    || !isNonNegativeInteger(value.resourcePackVersion.major)
    || !isNonNegativeInteger(value.resourcePackVersion.minor)
    || !isRecord(value.dataPackVersion)
    || !isNonNegativeInteger(value.dataPackVersion.major)
    || !isNonNegativeInteger(value.dataPackVersion.minor)
    || !isNonNegativeInteger(value.blockCount)
    || !Array.isArray(value.blocks)
    || value.blocks.length === 0
    || value.blockCount !== value.blocks.length) return false;

  const ids = new Set<string>();
  for (const block of value.blocks) {
    if (!isRecord(block)
      || typeof block.id !== "string" || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(block.id)
      || typeof block.displayName !== "string" || !block.displayName.trim()
      || typeof block.blockstatePath !== "string"
      || !/^assets\/minecraft\/blockstates\/[a-z0-9_./-]+\.json$/.test(block.blockstatePath)
      || ids.has(block.id)) return false;
    ids.add(block.id);
  }
  return true;
}

export function javaDataRoot() {
  return resolve(process.env.BLOCKWRIGHT_DATA_DIR || resolve(process.cwd(), "data", "java"));
}
function snapshotPath(version: string) {
  return resolve(javaDataRoot(), `${version}.registry.json`);
}

export function readJavaRegistry(version: string): JavaRegistrySnapshot | undefined {
  const path = snapshotPath(version);
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isValidJavaRegistrySnapshot(value, version) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function listJavaRegistries(): JavaRegistrySnapshot[] {
  const root = javaDataRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(".registry.json"))
    .map((name) => readJavaRegistry(name.slice(0, -".registry.json".length)))
    .filter((value): value is JavaRegistrySnapshot => Boolean(value))
    .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime));
}

export function registryMetadata(version: string) {
  const snapshot = readJavaRegistry(version);
  if (!snapshot) return undefined;
  return {
    requestedVersion: version,
    coverageVersion: version,
    source: snapshot.source,
    sourceUrl: snapshot.sourceUrl,
    syncedAt: snapshot.syncedAt,
    clientSha1: snapshot.client.sha1,
    blockCount: snapshot.blockCount,
    protocolVersion: snapshot.protocolVersion,
    worldVersion: snapshot.worldVersion,
    resourcePackVersion: snapshot.resourcePackVersion,
  };
}
