import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, HostedServiceStore, loadHostedServiceConfig, sessionTokenFromHeaders, validateBase64Upload } from "./hosted-service.js";

const temporaryDirectories: string[] = [];

function createStore(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), "blockwright-hosted-"));
  temporaryDirectories.push(directory);
  const config = loadHostedServiceConfig({
    BLOCKWRIGHT_HOSTED_MODE: "1",
    BLOCKWRIGHT_DATABASE_PATH: join(directory, "service.sqlite"),
    BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
    BLOCKWRIGHT_SESSION_SECRET: "s".repeat(48),
    BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "r".repeat(48),
    BLOCKWRIGHT_OPERATOR_TOKEN: "o".repeat(48),
    BLOCKWRIGHT_SUPPORT_EMAIL: "support@example.com",
    ...overrides,
  });
  return new HostedServiceStore(config);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("hosted service configuration", () => {
  it("fails closed when required hosted configuration is absent", () => {
    const config = loadHostedServiceConfig({ BLOCKWRIGHT_HOSTED_MODE: "1" });
    expect(config.ready).toBe(false);
    expect(config.issues).toHaveLength(6);
    expect(() => new HostedServiceStore(config)).toThrow(/Hosted mode is unavailable/);
  });

  it("does not require hosted credentials in local mode", () => {
    const config = loadHostedServiceConfig({});
    expect(config.enabled).toBe(false);
    expect(config.ready).toBe(false);
    expect(config.issues).toEqual([]);
  });

  it("fails closed when production hosted mode accidentally omits billing", () => {
    const directory = mkdtempSync(join(tmpdir(), "blockwright-hosted-config-"));
    temporaryDirectories.push(directory);
    const base = {
      NODE_ENV: "production",
      BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
      BLOCKWRIGHT_HOSTED_MODE: "1",
      BLOCKWRIGHT_DATABASE_PATH: join(directory, "service.sqlite"),
      BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
      BLOCKWRIGHT_SESSION_SECRET: "s".repeat(48),
      BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "r".repeat(48),
      BLOCKWRIGHT_OPERATOR_TOKEN: "o".repeat(48),
      BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: "a".repeat(48),
      BLOCKWRIGHT_SUPPORT_EMAIL: "support@example.com",
    };
    expect(loadHostedServiceConfig(base).issues.join(" ")).toMatch(/Production hosted mode requires Stripe/);
    expect(loadHostedServiceConfig({ ...base, BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1" }).ready).toBe(true);
    expect(loadHostedServiceConfig({ ...base, BLOCKWRIGHT_TRUST_PROXY_HOPS: "5", BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1" }).ready).toBe(false);
  });

  it("fails closed when production registration is not access controlled", () => {
    const directory = mkdtempSync(join(tmpdir(), "blockwright-hosted-registration-config-"));
    temporaryDirectories.push(directory);
    const config = loadHostedServiceConfig({
      NODE_ENV: "production",
      BLOCKWRIGHT_HOSTED_MODE: "1",
      BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
      BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1",
      BLOCKWRIGHT_DATABASE_PATH: join(directory, "service.sqlite"),
      BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
      BLOCKWRIGHT_SESSION_SECRET: "s".repeat(48),
      BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "r".repeat(48),
      BLOCKWRIGHT_OPERATOR_TOKEN: "o".repeat(48),
      BLOCKWRIGHT_SUPPORT_EMAIL: "support@example.com",
    });
    expect(config.ready).toBe(false);
    expect(config.issues.join(" ")).toMatch(/REGISTRATION_ACCESS_KEY/);
  });

  it("rejects relative persistent paths and public URLs with embedded path state", () => {
    const config = loadHostedServiceConfig({
      BLOCKWRIGHT_HOSTED_MODE: "1",
      BLOCKWRIGHT_DATABASE_PATH: ".\\service.sqlite",
      BLOCKWRIGHT_PROJECT_ROOT: ".\\projects",
      BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example/unexpected",
      BLOCKWRIGHT_SESSION_SECRET: "s".repeat(48),
      BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "r".repeat(48),
      BLOCKWRIGHT_OPERATOR_TOKEN: "o".repeat(48),
      BLOCKWRIGHT_SUPPORT_EMAIL: "support@example.com",
    });
    expect(config.ready).toBe(false);
    expect(config.issues.join(" ")).toMatch(/absolute persistent SQLite|PROJECT_ROOT|HTTPS origin/);
  });
});

describe("tenant authentication and deletion", () => {
  it("enforces the configured total tenant capacity inside the write transaction", async () => {
    const store = createStore({ BLOCKWRIGHT_MAX_TENANTS: "1" });
    await store.register({ email: "capacity-one@example.com", password: "correct horse 123", tenantName: "First Studio" });
    await expect(store.register({ email: "capacity-two@example.com", password: "another horse 456", tenantName: "Second Studio" }))
      .rejects.toThrow(/temporarily unavailable/);
    store.close();
  });

  it("stores only a token digest and isolates principals by tenant", async () => {
    const store = createStore();
    const first = await store.register({ email: "owner-one@example.com", password: "correct horse 123", tenantName: "One Studio" });
    const second = await store.register({ email: "owner-two@example.com", password: "another horse 456", tenantName: "Two Studio" });

    expect(first.principal.tenantId).not.toBe(second.principal.tenantId);
    expect(store.authenticate(first.token)?.tenantName).toBe("One Studio");
    expect(store.authenticate(second.token)?.tenantName).toBe("Two Studio");
    const stored = store.database.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").get(first.principal.userId) as { token_hash: string };
    expect(stored.token_hash).not.toContain(first.token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    store.close();
  });

  it("keeps only the newest active sessions for each user and workspace", async () => {
    const store = createStore();
    const registration = await store.register({ email: "sessions@example.com", password: "correct horse 123", tenantName: "Session Studio" });
    const issueSession = (store as unknown as { issueSession(userId: string, tenantId: string): { token: string } }).issueSession.bind(store);
    let newest = registration.token;
    for (let index = 0; index < 12; index += 1) newest = issueSession(registration.principal.userId, registration.principal.tenantId).token;
    const count = store.database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND tenant_id = ?")
      .get(registration.principal.userId, registration.principal.tenantId) as { count: number };
    expect(count.count).toBe(10);
    expect(store.authenticate(newest)?.userId).toBe(registration.principal.userId);
    expect(store.authenticate(registration.token)).toBeUndefined();
    store.close();
  });

  it("logs in, logs out, and deletes all tenant-owned records", async () => {
    const store = createStore();
    const registration = await store.register({ email: "owner@example.com", password: "correct horse 123", tenantName: "Builder Studio" });
    await expect(store.login({ email: "owner@example.com", password: "wrong password 000" })).rejects.toThrow(/incorrect/);
    const login = await store.login({ email: "owner@example.com", password: "correct horse 123" });
    expect(store.logout(login.token)).toBe(true);
    expect(store.authenticate(login.token)).toBeUndefined();
    store.recordUsage(registration.principal, "project_created", 1, 1200);
    expect(store.usage(registration.principal.tenantId).quantity).toBe(1);
    store.deleteAccount(registration.principal);
    expect(store.authenticate(registration.token)).toBeUndefined();
    expect((store.database.prepare("SELECT COUNT(*) AS count FROM tenants").get() as { count: number }).count).toBe(0);
    store.close();
  });

  it("records refund requests without pretending an automatic refund occurred", async () => {
    const store = createStore();
    const { principal } = await store.register({ email: "refund@example.com", password: "correct horse 123", tenantName: "Refund Studio" });
    const request = store.requestRefund(principal, "I was charged after canceling the plan.");
    expect(request.status).toBe("requested");
    expect(request.supportEmail).toBe("support@example.com");
    store.close();
  });

  it("bounds pending refund requests and retained telemetry per workspace", async () => {
    const store = createStore();
    const { principal } = await store.register({ email: "retention@example.com", password: "correct horse 123", tenantName: "Retention Studio" });
    for (let index = 0; index < 25; index += 1) store.requestRefund(principal, `Refund request number ${index} has enough detail.`);
    expect(() => store.requestRefund(principal, "One more pending refund request with enough detail.")).toThrow(/at most 25 pending/);

    const insert = store.database.prepare("INSERT INTO service_events (tenant_id, user_id, event_name, quantity, estimated_cost_microusd, created_at) VALUES (?, ?, 'project_created', 1, 0, ?)");
    store.database.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 10_001; index += 1) insert.run(principal.tenantId, principal.userId, new Date(index).toISOString());
    store.database.exec("COMMIT");
    store.recordUsage(principal, "project_created");
    expect(store.usage(principal.tenantId).events).toBe(10_000);
    store.close();
  });
});

describe("request safeguards", () => {
  it("enforces a deterministic fixed-window limit", () => {
    const limiter = new FixedWindowRateLimiter(1000, 2);
    expect(limiter.consume("ip", 0).allowed).toBe(true);
    expect(limiter.consume("ip", 100).allowed).toBe(true);
    expect(limiter.consume("ip", 200).allowed).toBe(false);
    expect(limiter.consume("ip", 1001).allowed).toBe(true);
  });

  it("extracts bearer or HttpOnly-cookie session tokens", () => {
    expect(sessionTokenFromHeaders("Bearer abc", undefined)).toBe("abc");
    expect(sessionTokenFromHeaders(undefined, "other=x; bw_session=a%20b")).toBe("a b");
    expect(sessionTokenFromHeaders(undefined, "bw_session=%zz")).toBeUndefined();
  });

  it("keeps rate-limit storage bounded under high-cardinality keys", () => {
    const limiter = new FixedWindowRateLimiter(60_000, 2);
    for (let index = 0; index < 21_000; index += 1) limiter.consume(`ip-${index}`, 0);
    expect((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size).toBeLessThanOrEqual(20_000);
  });

  it("persists only review-token digests and cascades project review data", async () => {
    const store = createStore();
    const { principal } = await store.register({ email: "review@example.com", password: "correct horse 123", tenantName: "Review Studio" });
    const tokenHash = "a".repeat(64);
    await store.insert({
      schemaVersion: 1,
      id: `link_${"1".repeat(32)}`,
      tenantId: principal.tenantId,
      projectId: `prj_${"2".repeat(32)}`,
      versionId: `ver_${"3".repeat(32)}`,
      buildHash: "4".repeat(64),
      tokenHash,
      access: "read_only",
      createdBy: principal.userId,
      createdAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2026-09-05T00:00:00.000Z",
      decisions: [],
    });
    expect((await store.getByTokenHash(tokenHash))?.tenantId).toBe(principal.tenantId);
    expect(await store.deleteProjectData(principal.tenantId, `prj_${"2".repeat(32)}`)).toBe(1);
    expect(await store.getByTokenHash(tokenHash)).toBeUndefined();
    store.close();
  });

  it("caps active review links per project", async () => {
    const store = createStore();
    const { principal } = await store.register({ email: "review-limit@example.com", password: "correct horse 123", tenantName: "Review Limit Studio" });
    const projectId = `prj_${"2".repeat(32)}`;
    const makeLink = (index: number) => ({
      schemaVersion: 1 as const,
      id: `link_${index.toString(16).padStart(32, "0")}`,
      tenantId: principal.tenantId,
      projectId,
      versionId: `ver_${"3".repeat(32)}`,
      buildHash: "4".repeat(64),
      tokenHash: index.toString(16).padStart(64, "0"),
      access: "read_only" as const,
      createdBy: principal.userId,
      createdAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2099-09-05T00:00:00.000Z",
      decisions: [],
    });
    for (let index = 1; index <= 25; index += 1) await store.insert(makeLink(index));
    const first = (await store.getById(makeLink(1).id))!;
    await store.update({ ...first, revokedAt: "2026-09-04T01:00:00.000Z" });
    await expect(store.insert(makeLink(26))).rejects.toThrow(/at most 25 unexpired review links/);
    store.close();
  });

  it("never resurrects a review link from a stale concurrent decision", async () => {
    const store = createStore();
    const { principal } = await store.register({ email: "review-race@example.com", password: "correct horse 123", tenantName: "Review Race Studio" });
    const record = {
      schemaVersion: 1 as const,
      id: `link_${"1".repeat(32)}`,
      tenantId: principal.tenantId,
      projectId: `prj_${"2".repeat(32)}`,
      versionId: `ver_${"3".repeat(32)}`,
      buildHash: "4".repeat(64),
      tokenHash: "5".repeat(64),
      access: "read_only" as const,
      createdBy: principal.userId,
      createdAt: new Date().toISOString(),
      expiresAt: "2099-09-05T00:00:00.000Z",
      decisions: [],
    };
    await store.insert(record);
    const stale = (await store.getById(record.id))!;
    await store.update({ ...stale, revokedAt: new Date().toISOString() }, stale);
    await expect(store.update({ ...stale, decisions: [{ actorId: "client", decision: "approved", createdAt: new Date().toISOString() }] }, stale))
      .rejects.toThrow(/revoked|changed/);
    const persisted = (await store.getById(record.id))!;
    expect(persisted.revokedAt).toBeDefined();
    expect(persisted.decisions).toEqual([]);
    store.close();
  });

  it("rejects malformed and oversized base64 payloads before decoding", () => {
    expect(validateBase64Upload(Buffer.from("safe").toString("base64"), 8)).toBe(4);
    expect(() => validateBase64Upload("not-base64!", 100)).toThrow(/valid base64/);
    expect(() => validateBase64Upload(Buffer.alloc(32).toString("base64"), 8)).toThrow(/exceeds/);
  });
});
