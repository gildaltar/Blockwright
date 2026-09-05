import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import type { BuildRecord, Placement } from "./types.js";

export type ProjectVersionReason = "manual" | "autosave" | "restore" | "region_revision";

export type ProjectVersionPayload = {
  build: BuildRecord;
  contract?: unknown;
  certificate?: unknown;
  review?: unknown;
  metadata?: Record<string, unknown>;
};

export type ProjectVersion = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  tenantDigest: string;
  parentVersionId?: string;
  restoredFromVersionId?: string;
  reason: ProjectVersionReason;
  createdAt: string;
  createdBy?: string;
  contentHash: string;
  payload: ProjectVersionPayload;
};

export type ProjectSummary = {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  private: true;
  createdAt: string;
  updatedAt: string;
  headVersionId?: string;
  versionCount: number;
};

type StoredProjectManifest = ProjectSummary & { tenantDigest: string };

export type ProjectSnapshot = {
  project: ProjectSummary;
  head?: ProjectVersion;
  versions: Omit<ProjectVersion, "payload">[];
};

export type PlacementChange = {
  coordinate: { x: number; y: number; z: number };
  before: Placement;
  after: Placement;
};

export type BuildDiff = {
  beforeHash: string;
  afterHash: string;
  added: Placement[];
  removed: Placement[];
  changed: PlacementChange[];
  materialDeltas: Record<string, number>;
  contractChanged?: boolean;
  certificateChanged?: boolean;
};

export type ProjectVersionDiff = BuildDiff & {
  projectId: string;
  beforeVersionId: string;
  afterVersionId: string;
};

export type ProjectVersionMetadata = Omit<ProjectVersion, "payload" | "tenantDigest">;

export type ProjectHeadSummary = ProjectVersionMetadata & {
  buildId: string;
  buildHash: string;
  blockCount: number;
  contractStatus: "valid" | "invalid";
};

export type ProjectPlacementPage = {
  project: ProjectSummary;
  head?: ProjectHeadSummary;
  versions: ProjectVersionMetadata[];
  placements: {
    offset: number;
    limit: number;
    returned: number;
    total: number;
    items: Placement[];
  };
};

export type ProjectDiffDetail =
  | { kind: "added"; placement: Placement }
  | { kind: "removed"; placement: Placement }
  | { kind: "changed"; change: PlacementChange };

export type ProjectVersionDiffPage = {
  projectId: string;
  beforeVersionId: string;
  afterVersionId: string;
  beforeHash: string;
  afterHash: string;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  materialDeltas: Record<string, number>;
  contractChanged: boolean;
  certificateChanged: boolean;
  detail: {
    offset: number;
    limit: number;
    returned: number;
    total: number;
    items: ProjectDiffDetail[];
  };
};

export type CreateProjectInput = {
  tenantId: string;
  name: string;
  description?: string;
  initialVersion?: ProjectVersionPayload;
  createdBy?: string;
};

export type SaveProjectVersionInput = {
  tenantId: string;
  projectId: string;
  payload: ProjectVersionPayload;
  reason?: ProjectVersionReason;
  createdBy?: string;
  expectedHeadVersionId?: string;
  restoredFromVersionId?: string;
};

export interface ProjectDependentStorage {
  deleteProjectData(tenantId: string, projectId: string): Promise<number>;
}

export type FileProjectStoreOptions = {
  rootDirectory?: string;
  now?: () => Date;
  dependentStores?: ProjectDependentStorage[];
  limits?: ProjectStorageLimits;
};

export type ProjectStorageLimits = {
  maxProjectsPerTenant: number;
  maxVersionsPerProject: number;
  maxVersionBytes: number;
  maxTenantBytes: number;
};

export const HOSTED_PROJECT_STORAGE_LIMITS: Readonly<ProjectStorageLimits> = Object.freeze({
  maxProjectsPerTenant: 25,
  maxVersionsPerProject: 100,
  maxVersionBytes: 64 * 1024 * 1024,
  maxTenantBytes: 512 * 1024 * 1024,
});

const PROJECT_ID = /^prj_[a-f0-9]{32}$/;
const VERSION_ID = /^ver_[a-f0-9]{32}$/;
const MAX_REVIEW_DECISIONS = 50;
const MAX_REVIEW_DECISION_BYTES = 64 * 1024;

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function tenantDigest(tenantId: string) {
  const value = tenantId.trim();
  if (!value || value.length > 256) throw new Error("A tenant identifier between 1 and 256 characters is required.");
  return sha256(`blockwright-tenant\0${value}`);
}

function cleanText(value: string, label: string, maximum: number) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return cleaned;
}

function optionalText(value: string | undefined, label: string, maximum: number) {
  if (value === undefined) return undefined;
  return cleanText(value, label, maximum);
}

function assertProjectId(value: string) {
  if (!PROJECT_ID.test(value)) throw new Error("Invalid project identifier.");
}

function assertVersionId(value: string) {
  if (!VERSION_ID.test(value)) throw new Error("Invalid project version identifier.");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutTenant(manifest: StoredProjectManifest): ProjectSummary {
  const { tenantDigest: _tenantDigest, ...summary } = manifest;
  return summary;
}

function canonicalState(placement: Pick<Placement, "block" | "state">) {
  const entries = Object.entries(placement.state ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return entries.length
    ? `${placement.block}[${entries.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
    : placement.block;
}

function coordinateKey(placement: Pick<Placement, "x" | "y" | "z">) {
  return `${placement.x},${placement.y},${placement.z}`;
}

function placementOrder(left: Placement, right: Placement) {
  return left.y - right.y || left.z - right.z || left.x - right.x || canonicalState(left).localeCompare(canonicalState(right));
}

function coordinateOrder(left: Pick<Placement, "x" | "y" | "z">, right: Pick<Placement, "x" | "y" | "z">) {
  return left.y - right.y || left.z - right.z || left.x - right.x;
}

function assertCanonicalCoordinateOrder(placements: Placement[]) {
  for (let index = 1; index < placements.length; index += 1) {
    if (coordinateOrder(placements[index - 1], placements[index]) >= 0) {
      throw new Error("Stored project placements are not in unique canonical coordinate order.");
    }
  }
}

function materialCounts(build: BuildRecord) {
  const result: Record<string, number> = {};
  for (const placement of build.placements) {
    const state = canonicalState(placement);
    result[state] = (result[state] ?? 0) + 1;
  }
  return result;
}

function assertPage(offset: number, limit: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Project page offset and limit must be positive safe integers.");
  }
}

function headSummary(version: ProjectVersion): ProjectHeadSummary {
  const { payload, tenantDigest: _tenantDigest, ...metadata } = version;
  return {
    ...metadata,
    buildId: payload.build.id,
    buildHash: payload.build.hash,
    blockCount: payload.build.placements.length,
    contractStatus: payload.build.contract.status,
  };
}

export function diffBuildRecords(before: BuildRecord, after: BuildRecord): BuildDiff {
  const beforeByPosition = new Map(before.placements.map((placement) => [coordinateKey(placement), placement]));
  const afterByPosition = new Map(after.placements.map((placement) => [coordinateKey(placement), placement]));
  const added: Placement[] = [];
  const removed: Placement[] = [];
  const changed: PlacementChange[] = [];

  for (const [key, placement] of beforeByPosition) {
    const replacement = afterByPosition.get(key);
    if (!replacement) removed.push(cloneJson(placement));
    else if (stableJson(placement) !== stableJson(replacement)) {
      changed.push({
        coordinate: { x: placement.x, y: placement.y, z: placement.z },
        before: cloneJson(placement),
        after: cloneJson(replacement),
      });
    }
  }
  for (const [key, placement] of afterByPosition) if (!beforeByPosition.has(key)) added.push(cloneJson(placement));

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

export function defaultProjectRoot(env: NodeJS.ProcessEnv = process.env) {
  if (env.BLOCKWRIGHT_PROJECT_ROOT?.trim()) return resolve(env.BLOCKWRIGHT_PROJECT_ROOT.trim());
  if (env.BLOCKWRIGHT_STATE_ROOT?.trim()) return resolve(env.BLOCKWRIGHT_STATE_ROOT.trim(), "projects");
  if (process.platform === "win32" && env.LOCALAPPDATA?.trim()) return resolve(env.LOCALAPPDATA.trim(), "Blockwright", "projects");
  if (env.XDG_DATA_HOME?.trim()) return resolve(env.XDG_DATA_HOME.trim(), "blockwright", "projects");
  return resolve(homedir(), ".local", "share", "blockwright", "projects");
}

export class FileProjectStore {
  readonly rootDirectory: string;
  private readonly now: () => Date;
  private readonly dependentStores: ProjectDependentStorage[];
  private readonly limits?: ProjectStorageLimits;
  private readonly projectQueues = new Map<string, Promise<void>>();
  private readonly tenantQueues = new Map<string, Promise<void>>();

  constructor(options: FileProjectStoreOptions = {}) {
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

  private tenantDirectory(tenantId: string) {
    return join(this.rootDirectory, `tenant_${tenantDigest(tenantId)}`);
  }

  private tenantMarkerPath(tenantId: string) {
    return join(this.tenantDirectory(tenantId), ".blockwright-tenant.json");
  }

  private async assertOwnedTenantDirectory(tenantId: string) {
    const directory = this.tenantDirectory(tenantId);
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Tenant storage path is not an owned directory.");
    const marker = JSON.parse(await fs.readFile(this.tenantMarkerPath(tenantId), "utf8")) as { schemaVersion?: number; tenantDigest?: string };
    if (marker.schemaVersion !== 1 || marker.tenantDigest !== tenantDigest(tenantId)) throw new Error("Tenant ownership marker validation failed.");
    const [realRoot, realDirectory] = await Promise.all([fs.realpath(this.rootDirectory), fs.realpath(directory)]);
    const traversal = relative(realRoot, realDirectory);
    if (!traversal || traversal.startsWith("..") || isAbsolute(traversal)) throw new Error("Tenant storage resolves outside the configured Blockwright root.");
    return directory;
  }

  private async ensureTenantDirectory(tenantId: string) {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const directory = this.tenantDirectory(tenantId);
    try {
      await fs.mkdir(directory, { recursive: false, mode: 0o700 });
      await fs.writeFile(this.tenantMarkerPath(tenantId), `${JSON.stringify({ schemaVersion: 1, tenantDigest: tenantDigest(tenantId) }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return this.assertOwnedTenantDirectory(tenantId);
  }

  private projectDirectory(tenantId: string, projectId: string) {
    assertProjectId(projectId);
    const tenantDirectory = this.tenantDirectory(tenantId);
    const projectDirectory = resolve(tenantDirectory, projectId);
    const traversal = relative(tenantDirectory, projectDirectory);
    if (!traversal || traversal.startsWith("..") || isAbsolute(traversal)) throw new Error("Unsafe project storage path.");
    return projectDirectory;
  }

  private manifestPath(tenantId: string, projectId: string) {
    return join(this.projectDirectory(tenantId, projectId), "project.json");
  }

  private markerPath(tenantId: string, projectId: string) {
    return join(this.projectDirectory(tenantId, projectId), ".blockwright-project.json");
  }

  private versionPath(tenantId: string, projectId: string, versionId: string) {
    assertVersionId(versionId);
    return join(this.projectDirectory(tenantId, projectId), "versions", `${versionId}.json`);
  }

  private versionMetadataPath(tenantId: string, projectId: string, versionId: string) {
    assertVersionId(versionId);
    return join(this.projectDirectory(tenantId, projectId), "versions", `${versionId}.meta`);
  }

  private async withProjectQueue<T>(tenantId: string, projectId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${tenantDigest(tenantId)}:${projectId}`;
    const previous = this.projectQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const queued = previous.then(() => gate);
    this.projectQueues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.projectQueues.get(key) === queued) this.projectQueues.delete(key);
    }
  }

  private async withTenantQueue<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    const key = tenantDigest(tenantId);
    const previous = this.tenantQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const queued = previous.then(() => gate);
    this.tenantQueues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tenantQueues.get(key) === queued) this.tenantQueues.delete(key);
    }
  }

  private async directoryBytes(directory: string): Promise<number> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let total = 0;
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await fs.lstat(path);
      if (info.isSymbolicLink()) throw new Error("Project storage contains a symbolic link; refusing quota accounting.");
      total += info.isDirectory() ? await this.directoryBytes(path) : info.size;
    }
    return total;
  }

  private async assertProjectCreationAllowed(tenantId: string) {
    if (!this.limits) return;
    const directory = this.tenantDirectory(tenantId);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const projects = entries.filter((entry) => entry.isDirectory() && PROJECT_ID.test(entry.name)).length;
    if (projects >= this.limits.maxProjectsPerTenant) {
      throw new Error(`PROJECT_QUOTA_EXCEEDED: this workspace is limited to ${this.limits.maxProjectsPerTenant} projects.`);
    }
  }

  private async assertVersionStorageAllowed(tenantId: string, manifest: StoredProjectManifest, versionBytes: number) {
    if (!this.limits) return;
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

  private async readManifest(tenantId: string, projectId: string): Promise<StoredProjectManifest> {
    const directory = this.projectDirectory(tenantId, projectId);
    try {
      await this.assertOwnedTenantDirectory(tenantId);
      const info = await fs.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Project storage path is not an owned directory.");
      const marker = JSON.parse(await fs.readFile(this.markerPath(tenantId, projectId), "utf8")) as { schemaVersion?: number; projectId?: string; tenantDigest?: string };
      if (marker.schemaVersion !== 1 || marker.projectId !== projectId || marker.tenantDigest !== tenantDigest(tenantId)) {
        throw new Error("Project ownership marker validation failed.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Project not found.");
      throw error;
    }
    let manifest: StoredProjectManifest;
    try {
      manifest = JSON.parse(await fs.readFile(this.manifestPath(tenantId, projectId), "utf8")) as StoredProjectManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Project not found.");
      throw error;
    }
    if (manifest.id !== projectId || manifest.tenantDigest !== tenantDigest(tenantId) || manifest.private !== true) {
      throw new Error("Project tenant boundary validation failed.");
    }
    return manifest;
  }

  private async writeManifest(path: string, manifest: StoredProjectManifest) {
    const temporary = join(dirname(path), `.project-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await fs.rename(temporary, path);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectSnapshot> {
    return this.withTenantQueue(input.tenantId, () => this.createProjectUnlocked(input));
  }

  private async createProjectUnlocked(input: CreateProjectInput): Promise<ProjectSnapshot> {
    const digest = tenantDigest(input.tenantId);
    const id = `prj_${randomBytes(16).toString("hex")}`;
    const createdAt = this.now().toISOString();
    const directory = this.projectDirectory(input.tenantId, id);
    const manifest: StoredProjectManifest = {
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
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
    return this.getProject(input.tenantId, id);
  }

  async listProjects(tenantId: string): Promise<ProjectSummary[]> {
    const tenantDirectory = this.tenantDirectory(tenantId);
    let entries;
    try {
      await this.assertOwnedTenantDirectory(tenantId);
      entries = await fs.readdir(tenantDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const projects: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
      projects.push(withoutTenant(await this.readManifest(tenantId, entry.name)));
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  async getProjectSummary(tenantId: string, projectId: string): Promise<ProjectSummary> {
    return withoutTenant(await this.readManifest(tenantId, projectId));
  }

  private async readVersionMetadata(manifest: StoredProjectManifest, tenantId: string, projectId: string, versionId: string): Promise<Omit<ProjectVersion, "payload">> {
    try {
      const metadata = JSON.parse(await fs.readFile(this.versionMetadataPath(tenantId, projectId, versionId), "utf8")) as Omit<ProjectVersion, "payload">;
      if (metadata.projectId !== projectId || metadata.tenantDigest !== manifest.tenantDigest || metadata.id !== versionId || !/^[a-f0-9]{64}$/.test(metadata.contentHash)) {
        throw new Error("Project version metadata boundary validation failed.");
      }
      return cloneJson(metadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const version = await this.readVersion(manifest, tenantId, projectId, versionId);
    const { payload: _payload, ...metadata } = version;
    try {
      await fs.writeFile(this.versionMetadataPath(tenantId, projectId, versionId), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return cloneJson(metadata);
  }

  async getProject(tenantId: string, projectId: string): Promise<ProjectSnapshot> {
    const manifest = await this.readManifest(tenantId, projectId);
    const directory = join(this.projectDirectory(tenantId, projectId), "versions");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const versions: Omit<ProjectVersion, "payload">[] = [];
    const head = manifest.headVersionId ? await this.readVersion(manifest, tenantId, projectId, manifest.headVersionId) : undefined;
    for (const entry of entries) {
      const versionId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
      if (!entry.isFile() || !VERSION_ID.test(versionId)) continue;
      versions.push(await this.readVersionMetadata(manifest, tenantId, projectId, versionId));
    }
    versions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    if (manifest.versionCount !== versions.length || (manifest.headVersionId && !head)) throw new Error("Project version history is inconsistent.");
    return {
      project: withoutTenant(manifest),
      ...(head ? { head: cloneJson(head) } : {}),
      versions: cloneJson(versions),
    };
  }

  async getProjectPage(tenantId: string, projectId: string, offset: number, limit: number): Promise<ProjectPlacementPage> {
    assertPage(offset, limit);
    const manifest = await this.readManifest(tenantId, projectId);
    const directory = join(this.projectDirectory(tenantId, projectId), "versions");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const versions: Omit<ProjectVersion, "payload">[] = [];
    const head = manifest.headVersionId ? await this.readVersion(manifest, tenantId, projectId, manifest.headVersionId) : undefined;
    for (const entry of entries) {
      const versionId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
      if (!entry.isFile() || !VERSION_ID.test(versionId)) continue;
      versions.push(await this.readVersionMetadata(manifest, tenantId, projectId, versionId));
    }
    versions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    if (manifest.versionCount !== versions.length || (manifest.headVersionId && !head)) throw new Error("Project version history is inconsistent.");
    const total = head?.payload.build.placements.length ?? 0;
    const items = head ? cloneJson(head.payload.build.placements.slice(offset, offset + limit)) : [];
    return {
      project: withoutTenant(manifest),
      ...(head ? { head: headSummary(head) } : {}),
      versions: versions.map(({ tenantDigest: _tenantDigest, ...metadata }) => cloneJson(metadata)),
      placements: { offset, limit, returned: items.length, total, items },
    };
  }

  async getVersion(tenantId: string, projectId: string, versionId: string): Promise<ProjectVersion> {
    const manifest = await this.readManifest(tenantId, projectId);
    return this.readVersion(manifest, tenantId, projectId, versionId);
  }

  private async readVersion(manifest: StoredProjectManifest, tenantId: string, projectId: string, versionId: string): Promise<ProjectVersion> {
    let version: ProjectVersion;
    try {
      version = JSON.parse(await fs.readFile(this.versionPath(tenantId, projectId, versionId), "utf8")) as ProjectVersion;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Project version not found.");
      throw error;
    }
    if (version.projectId !== projectId || version.tenantDigest !== manifest.tenantDigest || version.id !== versionId) {
      throw new Error("Project version tenant boundary validation failed.");
    }
    const { contentHash, ...hashBoundRecord } = version;
    if (sha256(stableJson(hashBoundRecord)) !== contentHash) throw new Error("Project version content integrity check failed.");
    return cloneJson(version);
  }

  async saveVersion(input: SaveProjectVersionInput): Promise<ProjectVersion> {
    return this.withTenantQueue(input.tenantId, () => this.withProjectQueue(input.tenantId, input.projectId, () => this.saveVersionUnlocked(input)));
  }

  private async saveVersionUnlocked(input: SaveProjectVersionInput): Promise<ProjectVersion> {
    const manifest = await this.readManifest(input.tenantId, input.projectId);
    if (input.expectedHeadVersionId !== undefined && manifest.headVersionId !== input.expectedHeadVersionId) {
      throw new Error("Project head changed; reload before saving another version.");
    }
    const payload = cloneJson(input.payload);
    if (!payload.build?.hash || !Array.isArray(payload.build.placements)) throw new Error("A complete hash-bound build record is required.");
    const versionWithoutHash: Omit<ProjectVersion, "contentHash"> = {
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
    const version: ProjectVersion = { ...versionWithoutHash, contentHash: sha256(stableJson(versionWithoutHash)) };
    if (input.restoredFromVersionId) assertVersionId(input.restoredFromVersionId);
    const path = this.versionPath(input.tenantId, input.projectId, version.id);
    const serialized = `${JSON.stringify(version, null, 2)}\n`;
    const { payload: _payload, ...metadata } = version;
    const metadataPath = this.versionMetadataPath(input.tenantId, input.projectId, version.id);
    const serializedMetadata = `${JSON.stringify(metadata, null, 2)}\n`;
    await this.assertVersionStorageAllowed(input.tenantId, manifest, Buffer.byteLength(serialized));
    await fs.writeFile(path, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await fs.writeFile(metadataPath, serializedMetadata, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      await fs.rm(path, { force: true });
      throw error;
    }
    const updated: StoredProjectManifest = {
      ...manifest,
      updatedAt: version.createdAt,
      headVersionId: version.id,
      versionCount: manifest.versionCount + 1,
    };
    try {
      await this.writeManifest(this.manifestPath(input.tenantId, input.projectId), updated);
    } catch (error) {
      await fs.rm(path, { force: true });
      await fs.rm(metadataPath, { force: true });
      throw error;
    }
    return cloneJson(version);
  }

  async autosave(input: Omit<SaveProjectVersionInput, "reason">) {
    return this.saveVersion({ ...input, reason: "autosave" });
  }

  async compareVersions(tenantId: string, projectId: string, beforeVersionId: string, afterVersionId: string): Promise<ProjectVersionDiff> {
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

  async compareVersionsPage(tenantId: string, projectId: string, beforeVersionId: string, afterVersionId: string, offset: number, limit: number): Promise<ProjectVersionDiffPage> {
    assertPage(offset, limit);
    const [before, after] = await Promise.all([
      this.getVersion(tenantId, projectId, beforeVersionId),
      this.getVersion(tenantId, projectId, afterVersionId),
    ]);
    const beforePlacements = before.payload.build.placements;
    const afterPlacements = after.payload.build.placements;
    assertCanonicalCoordinateOrder(beforePlacements);
    assertCanonicalCoordinateOrder(afterPlacements);
    const detailItems: ProjectDiffDetail[] = [];
    let detailTotal = 0;
    let addedCount = 0;
    let removedCount = 0;
    let changedCount = 0;
    const recordDetail = (detail: ProjectDiffDetail) => {
      if (detailTotal >= offset && detailItems.length < limit) detailItems.push(cloneJson(detail));
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
      } else if (order > 0) {
        addedCount += 1;
        recordDetail({ kind: "added", placement: afterPlacement });
        afterIndex += 1;
      } else {
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

  async restoreVersion(input: { tenantId: string; projectId: string; versionId: string; createdBy?: string; expectedHeadVersionId?: string }) {
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

  async deleteProject(tenantId: string, projectId: string) {
    return this.withProjectQueue(tenantId, projectId, () => this.deleteProjectUnlocked(tenantId, projectId));
  }

  private async deleteProjectUnlocked(tenantId: string, projectId: string) {
    const manifest = await this.readManifest(tenantId, projectId);
    const directory = this.projectDirectory(tenantId, projectId);
    let deletedDependentRecords = 0;
    for (const storage of this.dependentStores) deletedDependentRecords += await storage.deleteProjectData(tenantId, projectId);
    await fs.rm(directory, { recursive: true, force: false });
    return { deleted: true as const, projectId, deletedVersionCount: manifest.versionCount, deletedDependentRecords };
  }

  async deleteTenant(tenantId: string) {
    const directory = this.tenantDirectory(tenantId);
    let entries;
    try {
      await this.assertOwnedTenantDirectory(tenantId);
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.message === "Project not found.")) {
        return { deleted: true as const, deletedProjects: 0, deletedVersions: 0, deletedDependentRecords: 0 };
      }
      throw error;
    }
    const unknown = entries.filter((entry) => entry.name !== ".blockwright-tenant.json" && !(entry.isDirectory() && PROJECT_ID.test(entry.name)));
    if (unknown.length) throw new Error(`Tenant storage contains unrecognized data (${unknown.map(({ name }) => name).join(", ")}); refusing broad deletion.`);
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
    if (remaining.length) throw new Error("Tenant storage is not empty after exact project cleanup.");
    await fs.rmdir(directory);
    return { deleted: true as const, deletedProjects: projects.length, deletedVersions, deletedDependentRecords };
  }
}

export type ReviewDecision = {
  decision: "approved" | "changes_requested";
  actorId: string;
  comment?: string;
  createdAt: string;
};

export type StoredReviewLink = {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  projectId: string;
  versionId: string;
  buildHash: string;
  tokenHash: string;
  access: "read_only";
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  decisions: ReviewDecision[];
};

export interface HostedReviewStorage extends ProjectDependentStorage {
  insert(record: StoredReviewLink): Promise<void>;
  getById(id: string): Promise<StoredReviewLink | undefined>;
  getByTokenHash(tokenHash: string): Promise<StoredReviewLink | undefined>;
  update(record: StoredReviewLink, expected?: StoredReviewLink): Promise<void>;
}

export type HostedReviewServiceConfig = {
  enabled: true;
  baseUrl: string;
  tokenPepper: string;
  storage: HostedReviewStorage;
  now?: () => Date;
};

function reviewTokenHash(token: string, pepper: string) {
  return sha256(`${pepper}\0${token}`);
}

function assertHostedReviewConfig(config: HostedReviewServiceConfig | undefined) {
  if (!config?.enabled || !config.storage || config.tokenPepper.length < 32) {
    throw new Error("HOSTED_REVIEW_UNAVAILABLE: secure hosted review storage is not configured.");
  }
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:") throw new Error("HOSTED_REVIEW_UNAVAILABLE: the hosted review base URL must use HTTPS.");
  return { ...config, baseUrl: url.toString().replace(/\/$/, ""), now: config.now ?? (() => new Date()) };
}

export function createHostedReviewService(config?: HostedReviewServiceConfig) {
  const ready = assertHostedReviewConfig(config);
  const active = (record: StoredReviewLink) => !record.revokedAt && Date.parse(record.expiresAt) > ready.now().getTime();
  return {
    async create(input: { tenantId: string; projectId: string; versionId: string; buildHash: string; createdBy: string; expiresInSeconds?: number }) {
      const expiresInSeconds = input.expiresInSeconds ?? 60 * 60 * 24 * 7;
      if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 60 * 60 * 24 * 30) {
        throw new Error("Review links must expire between 60 seconds and 30 days after creation.");
      }
      assertProjectId(input.projectId);
      assertVersionId(input.versionId);
      if (!/^[a-f0-9]{64}$/.test(input.buildHash)) throw new Error("A valid build hash is required.");
      const token = randomBytes(32).toString("base64url");
      const createdAt = ready.now();
      const record: StoredReviewLink = {
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

    async resolve(token: string) {
      if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) throw new Error("Review link is invalid.");
      const record = await ready.storage.getByTokenHash(reviewTokenHash(token, ready.tokenPepper));
      if (!record || !active(record)) throw new Error("Review link is unavailable, expired, or revoked.");
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

    async revoke(input: { tenantId: string; linkId: string }) {
      const record = await ready.storage.getById(input.linkId);
      if (!record || record.tenantId !== input.tenantId) throw new Error("Review link not found for this tenant.");
      if (!record.revokedAt) {
        const expected = cloneJson(record);
        record.revokedAt = ready.now().toISOString();
        await ready.storage.update(cloneJson(record), expected);
      }
      return { revoked: true as const, id: record.id, revokedAt: record.revokedAt };
    },

    async recordDecision(input: { token: string; actorId: string; decision: ReviewDecision["decision"]; comment?: string }) {
      if (input.decision !== "approved" && input.decision !== "changes_requested") throw new Error("Unsupported review decision.");
      const record = await ready.storage.getByTokenHash(reviewTokenHash(input.token, ready.tokenPepper));
      if (!record || !active(record)) throw new Error("Review link is unavailable, expired, or revoked.");
      if (record.decisions.length >= MAX_REVIEW_DECISIONS) {
        throw new Error(`REVIEW_DECISION_LIMIT_EXCEEDED: this link is limited to ${MAX_REVIEW_DECISIONS} decision events.`);
      }
      const event: ReviewDecision = {
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

    async deleteProjectData(input: { tenantId: string; projectId: string }) {
      assertProjectId(input.projectId);
      return ready.storage.deleteProjectData(input.tenantId, input.projectId);
    },
  };
}
