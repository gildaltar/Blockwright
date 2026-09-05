import { useEffect, useRef, useState } from "react";
import { useCallTool } from "./helpers.js";
import {
  buildPlacementPageFromToolResponse,
  loadBuildForView,
  type BuildPlacementPage,
  type BuildSummary,
} from "./lib/build-view-paging.js";
import type { BuildRecord } from "./lib/types.js";

export type PagedBuildState = {
  build?: BuildRecord;
  loaded: number;
  total: number;
  isLoading: boolean;
  error?: string;
};

export type UsePagedBuildOptions = {
  enabled?: boolean;
};

export function usePagedBuild(summary: BuildSummary | undefined, initialPage?: BuildPlacementPage, legacyBuild?: BuildRecord, options: UsePagedBuildOptions = {}): PagedBuildState {
  const { callToolAsync } = useCallTool("get_build_chunk");
  const callToolRef = useRef(callToolAsync);
  callToolRef.current = callToolAsync;
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<PagedBuildState>({ loaded: 0, total: summary?.blockCount ?? 0, isLoading: Boolean(summary && enabled) });

  const summaryIdentity = summary ? `${summary.id}:${summary.hash}:${summary.blockCount}` : "";
  const initialPageIdentity = initialPage ? `${initialPage.buildId}:${initialPage.offset}:${initialPage.returned}:${initialPage.total}` : "";
  const legacyIdentity = legacyBuild ? `${legacyBuild.id}:${legacyBuild.hash}:${legacyBuild.placements.length}` : "";

  useEffect(() => {
    if (!summary || !enabled) {
      setState({ loaded: 0, total: summary?.blockCount ?? 0, isLoading: false });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState({ loaded: initialPage?.returned ?? 0, total: summary.blockCount, isLoading: true });
    void loadBuildForView({
      summary,
      initialPage,
      legacyBuild,
      signal: controller.signal,
      fetchPage: async ({ buildId, offset, limit }) => {
        const response = await callToolRef.current({ build: buildId, offset, limit });
        if (controller.signal.aborted) {
          const error = new Error("Build placement loading was cancelled.");
          error.name = "AbortError";
          throw error;
        }
        return buildPlacementPageFromToolResponse(response);
      },
      onProgress: (loaded, total) => {
        if (!cancelled) setState((current) => ({ ...current, loaded, total, isLoading: true }));
      },
    }).then((build) => {
      if (!cancelled) setState({ build, loaded: build.placements.length, total: build.placements.length, isLoading: false });
    }).catch((error: unknown) => {
      if (!cancelled && !controller.signal.aborted) setState({ loaded: 0, total: summary.blockCount, isLoading: false, error: error instanceof Error ? error.message : "Build placements could not be loaded." });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, summaryIdentity, initialPageIdentity, legacyIdentity]);

  return state;
}
