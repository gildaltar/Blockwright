export const REVIEWER_LEASE_CHANNEL = "blockwright-reviewer-3d-lease-v1";
export const REVIEWER_LEASE_STORAGE_KEY = "blockwright:reviewer:3d-lease:v1";
export const REVIEWER_LEASE_MESSAGE = "blockwright-reviewer-3d-active";
export function reviewer3dEnabled(viewerActive, displayMode) {
    return viewerActive && displayMode === "fullscreen";
}
export function createReviewerLease(token, activatedAt = Date.now()) {
    return { type: REVIEWER_LEASE_MESSAGE, token, activatedAt };
}
export function isForeignReviewerLease(candidate, localToken) {
    if (!candidate || typeof candidate !== "object")
        return false;
    const lease = candidate;
    return lease.type === REVIEWER_LEASE_MESSAGE
        && typeof lease.token === "string"
        && lease.token.length > 0
        && lease.token !== localToken
        && typeof lease.activatedAt === "number"
        && Number.isFinite(lease.activatedAt);
}
export function summarizeReviewerMaterials(materialCounts, visibleLimit = 4) {
    const entries = Object.entries(materialCounts).sort(([, a], [, b]) => b - a || 0);
    const limit = Number.isSafeInteger(visibleLimit) && visibleLimit > 0 ? visibleLimit : 4;
    return {
        materialCount: entries.length,
        visible: entries.slice(0, limit),
        hiddenCount: Math.max(0, entries.length - limit),
    };
}
//# sourceMappingURL=reviewer-lifecycle.js.map