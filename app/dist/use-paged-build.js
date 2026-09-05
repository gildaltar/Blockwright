import { useEffect, useRef, useState } from "react";
import { useCallTool } from "./helpers.js";
import { buildPlacementPageFromToolResponse, loadBuildForView, } from "./lib/build-view-paging.js";
export function usePagedBuild(summary, initialPage, legacyBuild) {
    const { callToolAsync } = useCallTool("get_build_chunk");
    const callToolRef = useRef(callToolAsync);
    callToolRef.current = callToolAsync;
    const [state, setState] = useState({ loaded: 0, total: summary?.blockCount ?? 0, isLoading: Boolean(summary) });
    const summaryIdentity = summary ? `${summary.id}:${summary.hash}:${summary.blockCount}` : "";
    const initialPageIdentity = initialPage ? `${initialPage.buildId}:${initialPage.offset}:${initialPage.returned}:${initialPage.total}` : "";
    const legacyIdentity = legacyBuild ? `${legacyBuild.id}:${legacyBuild.hash}:${legacyBuild.placements.length}` : "";
    useEffect(() => {
        if (!summary) {
            setState({ loaded: 0, total: 0, isLoading: false });
            return;
        }
        let cancelled = false;
        setState({ loaded: initialPage?.returned ?? 0, total: summary.blockCount, isLoading: true });
        void loadBuildForView({
            summary,
            initialPage,
            legacyBuild,
            fetchPage: async ({ buildId, offset, limit }) => buildPlacementPageFromToolResponse(await callToolRef.current({ build: buildId, offset, limit })),
            onProgress: (loaded, total) => {
                if (!cancelled)
                    setState((current) => ({ ...current, loaded, total, isLoading: true }));
            },
        }).then((build) => {
            if (!cancelled)
                setState({ build, loaded: build.placements.length, total: build.placements.length, isLoading: false });
        }).catch((error) => {
            if (!cancelled)
                setState({ loaded: 0, total: summary.blockCount, isLoading: false, error: error instanceof Error ? error.message : "Build placements could not be loaded." });
        });
        return () => { cancelled = true; };
    }, [summaryIdentity, initialPageIdentity, legacyIdentity]);
    return state;
}
//# sourceMappingURL=use-paged-build.js.map