import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { JAVA_MANIFEST_URL, javaDataRoot, listJavaRegistries } from "./java-registry.js";
async function fetchJson(url) {
    const response = await fetch(url, { headers: { "user-agent": "Blockwright/0.2 version synchronizer" } });
    if (!response.ok)
        throw new Error(`Mojang request failed (${response.status}) for ${url}`);
    return response.json();
}
export async function checkJavaUpdates(channel = "release") {
    const manifest = await fetchJson(JAVA_MANIFEST_URL);
    const latestVersion = manifest.latest[channel];
    const installed = listJavaRegistries().map(({ version, type, releaseTime, syncedAt, blockCount, resourcePackVersion }) => ({ version, type, releaseTime, syncedAt, blockCount, resourcePackVersion }));
    return {
        channel,
        latestVersion,
        latestRelease: manifest.latest.release,
        latestSnapshot: manifest.latest.snapshot,
        installed,
        updateAvailable: !installed.some(({ version }) => version === latestVersion),
        checkedAt: new Date().toISOString(),
        manifestUrl: JAVA_MANIFEST_URL,
    };
}
function displayName(id) {
    const path = id.split(":", 2)[1] ?? id;
    return path.split("_").map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
}
async function writeAtomic(path, bytes) {
    const temporary = `${path}.partial`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
}
export async function syncJavaVersion(requestedVersion = "latest", includeTextures = true) {
    const manifest = await fetchJson(JAVA_MANIFEST_URL);
    const version = requestedVersion === "latest" ? manifest.latest.release : requestedVersion === "snapshot" ? manifest.latest.snapshot : requestedVersion;
    const entry = manifest.versions.find((candidate) => candidate.id === version);
    if (!entry)
        throw new Error(`Java ${version} is not present in Mojang's version manifest.`);
    const metadata = await fetchJson(entry.url);
    const clientResponse = await fetch(metadata.downloads.client.url, { headers: { "user-agent": "Blockwright/0.2 version synchronizer" } });
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