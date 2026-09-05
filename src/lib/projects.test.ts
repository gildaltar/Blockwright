import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import {
  createHostedReviewService,
  FileProjectStore,
  type HostedReviewStorage,
  type StoredReviewLink,
} from "./projects.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "blockwright-project-store-"));
  temporaryDirectories.push(root);
  return root;
}

const input = {
  name: "Durable Workshop",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 11, depth: 9, height: 10 },
  origin: { x: 20, y: 64, z: -12 },
  blockBudget: 10_000,
  seed: "project-version-one",
  features: [],
};

class MemoryReviewStorage implements HostedReviewStorage {
  records = new Map<string, StoredReviewLink>();

  async insert(record: StoredReviewLink) {
    if (this.records.has(record.id)) throw new Error("duplicate");
    this.records.set(record.id, structuredClone(record));
  }

  async getById(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async getByTokenHash(tokenHash: string) {
    const record = [...this.records.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return record ? structuredClone(record) : undefined;
  }

  async update(record: StoredReviewLink) {
    if (!this.records.has(record.id)) throw new Error("missing");
    this.records.set(record.id, structuredClone(record));
  }

  async deleteProjectData(tenantId: string, projectId: string) {
    const matches = [...this.records.values()].filter((record) => record.tenantId === tenantId && record.projectId === projectId);
    for (const record of matches) this.records.delete(record.id);
    return matches.length;
  }
}

describe("durable tenant-scoped projects", () => {
  it("persists immutable manual and autosave versions outside process memory", async () => {
    const rootDirectory = temporaryRoot();
    const buildOne = compileBuild(input);
    const buildTwo = compileBuild({ ...input, seed: "project-version-two" });
    const store = new FileProjectStore({ rootDirectory, now: () => new Date("2026-09-04T12:00:00.000Z") });
    const created = await store.createProject({
      tenantId: "tenant-one",
      name: "  Client Workshop  ",
      initialVersion: { build: buildOne, contract: buildOne.contract, certificate: buildOne.certificate },
      createdBy: "owner-one",
    });
    expect(created.project.private).toBe(true);
    expect(created.project.name).toBe("Client Workshop");
    expect(created.project.versionCount).toBe(1);
    const first = created.head!;
    const tenantDirectory = readdirSync(rootDirectory, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name;
    const firstPath = join(rootDirectory, tenantDirectory, created.project.id, "versions", `${first.id}.json`);
    const immutableBytes = readFileSync(firstPath, "utf8");

    const autosave = await store.autosave({
      tenantId: "tenant-one",
      projectId: created.project.id,
      payload: { build: buildTwo, contract: buildTwo.contract, certificate: buildTwo.certificate },
      expectedHeadVersionId: first.id,
    });
    const reopened = await new FileProjectStore({ rootDirectory }).getProject("tenant-one", created.project.id);
    expect(reopened.project.versionCount).toBe(2);
    expect(reopened.head?.id).toBe(autosave.id);
    expect(autosave.parentVersionId).toBe(first.id);
    expect(autosave.reason).toBe("autosave");
    expect(readFileSync(firstPath, "utf8")).toBe(immutableBytes);
  });

  it("isolates tenants, returns exact before/after diffs, and restores as a new head", async () => {
    const store = new FileProjectStore({ rootDirectory: temporaryRoot() });
    const firstBuild = compileBuild(input);
    const secondBuild = compileBuild({ ...input, seed: "different-design" });
    const created = await store.createProject({ tenantId: "tenant-a", name: "A", initialVersion: { build: firstBuild } });
    await expect(store.getProject("tenant-b", created.project.id)).rejects.toThrow(/not found|tenant/i);
    const second = await store.saveVersion({ tenantId: "tenant-a", projectId: created.project.id, payload: { build: secondBuild } });
    const diff = await store.compareVersions("tenant-a", created.project.id, created.head!.id, second.id);
    expect(diff.beforeHash).toBe(firstBuild.hash);
    expect(diff.afterHash).toBe(secondBuild.hash);
    expect(diff.added.length + diff.removed.length + diff.changed.length).toBeGreaterThan(0);

    const restored = await store.restoreVersion({
      tenantId: "tenant-a",
      projectId: created.project.id,
      versionId: created.head!.id,
      expectedHeadVersionId: second.id,
      createdBy: "owner-a",
    });
    expect(restored.id).not.toBe(created.head!.id);
    expect(restored.parentVersionId).toBe(second.id);
    expect(restored.restoredFromVersionId).toBe(created.head!.id);
    expect(restored.payload.build.hash).toBe(firstBuild.hash);
    expect((await store.getProject("tenant-a", created.project.id)).project.versionCount).toBe(3);
  });

  it("returns bounded hosted-style project and diff pages without full payload arrays", async () => {
    const store = new FileProjectStore({ rootDirectory: temporaryRoot() });
    const firstBuild = compileBuild(input);
    const secondBuild = compileBuild({ ...input, origin: { x: 120, y: 64, z: -12 }, seed: "paged-different-design" });
    const created = await store.createProject({ tenantId: "tenant-paged", name: "Paged", initialVersion: { build: firstBuild } });
    const second = await store.saveVersion({ tenantId: "tenant-paged", projectId: created.project.id, payload: { build: secondBuild } });

    const projectPage = await store.getProjectPage("tenant-paged", created.project.id, 1, 2);
    expect(projectPage.head?.id).toBe(second.id);
    expect(projectPage.head?.blockCount).toBe(secondBuild.placements.length);
    expect(projectPage.head).not.toHaveProperty("payload");
    expect(projectPage.placements).toMatchObject({ offset: 1, limit: 2, returned: 2, total: secondBuild.placements.length });
    expect(projectPage.placements.items).toEqual(secondBuild.placements.slice(1, 3));

    const full = await store.compareVersions("tenant-paged", created.project.id, created.head!.id, second.id);
    const page = await store.compareVersionsPage("tenant-paged", created.project.id, created.head!.id, second.id, 1, 3);
    expect(page.addedCount).toBe(full.added.length);
    expect(page.removedCount).toBe(full.removed.length);
    expect(page.changedCount).toBe(full.changed.length);
    expect(page.materialDeltas).toEqual(full.materialDeltas);
    expect(page.detail).toMatchObject({ offset: 1, limit: 3, returned: 3, total: full.added.length + full.removed.length + full.changed.length });
    expect(page.detail.items).toHaveLength(3);
    expect(page).not.toHaveProperty("added");
    expect(page).not.toHaveProperty("removed");
    expect(page).not.toHaveProperty("changed");
  });

  it("serializes competing saves and leaves no unpublished version file after a stale-head rejection", async () => {
    const rootDirectory = temporaryRoot();
    const store = new FileProjectStore({ rootDirectory });
    const first = compileBuild(input);
    const second = compileBuild({ ...input, seed: "parallel-two" });
    const third = compileBuild({ ...input, seed: "parallel-three" });
    const created = await store.createProject({ tenantId: "tenant-parallel", name: "Parallel", initialVersion: { build: first } });
    const attempts = await Promise.allSettled([
      store.saveVersion({ tenantId: "tenant-parallel", projectId: created.project.id, payload: { build: second }, expectedHeadVersionId: created.head!.id }),
      store.saveVersion({ tenantId: "tenant-parallel", projectId: created.project.id, payload: { build: third }, expectedHeadVersionId: created.head!.id }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const reopened = await store.getProject("tenant-parallel", created.project.id);
    expect(reopened.project.versionCount).toBe(2);
    const tenantDirectory = join(rootDirectory, readdirSync(rootDirectory, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name);
    expect(readdirSync(join(tenantDirectory, created.project.id, "versions")).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  it("deletes only marker-owned project paths and cascades dependent review records", async () => {
    const rootDirectory = temporaryRoot();
    const reviewStorage = new MemoryReviewStorage();
    const store = new FileProjectStore({ rootDirectory, dependentStores: [reviewStorage] });
    const build = compileBuild(input);
    const created = await store.createProject({ tenantId: "tenant-cleanup", name: "Cleanup", initialVersion: { build } });
    const service = createHostedReviewService({
      enabled: true,
      baseUrl: "https://reviews.example.test",
      tokenPepper: "a-secure-review-token-pepper-value-longer-than-32",
      storage: reviewStorage,
    });
    await service.create({
      tenantId: "tenant-cleanup",
      projectId: created.project.id,
      versionId: created.head!.id,
      buildHash: build.hash,
      createdBy: "owner",
    });
    expect(reviewStorage.records.size).toBe(1);
    const deleted = await store.deleteProject("tenant-cleanup", created.project.id);
    expect(deleted.deletedVersionCount).toBe(1);
    expect(deleted.deletedDependentRecords).toBe(1);
    expect(reviewStorage.records.size).toBe(0);
    await expect(store.getProject("tenant-cleanup", created.project.id)).rejects.toThrow(/not found/i);
    expect(await store.listProjects("tenant-cleanup")).toEqual([]);
  });

  it("preflights exact tenant cleanup and refuses to erase unrecognized sibling data", async () => {
    const rootDirectory = temporaryRoot();
    const store = new FileProjectStore({ rootDirectory });
    const build = compileBuild(input);
    await store.createProject({ tenantId: "tenant-exact", name: "First", initialVersion: { build } });
    await store.createProject({ tenantId: "tenant-exact", name: "Second", initialVersion: { build } });
    const tenantDirectory = join(rootDirectory, readdirSync(rootDirectory, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name);
    const unknownPath = join(tenantDirectory, "user-owned-note.txt");
    writeFileSync(unknownPath, "do not delete");
    await expect(store.deleteTenant("tenant-exact")).rejects.toThrow(/unrecognized data/);
    expect(await store.listProjects("tenant-exact")).toHaveLength(2);
    expect(readFileSync(unknownPath, "utf8")).toBe("do not delete");
    unlinkSync(unknownPath);
    const deleted = await store.deleteTenant("tenant-exact");
    expect(deleted.deletedProjects).toBe(2);
    expect(deleted.deletedVersions).toBe(2);
    expect(readdirSync(rootDirectory)).toEqual([]);
  });

  it("enforces hosted project, history, version-size, and workspace-byte quotas", async () => {
    const build = compileBuild(input);
    const counted = new FileProjectStore({
      rootDirectory: temporaryRoot(),
      limits: { maxProjectsPerTenant: 1, maxVersionsPerProject: 1, maxVersionBytes: 100_000_000, maxTenantBytes: 200_000_000 },
    });
    const created = await counted.createProject({ tenantId: "tenant-quota", name: "Only", initialVersion: { build } });
    await expect(counted.saveVersion({ tenantId: "tenant-quota", projectId: created.project.id, payload: { build } })).rejects.toThrow(/VERSION_QUOTA_EXCEEDED/);
    await expect(counted.createProject({ tenantId: "tenant-quota", name: "Too many" })).rejects.toThrow(/PROJECT_QUOTA_EXCEEDED/);

    const sized = new FileProjectStore({
      rootDirectory: temporaryRoot(),
      limits: { maxProjectsPerTenant: 2, maxVersionsPerProject: 2, maxVersionBytes: 128, maxTenantBytes: 100_000 },
    });
    const empty = await sized.createProject({ tenantId: "tenant-size", name: "Size" });
    await expect(sized.saveVersion({ tenantId: "tenant-size", projectId: empty.project.id, payload: { build } })).rejects.toThrow(/VERSION_SIZE_EXCEEDED/);

    const total = new FileProjectStore({
      rootDirectory: temporaryRoot(),
      limits: { maxProjectsPerTenant: 2, maxVersionsPerProject: 2, maxVersionBytes: 100_000_000, maxTenantBytes: 1_024 },
    });
    const byteLimited = await total.createProject({ tenantId: "tenant-bytes", name: "Bytes" });
    await expect(total.saveVersion({ tenantId: "tenant-bytes", projectId: byteLimited.project.id, payload: { build } })).rejects.toThrow(/WORKSPACE_STORAGE_QUOTA_EXCEEDED/);
  });
});

describe("hosted review-link model", () => {
  it("fails closed without secure hosted configuration", () => {
    expect(() => createHostedReviewService()).toThrow(/HOSTED_REVIEW_UNAVAILABLE/);
    expect(() => createHostedReviewService({
      enabled: true,
      baseUrl: "http://reviews.example.test",
      tokenPepper: "a-secure-review-token-pepper-value-longer-than-32",
      storage: new MemoryReviewStorage(),
    })).toThrow(/HTTPS/);
  });

  it("stores only a token digest and records immutable approval/change events", async () => {
    let now = new Date("2026-09-04T12:00:00.000Z");
    const storage = new MemoryReviewStorage();
    const service = createHostedReviewService({
      enabled: true,
      baseUrl: "https://reviews.example.test/",
      tokenPepper: "a-secure-review-token-pepper-value-longer-than-32",
      storage,
      now: () => now,
    });
    const projectId = `prj_${"1".repeat(32)}`;
    const versionId = `ver_${"2".repeat(32)}`;
    const created = await service.create({
      tenantId: "tenant-a",
      projectId,
      versionId,
      buildHash: "a".repeat(64),
      createdBy: "owner-a",
      expiresInSeconds: 120,
    });
    const token = new URL(created.url).hash.slice("#review=".length);
    expect([...storage.records.values()][0].tokenHash).not.toContain(token);
    expect((await service.resolve(token)).access).toBe("read_only");
    const event = await service.recordDecision({ token, actorId: "client-a", decision: "changes_requested", comment: "Move the doorway." });
    expect(event.createdAt).toBe(now.toISOString());
    expect((await service.resolve(token)).decisions).toEqual([event]);
    await service.revoke({ tenantId: "tenant-a", linkId: created.id });
    await expect(service.resolve(token)).rejects.toThrow(/unavailable/);

    const second = await service.create({ tenantId: "tenant-a", projectId, versionId, buildHash: "b".repeat(64), createdBy: "owner-a", expiresInSeconds: 60 });
    const secondToken = new URL(second.url).hash.slice("#review=".length);
    now = new Date("2026-09-04T12:02:00.001Z");
    await expect(service.resolve(secondToken)).rejects.toThrow(/expired/);
  });

  it("bounds bearer-link decision history by count and serialized bytes", async () => {
    const storage = new MemoryReviewStorage();
    const service = createHostedReviewService({
      enabled: true,
      baseUrl: "https://reviews.example.test/",
      tokenPepper: "another-secure-review-token-pepper-longer-than-32",
      storage,
    });
    const common = { tenantId: "tenant-b", projectId: `prj_${"3".repeat(32)}`, versionId: `ver_${"4".repeat(32)}`, createdBy: "owner-b" };
    const counted = await service.create({ ...common, buildHash: "c".repeat(64) });
    const countedToken = new URL(counted.url).hash.slice("#review=".length);
    const countedRecord = storage.records.get(counted.id)!;
    countedRecord.decisions = Array.from({ length: 50 }, (_, index) => ({ decision: "approved" as const, actorId: `reviewer-${index}`, createdAt: new Date(0).toISOString() }));
    storage.records.set(counted.id, countedRecord);
    await expect(service.recordDecision({ token: countedToken, actorId: "overflow", decision: "approved" })).rejects.toThrow(/REVIEW_DECISION_LIMIT_EXCEEDED/);

    const sized = await service.create({ ...common, buildHash: "d".repeat(64) });
    const sizedToken = new URL(sized.url).hash.slice("#review=".length);
    const sizedRecord = storage.records.get(sized.id)!;
    sizedRecord.decisions = Array.from({ length: 16 }, (_, index) => ({ decision: "changes_requested" as const, actorId: `reviewer-${index}`, comment: "x".repeat(4_000), createdAt: new Date(0).toISOString() }));
    storage.records.set(sized.id, sizedRecord);
    await expect(service.recordDecision({ token: sizedToken, actorId: "overflow", decision: "approved" })).rejects.toThrow(/REVIEW_DECISION_SIZE_EXCEEDED/);
  });
});
