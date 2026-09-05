export const REVIEWER_LEASE_CHANNEL = "blockwright-reviewer-3d-lease-v1";
export const REVIEWER_LEASE_STORAGE_KEY = "blockwright:reviewer:3d-lease:v1";
export const REVIEWER_LEASE_MESSAGE = "blockwright-reviewer-3d-active";

export type ReviewerLease = {
  type: typeof REVIEWER_LEASE_MESSAGE;
  token: string;
  activatedAt: number;
};

export function reviewer3dEnabled(viewerActive: boolean, displayMode: string) {
  return viewerActive && displayMode === "fullscreen";
}

export function createReviewerLease(token: string, activatedAt = Date.now()): ReviewerLease {
  return { type: REVIEWER_LEASE_MESSAGE, token, activatedAt };
}

export function isForeignReviewerLease(candidate: unknown, localToken: string): candidate is ReviewerLease {
  if (!candidate || typeof candidate !== "object") return false;
  const lease = candidate as Partial<ReviewerLease>;
  return lease.type === REVIEWER_LEASE_MESSAGE
    && typeof lease.token === "string"
    && lease.token.length > 0
    && lease.token !== localToken
    && typeof lease.activatedAt === "number"
    && Number.isFinite(lease.activatedAt);
}

export function summarizeReviewerMaterials(materialCounts: Record<string, number>, visibleLimit = 4) {
  const entries = Object.entries(materialCounts).sort(([, a], [, b]) => b - a || 0);
  const limit = Number.isSafeInteger(visibleLimit) && visibleLimit > 0 ? visibleLimit : 4;
  return {
    materialCount: entries.length,
    visible: entries.slice(0, limit),
    hiddenCount: Math.max(0, entries.length - limit),
  };
}
