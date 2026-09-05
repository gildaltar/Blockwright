import type { BuildRecord } from "./types.js";

export const HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS = 4;
export const HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS = 500_000;
export const HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL = 2;
export const HOSTED_BUILD_VIEW_CACHE_TTL_MS = 15 * 60_000;

export type BuildViewPrincipal = {
  tenantId: string;
  userId: string;
};

type CacheEntry = {
  build: BuildRecord;
  principalKey: string;
  expiresAt: number;
};

type PrincipalBuildViewCacheOptions = {
  maxRecords?: number;
  maxPlacements?: number;
  maxRecordsPerPrincipal?: number;
  ttlMs?: number;
  now?: () => number;
};

const positiveInteger = (value: number | undefined, fallback: number) => (
  Number.isSafeInteger(value) && value! > 0 ? value! : fallback
);

function principalKey(principal: BuildViewPrincipal) {
  return JSON.stringify([principal.tenantId, principal.userId]);
}

function entryKey(principal: BuildViewPrincipal, buildId: string) {
  return JSON.stringify([principal.tenantId, principal.userId, buildId]);
}

export class PrincipalBuildViewCache {
  readonly maxRecords: number;
  readonly maxPlacements: number;
  readonly maxRecordsPerPrincipal: number;
  readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();
  private placementCount = 0;

  constructor(options: PrincipalBuildViewCacheOptions = {}) {
    this.maxRecords = positiveInteger(options.maxRecords, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS);
    this.maxPlacements = positiveInteger(options.maxPlacements, HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS);
    this.maxRecordsPerPrincipal = positiveInteger(options.maxRecordsPerPrincipal, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL);
    this.ttlMs = positiveInteger(options.ttlMs, HOSTED_BUILD_VIEW_CACHE_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  private remove(key: string) {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.delete(key);
    this.placementCount -= existing.build.placements.length;
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(key);
    }
  }

  private oldestKeyForPrincipal(key: string) {
    for (const [entryKeyValue, entry] of this.entries) {
      if (entry.principalKey === key) return entryKeyValue;
    }
    return undefined;
  }

  set(principal: BuildViewPrincipal, build: BuildRecord) {
    const now = this.now();
    this.pruneExpired(now);
    const key = entryKey(principal, build.id);
    this.remove(key);
    if (build.placements.length > this.maxPlacements) return false;

    const owner = principalKey(principal);
    this.entries.set(key, { build, principalKey: owner, expiresAt: now + this.ttlMs });
    this.placementCount += build.placements.length;

    while ([...this.entries.values()].filter((entry) => entry.principalKey === owner).length > this.maxRecordsPerPrincipal) {
      const oldest = this.oldestKeyForPrincipal(owner);
      if (!oldest) break;
      this.remove(oldest);
    }
    while (this.entries.size > this.maxRecords || this.placementCount > this.maxPlacements) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
    return this.entries.has(key);
  }

  get(principal: BuildViewPrincipal, buildId: string) {
    const now = this.now();
    this.pruneExpired(now);
    const key = entryKey(principal, buildId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    entry.expiresAt = now + this.ttlMs;
    this.entries.set(key, entry);
    return entry.build;
  }

  stats() {
    this.pruneExpired(this.now());
    return { records: this.entries.size, placements: this.placementCount };
  }
}
