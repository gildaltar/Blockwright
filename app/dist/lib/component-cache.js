/** Deterministic bounded LRU used for compiled component operation streams. */
export class ComponentCache {
    entries = new Map();
    maxEntries;
    maxWeight;
    totalWeight = 0;
    evictionCount = 0;
    constructor(options = {}) {
        this.maxEntries = positiveLimit(options.maxEntries, 256, "maxEntries");
        this.maxWeight = positiveLimit(options.maxWeight, 2_000_000, "maxWeight");
    }
    get(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return undefined;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }
    set(key, value, weight = 1) {
        const resolvedWeight = positiveLimit(weight, 1, "weight");
        const previous = this.entries.get(key);
        if (previous) {
            this.entries.delete(key);
            this.totalWeight -= previous.weight;
        }
        if (resolvedWeight > this.maxWeight)
            return false;
        this.entries.set(key, { value, weight: resolvedWeight });
        this.totalWeight += resolvedWeight;
        while (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey === undefined)
                break;
            const oldest = this.entries.get(oldestKey);
            this.entries.delete(oldestKey);
            this.totalWeight -= oldest.weight;
            this.evictionCount += 1;
        }
        return this.entries.has(key);
    }
    clear() {
        this.entries.clear();
        this.totalWeight = 0;
    }
    stats() {
        return { entries: this.entries.size, weight: this.totalWeight, evictions: this.evictionCount };
    }
}
function positiveLimit(value, fallback, label) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1)
        throw new Error(`COMPONENT_CACHE_LIMIT_INVALID: ${label} must be a positive safe integer.`);
    return resolved;
}
//# sourceMappingURL=component-cache.js.map