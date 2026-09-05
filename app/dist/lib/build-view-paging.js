export const BUILD_VIEW_INITIAL_PAGE_SIZE = 500;
export const BUILD_VIEW_PAGE_SIZE = 5_000;
export const BUILD_VIEW_LEGACY_INLINE_LIMIT = 2_000;
export const BUILD_VIEW_MAX_PLACEMENTS = 2_000_000;
function assertPlacementCount(blockCount) {
    if (!Number.isSafeInteger(blockCount) || blockCount < 0 || blockCount > BUILD_VIEW_MAX_PLACEMENTS) {
        throw new Error(`Build placement count must be an integer from 0 to ${BUILD_VIEW_MAX_PLACEMENTS.toLocaleString()}.`);
    }
}
function assertPlacement(value, index) {
    if (!value || typeof value !== "object")
        throw new Error(`Build placement ${index.toLocaleString()} is not an object.`);
    const placement = value;
    if (!Number.isSafeInteger(placement.x) || !Number.isSafeInteger(placement.y) || !Number.isSafeInteger(placement.z)) {
        throw new Error(`Build placement ${index.toLocaleString()} has a non-integer coordinate.`);
    }
    if (typeof placement.block !== "string" || !placement.block || typeof placement.phase !== "string") {
        throw new Error(`Build placement ${index.toLocaleString()} is missing its canonical block or phase.`);
    }
}
function validatedPage(summary, page, expectedOffset, maximumReturned) {
    if (!page || typeof page !== "object")
        throw new Error("Build placement page is missing.");
    if (page.buildId !== summary.id)
        throw new Error(`Build placement page belongs to ${page.buildId || "an unknown build"}, not ${summary.id}.`);
    if (page.offset !== expectedOffset)
        throw new Error(`Build placement page started at ${page.offset}, but offset ${expectedOffset} was required.`);
    if (page.total !== summary.blockCount)
        throw new Error(`Build placement page reports ${page.total} total placements, but the immutable summary reports ${summary.blockCount}.`);
    if (!Number.isSafeInteger(page.returned) || page.returned < 0 || page.returned > maximumReturned) {
        throw new Error(`Build placement page returned an invalid count of ${String(page.returned)}.`);
    }
    if (!Array.isArray(page.placements) || page.placements.length !== page.returned) {
        throw new Error("Build placement page metadata does not match its declared returned count.");
    }
    if (expectedOffset + page.returned > summary.blockCount)
        throw new Error("Build placement page exceeds the immutable placement count.");
    if (expectedOffset < summary.blockCount && page.returned === 0)
        throw new Error("Build placement paging stopped before every placement was returned.");
    page.placements.forEach((placement, index) => assertPlacement(placement, expectedOffset + index));
    return page;
}
function validLegacyBuild(summary, legacyBuild) {
    return Boolean(legacyBuild
        && summary.blockCount <= BUILD_VIEW_LEGACY_INLINE_LIMIT
        && legacyBuild.id === summary.id
        && legacyBuild.hash === summary.hash
        && Array.isArray(legacyBuild.placements)
        && legacyBuild.placements.length === summary.blockCount);
}
export function createBuildPlacementPage(build, offset, limit) {
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, BUILD_VIEW_PAGE_SIZE) : BUILD_VIEW_PAGE_SIZE;
    const placements = build.placements.slice(safeOffset, safeOffset + safeLimit);
    return { buildId: build.id, offset: safeOffset, returned: placements.length, total: build.placements.length, placements };
}
export function createInitialBuildPlacementPage(build) {
    return createBuildPlacementPage(build, 0, BUILD_VIEW_INITIAL_PAGE_SIZE);
}
export function buildPlacementPageFromToolResponse(response) {
    if (!response || typeof response !== "object")
        throw new Error("Build placement tool returned no response.");
    const envelope = response;
    if (!envelope.structuredContent || typeof envelope.structuredContent !== "object") {
        throw new Error("Build placement tool returned no structured page identity.");
    }
    const structured = envelope.structuredContent;
    const metadata = envelope.meta && typeof envelope.meta === "object" ? envelope.meta : undefined;
    return {
        buildId: String(structured.buildId ?? ""),
        offset: Number(structured.offset),
        returned: Number(structured.returned),
        total: Number(structured.total),
        placements: metadata?.placements,
    };
}
export async function loadBuildForView({ summary, fetchPage, initialPage, legacyBuild, onProgress }) {
    assertPlacementCount(summary.blockCount);
    if (!initialPage && validLegacyBuild(summary, legacyBuild)) {
        legacyBuild.placements.forEach(assertPlacement);
        onProgress?.(summary.blockCount, summary.blockCount);
        return legacyBuild;
    }
    const placements = [];
    if (initialPage) {
        const page = validatedPage(summary, initialPage, 0, BUILD_VIEW_INITIAL_PAGE_SIZE);
        placements.push(...page.placements);
        onProgress?.(placements.length, summary.blockCount);
    }
    while (placements.length < summary.blockCount) {
        const offset = placements.length;
        const limit = Math.min(BUILD_VIEW_PAGE_SIZE, summary.blockCount - offset);
        const page = validatedPage(summary, await fetchPage({ buildId: summary.id, offset, limit }), offset, limit);
        placements.push(...page.placements);
        onProgress?.(placements.length, summary.blockCount);
    }
    if (placements.length !== summary.blockCount)
        throw new Error("Build placement paging did not reproduce the immutable placement count.");
    const { blockCount: _blockCount, ...shell } = summary;
    return { ...shell, placements };
}
//# sourceMappingURL=build-view-paging.js.map