import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostedReviewStorage, StoredReviewLink } from "./projects.js";

export type HostedServiceConfig = {
  enabled: boolean;
  ready: boolean;
  issues: string[];
  databasePath?: string;
  projectRoot?: string;
  baseUrl?: string;
  sessionSecret?: string;
  reviewTokenPepper?: string;
  supportEmail?: string;
  operatorToken?: string;
  stripeSecretKey?: string;
  stripePriceId?: string;
  registrationAccessKey?: string;
  sessionTtlSeconds: number;
  maxUploadBytes: number;
  maxExpandedBytes: number;
  maxTenants: number;
  maxRegistrationsPerDay: number;
  maxLoginsPerMinute: number;
  rateLimitWindowMs: number;
  rateLimitRequests: number;
  authRateLimitRequests: number;
  trustProxyHops: number;
  telemetryEnabled: boolean;
};

export type HostedPrincipal = {
  userId: string;
  tenantId: string;
  email: string;
  tenantName: string;
  role: "owner" | "member" | "reviewer";
  plan: string;
  sessionExpiresAt: string;
};

export type BillingState = {
  tenantId: string;
  customerId?: string;
  subscriptionId?: string;
  status: "unconfigured" | "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  updatedAt: string;
};

export type ServiceUsage = {
  events: number;
  quantity: number;
  estimatedCostMicrousd: number;
  byEvent: { name: string; events: number; quantity: number; estimatedCostMicrousd: number }[];
};

const MAX_ACTIVE_SESSIONS_PER_USER = 10;
const MAX_RETAINED_REVIEW_LINKS_PER_PROJECT = 25;
const MAX_RETAINED_REVIEW_LINKS_PER_TENANT = 100;
const MAX_REFUND_REQUESTS_PER_TENANT = 25;
const MAX_SERVICE_EVENTS_PER_TENANT = 10_000;

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const boundedNonnegativeInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
};

const validHttpsOrigin = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export function loadHostedServiceConfig(env: NodeJS.ProcessEnv = process.env): HostedServiceConfig {
  const enabled = env.BLOCKWRIGHT_HOSTED_MODE === "1";
  const issues: string[] = [];
  const configuredPath = env.BLOCKWRIGHT_DATABASE_PATH?.trim();
  const databasePath = configuredPath ? resolve(configuredPath) : undefined;
  const configuredProjectRoot = env.BLOCKWRIGHT_PROJECT_ROOT?.trim();
  const projectRoot = configuredProjectRoot ? resolve(configuredProjectRoot) : databasePath ? resolve(dirname(databasePath), "projects") : undefined;
  const baseUrl = validHttpsOrigin(env.BLOCKWRIGHT_PUBLIC_URL?.trim());
  const sessionSecret = env.BLOCKWRIGHT_SESSION_SECRET?.trim();
  const reviewTokenPepper = env.BLOCKWRIGHT_REVIEW_TOKEN_PEPPER?.trim();
  const supportEmail = env.BLOCKWRIGHT_SUPPORT_EMAIL?.trim().toLowerCase();
  const operatorToken = env.BLOCKWRIGHT_OPERATOR_TOKEN?.trim();
  const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim();
  const stripePriceId = env.STRIPE_STUDIO_PRICE_ID?.trim();
  const registrationAccessKey = env.BLOCKWRIGHT_REGISTRATION_ACCESS_KEY?.trim();
  const allowUnbilledHostedDevelopment = env.BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT === "1";
  const trustProxyHopsValue = env.BLOCKWRIGHT_TRUST_PROXY_HOPS?.trim();
  const trustProxyHops = boundedNonnegativeInteger(trustProxyHopsValue, 0, 4);

  if (enabled) {
    if (!configuredPath || !databasePath || !isAbsolute(configuredPath)) issues.push("BLOCKWRIGHT_DATABASE_PATH must be an absolute persistent SQLite file path.");
    if (configuredProjectRoot && !isAbsolute(configuredProjectRoot)) issues.push("BLOCKWRIGHT_PROJECT_ROOT must be an absolute persistent directory when supplied.");
    if (!baseUrl) issues.push("BLOCKWRIGHT_PUBLIC_URL must be a valid HTTPS origin.");
    if (!sessionSecret || sessionSecret.length < 32) issues.push("BLOCKWRIGHT_SESSION_SECRET must contain at least 32 characters.");
    if (!reviewTokenPepper || reviewTokenPepper.length < 32) issues.push("BLOCKWRIGHT_REVIEW_TOKEN_PEPPER must contain at least 32 characters.");
    if (!supportEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) issues.push("BLOCKWRIGHT_SUPPORT_EMAIL must be a valid operator-owned address.");
    if (!operatorToken || operatorToken.length < 32) issues.push("BLOCKWRIGHT_OPERATOR_TOKEN must contain at least 32 characters.");
    if (registrationAccessKey && registrationAccessKey.length < 32) issues.push("BLOCKWRIGHT_REGISTRATION_ACCESS_KEY must contain at least 32 characters when supplied.");
    if (env.NODE_ENV === "production" && !registrationAccessKey) {
      issues.push("Production hosted mode requires BLOCKWRIGHT_REGISTRATION_ACCESS_KEY so account creation is explicitly access controlled.");
    }
    if (Boolean(stripeSecretKey) !== Boolean(stripePriceId)) issues.push("STRIPE_SECRET_KEY and STRIPE_STUDIO_PRICE_ID must either both be present or both be absent.");
    if (env.NODE_ENV === "production" && (!stripeSecretKey || !stripePriceId) && !allowUnbilledHostedDevelopment) {
      issues.push("Production hosted mode requires Stripe billing configuration. Set BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT=1 only for an intentionally free development deployment.");
    }
    if (trustProxyHopsValue !== undefined && !/^[0-4]$/.test(trustProxyHopsValue)) issues.push("BLOCKWRIGHT_TRUST_PROXY_HOPS must be an integer from 0 through 4.");
    if (env.NODE_ENV === "production" && trustProxyHopsValue === undefined) {
      issues.push("Production hosted mode requires an explicit BLOCKWRIGHT_TRUST_PROXY_HOPS value so client rate limits cannot collapse at or trust past the ingress boundary.");
    }
  }

  return {
    enabled,
    ready: enabled && issues.length === 0,
    issues,
    databasePath,
    projectRoot,
    baseUrl,
    sessionSecret,
    reviewTokenPepper,
    supportEmail,
    operatorToken,
    stripeSecretKey,
    stripePriceId,
    registrationAccessKey,
    sessionTtlSeconds: positiveInteger(env.BLOCKWRIGHT_SESSION_TTL_SECONDS, 60 * 60 * 24 * 14),
    maxUploadBytes: positiveInteger(env.BLOCKWRIGHT_MAX_UPLOAD_BYTES, 4 * 1024 * 1024),
    maxExpandedBytes: positiveInteger(env.BLOCKWRIGHT_MAX_EXPANDED_BYTES, 16 * 1024 * 1024),
    maxTenants: positiveInteger(env.BLOCKWRIGHT_MAX_TENANTS, 1_000),
    maxRegistrationsPerDay: positiveInteger(env.BLOCKWRIGHT_MAX_REGISTRATIONS_PER_DAY, 100),
    maxLoginsPerMinute: positiveInteger(env.BLOCKWRIGHT_MAX_LOGINS_PER_MINUTE, 120),
    rateLimitWindowMs: positiveInteger(env.BLOCKWRIGHT_RATE_WINDOW_MS, 60_000),
    rateLimitRequests: positiveInteger(env.BLOCKWRIGHT_RATE_REQUESTS, 90),
    authRateLimitRequests: positiveInteger(env.BLOCKWRIGHT_AUTH_RATE_REQUESTS, 12),
    trustProxyHops,
    telemetryEnabled: env.BLOCKWRIGHT_TELEMETRY_ENABLED === "1",
  };
}

function stableId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function tokenHash(token: string, secret: string) {
  return createHash("sha256").update(secret).update("\0").update(token).digest("hex");
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  return normalized;
}

function validatePassword(password: string) {
  if (password.length < 12 || password.length > 256) throw new Error("Password must contain between 12 and 256 characters.");
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) throw new Error("Password must contain both a letter and a number.");
}

function passwordDigest(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolveDigest, reject) => {
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolveDigest(derivedKey);
    });
  });
}

function safeCompare(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class HostedServiceStore implements HostedReviewStorage {
  readonly config: HostedServiceConfig;
  readonly database: DatabaseSync;

  constructor(config: HostedServiceConfig) {
    if (!config.ready || !config.databasePath || !config.sessionSecret) {
      throw new Error(`Hosted mode is unavailable: ${config.issues.join(" ") || "BLOCKWRIGHT_HOSTED_MODE is disabled."}`);
    }
    this.config = config;
    mkdirSync(dirname(config.databasePath), { recursive: true });
    this.database = new DatabaseSync(config.databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  close() {
    this.database.close();
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memberships (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'reviewer')),
        PRIMARY KEY (user_id, tenant_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS billing (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id TEXT,
        subscription_id TEXT,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refund_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS service_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS service_events_tenant_idx ON service_events(tenant_id, created_at);
      CREATE TABLE IF NOT EXISTS review_links (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        build_hash TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        access TEXT NOT NULL CHECK (access = 'read_only'),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        decisions_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_links_project_idx ON review_links(tenant_id, project_id);
      CREATE INDEX IF NOT EXISTS review_links_expiry_idx ON review_links(expires_at);
    `);
  }

  private reviewRecord(row: Record<string, unknown> | undefined): StoredReviewLink | undefined {
    if (!row) return undefined;
    const decisions = JSON.parse(String(row.decisions_json)) as StoredReviewLink["decisions"];
    if (!Array.isArray(decisions)) throw new Error("Stored review decisions are invalid.");
    return {
      schemaVersion: 1,
      id: String(row.id),
      tenantId: String(row.tenant_id),
      projectId: String(row.project_id),
      versionId: String(row.version_id),
      buildHash: String(row.build_hash),
      tokenHash: String(row.token_hash),
      access: "read_only",
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}),
      decisions,
    };
  }

  async insert(record: StoredReviewLink) {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM review_links WHERE expires_at <= ?").run(now);
      const projectCount = this.database.prepare(`
        SELECT COUNT(*) AS count FROM review_links
        WHERE tenant_id = ? AND project_id = ? AND expires_at > ?
      `).get(record.tenantId, record.projectId, now) as { count: number };
      const tenantCount = this.database.prepare(`
        SELECT COUNT(*) AS count FROM review_links
        WHERE tenant_id = ? AND expires_at > ?
      `).get(record.tenantId, now) as { count: number };
      if (projectCount.count >= MAX_RETAINED_REVIEW_LINKS_PER_PROJECT) {
        throw new Error(`A project can retain at most ${MAX_RETAINED_REVIEW_LINKS_PER_PROJECT} unexpired review links, including revoked links.`);
      }
      if (tenantCount.count >= MAX_RETAINED_REVIEW_LINKS_PER_TENANT) {
        throw new Error(`A workspace can retain at most ${MAX_RETAINED_REVIEW_LINKS_PER_TENANT} unexpired review links, including revoked links.`);
      }
      this.database.prepare(`
        INSERT INTO review_links (id, tenant_id, project_id, version_id, build_hash, token_hash, access, created_by, created_at, expires_at, revoked_at, decisions_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.tenantId, record.projectId, record.versionId, record.buildHash, record.tokenHash, record.access,
        record.createdBy, record.createdAt, record.expiresAt, record.revokedAt ?? null, JSON.stringify(record.decisions));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async getById(id: string) {
    return this.reviewRecord(this.database.prepare("SELECT * FROM review_links WHERE id = ?").get(id) as Record<string, unknown> | undefined);
  }

  async getByTokenHash(hash: string) {
    return this.reviewRecord(this.database.prepare("SELECT * FROM review_links WHERE token_hash = ?").get(hash) as Record<string, unknown> | undefined);
  }

  async update(record: StoredReviewLink, expected: StoredReviewLink = record) {
    const identity = [record.id, record.tenantId, record.projectId, record.versionId, record.buildHash, record.tokenHash] as const;
    const now = new Date().toISOString();
    const expectedDecisions = JSON.stringify(expected.decisions);
    const changed = record.revokedAt
      ? this.database.prepare(`
          UPDATE review_links SET revoked_at = ?
          WHERE id = ? AND tenant_id = ? AND project_id = ? AND version_id = ? AND build_hash = ? AND token_hash = ?
            AND revoked_at IS NULL AND expires_at > ? AND decisions_json = ?
        `).run(record.revokedAt, ...identity, now, expectedDecisions).changes
      : this.database.prepare(`
          UPDATE review_links SET decisions_json = ?
          WHERE id = ? AND tenant_id = ? AND project_id = ? AND version_id = ? AND build_hash = ? AND token_hash = ?
            AND revoked_at IS NULL AND expires_at > ? AND decisions_json = ?
        `).run(JSON.stringify(record.decisions), ...identity, now, expectedDecisions).changes;
    if (changed !== 1) throw new Error("Review link changed, expired, was revoked, or no longer exists.");
  }

  async deleteProjectData(tenantId: string, projectId: string) {
    return Number(this.database.prepare("DELETE FROM review_links WHERE tenant_id = ? AND project_id = ?").run(tenantId, projectId).changes);
  }

  private issueSession(userId: string, tenantId: string) {
    const rawToken = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.config.sessionTtlSeconds * 1000);
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt.toISOString());
    this.database.prepare("INSERT INTO sessions (token_hash, user_id, tenant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(tokenHash(rawToken, this.config.sessionSecret!), userId, tenantId, createdAt.toISOString(), expiresAt.toISOString());
    this.database.prepare(`
      DELETE FROM sessions
      WHERE user_id = ? AND tenant_id = ? AND token_hash NOT IN (
        SELECT token_hash FROM sessions
        WHERE user_id = ? AND tenant_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      )
    `).run(userId, tenantId, userId, tenantId, MAX_ACTIVE_SESSIONS_PER_USER);
    return { token: rawToken, expiresAt: expiresAt.toISOString() };
  }

  async register(input: { email: string; password: string; tenantName: string }) {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const tenantName = input.tenantName.trim().replace(/\s+/g, " ");
    if (!tenantName || tenantName.length > 80) throw new Error("Workspace name must contain between 1 and 80 characters.");

    const userId = stableId("usr");
    const tenantId = stableId("ten");
    const salt = randomBytes(16);
    const digest = await passwordDigest(input.password, salt);
    const createdAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const tenantCount = this.database.prepare("SELECT COUNT(*) AS count FROM tenants").get() as { count: number };
      if (tenantCount.count >= this.config.maxTenants) throw new Error("Account registration is temporarily unavailable.");
      this.database.prepare("INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, email, digest.toString("hex"), salt.toString("hex"), createdAt);
      this.database.prepare("INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)").run(tenantId, tenantName, createdAt);
      this.database.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')").run(userId, tenantId);
      this.database.prepare("INSERT INTO billing (tenant_id, status, updated_at) VALUES (?, 'unconfigured', ?)").run(tenantId, createdAt);
      const session = this.issueSession(userId, tenantId);
      this.database.exec("COMMIT");
      return { ...session, principal: this.authenticate(session.token)! };
    } catch (error) {
      this.database.exec("ROLLBACK");
      const message = error instanceof Error && /UNIQUE constraint failed: users\.email/.test(error.message)
        ? "Account registration could not be completed."
        : error instanceof Error ? error.message : "Account creation failed.";
      throw new Error(message);
    }
  }

  async login(input: { email: string; password: string }) {
    const email = normalizeEmail(input.email);
    if (input.password.length > 256) throw new Error("Email or password is incorrect.");
    const row = this.database.prepare(`
      SELECT u.id AS user_id, u.password_hash, u.password_salt, m.tenant_id
      FROM users u JOIN memberships m ON m.user_id = u.id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE u.email = ? AND u.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1
    `).get(email) as { user_id: string; password_hash: string; password_salt: string; tenant_id: string } | undefined;
    const salt = row ? Buffer.from(row.password_salt, "hex") : Buffer.alloc(16);
    const actual = await passwordDigest(input.password, salt);
    const expected = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(64);
    if (!row || !safeCompare(actual, expected)) throw new Error("Email or password is incorrect.");
    const session = this.issueSession(row.user_id, row.tenant_id);
    return { ...session, principal: this.authenticate(session.token)! };
  }

  authenticate(token: string): HostedPrincipal | undefined {
    if (!token) return undefined;
    const now = new Date().toISOString();
    const row = this.database.prepare(`
      SELECT u.id AS user_id, u.email, t.id AS tenant_id, t.name AS tenant_name, t.plan,
             m.role, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = s.tenant_id
      JOIN memberships m ON m.user_id = u.id AND m.tenant_id = t.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL AND t.deleted_at IS NULL
    `).get(tokenHash(token, this.config.sessionSecret!), now) as {
      user_id: string; email: string; tenant_id: string; tenant_name: string; plan: string;
      role: HostedPrincipal["role"]; expires_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      email: row.email,
      tenantName: row.tenant_name,
      role: row.role,
      plan: row.plan,
      sessionExpiresAt: row.expires_at,
    };
  }

  logout(token: string) {
    if (!token) return false;
    return this.database.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash(token, this.config.sessionSecret!)).changes > 0;
  }

  deleteAccount(principal: HostedPrincipal) {
    if (principal.role !== "owner") throw new Error("Only the workspace owner can delete this workspace.");
    this.database.prepare("DELETE FROM tenants WHERE id = ?").run(principal.tenantId);
    const remaining = this.database.prepare("SELECT COUNT(*) AS count FROM memberships WHERE user_id = ?").get(principal.userId) as { count: number };
    if (remaining.count === 0) this.database.prepare("DELETE FROM users WHERE id = ?").run(principal.userId);
    return { deleted: true, tenantId: principal.tenantId };
  }

  billingState(tenantId: string): BillingState {
    const row = this.database.prepare("SELECT customer_id, subscription_id, status, updated_at FROM billing WHERE tenant_id = ?")
      .get(tenantId) as { customer_id?: string; subscription_id?: string; status: BillingState["status"]; updated_at: string } | undefined;
    return row ? {
      tenantId,
      customerId: row.customer_id,
      subscriptionId: row.subscription_id,
      status: row.status,
      updatedAt: row.updated_at,
    } : { tenantId, status: "unconfigured", updatedAt: new Date(0).toISOString() };
  }

  setBillingState(input: Omit<BillingState, "updatedAt">) {
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO billing (tenant_id, customer_id, subscription_id, status, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET customer_id=excluded.customer_id,
        subscription_id=excluded.subscription_id, status=excluded.status, updated_at=excluded.updated_at
    `).run(input.tenantId, input.customerId ?? null, input.subscriptionId ?? null, input.status, updatedAt);
    if (input.status === "active" || input.status === "trialing") {
      this.database.prepare("UPDATE tenants SET plan = 'studio' WHERE id = ?").run(input.tenantId);
    } else if (["canceled", "past_due", "incomplete"].includes(input.status)) {
      this.database.prepare("UPDATE tenants SET plan = 'free' WHERE id = ?").run(input.tenantId);
    }
    return this.billingState(input.tenantId);
  }

  requestRefund(principal: HostedPrincipal, reason: string) {
    const cleanReason = reason.trim().replace(/\s+/g, " ");
    if (cleanReason.length < 10 || cleanReason.length > 1000) throw new Error("Refund reason must contain between 10 and 1000 characters.");
    const id = stableId("ref");
    const createdAt = new Date().toISOString();
    const pending = this.database.prepare("SELECT COUNT(*) AS count FROM refund_requests WHERE tenant_id = ? AND status = 'requested'")
      .get(principal.tenantId) as { count: number };
    if (pending.count >= MAX_REFUND_REQUESTS_PER_TENANT) {
      throw new Error(`A workspace can have at most ${MAX_REFUND_REQUESTS_PER_TENANT} pending refund requests. Contact support for an existing request.`);
    }
    this.database.prepare("INSERT INTO refund_requests (id, tenant_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, principal.tenantId, principal.userId, cleanReason, createdAt);
    return { id, status: "requested" as const, createdAt, supportEmail: this.config.supportEmail };
  }

  recordUsage(principal: HostedPrincipal, eventName: string, quantity = 1, estimatedCostMicrousd = 0) {
    const allowed = new Set(["onboarding_completed", "project_created", "build_compiled", "contract_validated", "review_opened", "export_completed", "upload_rejected", "support_bundle_created"]);
    if (!allowed.has(eventName)) throw new Error("Unsupported telemetry event.");
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 10_000_000) throw new Error("Invalid telemetry quantity.");
    if (!Number.isSafeInteger(estimatedCostMicrousd) || estimatedCostMicrousd < 0 || estimatedCostMicrousd > 1_000_000_000) throw new Error("Invalid cost estimate.");
    this.database.prepare("INSERT INTO service_events (tenant_id, user_id, event_name, quantity, estimated_cost_microusd, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(principal.tenantId, principal.userId, eventName, quantity, estimatedCostMicrousd, new Date().toISOString());
    this.database.prepare(`
      DELETE FROM service_events
      WHERE tenant_id = ? AND id NOT IN (
        SELECT id FROM service_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(principal.tenantId, principal.tenantId, MAX_SERVICE_EVENTS_PER_TENANT);
  }

  usage(tenantId?: string): ServiceUsage {
    const filter = tenantId ? " WHERE tenant_id = ?" : "";
    const args = tenantId ? [tenantId] : [];
    const total = this.database.prepare(`SELECT COUNT(*) AS events, COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(estimated_cost_microusd), 0) AS cost FROM service_events${filter}`)
      .get(...args) as { events: number; quantity: number; cost: number };
    const rows = this.database.prepare(`SELECT event_name AS name, COUNT(*) AS events, COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(estimated_cost_microusd), 0) AS cost FROM service_events${filter} GROUP BY event_name ORDER BY event_name`)
      .all(...args) as { name: string; events: number; quantity: number; cost: number }[];
    return {
      events: total.events,
      quantity: total.quantity,
      estimatedCostMicrousd: total.cost,
      byEvent: rows.map((row) => ({ name: row.name, events: row.events, quantity: row.quantity, estimatedCostMicrousd: row.cost })),
    };
  }
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly windowMs: number, private readonly maximum: number) {}

  consume(key: string, now = Date.now()) {
    const current = this.buckets.get(key);
    const bucket = !current || now - current.startedAt >= this.windowMs ? { startedAt: now, count: 0 } : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 20_000) {
      for (const [candidate, value] of this.buckets) if (now - value.startedAt >= this.windowMs) this.buckets.delete(candidate);
      while (this.buckets.size > 20_000) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (!oldest) break;
        this.buckets.delete(oldest);
      }
    }
    return {
      allowed: bucket.count <= this.maximum,
      limit: this.maximum,
      remaining: Math.max(0, this.maximum - bucket.count),
      resetAt: new Date(bucket.startedAt + this.windowMs).toISOString(),
    };
  }
}

export function sessionTokenFromHeaders(authorization: string | undefined, cookieHeader: string | undefined) {
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...value] = part.trim().split("=");
    if (name === "bw_session") {
      try { return decodeURIComponent(value.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
}

export function validateBase64Upload(base64: string, maximumBytes: number) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error("Upload is not valid base64 data.");
  const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > maximumBytes) throw new Error(`Upload exceeds the configured ${maximumBytes}-byte compressed limit.`);
  return bytes;
}
