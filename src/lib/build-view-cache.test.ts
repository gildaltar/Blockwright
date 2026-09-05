import { describe, expect, it } from "vitest";
import {
  HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS,
  HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS,
  HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL,
  HOSTED_BUILD_VIEW_CACHE_TTL_MS,
  PrincipalBuildViewCache,
  type BuildViewPrincipal,
} from "./build-view-cache.js";
import type { BuildRecord, Placement } from "./types.js";

const alpha: BuildViewPrincipal = { tenantId: "tenant-alpha", userId: "user-alpha" };
const beta: BuildViewPrincipal = { tenantId: "tenant-beta", userId: "user-beta" };

function build(id: string, placementCount = 1): BuildRecord {
  const placement: Placement = { x: 0, y: 64, z: 0, block: "minecraft:stone", phase: "fixture" };
  return { id, hash: id.padEnd(64, "0").slice(0, 64), placements: Array.from({ length: placementCount }, () => ({ ...placement })) } as BuildRecord;
}

describe("principal-scoped build view cache", () => {
  it("keeps the release bounds explicit", () => {
    expect(HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS).toBe(4);
    expect(HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS).toBe(500_000);
    expect(HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL).toBe(2);
    expect(HOSTED_BUILD_VIEW_CACHE_TTL_MS).toBe(15 * 60_000);
  });

  it("never exposes one tenant or user cache entry to another principal", () => {
    const cache = new PrincipalBuildViewCache();
    const record = build("bw_private");
    expect(cache.set(alpha, record)).toBe(true);
    expect(cache.get(alpha, record.id)).toBe(record);
    expect(cache.get(beta, record.id)).toBeUndefined();
    expect(cache.get({ tenantId: alpha.tenantId, userId: "different-user" }, record.id)).toBeUndefined();
  });

  it("expires entries and fails a cache lookup without any recompilation path", () => {
    let now = 1_000;
    const cache = new PrincipalBuildViewCache({ ttlMs: 100, now: () => now });
    const record = build("bw_expiring");
    cache.set(alpha, record);
    now += 99;
    expect(cache.get(alpha, record.id)).toBe(record);
    now += 101;
    expect(cache.get(alpha, record.id)).toBeUndefined();
    expect(cache.stats()).toEqual({ records: 0, placements: 0 });
  });

  it("evicts least-recently-used records at per-principal, global-record, and total-placement bounds", () => {
    const perPrincipal = new PrincipalBuildViewCache({ maxRecords: 10, maxPlacements: 20, maxRecordsPerPrincipal: 2 });
    perPrincipal.set(alpha, build("bw_alpha_1"));
    perPrincipal.set(alpha, build("bw_alpha_2"));
    perPrincipal.get(alpha, "bw_alpha_1");
    perPrincipal.set(alpha, build("bw_alpha_3"));
    expect(perPrincipal.get(alpha, "bw_alpha_2")).toBeUndefined();
    expect(perPrincipal.get(alpha, "bw_alpha_1")).toBeDefined();
    expect(perPrincipal.get(alpha, "bw_alpha_3")).toBeDefined();

    const globallyBounded = new PrincipalBuildViewCache({ maxRecords: 2, maxPlacements: 4, maxRecordsPerPrincipal: 2 });
    globallyBounded.set(alpha, build("bw_first", 2));
    globallyBounded.set(beta, build("bw_second", 2));
    globallyBounded.get(alpha, "bw_first");
    globallyBounded.set(beta, build("bw_third", 2));
    expect(globallyBounded.get(beta, "bw_second")).toBeUndefined();
    expect(globallyBounded.stats()).toEqual({ records: 2, placements: 4 });
  });

  it("refuses a single record that cannot fit instead of evicting useful entries for it", () => {
    const cache = new PrincipalBuildViewCache({ maxRecords: 4, maxPlacements: 3, maxRecordsPerPrincipal: 2 });
    const retained = build("bw_retained", 2);
    cache.set(alpha, retained);
    expect(cache.set(beta, build("bw_too_large", 4))).toBe(false);
    expect(cache.get(alpha, retained.id)).toBe(retained);
    expect(cache.stats()).toEqual({ records: 1, placements: 2 });
  });
});
