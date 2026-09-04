import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export const JAVA_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export function javaDataRoot() {
    return resolve(process.env.BLOCKWRIGHT_DATA_DIR || resolve(process.cwd(), "data", "java"));
}
function snapshotPath(version) {
    return resolve(javaDataRoot(), `${version}.registry.json`);
}
export function readJavaRegistry(version) {
    const path = snapshotPath(version);
    if (!existsSync(path))
        return undefined;
    try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        return value.schemaVersion === 1 && value.edition === "java" && value.version === version ? value : undefined;
    }
    catch {
        return undefined;
    }
}
export function listJavaRegistries() {
    const root = javaDataRoot();
    if (!existsSync(root))
        return [];
    return readdirSync(root)
        .filter((name) => name.endsWith(".registry.json"))
        .map((name) => readJavaRegistry(name.slice(0, -".registry.json".length)))
        .filter((value) => Boolean(value))
        .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime));
}
export function registryMetadata(version) {
    const snapshot = readJavaRegistry(version);
    if (!snapshot)
        return undefined;
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
//# sourceMappingURL=java-registry.js.map