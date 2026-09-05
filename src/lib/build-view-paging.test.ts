import { describe, expect, it, vi } from "vitest";
import { compileBuild, summarizeBuild } from "./compiler.js";
import {
  BUILD_VIEW_INITIAL_PAGE_SIZE,
  BUILD_VIEW_LEGACY_INLINE_LIMIT,
  BUILD_VIEW_MAX_PLACEMENTS,
  BUILD_VIEW_PAGE_SIZE,
  buildPlacementPageFromToolResponse,
  createBuildPlacementPage,
  loadBuildForView,
  type BuildPlacementPage,
  type BuildSummary,
} from "./build-view-paging.js";
import type { BuildRecord, Placement } from "./types.js";

const compiled = compileBuild({
  name: "Paged View Fixture",
  edition: "java",
  version: "26.2",
  style: "nordic",
  dimensions: { width: 9, depth: 9, height: 9 },
  seed: "paged-view-fixture",
});

function placements(count: number): Placement[] {
  const source = compiled.placements[0];
  return Array.from({ length: count }, (_, index) => ({ ...source, x: index, y: 64 + Math.floor(index / 10_000) }));
}

function fixture(count: number) {
  const build = { ...compiled, placements: placements(count) };
  const summary = { ...summarizeBuild(build), blockCount: count } as BuildSummary;
  return { build, summary };
}

describe("build view placement paging", () => {
  it("assembles one immutable record from a bounded first page and sequential 5,000-placement tool calls", async () => {
    const { build, summary } = fixture(BUILD_VIEW_INITIAL_PAGE_SIZE + BUILD_VIEW_PAGE_SIZE * 2 + 3);
    const initialPage = createBuildPlacementPage(build, 0, BUILD_VIEW_INITIAL_PAGE_SIZE);
    const requests: { buildId: string; offset: number; limit: number }[] = [];
    const progress: number[] = [];
    const loaded = await loadBuildForView({
      summary,
      initialPage,
      fetchPage: async (request) => {
        requests.push(request);
        return createBuildPlacementPage(build, request.offset, request.limit);
      },
      onProgress: (count) => progress.push(count),
    });

    expect(requests).toEqual([
      { buildId: summary.id, offset: BUILD_VIEW_INITIAL_PAGE_SIZE, limit: BUILD_VIEW_PAGE_SIZE },
      { buildId: summary.id, offset: BUILD_VIEW_INITIAL_PAGE_SIZE + BUILD_VIEW_PAGE_SIZE, limit: BUILD_VIEW_PAGE_SIZE },
      { buildId: summary.id, offset: BUILD_VIEW_INITIAL_PAGE_SIZE + BUILD_VIEW_PAGE_SIZE * 2, limit: 3 },
    ]);
    expect(progress).toEqual([BUILD_VIEW_INITIAL_PAGE_SIZE, BUILD_VIEW_INITIAL_PAGE_SIZE + BUILD_VIEW_PAGE_SIZE, BUILD_VIEW_INITIAL_PAGE_SIZE + BUILD_VIEW_PAGE_SIZE * 2, build.placements.length]);
    expect(loaded).toEqual(build);
  });

  it("uses only a small identity-matched legacy build and never needs a tool call for that fallback", async () => {
    const { build, summary } = fixture(Math.min(75, BUILD_VIEW_LEGACY_INLINE_LIMIT));
    const fetchPage = vi.fn<() => Promise<BuildPlacementPage>>();
    const loaded = await loadBuildForView({ summary, legacyBuild: build, fetchPage });
    expect(loaded).toBe(build);
    expect(fetchPage).not.toHaveBeenCalled();

    const wrongIdentity = { ...build, id: "bw_wrong_legacy_identity" };
    await expect(loadBuildForView({
      summary,
      legacyBuild: wrongIdentity,
      fetchPage: async ({ offset, limit }) => createBuildPlacementPage(build, offset, limit),
    })).resolves.toEqual(build);
  });

  it("does not trust an oversized legacy metadata record", async () => {
    const { build, summary } = fixture(BUILD_VIEW_LEGACY_INLINE_LIMIT + 1);
    const fetchPage = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => createBuildPlacementPage(build, offset, limit));
    await expect(loadBuildForView({ summary, legacyBuild: build, fetchPage })).resolves.toEqual(build);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fails closed on cross-build, offset, total, count, and incomplete page responses", async () => {
    const { summary } = fixture(10);
    const base: BuildPlacementPage = { buildId: summary.id, offset: 0, returned: 10, total: 10, placements: placements(10) };
    const failures: BuildPlacementPage[] = [
      { ...base, buildId: "bw_other" },
      { ...base, offset: 1 },
      { ...base, total: 11 },
      { ...base, returned: 9 },
      { ...base, returned: 0, placements: [] },
    ];
    for (const page of failures) {
      await expect(loadBuildForView({ summary, fetchPage: async () => page })).rejects.toThrow();
    }
  });

  it("rejects summaries over the local placement ceiling and oversized initial pages", async () => {
    const { build, summary } = fixture(1);
    await expect(loadBuildForView({
      summary: { ...summary, blockCount: BUILD_VIEW_MAX_PLACEMENTS + 1 },
      fetchPage: async () => createBuildPlacementPage(build, 0, 1),
    })).rejects.toThrow(/2,000,000/);

    const tooLargeInitial = createBuildPlacementPage({ ...build, placements: placements(BUILD_VIEW_INITIAL_PAGE_SIZE + 1) }, 0, BUILD_VIEW_INITIAL_PAGE_SIZE + 1);
    await expect(loadBuildForView({
      summary: { ...summary, blockCount: BUILD_VIEW_INITIAL_PAGE_SIZE + 1 },
      initialPage: tooLargeInitial,
      fetchPage: async () => tooLargeInitial,
    })).rejects.toThrow(/invalid count/);
  });

  it("adapts MCP Apps structured content and private response metadata into a checked page", () => {
    const page = buildPlacementPageFromToolResponse({
      structuredContent: { buildId: compiled.id, offset: 0, returned: 1, total: 1 },
      meta: { placements: placements(1) },
    });
    expect(page).toMatchObject({ buildId: compiled.id, offset: 0, returned: 1, total: 1 });
    expect(page.placements).toHaveLength(1);
    expect(() => buildPlacementPageFromToolResponse({ meta: { placements: [] } })).toThrow(/structured page identity/);
  });
});
