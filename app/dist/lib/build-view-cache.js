export const HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS = 4;
export const HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS = 500_000;
export const HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL = 2;
export const HOSTED_BUILD_VIEW_CACHE_TTL_MS = 15 * 60_000;
const positiveInteger = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback);
function principalKey(principal) {
    return JSON.stringify([principal.tenantId, principal.userId]);
}
function entryKey(principal, buildId) {
    return JSON.stringify([principal.tenantId, principal.userId, buildId]);
}
export class PrincipalBuildViewCache {
    maxRecords;
    maxPlacements;
    maxRecordsPerPrincipal;
    ttlMs;
    now;
    entries = new Map();
    placementCount = 0;
    constructor(options = {}) {
        this.maxRecords = positiveInteger(options.maxRecords, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS);
        this.maxPlacements = positiveInteger(options.maxPlacements, HOSTED_BUILD_VIEW_CACHE_MAX_PLACEMENTS);
        this.maxRecordsPerPrincipal = positiveInteger(options.maxRecordsPerPrincipal, HOSTED_BUILD_VIEW_CACHE_MAX_RECORDS_PER_PRINCIPAL);
        this.ttlMs = positiveInteger(options.ttlMs, HOSTED_BUILD_VIEW_CACHE_TTL_MS);
        this.now = options.now ?? Date.now;
    }
    remove(key) {
        const existing = this.entries.get(key);
        if (!existing)
            return;
        this.entries.delete(key);
        this.placementCount -= existing.build.placements.length;
    }
    pruneExpired(now) {
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now)
                this.remove(key);
        }
    }
    oldestKeyForPrincipal(key) {
        for (const [entryKeyValue, entry] of this.entries) {
            if (entry.principalKey === key)
                return entryKeyValue;
        }
        return undefined;
    }
    set(principal, build) {
        const now = this.now();
        this.pruneExpired(now);
        const key = entryKey(principal, build.id);
        this.remove(key);
        if (build.placements.length > this.maxPlacements)
            return false;
        const owner = principalKey(principal);
        this.entries.set(key, { build, principalKey: owner, expiresAt: now + this.ttlMs });
        this.placementCount += build.placements.length;
        while ([...this.entries.values()].filter((entry) => entry.principalKey === owner).length > this.maxRecordsPerPrincipal) {
            const oldest = this.oldestKeyForPrincipal(owner);
            if (!oldest)
                break;
            this.remove(oldest);
        }
        while (this.entries.size > this.maxRecords || this.placementCount > this.maxPlacements) {
            const oldest = this.entries.keys().next().value;
            if (!oldest)
                break;
            this.remove(oldest);
        }
        return this.entries.has(key);
    }
    get(principal, buildId) {
        const now = this.now();
        this.pruneExpired(now);
        const key = entryKey(principal, buildId);
        const entry = this.entries.get(key);
        if (!entry)
            return undefined;
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
//# sourceMappingURL=build-view-cache.js.map