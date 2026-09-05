import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { JAVA_MANIFEST_URL, javaDataRoot, listJavaRegistries } from "./java-registry.js";
const JSON_TIMEOUT_MS = 20_000;
const CLIENT_TIMEOUT_MS = 120_000;
const USER_AGENT = "Blockwright/version-synchronizer";
async function fetchOfficial(url, timeoutMs, request = fetch) {
    try {
        return await request(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    }
    catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            throw new Error(`Mojang request timed out after ${Math.round(timeoutMs / 1000)} seconds for ${url}.`);
        }
        throw error;
    }
}
async function fetchJson(url, request = fetch) {
    const response = await fetchOfficial(url, JSON_TIMEOUT_MS, request);
    if (!response.ok)
        throw new Error(`Mojang request failed (${response.status}) for ${url}`);
    return response.json();
}
export class JavaUpdateChecker {
    cached = new Map();
    inFlight = new Map();
    activeChecks = 0;
    request;
    cacheTtlMs;
    maximumConcurrentChecks;
    now;
    constructor(options = {}) {
        this.request = options.request ?? fetch;
        this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
        this.maximumConcurrentChecks = options.maximumConcurrentChecks ?? 1;
        this.now = options.now ?? Date.now;
        if (!Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 1
            || !Number.isSafeInteger(this.maximumConcurrentChecks) || this.maximumConcurrentChecks < 1) {
            throw new Error("Java update-check cache and concurrency limits must be positive safe integers.");
        }
    }
    async check(channel = "release") {
        const now = this.now();
        const cached = this.cached.get(channel);
        if (cached && cached.expiresAt > now)
            return cached.result;
        if (cached)
            this.cached.delete(channel);
        const existing = this.inFlight.get(channel);
        if (existing)
            return existing;
        if (this.activeChecks >= this.maximumConcurrentChecks) {
            throw new Error("JAVA_UPDATE_CHECK_BUSY: the shared Mojang update check is already at capacity.");
        }
        const pending = (async () => {
            this.activeChecks += 1;
            try {
                const manifest = await fetchJson(JAVA_MANIFEST_URL, this.request);
                const latestVersion = manifest.latest[channel];
                const installed = listJavaRegistries().map(({ version, type, releaseTime, syncedAt, blockCount, resourcePackVersion }) => ({ version, type, releaseTime, syncedAt, blockCount, resourcePackVersion }));
                const result = {
                    channel,
                    latestVersion,
                    latestRelease: manifest.latest.release,
                    latestSnapshot: manifest.latest.snapshot,
                    installed,
                    updateAvailable: !installed.some(({ version }) => version === latestVersion),
                    checkedAt: new Date(this.now()).toISOString(),
                    manifestUrl: JAVA_MANIFEST_URL,
                };
                this.cached.set(channel, { result, expiresAt: this.now() + this.cacheTtlMs });
                return result;
            }
            finally {
                this.activeChecks -= 1;
            }
        })();
        this.inFlight.set(channel, pending);
        try {
            return await pending;
        }
        finally {
            if (this.inFlight.get(channel) === pending)
                this.inFlight.delete(channel);
        }
    }
}
const javaUpdateChecker = new JavaUpdateChecker();
export function checkJavaUpdates(channel = "release") {
    return javaUpdateChecker.check(channel);
}
function displayName(id) {
    const path = id.split(":", 2)[1] ?? id;
    return path.split("_").map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
}
async function writeAtomic(path, bytes) {
    const temporary = `${path}.${process.pid}.${Date.now()}.partial`;
    const backup = `${path}.${process.pid}.${Date.now()}.backup`;
    let movedExisting = false;
    await writeFile(temporary, bytes);
    try {
        if (existsSync(path)) {
            await rename(path, backup);
            movedExisting = true;
        }
        await rename(temporary, path);
        if (movedExisting)
            await rm(backup, { force: true });
    }
    catch (error) {
        if (movedExisting && !existsSync(path) && existsSync(backup))
            await rename(backup, path);
        throw error;
    }
    finally {
        await rm(temporary, { force: true });
        if (existsSync(path))
            await rm(backup, { force: true });
    }
}
export async function syncJavaVersion(requestedVersion = "latest", includeTextures = true) {
    const manifest = await fetchJson(JAVA_MANIFEST_URL);
    const version = requestedVersion === "latest" ? manifest.latest.release : requestedVersion === "snapshot" ? manifest.latest.snapshot : requestedVersion;
    const entry = manifest.versions.find((candidate) => candidate.id === version);
    if (!entry)
        throw new Error(`Java ${version} is not present in Mojang's version manifest.`);
    const metadata = await fetchJson(entry.url);
    const clientResponse = await fetchOfficial(metadata.downloads.client.url, CLIENT_TIMEOUT_MS);
    if (!clientResponse.ok)
        throw new Error(`Official Java ${version} client download failed (${clientResponse.status}).`);
    const clientBytes = new Uint8Array(await clientResponse.arrayBuffer());
    const actualSha1 = createHash("sha1").update(clientBytes).digest("hex");
    if (actualSha1 !== metadata.downloads.client.sha1)
        throw new Error(`Java ${version} client SHA-1 mismatch; no files were written.`);
    const clientJar = await JSZip.loadAsync(clientBytes);
    const versionEntry = clientJar.file("version.json");
    if (!versionEntry)
        throw new Error(`Java ${version} client JAR does not contain version.json.`);
    const clientVersion = JSON.parse(await versionEntry.async("string"));
    const blockFiles = Object.keys(clientJar.files)
        .map((path) => ({ path, match: /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(path) }))
        .filter((item) => Boolean(item.match))
        .map(({ path, match }) => ({ id: `${match[1]}:${match[2]}`, displayName: displayName(`${match[1]}:${match[2]}`), blockstatePath: path }))
        .sort((a, b) => a.id.localeCompare(b.id));
    if (!blockFiles.length)
        throw new Error(`Java ${version} client JAR contained no blockstate registry assets.`);
    const snapshot = {
        schemaVersion: 1,
        edition: "java",
        version,
        type: metadata.type,
        releaseTime: metadata.releaseTime,
        syncedAt: new Date().toISOString(),
        source: "Mojang Java client JAR blockstate assets",
        sourceUrl: metadata.downloads.client.url,
        manifestUrl: JAVA_MANIFEST_URL,
        client: { sha1: actualSha1, size: clientBytes.byteLength },
        worldVersion: clientVersion.world_version,
        protocolVersion: clientVersion.protocol_version,
        resourcePackVersion: { major: clientVersion.pack_version.resource_major, minor: clientVersion.pack_version.resource_minor },
        dataPackVersion: { major: clientVersion.pack_version.data_major, minor: clientVersion.pack_version.data_minor },
        blockCount: blockFiles.length,
        blocks: blockFiles,
    };
    const root = javaDataRoot();
    await mkdir(root, { recursive: true });
    const registryPath = resolve(root, `${version}.registry.json`);
    await writeAtomic(registryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    let resourcePackPath;
    if (includeTextures) {
        const pack = new JSZip();
        pack.file("pack.mcmeta", JSON.stringify({ pack: { pack_format: snapshot.resourcePackVersion.major, supported_formats: { min_inclusive: snapshot.resourcePackVersion.major, max_inclusive: snapshot.resourcePackVersion.major }, description: `Blockwright local vanilla resources for Java ${version}` } }, null, 2));
        for (const [path, zipped] of Object.entries(clientJar.files)) {
            if (!/^assets\/[^/]+\/(blockstates|models\/block|textures\/block)\//.test(path) || zipped.dir)
                continue;
            pack.file(path, await zipped.async("uint8array"));
        }
        resourcePackPath = resolve(root, `${version}-vanilla-resources.zip`);
        await writeAtomic(resourcePackPath, await pack.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } }));
    }
    return { snapshot, registryPath, resourcePackPath };
}
//# sourceMappingURL=java-version-sync.js.map