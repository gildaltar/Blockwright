import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
export const HOSTED_PROJECT_STORAGE_LIMITS = Object.freeze({
    maxProjectsPerTenant: 25,
    maxVersionsPerProject: 100,
    maxVersionBytes: 64 * 1024 * 1024,
    maxTenantBytes: 512 * 1024 * 1024,
});
const PROJECT_ID = /^prj_[a-f0-9]{32}$/;
const VERSION_ID = /^ver_[a-f0-9]{32}$/;
const MAX_REVIEW_DECISIONS = 50;
const MAX_REVIEW_DECISION_BYTES = 64 * 1024;
function stableJson(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")}}`;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function tenantDigest(tenantId) {
    const value = tenantId.trim();
    if (!value || value.length > 256)
        throw new Error("A tenant identifier between 1 and 256 characters is required.");
    return sha256(`blockwright-tenant\0${value}`);
}
function cleanText(value, label, maximum) {
    const cleaned = value.trim().replace(/\s+/g, " ");
    if (!cleaned || cleaned.length > maximum)
        throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
    return cleaned;
}
function optionalText(value, label, maximum) {
    if (value === undefined)
        return undefined;
    return cleanText(value, label, maximum);
}
function assertProjectId(value) {
    if (!PROJECT_ID.test(value))
        throw new Error("Invalid project identifier.");
}
function assertVersionId(value) {
    if (!VERSION_ID.test(value))
        throw new Error("Invalid project version identifier.");
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function withoutTenant(manifest) {
    const { tenantDigest: _tenantDigest, ...summary } = manifest;
    return summary;
}
function canonicalState(placement) {
    const entries = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right));
    return entries.length
        ? `${placement.block}[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
        : placement.block;
}
function coordinateKey(placement) {
    return `${placement.x},${placement.y},${placement.z}`;
}
function placementOrder(left, right) {
    return left.y - right.y || left.z - right.z || left.x - right.x || canonicalState(left).localeCompare(canonicalState(right));
}
function coordinateOrder(left, right) {
    return left.y - right.y || left.z - right.z || left.x - right.x;
}
function assertCanonicalCoordinateOrder(placements) {
    for (let index = 1; index < placements.length; index += 1) {
        if (coordinateOrder(placements[index - 1], placements[index]) >= 0) {
            throw new Error("Stored project placements are not in unique canonical coordinate order.");
        }
    }
}
function materialCounts(build) {
    const result = {};
    for (const placement of build.placements) {
        const state = canonicalState(placement);
        result[state] = (result[state] ?? 0) + 1;
    }
    return result;
}
function assertPage(offset, limit) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
        throw new Error("Project page offset and limit must be positive safe integers.");
    }
}
function headSummary(version) {
    const { payload, tenantDigest: _tenantDigest, ...metadata } = version;
    return {
        ...metadata,
        buildId: payload.build.id,
        buildHash: payload.build.hash,
        blockCount: payload.build.placements.length,
        contractStatus: payload.build.contract.status,
    };
}
export function diffBuildRecords(before, after) {
    const beforeByPosition = new Map(before.placements.map((placement) => [coordinateKey(placement), placement]));
    const afterByPosition = new Map(after.placements.map((placement) => [coordinateKey(placement), placement]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, placement] of beforeByPosition) {
        const replacement = afterByPosition.get(key);
        if (!replacement)
            removed.push(cloneJson(placement));
        else if (stableJson(placement) !== stableJson(replacement)) {
            changed.push({
                coordinate: { x: placement.x, y: placement.y, z: placement.z },
                before: cloneJson(placement),
                after: cloneJson(replacement),
            });
        }
    }
    for (const [key, placement] of afterByPosition)
        if (!beforeByPosition.has(key))
            added.push(cloneJson(placement));
    const beforeMaterials = materialCounts(before);
    const afterMaterials = materialCounts(after);
    const materialDeltas = Object.fromEntries([...new Set([...Object.keys(beforeMaterials), ...Object.keys(afterMaterials)])]
        .sort()
        .map((state) => [state, (afterMaterials[state] ?? 0) - (beforeMaterials[state] ?? 0)])
        .filter(([, count]) => count !== 0));
    return {
        beforeHash: before.hash,
        afterHash: after.hash,
        added: added.sort(placementOrder),
        removed: removed.sort(placementOrder),
        changed: changed.sort((left, right) => placementOrder(left.before, right.before)),
        materialDeltas,
    };
}
export function defaultProjectRoot(env = process.env) {
    if (env.BLOCKWRIGHT_PROJECT_ROOT?.trim())
        return resolve(env.BLOCKWRIGHT_PROJECT_ROOT.trim());
    if (env.BLOCKWRIGHT_STATE_ROOT?.trim())
        return resolve(env.BLOCKWRIGHT_STATE_ROOT.trim(), "projects");
    if (process.platform === "win32" && env.LOCALAPPDATA?.trim())
        return resolve(env.LOCALAPPDATA.trim(), "Blockwright", "projects");
    if (env.XDG_DATA_HOME?.trim())
        return resolve(env.XDG_DATA_HOME.trim(), "blockwright", "projects");
    return resolve(homedir(), ".local", "share", "blockwright", "projects");
}
export class FileProjectStore {
    rootDirectory;
    now;
    dependentStores;
    limits;
    projectQueues = new Map();
    tenantQueues = new Map();
    constructor(options = {}) {
        this.rootDirectory = resolve(options.rootDirectory ?? defaultProjectRoot());
        this.now = options.now ?? (() => new Date());
        this.dependentStores = [...(options.dependentStores ?? [])];
        this.limits = options.limits ? { ...options.limits } : undefined;
        if (!isAbsolute(this.rootDirectory) || this.rootDirectory === parse(this.rootDirectory).root) {
            throw new Error("Project storage must be an absolute directory below the filesystem root.");
        }
        if (this.limits && !Object.values(this.limits).every((value) => Number.isSafeInteger(value) && value > 0)) {
            throw new Error("Project storage limits must be positive safe integers.");
        }
    }
    tenantDirectory(tenantId) {
        return join(this.rootDirectory, `tenant_${tenantDigest(tenantId)}`);
    }
    tenantMarkerPath(tenantId) {
        return join(this.tenantDirectory(tenantId), ".blockwright-tenant.json");
    }
    async assertOwnedTenantDirectory(tenantId) {
        const directory = this.tenantDirectory(tenantId);
        const info = await fs.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Tenant storage path is not an owned directory.");
        const marker = JSON.parse(await fs.readFile(this.tenantMarkerPath(tenantId), "utf8"));
        if (marker.schemaVersion !== 1 || marker.tenantDigest !== tenantDigest(tenantId))
            throw new Error("Tenant ownership marker validation failed.");
        const [realRoot, realDirectory] = await Promise.all([fs.realpath(this.rootDirectory), fs.realpath(directory)]);
        const traversal = relative(realRoot, realDirectory);
        if (!traversal || traversal.startsWith("..") || isAbsolute(traversal))
            throw new Error("Tenant storage resolves outside the configured Blockwright root.");
        return directory;
    }
    async ensureTenantDirectory(tenantId) {
        await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
        const directory = this.tenantDirectory(tenantId);
        try {
            await fs.mkdir(directory, { recursive: false, mode: 0o700 });
            await fs.writeFile(this.tenantMarkerPath(tenantId), `${JSON.stringify({ schemaVersion: 1, tenantDigest: tenantDigest(tenantId) }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        return this.assertOwnedTenantDirectory(tenantId);
    }
    projectDirectory(tenantId, projectId) {
        assertProjectId(projectId);
        const tenantDirectory = this.tenantDirectory(tenantId);
        const projectDirectory = resolve(tenantDirectory, projectId);
        const traversal = relative(tenantDirectory, projectDirectory);
        if (!traversal || traversal.startsWith("..") || isAbsolute(traversal))
            throw new Error("Unsafe project storage path.");
        return projectDirectory;
    }
    manifestPath(tenantId, projectId) {
        return join(this.projectDirectory(tenantId, projectId), "project.json");
    }
    markerPath(tenantId, projectId) {
        return join(this.projectDirectory(tenantId, projectId), ".blockwright-project.json");
    }
    versionPath(tenantId, projectId, versionId) {
        assertVersionId(versionId);
        return join(this.projectDirectory(tenantId, projectId), "versions", `${versionId}.json`);
    }
    versionMetadataPath(tenantId, projectId, versionId) {
        assertVersionId(versionId);
        return join(this.projectDirectory(tenantId, projectId), "versions", `${versionId}.meta`);
    }
    async withProjectQueue(tenantId, projectId, operation) {
        const key = `${tenantDigest(tenantId)}:${projectId}`;
        const previous = this.projectQueues.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolveGate) => { release = resolveGate; });
        const queued = previous.then(() => gate);
        this.projectQueues.set(key, queued);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (this.projectQueues.get(key) === queued)
                this.projectQueues.delete(key);
        }
    }
    async withTenantQueue(tenantId, operation) {
        const key = tenantDigest(tenantId);
        const previous = this.tenantQueues.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolveGate) => { release = resolveGate; });
        const queued = previous.then(() => gate);
        this.tenantQueues.set(key, queued);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (this.tenantQueues.get(key) === queued)
                this.tenantQueues.delete(key);
        }
    }
    async directoryBytes(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === "ENOENT")
                return 0;
            throw error;
        }
        let total = 0;
        for (const entry of entries) {
            const path = join(directory, entry.name);
            const info = await fs.lstat(path);
            if (info.isSymbolicLink())
                throw new Error("Project storage contains a symbolic link; refusing quota accounting.");
            total += info.isDirectory() ? await this.directoryBytes(path) : info.size;
        }
        return total;
    }
    async assertProjectCreationAllowed(tenantId) {
        if (!this.limits)
            return;
        const directory = this.tenantDirectory(tenantId);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const projects = entries.filter((entry) => entry.isDirectory() && PROJECT_ID.test(entry.name)).length;
        if (projects >= this.limits.maxProjectsPerTenant) {
            throw new Error(`PROJECT_QUOTA_EXCEEDED: this workspace is limited to ${this.limits.maxProjectsPerTenant} projects.`);
        }
    }
    async assertVersionStorageAllowed(tenantId, manifest, versionBytes) {
        if (!this.limits)
            return;
        if (manifest.versionCount >= this.limits.maxVersionsPerProject) {
            throw new Error(`VERSION_QUOTA_EXCEEDED: this project is limited to ${this.limits.maxVersionsPerProject} immutable versions.`);
        }
        if (versionBytes > this.limits.maxVersionBytes) {
            throw new Error(`VERSION_SIZE_EXCEEDED: an immutable version may use at most ${this.limits.maxVersionBytes.toLocaleString()} bytes.`);
        }
        const usedBytes = await this.directoryBytes(this.tenantDirectory(tenantId));
        if (usedBytes + versionBytes + 4_096 > this.limits.maxTenantBytes) {
            throw new Error(`WORKSPACE_STORAGE_QUOTA_EXCEEDED: this workspace is limited to ${this.limits.maxTenantBytes.toLocaleString()} stored bytes.`);
        }
    }
    async readManifest(tenantId, projectId) {
        const directory = this.projectDirectory(tenantId, projectId);
        try {
            await this.assertOwnedTenantDirectory(tenantId);
            const info = await fs.lstat(directory);
            if (!info.isDirectory() || info.isSymbolicLink())
                throw new Error("Project storage path is not an owned directory.");
            const marker = JSON.parse(await fs.readFile(this.markerPath(tenantId, projectId), "utf8"));
            if (marker.schemaVersion !== 1 || marker.projectId !== projectId || marker.tenantDigest !== tenantDigest(tenantId)) {
                throw new Error("Project ownership marker validation failed.");
            }
        }
        catch (error) {
            if (error.code === "ENOENT")
                throw new Error("Project not found.");
            throw error;
        }
        let manifest;
        try {
            manifest = JSON.parse(await fs.readFile(this.manifestPath(tenantId, projectId), "utf8"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                throw new Error("Project not found.");
            throw error;
        }
        if (manifest.id !== projectId || manifest.tenantDigest !== tenantDigest(tenantId) || manifest.private !== true) {
            throw new Error("Project tenant boundary validation failed.");
        }
        return manifest;
    }
    async writeManifest(path, manifest) {
        const temporary = join(dirname(path), `.project-${randomUUID()}.tmp`);
        await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        try {
            await fs.rename(temporary, path);
        }
        catch (error) {
            await fs.rm(temporary, { force: true });
            throw error;
        }
    }
    async createProject(input) {
        return this.withTenantQueue(input.tenantId, () => this.createProjectUnlocked(input));
    }
    async createProjectUnlocked(input) {
        const digest = tenantDigest(input.tenantId);
        const id = `prj_${randomBytes(16).toString("hex")}`;
        const createdAt = this.now().toISOString();
        const directory = this.projectDirectory(input.tenantId, id);
        const manifest = {
            schemaVersion: 1,
            id,
            tenantDigest: digest,
            name: cleanText(input.name, "Project name", 120),
            ...(optionalText(input.description, "Project description", 2_000) ? { description: optionalText(input.description, "Project description", 2_000) } : {}),
            private: true,
            createdAt,
            updatedAt: createdAt,
            versionCount: 0,
        };
        await this.ensureTenantDirectory(input.tenantId);
        await this.assertProjectCreationAllowed(input.tenantId);
        await fs.mkdir(directory, { recursive: false, mode: 0o700 });
        await fs.mkdir(join(directory, "versions"), { recursive: false, mode: 0o700 });
        try {
            await fs.writeFile(this.markerPath(input.tenantId, id), `${JSON.stringify({ schemaVersion: 1, projectId: id, tenantDigest: digest }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
            await fs.writeFile(this.manifestPath(input.tenantId, id), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
            if (input.initialVersion) {
                await this.saveVersionUnlocked({ tenantId: input.tenantId, projectId: id, payload: input.initialVersion, createdBy: input.createdBy });
            }
        }
        catch (error) {
            await fs.rm(directory, { recursive: true, force: true });
            throw error;
        }
        return this.getProject(input.tenantId, id);
    }
    async listProjects(tenantId) {
        const tenantDirectory = this.tenantDirectory(tenantId);
        let entries;
        try {
            await this.assertOwnedTenantDirectory(tenantId);
            entries = await fs.readdir(tenantDirectory, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
        const projects = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !PROJECT_ID.test(entry.name))
                continue;
            projects.push(withoutTenant(await this.readManifest(tenantId, entry.name)));
        }
        return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    }
    async getProjectSummary(tenantId, projectId) {
        return withoutTenant(await this.readManifest(tenantId, projectId));
    }
    async readVersionMetadata(manifest, tenantId, projectId, versionId) {
        try {
            const metadata = JSON.parse(await fs.readFile(this.versionMetadataPath(tenantId, projectId, versionId), "utf8"));
            if (metadata.projectId !== projectId || metadata.tenantDigest !== manifest.tenantDigest || metadata.id !== versionId || !/^[a-f0-9]{64}$/.test(metadata.contentHash)) {
                throw new Error("Project version metadata boundary validation failed.");
            }
            return cloneJson(metadata);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        const version = await this.readVersion(manifest, tenantId, projectId, versionId);
        const { payload: _payload, ...metadata } = version;
        try {
            await fs.writeFile(this.versionMetadataPath(tenantId, projectId, versionId), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        return cloneJson(metadata);
    }
    async getProject(tenantId, projectId) {
        const manifest = await this.readManifest(tenantId, projectId);
        const directory = join(this.projectDirectory(tenantId, projectId), "versions");
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const versions = [];
        const head = manifest.headVersionId ? await this.readVersion(manifest, tenantId, projectId, manifest.headVersionId) : undefined;
        for (const entry of entries) {
            const versionId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
            if (!entry.isFile() || !VERSION_ID.test(versionId))
                continue;
            versions.push(await this.readVersionMetadata(manifest, tenantId, projectId, versionId));
        }
        versions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
        if (manifest.versionCount !== versions.length || (manifest.headVersionId && !head))
            throw new Error("Project version history is inconsistent.");
        return {
            project: withoutTenant(manifest),
            ...(head ? { head: cloneJson(head) } : {}),
            versions: cloneJson(versions),
        };
    }
    async getProjectPage(tenantId, projectId, offset, limit) {
        assertPage(offset, limit);
        const manifest = await this.readManifest(tenantId, projectId);
        const directory = join(this.projectDirectory(tenantId, projectId), "versions");
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const versions = [];
        const head = manifest.headVersionId ? await this.readVersion(manifest, tenantId, projectId, manifest.headVersionId) : undefined;
        for (const entry of entries) {
            const versionId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
            if (!entry.isFile() || !VERSION_ID.test(versionId))
                continue;
            versions.push(await this.readVersionMetadata(manifest, tenantId, projectId, versionId));
        }
        versions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
        if (manifest.versionCount !== versions.length || (manifest.headVersionId && !head))
            throw new Error("Project version history is inconsistent.");
        const total = head?.payload.build.placements.length ?? 0;
        const items = head ? cloneJson(head.payload.build.placements.slice(offset, offset + limit)) : [];
        return {
            project: withoutTenant(manifest),
            ...(head ? { head: headSummary(head) } : {}),
            versions: versions.map(({ tenantDigest: _tenantDigest, ...metadata }) => cloneJson(metadata)),
            placements: { offset, limit, returned: items.length, total, items },
        };
    }
    async getVersion(tenantId, projectId, versionId) {
        const manifest = await this.readManifest(tenantId, projectId);
        return this.readVersion(manifest, tenantId, projectId, versionId);
    }
    async readVersion(manifest, tenantId, projectId, versionId) {
        let version;
        try {
            version = JSON.parse(await fs.readFile(this.versionPath(tenantId, projectId, versionId), "utf8"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                throw new Error("Project version not found.");
            throw error;
        }
        if (version.projectId !== projectId || version.tenantDigest !== manifest.tenantDigest || version.id !== versionId) {
            throw new Error("Project version tenant boundary validation failed.");
        }
        const { contentHash, ...hashBoundRecord } = version;
        if (sha256(stableJson(hashBoundRecord)) !== contentHash)
            throw new Error("Project version content integrity check failed.");
        return cloneJson(version);
    }
    async saveVersion(input) {
        return this.withTenantQueue(input.tenantId, () => this.withProjectQueue(input.tenantId, input.projectId, () => this.saveVersionUnlocked(input)));
    }
    async saveVersionUnlocked(input) {
        const manifest = await this.readManifest(input.tenantId, input.projectId);
        if (input.expectedHeadVersionId !== undefined && manifest.headVersionId !== input.expectedHeadVersionId) {
            throw new Error("Project head changed; reload before saving another version.");
        }
        const payload = cloneJson(input.payload);
        if (!payload.build?.hash || !Array.isArray(payload.build.placements))
            throw new Error("A complete hash-bound build record is required.");
        const versionWithoutHash = {
            schemaVersion: 1,
            id: `ver_${randomBytes(16).toString("hex")}`,
            projectId: input.projectId,
            tenantDigest: manifest.tenantDigest,
            ...(manifest.headVersionId ? { parentVersionId: manifest.headVersionId } : {}),
            ...(input.restoredFromVersionId ? { restoredFromVersionId: input.restoredFromVersionId } : {}),
            reason: input.reason ?? "manual",
            createdAt: this.now().toISOString(),
            ...(optionalText(input.createdBy, "Actor identifier", 256) ? { createdBy: optionalText(input.createdBy, "Actor identifier", 256) } : {}),
            payload,
        };
        const version = { ...versionWithoutHash, contentHash: sha256(stableJson(versionWithoutHash)) };
        if (input.restoredFromVersionId)
            assertVersionId(input.restoredFromVersionId);
        const path = this.versionPath(input.tenantId, input.projectId, version.id);
        const serialized = `${JSON.stringify(version, null, 2)}\n`;
        const { payload: _payload, ...metadata } = version;
        const metadataPath = this.versionMetadataPath(input.tenantId, input.projectId, version.id);
        const serializedMetadata = `${JSON.stringify(metadata, null, 2)}\n`;
        await this.assertVersionStorageAllowed(input.tenantId, manifest, Buffer.byteLength(serialized));
        await fs.writeFile(path, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
        try {
            await fs.writeFile(metadataPath, serializedMetadata, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        catch (error) {
            await fs.rm(path, { force: true });
            throw error;
        }
        const updated = {
            ...manifest,
            updatedAt: version.createdAt,
            headVersionId: version.id,
            versionCount: manifest.versionCount + 1,
        };
        try {
            await this.writeManifest(this.manifestPath(input.tenantId, input.projectId), updated);
        }
        catch (error) {
            await fs.rm(path, { force: true });
            await fs.rm(metadataPath, { force: true });
            throw error;
        }
        return cloneJson(version);
    }
    async autosave(input) {
        return this.saveVersion({ ...input, reason: "autosave" });
    }
    async compareVersions(tenantId, projectId, beforeVersionId, afterVersionId) {
        const [before, after] = await Promise.all([
            this.getVersion(tenantId, projectId, beforeVersionId),
            this.getVersion(tenantId, projectId, afterVersionId),
        ]);
        return {
            projectId,
            beforeVersionId,
            afterVersionId,
            ...diffBuildRecords(before.payload.build, after.payload.build),
            contractChanged: stableJson(before.payload.contract ?? before.payload.build.contract) !== stableJson(after.payload.contract ?? after.payload.build.contract),
            certificateChanged: stableJson(before.payload.certificate ?? before.payload.build.certificate) !== stableJson(after.payload.certificate ?? after.payload.build.certificate),
        };
    }
    async compareVersionsPage(tenantId, projectId, beforeVersionId, afterVersionId, offset, limit) {
        assertPage(offset, limit);
        const [before, after] = await Promise.all([
            this.getVersion(tenantId, projectId, beforeVersionId),
            this.getVersion(tenantId, projectId, afterVersionId),
        ]);
        const beforePlacements = before.payload.build.placements;
        const afterPlacements = after.payload.build.placements;
        assertCanonicalCoordinateOrder(beforePlacements);
        assertCanonicalCoordinateOrder(afterPlacements);
        const detailItems = [];
        let detailTotal = 0;
        let addedCount = 0;
        let removedCount = 0;
        let changedCount = 0;
        const recordDetail = (detail) => {
            if (detailTotal >= offset && detailItems.length < limit)
                detailItems.push(cloneJson(detail));
            detailTotal += 1;
        };
        let beforeIndex = 0;
        let afterIndex = 0;
        while (beforeIndex < beforePlacements.length || afterIndex < afterPlacements.length) {
            const beforePlacement = beforePlacements[beforeIndex];
            const afterPlacement = afterPlacements[afterIndex];
            if (beforePlacement === undefined) {
                addedCount += 1;
                recordDetail({ kind: "added", placement: afterPlacement });
                afterIndex += 1;
                continue;
            }
            if (afterPlacement === undefined) {
                removedCount += 1;
                recordDetail({ kind: "removed", placement: beforePlacement });
                beforeIndex += 1;
                continue;
            }
            const order = coordinateOrder(beforePlacement, afterPlacement);
            if (order < 0) {
                removedCount += 1;
                recordDetail({ kind: "removed", placement: beforePlacement });
                beforeIndex += 1;
            }
            else if (order > 0) {
                addedCount += 1;
                recordDetail({ kind: "added", placement: afterPlacement });
                afterIndex += 1;
            }
            else {
                if (stableJson(beforePlacement) !== stableJson(afterPlacement)) {
                    changedCount += 1;
                    recordDetail({
                        kind: "changed",
                        change: {
                            coordinate: { x: beforePlacement.x, y: beforePlacement.y, z: beforePlacement.z },
                            before: beforePlacement,
                            after: afterPlacement,
                        },
                    });
                }
                beforeIndex += 1;
                afterIndex += 1;
            }
        }
        const beforeMaterials = materialCounts(before.payload.build);
        const afterMaterials = materialCounts(after.payload.build);
        const materialDeltas = Object.fromEntries([...new Set([...Object.keys(beforeMaterials), ...Object.keys(afterMaterials)])]
            .sort()
            .map((state) => [state, (afterMaterials[state] ?? 0) - (beforeMaterials[state] ?? 0)])
            .filter(([, count]) => count !== 0));
        return {
            projectId,
            beforeVersionId,
            afterVersionId,
            beforeHash: before.payload.build.hash,
            afterHash: after.payload.build.hash,
            addedCount,
            removedCount,
            changedCount,
            materialDeltas,
            contractChanged: stableJson(before.payload.contract ?? before.payload.build.contract) !== stableJson(after.payload.contract ?? after.payload.build.contract),
            certificateChanged: stableJson(before.payload.certificate ?? before.payload.build.certificate) !== stableJson(after.payload.certificate ?? after.payload.build.certificate),
            detail: { offset, limit, returned: detailItems.length, total: detailTotal, items: detailItems },
        };
    }
    async restoreVersion(input) {
        const target = await this.getVersion(input.tenantId, input.projectId, input.versionId);
        const restored = await this.saveVersion({
            tenantId: input.tenantId,
            projectId: input.projectId,
            payload: target.payload,
            reason: "restore",
            createdBy: input.createdBy,
            expectedHeadVersionId: input.expectedHeadVersionId,
            restoredFromVersionId: target.id,
        });
        return restored;
    }
    async deleteProject(tenantId, projectId) {
        return this.withProjectQueue(tenantId, projectId, () => this.deleteProjectUnlocked(tenantId, projectId));
    }
    async deleteProjectUnlocked(tenantId, projectId) {
        const manifest = await this.readManifest(tenantId, projectId);
        const directory = this.projectDirectory(tenantId, projectId);
        let deletedDependentRecords = 0;
        for (const storage of this.dependentStores)
            deletedDependentRecords += await storage.deleteProjectData(tenantId, projectId);
        await fs.rm(directory, { recursive: true, force: false });
        return { deleted: true, projectId, deletedVersionCount: manifest.versionCount, deletedDependentRecords };
    }
    async deleteTenant(tenantId) {
        const directory = this.tenantDirectory(tenantId);
        let entries;
        try {
            await this.assertOwnedTenantDirectory(tenantId);
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === "ENOENT" || (error instanceof Error && error.message === "Project not found.")) {
                return { deleted: true, deletedProjects: 0, deletedVersions: 0, deletedDependentRecords: 0 };
            }
            throw error;
        }
        const unknown = entries.filter((entry) => entry.name !== ".blockwright-tenant.json" && !(entry.isDirectory() && PROJECT_ID.test(entry.name)));
        if (unknown.length)
            throw new Error(`Tenant storage contains unrecognized data (${unknown.map(({ name }) => name).join(", ")}); refusing broad deletion.`);
        const projects = await this.listProjects(tenantId);
        let deletedVersions = 0;
        let deletedDependentRecords = 0;
        for (const project of projects) {
            const result = await this.deleteProject(tenantId, project.id);
            deletedVersions += result.deletedVersionCount;
            deletedDependentRecords += result.deletedDependentRecords;
        }
        await fs.rm(this.tenantMarkerPath(tenantId), { force: false });
        const remaining = await fs.readdir(directory);
        if (remaining.length)
            throw new Error("Tenant storage is not empty after exact project cleanup.");
        await fs.rmdir(directory);
        return { deleted: true, deletedProjects: projects.length, deletedVersions, deletedDependentRecords };
    }
}
function reviewTokenHash(token, pepper) {
    return sha256(`${pepper}\0${token}`);
}
function assertHostedReviewConfig(config) {
    if (!config?.enabled || !config.storage || config.tokenPepper.length < 32) {
        throw new Error("HOSTED_REVIEW_UNAVAILABLE: secure hosted review storage is not configured.");
    }
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:")
        throw new Error("HOSTED_REVIEW_UNAVAILABLE: the hosted review base URL must use HTTPS.");
    return { ...config, baseUrl: url.toString().replace(/\/$/, ""), now: config.now ?? (() => new Date()) };
}
export function createHostedReviewService(config) {
    const ready = assertHostedReviewConfig(config);
    const active = (record) => !record.revokedAt && Date.parse(record.expiresAt) > ready.now().getTime();
    return {
        async create(input) {
            const expiresInSeconds = input.expiresInSeconds ?? 60 * 60 * 24 * 7;
            if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 60 * 60 * 24 * 30) {
                throw new Error("Review links must expire between 60 seconds and 30 days after creation.");
            }
            assertProjectId(input.projectId);
            assertVersionId(input.versionId);
            if (!/^[a-f0-9]{64}$/.test(input.buildHash))
                throw new Error("A valid build hash is required.");
            const token = randomBytes(32).toString("base64url");
            const createdAt = ready.now();
            const record = {
                schemaVersion: 1,
                id: `link_${randomBytes(16).toString("hex")}`,
                tenantId: cleanText(input.tenantId, "Tenant identifier", 256),
                projectId: input.projectId,
                versionId: input.versionId,
                buildHash: input.buildHash,
                tokenHash: reviewTokenHash(token, ready.tokenPepper),
                access: "read_only",
                createdBy: cleanText(input.createdBy, "Actor identifier", 256),
                createdAt: createdAt.toISOString(),
                expiresAt: new Date(createdAt.getTime() + expiresInSeconds * 1000).toISOString(),
                decisions: [],
            };
            await ready.storage.insert(cloneJson(record));
            return { id: record.id, url: `${ready.baseUrl}/assets/blockwright/index.html#review=${token}`, expiresAt: record.expiresAt, access: record.access };
        },
        async resolve(token) {
            if (!/^[A-Za-z0-9_-]{40,128}$/.test(token))
                throw new Error("Review link is invalid.");
            const record = await ready.storage.getByTokenHash(reviewTokenHash(token, ready.tokenPepper));
            if (!record || !active(record))
                throw new Error("Review link is unavailable, expired, or revoked.");
            return {
                id: record.id,
                tenantId: record.tenantId,
                projectId: record.projectId,
                versionId: record.versionId,
                buildHash: record.buildHash,
                access: record.access,
                expiresAt: record.expiresAt,
                decisions: cloneJson(record.decisions),
            };
        },
        async revoke(input) {
            const record = await ready.storage.getById(input.linkId);
            if (!record || record.tenantId !== input.tenantId)
                throw new Error("Review link not found for this tenant.");
            if (!record.revokedAt) {
                const expected = cloneJson(record);
                record.revokedAt = ready.now().toISOString();
                await ready.storage.update(cloneJson(record), expected);
            }
            return { revoked: true, id: record.id, revokedAt: record.revokedAt };
        },
        async recordDecision(input) {
            if (input.decision !== "approved" && input.decision !== "changes_requested")
                throw new Error("Unsupported review decision.");
            const record = await ready.storage.getByTokenHash(reviewTokenHash(input.token, ready.tokenPepper));
            if (!record || !active(record))
                throw new Error("Review link is unavailable, expired, or revoked.");
            if (record.decisions.length >= MAX_REVIEW_DECISIONS) {
                throw new Error(`REVIEW_DECISION_LIMIT_EXCEEDED: this link is limited to ${MAX_REVIEW_DECISIONS} decision events.`);
            }
            const event = {
                decision: input.decision,
                actorId: cleanText(input.actorId, "Reviewer identifier", 256),
                ...(optionalText(input.comment, "Review comment", 4_000) ? { comment: optionalText(input.comment, "Review comment", 4_000) } : {}),
                createdAt: ready.now().toISOString(),
            };
            if (Buffer.byteLength(JSON.stringify([...record.decisions, event])) > MAX_REVIEW_DECISION_BYTES) {
                throw new Error(`REVIEW_DECISION_SIZE_EXCEEDED: this link is limited to ${MAX_REVIEW_DECISION_BYTES.toLocaleString()} bytes of decision history.`);
            }
            const expected = cloneJson(record);
            record.decisions = [...record.decisions, event];
            await ready.storage.update(cloneJson(record), expected);
            return cloneJson(event);
        },
        async deleteProjectData(input) {
            assertProjectId(input.projectId);
            return ready.storage.deleteProjectData(input.tenantId, input.projectId);
        },
    };
}
//# sourceMappingURL=projects.js.map