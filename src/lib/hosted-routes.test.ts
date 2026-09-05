import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureHostedRoutes } from "./hosted-routes.js";
import { HostedServiceStore, loadHostedServiceConfig } from "./hosted-service.js";
import { compileBuild } from "./compiler.js";
import { createHostedReviewService, FileProjectStore } from "./projects.js";
import type { BuildInput } from "./types.js";

const cleanup: (() => void)[] = [];

async function appFixture(overrides: NodeJS.ProcessEnv = {}, resolvedPrincipals: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "blockwright-routes-"));
  const config = loadHostedServiceConfig({
    BLOCKWRIGHT_HOSTED_MODE: "1",
    BLOCKWRIGHT_DATABASE_PATH: join(directory, "service.sqlite"),
    BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
    BLOCKWRIGHT_SESSION_SECRET: "s".repeat(48),
    BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "r".repeat(48),
    BLOCKWRIGHT_OPERATOR_TOKEN: "o".repeat(48),
    BLOCKWRIGHT_SUPPORT_EMAIL: "support@example.com",
    BLOCKWRIGHT_RATE_REQUESTS: "100",
    ...overrides,
  });
  const store = new HostedServiceStore(config);
  const projectStore = new FileProjectStore({ rootDirectory: join(directory, "projects"), dependentStores: [store] });
  const reviewService = createHostedReviewService({
    enabled: true,
    baseUrl: config.baseUrl!,
    tokenPepper: config.reviewTokenPepper!,
    storage: store,
  });
  const app = express();
  app.use(express.json());
  configureHostedRoutes(app, {
    config,
    store,
    projectStore,
    reviewService,
    resolveBuild: (value, principal) => {
      resolvedPrincipals.push(principal.userId);
      return compileBuild(((value as { input?: BuildInput })?.input ?? value) as BuildInput);
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  cleanup.push(() => {
    server.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, server, store, projectStore, directory };
}

afterEach(() => cleanup.splice(0).reverse().forEach((dispose) => dispose()));

function cookieFrom(response: Response) {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("No session cookie returned.");
  return value.split(";", 1)[0];
}

describe("hosted browser routes", () => {
  it("registers, authenticates, and explicitly deletes a tenant", async () => {
    const { base } = await appFixture();
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://blockwright.example" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct horse 123", tenantName: "Builder Studio" }),
    });
    expect(registration.status).toBe(201);
    const cookie = cookieFrom(registration);
    const account = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect((await account.json() as { account: { tenantName: string } }).account.tenantName).toBe("Builder Studio");
    const deleted = await fetch(`${base}/api/me`, { method: "DELETE", headers: { cookie, origin: "https://blockwright.example" } });
    expect(deleted.status).toBe(200);
    expect((await fetch(`${base}/api/me`, { headers: { cookie } })).status).toBe(401);
  });

  it("rejects cross-origin browser mutations", async () => {
    const { base } = await appFixture();
    const result = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct horse 123", tenantName: "Builder Studio" }),
    });
    expect(result.status).toBe(403);
  });

  it("reports provider gates without claiming checkout is live", async () => {
    const { base } = await appFixture();
    const status = await fetch(`${base}/api/service/status`).then((response) => response.json()) as { hostedReady: boolean; billingConfigured: boolean; registrationAccessRequired: boolean; capabilities: { checkout: boolean } };
    expect(status.hostedReady).toBe(true);
    expect(status.billingConfigured).toBe(false);
    expect(status.registrationAccessRequired).toBe(false);
    expect(status.capabilities.checkout).toBe(false);
  });

  it("requires the configured early-access key and globally caps registration work", async () => {
    const accessKey = "early-access-key-used-only-by-tests-1234567890";
    const { base } = await appFixture({ BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: accessKey, BLOCKWRIGHT_MAX_REGISTRATIONS_PER_DAY: "1" });
    const origin = "https://blockwright.example";
    const status = await fetch(`${base}/api/service/status`).then((response) => response.json()) as { registrationAccessRequired: boolean };
    expect(status.registrationAccessRequired).toBe(true);
    const withoutKey = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "denied@example.com", password: "correct horse 123", tenantName: "Denied Studio" }),
    });
    expect(withoutKey.status).toBe(403);
    const accepted = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "accepted@example.com", password: "correct horse 123", tenantName: "Accepted Studio", accessKey }),
    });
    expect(accepted.status).toBe(201);
    const capped = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "capped@example.com", password: "correct horse 123", tenantName: "Capped Studio", accessKey }),
    });
    expect(capped.status).toBe(429);
  });

  it("accepts telemetry only from an authenticated workspace when enabled", async () => {
    const { base } = await appFixture({ BLOCKWRIGHT_TELEMETRY_ENABLED: "1" });
    const origin = "https://blockwright.example";
    expect((await fetch(`${base}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ eventName: "onboarding_completed" }),
    })).status).toBe(401);
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "telemetry@example.com", password: "correct horse 123", tenantName: "Telemetry Studio" }),
    });
    const cookie = cookieFrom(registration);
    expect((await fetch(`${base}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ eventName: "onboarding_completed" }),
    })).status).toBe(202);
  });

  it("isolates durable projects and serves only the exact token-bound review snapshot", async () => {
    const resolvedPrincipals: string[] = [];
    const { base, projectStore } = await appFixture({}, resolvedPrincipals);
    const origin = "https://blockwright.example";
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "projects@example.com", password: "correct horse 123", tenantName: "Project Studio" }),
    });
    const cookie = cookieFrom(registration);
    const build = compileBuild({
      name: "Hosted project fixture",
      edition: "java",
      version: "26.2",
      style: "nordic",
      dimensions: { width: 9, depth: 9, height: 9 },
      origin: { x: 0, y: 64, z: 0 },
      blockBudget: 20_000,
      seed: "hosted-project-fixture",
    });
    const createdResponse = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ name: "Client pavilion", build }),
    });
    expect(createdResponse.status).toBe(201);
    expect(resolvedPrincipals).toHaveLength(1);
    expect(resolvedPrincipals[0]).toMatch(/^usr_/);
    const created = await createdResponse.json() as { project: { project: { id: string }; head: { id: string; payload?: unknown; tenantDigest?: string } } };
    const projectId = created.project.project.id;
    const versionId = created.project.head.id;
    expect(created.project.head.payload).toBeUndefined();
    expect(created.project.head.tenantDigest).toBeUndefined();
    const projectPage = await fetch(`${base}/api/projects/${projectId}?offset=0&limit=2`, { headers: { cookie } }).then((response) => response.json()) as {
      project: { head: { id: string; blockCount: number; payload?: unknown }; placements: { returned: number; total: number; items: unknown[] } };
    };
    expect(projectPage.project.head.id).toBe(versionId);
    expect(projectPage.project.head.blockCount).toBe(build.placements.length);
    expect(projectPage.project.head.payload).toBeUndefined();
    expect(projectPage.project.placements.returned).toBe(2);
    expect(projectPage.project.placements.total).toBe(build.placements.length);
    expect(projectPage.project.placements.items).toHaveLength(2);
    expect((await fetch(`${base}/api/projects/${projectId}?limit=1001`, { headers: { cookie } })).status).toBe(400);
    const linkResponse = await fetch(`${base}/api/projects/${projectId}/review-links`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ versionId, expiresInSeconds: 3600 }),
    });
    expect(linkResponse.status).toBe(201);
    const link = await linkResponse.json() as { link: { url: string } };
    expect(new URL(link.link.url).pathname).toBe("/assets/blockwright/index.html");
    const token = new URL(link.link.url).hash.replace("#review=", "");
    const versionReads = vi.spyOn(projectStore, "getVersion");
    const publicSnapshot = await fetch(`${base}/api/review/${token}`).then((response) => response.json()) as {
      project: { id: string };
      version: {
        id: string;
        build: {
          hash: string;
          placementCount: number;
          materialStateCount: number;
          primaryMaterials: unknown[];
          placements?: unknown;
          plan?: unknown;
          preflight?: unknown;
          regions?: unknown;
          materialCounts?: unknown;
          contract?: unknown;
          certificate: { status: string; text?: unknown };
        };
      };
      tenantId?: string;
    };
    expect(publicSnapshot.project.id).toBe(projectId);
    expect(publicSnapshot.version.id).toBe(versionId);
    expect(publicSnapshot.version.build.hash).toBe(build.hash);
    expect(publicSnapshot.version.build.placementCount).toBe(build.placements.length);
    expect(Object.keys(publicSnapshot.version.build).sort()).toEqual([
      "bounds",
      "certificate",
      "contractStatus",
      "hash",
      "id",
      "input",
      "materialStateCount",
      "placementCount",
      "primaryMaterials",
    ]);
    expect(publicSnapshot.version.build.placements).toBeUndefined();
    expect(publicSnapshot.version.build.plan).toBeUndefined();
    expect(publicSnapshot.version.build.preflight).toBeUndefined();
    expect(publicSnapshot.version.build.regions).toBeUndefined();
    expect(publicSnapshot.version.build.materialCounts).toBeUndefined();
    expect(publicSnapshot.version.build.contract).toBeUndefined();
    expect(publicSnapshot.version.build.certificate.text).toBeUndefined();
    expect(publicSnapshot.version.build.materialStateCount).toBe(Object.keys(build.materialCounts).length);
    expect(publicSnapshot.version.build.primaryMaterials.length).toBeLessThanOrEqual(8);
    expect(publicSnapshot.tenantId).toBeUndefined();
    const placementPage = await fetch(`${base}/api/review/${token}/placements?offset=0&limit=2`).then((response) => response.json()) as { placements: unknown[]; returned: number; total: number };
    expect(placementPage.returned).toBe(2);
    expect(placementPage.total).toBe(build.placements.length);
    expect(versionReads).toHaveBeenCalledTimes(1);
    const decision = await fetch(`${base}/api/review/${token}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ actorId: "Client reviewer", decision: "approved" }),
    });
    expect(decision.status).toBe(201);
    const deleted = await fetch(`${base}/api/me`, { method: "DELETE", headers: { cookie, origin } });
    expect(deleted.status).toBe(200);
    expect((await fetch(`${base}/api/review/${token}`)).status).toBe(404);
  });

  it("bounds project reads per workspace and permits only one in-flight read per tenant", async () => {
    const { base, store, projectStore } = await appFixture();
    const registration = await store.register({ email: "read-limits@example.com", password: "correct horse 123", tenantName: "Read Limits" });
    const cookie = `bw_session=${registration.token}`;
    const build = compileBuild({
      name: "Read limit fixture",
      edition: "java",
      version: "26.2",
      style: "nordic",
      dimensions: { width: 9, depth: 9, height: 9 },
      origin: { x: 0, y: 64, z: 0 },
      blockBudget: 20_000,
      seed: "hosted-project-read-limit",
    });
    const created = await projectStore.createProject({ tenantId: registration.principal.tenantId, name: "Read Limits", initialVersion: { build } });
    const movedBuild = compileBuild({ ...build.input, origin: { x: 80, y: 64, z: 0 }, seed: "hosted-project-read-limit-moved" });
    const savedResponse = await fetch(`${base}/api/projects/${created.project.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://blockwright.example", cookie },
      body: JSON.stringify({ build: { input: movedBuild.input }, expectedHeadVersionId: created.head!.id }),
    });
    expect(savedResponse.status).toBe(201);
    const savedBody = await savedResponse.json() as { version: { id: string; payload?: unknown; tenantDigest?: string; blockCount: number } };
    expect(savedBody.version.payload).toBeUndefined();
    expect(savedBody.version.tenantDigest).toBeUndefined();
    expect(savedBody.version.blockCount).toBe(movedBuild.placements.length);
    const second = savedBody.version;
    const diffResponse = await fetch(
      `${base}/api/projects/${created.project.id}/diff?before=${created.head!.id}&after=${second.id}&offset=0&limit=2`,
      { headers: { cookie } },
    );
    expect(diffResponse.status).toBe(200);
    const diffBody = await diffResponse.json() as {
      diff: Record<string, unknown> & {
        addedCount: number;
        removedCount: number;
        materialDeltaCount: number;
        materialDeltas: { offset: number; limit: number; returned: number; total: number; items: unknown[] };
        detail: { returned: number; total: number; items: unknown[] };
      };
    };
    expect(diffBody.diff.addedCount).toBe(movedBuild.placements.length);
    expect(diffBody.diff.removedCount).toBe(build.placements.length);
    expect(diffBody.diff.detail.returned).toBe(2);
    expect(diffBody.diff.detail.total).toBe(build.placements.length + movedBuild.placements.length);
    expect(diffBody.diff.detail.items).toHaveLength(2);
    expect(diffBody.diff.materialDeltaCount).toBe(diffBody.diff.materialDeltas.total);
    expect(diffBody.diff.materialDeltas.limit).toBe(100);
    expect(diffBody.diff.materialDeltas.returned).toBeLessThanOrEqual(100);
    expect(diffBody.diff.materialDeltas.items).toHaveLength(diffBody.diff.materialDeltas.returned);
    expect(diffBody.diff).not.toHaveProperty("added");
    expect(diffBody.diff).not.toHaveProperty("removed");
    expect(diffBody.diff).not.toHaveProperty("changed");
    expect((await fetch(
      `${base}/api/projects/${created.project.id}/diff?before=${created.head!.id}&after=${second.id}&limit=501`,
      { headers: { cookie } },
    )).status).toBe(400);
    expect((await fetch(
      `${base}/api/projects/${created.project.id}/diff?before=${created.head!.id}&after=${second.id}&materialLimit=101`,
      { headers: { cookie } },
    )).status).toBe(400);
    const restoreResponse = await fetch(`${base}/api/projects/${created.project.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://blockwright.example", cookie },
      body: JSON.stringify({ versionId: created.head!.id, expectedHeadVersionId: second.id }),
    });
    expect(restoreResponse.status).toBe(201);
    const restoredBody = await restoreResponse.json() as { version: { payload?: unknown; tenantDigest?: string; blockCount: number } };
    expect(restoredBody.version.payload).toBeUndefined();
    expect(restoredBody.version.tenantDigest).toBeUndefined();
    expect(restoredBody.version.blockCount).toBe(build.placements.length);

    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const original = projectStore.getProjectPage.bind(projectStore);
    vi.spyOn(projectStore, "getProjectPage").mockImplementation(async (...args) => {
      signalStarted();
      await gate;
      return original(...args);
    });

    const first = fetch(`${base}/api/projects/${created.project.id}?limit=1`, { headers: { cookie } });
    await started;
    const competing = await fetch(`${base}/api/projects/${created.project.id}?limit=1`, { headers: { cookie } });
    expect(competing.status).toBe(503);
    releaseFirst();
    expect((await first).status).toBe(200);

    for (let index = 0; index < 12; index += 1) {
      expect((await fetch(`${base}/api/projects/${created.project.id}?limit=1`, { headers: { cookie } })).status).toBe(200);
    }
    expect((await fetch(`${base}/api/projects/${created.project.id}?limit=1`, { headers: { cookie } })).status).toBe(429);
  });
});
