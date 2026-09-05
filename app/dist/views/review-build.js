import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Box as DreiBox, Edges, Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { AlertTriangle, Box as BoxIcon, BoxSelect, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Crosshair, Download, Edit3, Eye, FileInput, Focus, HelpCircle, Layers3, LocateFixed, Maximize2, MousePointer2, Orbit, RotateCcw, Ruler, Search, Trash2, Undo2, Upload, X, } from "lucide-react";
import { useDisplayMode, useDownload, useLayout, useRequestClose, useViewState } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import {} from "../lib/build-view-paging.js";
import { loadResourcePack, placementTextureKey } from "../lib/resource-pack.js";
import { countPlacementsWithin, getReviewStateBuildStatus, getReviewBoundsMetrics, getReviewMeasurement, isRoofPlacement, MAX_REVIEW_ANNOTATIONS, MAX_REVIEW_IMPORT_BYTES, MAX_REVIEW_NOTE_LENGTH, MIN_REVIEW_TEXT_SEARCH_LENGTH, parseReviewCoordinate, prependReviewAnnotation, REVIEW_CATEGORIES, searchReviewPlacements, validateReviewDocument, } from "../lib/reviewer.js";
import { createReviewerLease, isForeignReviewerLease, REVIEWER_LEASE_CHANNEL, REVIEWER_LEASE_STORAGE_KEY, reviewer3dEnabled, summarizeReviewerMaterials, } from "../lib/reviewer-lifecycle.js";
import { reviewerBlockColor, reviewerGeometryParts, updateReviewerInstanceMesh, } from "../lib/reviewer-rendering.js";
import { usePagedBuild } from "../use-paged-build.js";
const COLORS = {
    change: "#e9ad4f", fix: "#ef6b5b", remove: "#c74f76", liked: "#5ec6a7",
};
function useMobileRenderingProfile() {
    const query = "(max-width: 620px), (pointer: coarse)";
    const [mobile, setMobile] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function")
            return;
        const media = window.matchMedia(query);
        const update = () => setMobile(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    return mobile;
}
const coordinateKey = ({ x, y, z }) => `${x},${y},${z}`;
const formatBlock = (block) => block.replace("minecraft:", "").split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
const stateString = (state) => Object.entries(state ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${String(value)}`).join(", ");
const pointsEqual = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y && a.z === b.z);
const boundsCenter = (bounds) => ({ x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 });
function useResourcePackTextures(texturePack) {
    const textureMaps = useMemo(() => {
        const maps = new Map();
        if (!texturePack)
            return maps;
        const loader = new THREE.TextureLoader();
        for (const faces of texturePack.textures.values()) {
            for (const url of Object.values(faces)) {
                if (maps.has(url))
                    continue;
                const map = loader.load(url);
                map.colorSpace = THREE.SRGBColorSpace;
                map.magFilter = THREE.NearestFilter;
                map.minFilter = THREE.NearestMipmapNearestFilter;
                maps.set(url, map);
            }
        }
        return maps;
    }, [texturePack]);
    useEffect(() => () => { for (const map of textureMaps.values())
        map.dispose(); }, [textureMaps]);
    return textureMaps;
}
function InstancePart({ placements, part, block, textures, textureMaps, dimmed, onPick }) {
    const ref = useRef(null);
    const invalidate = useThree((state) => state.invalidate);
    const material = useMemo(() => {
        const url = textures?.top;
        const map = url ? textureMaps.get(url) : undefined;
        const emissive = part.role === "lantern" ? new THREE.Color("#b86b22") : new THREE.Color("#000000");
        return new THREE.MeshStandardMaterial({ color: url ? "#ffffff" : part.role === "metal" ? "#242a2c" : reviewerBlockColor(block), map, roughness: part.role === "metal" ? .45 : .88, metalness: part.role === "metal" ? .5 : 0, transparent: dimmed || /glass|pane|leaves/.test(block), opacity: dimmed ? .2 : 1, alphaTest: /glass|pane|leaves|door|trapdoor/.test(block) ? .08 : 0, emissive, emissiveIntensity: part.role === "lantern" ? 1.1 : 0 });
    }, [block, dimmed, part.role, textureMaps, textures?.top]);
    useEffect(() => () => { material.dispose(); }, [material]);
    useEffect(() => {
        if (!ref.current)
            return;
        updateReviewerInstanceMesh(ref.current, placements, part, invalidate);
    }, [invalidate, placements, part]);
    return _jsx("instancedMesh", { ref: ref, args: [undefined, undefined, placements.length], material: material, frustumCulled: true, onClick: (event) => { event.stopPropagation(); if (event.instanceId !== undefined)
            onPick(placements[event.instanceId]); }, children: _jsx("boxGeometry", { args: [1, 1, 1] }) });
}
function SelectionBox({ selection, color = "#f2b661" }) {
    if (!selection)
        return null;
    const size = [selection.max.x - selection.min.x + 1.08, selection.max.y - selection.min.y + 1.08, selection.max.z - selection.min.z + 1.08];
    const center = [(selection.min.x + selection.max.x) / 2, (selection.min.y + selection.max.y) / 2, (selection.min.z + selection.max.z) / 2];
    return _jsxs(DreiBox, { args: size, position: center, children: [_jsx("meshBasicMaterial", { transparent: true, opacity: .035, color: color, depthWrite: false }), _jsx(Edges, { color: color })] });
}
function ReviewScene({ build, maxLayer, hideRoof, cameraPreset, cameraTarget, cameraDistance, orthographic, selection, annotations, texturePack, mobileRendering, onPick }) {
    const textureMaps = useResourcePackTextures(texturePack);
    const groups = useMemo(() => {
        const map = new Map();
        for (const placement of build.placements) {
            if (placement.y > maxLayer || (hideRoof && isRoofPlacement(placement, build)))
                continue;
            const key = placementTextureKey(placement.block, placement.state);
            const group = map.get(key) ?? { placement, placements: [], parts: reviewerGeometryParts(placement, build.input.edition) };
            group.placements.push(placement);
            map.set(key, group);
        }
        return [...map.entries()];
    }, [build, hideRoof, maxLayer]);
    const buildCenter = [(build.bounds.min.x + build.bounds.max.x) / 2, (build.bounds.min.y + build.bounds.max.y) / 2, (build.bounds.min.z + build.bounds.max.z) / 2];
    const center = cameraTarget ? [cameraTarget.x, cameraTarget.y, cameraTarget.z] : buildCenter;
    const fullRadius = Math.max(build.bounds.dimensions.width, build.bounds.dimensions.depth, build.bounds.dimensions.height) * 1.35;
    const radius = Math.max(6, Math.min(fullRadius, cameraDistance ?? fullRadius));
    const cameraKey = `${cameraPreset}-${coordinateKey({ x: center[0], y: center[1], z: center[2] })}-${radius.toFixed(2)}`;
    const positions = {
        iso: [center[0] + radius, center[1] + radius * .65, center[2] - radius],
        top: [center[0], center[1] + radius * 1.6, center[2] + .01],
        north: [center[0], center[1] + radius * .3, center[2] - radius * 1.3],
        south: [center[0], center[1] + radius * .3, center[2] + radius * 1.3],
        east: [center[0] + radius * 1.3, center[1] + radius * .3, center[2]],
        west: [center[0] - radius * 1.3, center[1] + radius * .3, center[2]],
    };
    return _jsxs(Canvas, { frameloop: "demand", shadows: !mobileRendering, dpr: mobileRendering ? 1 : [1, 1.5], gl: { antialias: !mobileRendering, alpha: false, powerPreference: mobileRendering ? "low-power" : "high-performance" }, onPointerMissed: () => undefined, children: [_jsx("color", { attach: "background", args: ["#06141e"] }), orthographic
                ? _jsx(OrthographicCamera, { makeDefault: true, position: positions[cameraPreset], zoom: Math.max(4, 850 / radius), onUpdate: (camera) => camera.lookAt(...center) }, `review-ortho-${cameraKey}`)
                : _jsx(PerspectiveCamera, { makeDefault: true, position: positions[cameraPreset], fov: 42, onUpdate: (camera) => camera.lookAt(...center) }, `review-perspective-${cameraKey}`), _jsx("ambientLight", { intensity: 1.05, color: "#a8bfd0" }), _jsx("directionalLight", { position: [center[0] + radius, center[1] + radius, center[2] - radius], intensity: 2.2, color: "#f5e7cf", castShadow: !mobileRendering }), groups.flatMap(([key, group]) => group.parts.map((part, index) => _jsx(InstancePart, { placements: group.placements, part: part, block: group.placement.block, textures: texturePack?.textures.get(key), textureMaps: textureMaps, dimmed: false, onPick: onPick }, `${key}-${index}`))), _jsx(SelectionBox, { selection: selection }), annotations.map((annotation) => _jsx(SelectionBox, { selection: annotation.bounds, color: annotation.resolved ? "#536b76" : COLORS[annotation.category] }, annotation.id)), _jsx(Grid, { position: [buildCenter[0], build.bounds.min.y - .51, buildCenter[2]], args: [Math.max(64, fullRadius * 2), Math.max(64, fullRadius * 2)], cellSize: 1, cellColor: "#294554", sectionSize: 5, sectionColor: "#3f6170", fadeDistance: fullRadius * 1.8, infiniteGrid: true }), _jsx(OrbitControls, { makeDefault: true, target: center, minDistance: 2, maxDistance: fullRadius * 4, maxPolarAngle: Math.PI / 2.01, enabled: true })] });
}
function orderedBounds(a, b) {
    return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) } };
}
function ReviewButton({ label, shortcut, active, disabled, onClick, children }) {
    const title = shortcut ? `${label} (${shortcut})` : label;
    return _jsx("button", { type: "button", className: `review-icon-button ${active ? "active" : ""}`, "aria-label": title, "aria-pressed": active === undefined ? undefined : active, title: title, disabled: disabled, onClick: onClick, children: children });
}
function reviewDefaults(build) {
    return {
        reviewBuildId: build?.id,
        reviewBuildHash: build?.hash,
        mode: "orbit",
        layer: build?.bounds.max.y ?? 0,
        hideRoof: false,
        orthographic: false,
        cameraPreset: "iso",
        cameraTarget: undefined,
        cameraDistance: undefined,
        annotations: [],
        selection: undefined,
        anchor: undefined,
        searchQuery: "",
        searchCursor: -1,
        auditQuery: "",
        auditSeverity: "all",
        annotationQuery: "",
        annotationCategory: "all",
        annotationStatus: "all",
        focusedFindingCode: undefined,
        focusedFindingIndex: undefined,
    };
}
export default function ReviewBuildView() {
    const { output, isPending, responseMetadata } = useToolInfo();
    const [displayMode, setDisplayMode] = useDisplayMode();
    const { maxHeight } = useLayout();
    const { download } = useDownload();
    const requestClose = useRequestClose();
    const mobileRendering = useMobileRenderingProfile();
    const metadata = responseMetadata;
    const [viewerActive, setViewerActive] = useState(false);
    const [viewerOpening, setViewerOpening] = useState(false);
    const shouldLoadBuild = reviewer3dEnabled(viewerActive, displayMode);
    const pagedBuild = usePagedBuild(metadata?.buildSummary, metadata?.buildPage, metadata?.build, { enabled: shouldLoadBuild });
    const build = shouldLoadBuild ? pagedBuild.build : undefined;
    const audit = metadata?.audit;
    const summary = output?.review;
    const maxBuildLayer = (build ?? metadata?.buildSummary)?.bounds.max.y ?? 0;
    const minBuildLayer = (build ?? metadata?.buildSummary)?.bounds.min.y ?? 0;
    const [persistedReviewState, setReviewState] = useViewState(reviewDefaults(build));
    const persistedBuildStatus = build ? getReviewStateBuildStatus(persistedReviewState, build) : "unbound";
    // Never render unverified or mismatched state, even for the single paint
    // before the synchronization/migration effect runs.
    const reviewState = persistedBuildStatus === "current" ? persistedReviewState : reviewDefaults(build);
    const mode = reviewState.mode ?? "orbit";
    const layer = reviewState.layer ?? maxBuildLayer;
    const hideRoof = reviewState.hideRoof ?? false;
    const orthographic = reviewState.orthographic ?? false;
    const cameraPreset = reviewState.cameraPreset ?? "iso";
    const cameraTarget = reviewState.cameraTarget;
    const cameraDistance = reviewState.cameraDistance;
    const annotations = Array.isArray(reviewState.annotations) ? reviewState.annotations : [];
    const selection = reviewState.selection;
    const anchor = reviewState.anchor;
    const searchQuery = reviewState.searchQuery ?? "";
    const auditQuery = reviewState.auditQuery ?? "";
    const auditSeverity = reviewState.auditSeverity ?? "all";
    const annotationQuery = reviewState.annotationQuery ?? "";
    const annotationCategory = reviewState.annotationCategory ?? "all";
    const annotationStatus = reviewState.annotationStatus ?? "all";
    const [category, setCategory] = useState("fix");
    const [note, setNote] = useState("");
    const [editingAnnotationId, setEditingAnnotationId] = useState();
    const [lastDeleted, setLastDeleted] = useState();
    const [activity, setActivity] = useState();
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [texturePack, setTexturePack] = useState(null);
    const [textureStatus, setTextureStatus] = useState("Procedural fallback");
    const importRef = useRef(null);
    const textureRef = useRef(null);
    const searchRef = useRef(null);
    const viewerTokenRef = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`);
    const activeBuildIdentity = build ? `${build.id}:${build.hash}` : "";
    const activeBuildIdentityRef = useRef(activeBuildIdentity);
    activeBuildIdentityRef.current = activeBuildIdentity;
    const placementByCoordinate = useMemo(() => {
        const index = new Map();
        for (const placement of build?.placements ?? [])
            index.set(coordinateKey(placement), placement);
        return index;
    }, [build]);
    const visibleBlockCount = useMemo(() => build?.placements.reduce((total, placement) => total + (placement.y <= layer && (!hideRoof || !isRoofPlacement(placement, build)) ? 1 : 0), 0) ?? 0, [build, hideRoof, layer]);
    const searchResults = useMemo(() => {
        if (!build || parseReviewCoordinate(searchQuery))
            return { matches: [], capped: false, tooShort: false };
        return searchReviewPlacements(build.placements, searchQuery);
    }, [build, searchQuery]);
    const searchMatches = searchResults.matches;
    const filteredFindings = useMemo(() => {
        if (!audit)
            return [];
        const query = auditQuery.trim().toLowerCase();
        return audit.findings.filter((finding) => (auditSeverity === "all" || finding.severity === auditSeverity)
            && (!query || `${finding.code.replaceAll("_", " ")} ${finding.message} ${finding.coordinates.map(coordinateKey).join(" ")}`.toLowerCase().includes(query)));
    }, [audit, auditQuery, auditSeverity]);
    const auditStops = useMemo(() => filteredFindings.flatMap((finding) => finding.coordinates.map((coordinate, coordinateIndex) => ({ finding, coordinate, coordinateIndex }))), [filteredFindings]);
    const filteredAnnotations = useMemo(() => {
        const query = annotationQuery.trim().toLowerCase();
        return annotations.filter((annotation) => (annotationCategory === "all" || annotation.category === annotationCategory)
            && (annotationStatus === "all" || (annotationStatus === "resolved") === Boolean(annotation.resolved))
            && (!query || `${annotation.category} ${annotation.note} ${annotation.pickedBlock ?? ""} ${coordinateKey(annotation.bounds.min)} ${coordinateKey(annotation.bounds.max)}`.toLowerCase().includes(query)));
    }, [annotationCategory, annotationQuery, annotationStatus, annotations]);
    useEffect(() => {
        if (!build)
            return;
        const status = getReviewStateBuildStatus(persistedReviewState, build);
        if (status === "different") {
            setReviewState(reviewDefaults(build));
            setCategory("fix");
            setNote("");
            setEditingAnnotationId(undefined);
            setLastDeleted(undefined);
            setShowShortcuts(false);
            setTexturePack(null);
            setTextureStatus("Procedural fallback");
            setActivity({ kind: "info", message: "Build changed; previous build-bound review state was cleared." });
            return;
        }
        if (status === "unbound") {
            let migratedAnnotations = [];
            const candidates = Array.isArray(persistedReviewState.annotations) ? persistedReviewState.annotations : [];
            try {
                migratedAnnotations = validateReviewDocument({ schemaVersion: 1, type: "blockwright-review", build: { id: build.id, hash: build.hash }, annotations: candidates }, build);
            }
            catch {
                // Legacy view state lacks immutable identity. Preserve only annotations
                // that can be proven canonical for the current build.
            }
            setReviewState({ ...reviewDefaults(build), annotations: migratedAnnotations });
            if (candidates.length && !migratedAnnotations.length)
                setActivity({ kind: "info", message: "Older saved annotations could not be verified for this build and were cleared." });
            return;
        }
        const persistedAnnotations = Array.isArray(persistedReviewState.annotations) ? persistedReviewState.annotations : [];
        const limitedAnnotations = persistedAnnotations.length > MAX_REVIEW_ANNOTATIONS ? persistedAnnotations.slice(0, MAX_REVIEW_ANNOTATIONS) : persistedAnnotations;
        const clampedLayer = typeof persistedReviewState.layer === "number" && persistedReviewState.layer >= build.bounds.min.y && persistedReviewState.layer <= build.bounds.max.y ? persistedReviewState.layer : build.bounds.max.y;
        if (limitedAnnotations !== persistedReviewState.annotations || clampedLayer !== persistedReviewState.layer) {
            setReviewState((state) => ({ ...state, layer: clampedLayer, annotations: limitedAnnotations }));
            if (persistedAnnotations.length > MAX_REVIEW_ANNOTATIONS)
                setActivity({ kind: "info", message: `Saved review state was repaired to the ${MAX_REVIEW_ANNOTATIONS}-annotation limit.` });
        }
    }, [build?.hash, build?.id, persistedReviewState.annotations?.length, persistedReviewState.reviewBuildHash, persistedReviewState.reviewBuildId]);
    useEffect(() => () => texturePack?.dispose(), [texturePack]);
    const stopLocalViewer = () => {
        setViewerActive(false);
        setViewerOpening(false);
        setShowShortcuts(false);
        setTexturePack(null);
        setTextureStatus("Procedural fallback");
    };
    const openReviewer = async () => {
        if (viewerOpening)
            return;
        setViewerOpening(true);
        // Arm the loader before asking the host to expand, but gate all work on
        // the actual displayMode. This avoids racing the host-context update.
        setViewerActive(true);
        setActivity(undefined);
        try {
            const result = await setDisplayMode("fullscreen");
            if (result.mode !== "fullscreen") {
                setViewerActive(false);
                setActivity({ kind: "error", message: "This host did not open a fullscreen review. The low-resource summary remains active." });
                return;
            }
        }
        catch (error) {
            setViewerActive(false);
            setActivity({ kind: "error", message: error instanceof Error ? error.message : "The 3D reviewer could not be opened." });
        }
        finally {
            setViewerOpening(false);
        }
    };
    const collapseReviewer = () => {
        stopLocalViewer();
        void setDisplayMode("inline").catch((error) => setActivity({ kind: "error", message: error instanceof Error ? error.message : "The viewer was stopped, but the host could not collapse this card." }));
    };
    const closeReviewer = () => {
        // Release local CPU, memory, paging, and WebGL immediately. Host close is
        // best-effort and may be declined, so teardown cannot wait for its result.
        stopLocalViewer();
        void setDisplayMode("inline").catch(() => undefined);
        void requestClose().catch((error) => setActivity({ kind: "error", message: error instanceof Error ? `3D stopped. ${error.message}` : "3D stopped, but the host could not close this card." }));
    };
    useEffect(() => {
        if (viewerOpening || !viewerActive || displayMode === "fullscreen")
            return;
        stopLocalViewer();
    }, [displayMode, viewerActive, viewerOpening]);
    useEffect(() => {
        if (!shouldLoadBuild || typeof window === "undefined")
            return;
        const token = viewerTokenRef.current;
        let relinquished = false;
        const relinquish = () => {
            if (relinquished)
                return;
            relinquished = true;
            stopLocalViewer();
            setActivity({ kind: "info", message: "3D stopped because another Blockwright reviewer became active. Only one live 3D viewer is kept at a time." });
            void setDisplayMode("inline").catch(() => undefined);
        };
        const receiveLease = (candidate) => {
            if (isForeignReviewerLease(candidate, token))
                relinquish();
        };
        let channel;
        try {
            channel = new BroadcastChannel(REVIEWER_LEASE_CHANNEL);
            channel.addEventListener("message", (event) => receiveLease(event.data));
        }
        catch {
            // Sandboxed/older hosts may not expose BroadcastChannel. The storage
            // event below is the same-origin fallback.
        }
        const onStorage = (event) => {
            if (event.key !== REVIEWER_LEASE_STORAGE_KEY || !event.newValue)
                return;
            try {
                receiveLease(JSON.parse(event.newValue));
            }
            catch { /* Ignore unrelated malformed host storage. */ }
        };
        window.addEventListener("storage", onStorage);
        const lease = createReviewerLease(token);
        try {
            channel?.postMessage(lease);
        }
        catch { /* Local teardown remains available without cross-widget messaging. */ }
        try {
            window.localStorage.setItem(REVIEWER_LEASE_STORAGE_KEY, JSON.stringify(lease));
        }
        catch { /* Host storage can be disabled. */ }
        return () => {
            channel?.close();
            window.removeEventListener("storage", onStorage);
        };
    }, [shouldLoadBuild]);
    useEffect(() => {
        if (!shouldLoadBuild)
            return;
        const onKeyDown = (event) => {
            const target = event.target;
            const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
            if (event.key === "Escape") {
                if (showShortcuts)
                    setShowShortcuts(false);
                else {
                    setEditingAnnotationId(undefined);
                    setNote("");
                    setReviewState((state) => ({ ...state, anchor: undefined, selection: undefined }));
                }
                return;
            }
            if (isEditing)
                return;
            const key = event.key.toLowerCase();
            const modeKeys = { o: "orbit", b: "select", r: "region", m: "measure" };
            const cameraKeys = { "1": "iso", "2": "top", "3": "north", "4": "south", "5": "east", "6": "west" };
            if (modeKeys[key]) {
                event.preventDefault();
                setReviewState((state) => ({ ...state, mode: modeKeys[key], anchor: undefined }));
            }
            else if (cameraKeys[key]) {
                event.preventDefault();
                setReviewState((state) => ({ ...state, cameraPreset: cameraKeys[key] }));
            }
            else if (key === "0") {
                event.preventDefault();
                setReviewState((state) => ({ ...state, cameraTarget: undefined, cameraDistance: undefined }));
            }
            else if (key === "p") {
                event.preventDefault();
                setReviewState((state) => ({ ...state, orthographic: !state.orthographic }));
            }
            else if (key === "h") {
                event.preventDefault();
                setReviewState((state) => ({ ...state, hideRoof: !state.hideRoof }));
            }
            else if (event.key === "[") {
                event.preventDefault();
                setReviewState((state) => ({ ...state, layer: Math.max(minBuildLayer, (state.layer ?? maxBuildLayer) - 1) }));
            }
            else if (event.key === "]") {
                event.preventDefault();
                setReviewState((state) => ({ ...state, layer: Math.min(maxBuildLayer, (state.layer ?? maxBuildLayer) + 1) }));
            }
            else if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
                event.preventDefault();
                setShowShortcuts((shown) => !shown);
            }
            else if (event.key === "/") {
                event.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [maxBuildLayer, minBuildLayer, shouldLoadBuild, showShortcuts]);
    const inlineBuild = metadata?.buildSummary;
    const inlineName = summary?.name ?? inlineBuild?.input.name ?? "Build review";
    const inlineBlockCount = summary?.blockCount ?? inlineBuild?.blockCount;
    const inlineAudit = summary?.audit ?? audit?.totals;
    const inlineMaterials = summarizeReviewerMaterials(inlineBuild?.materialCounts ?? {});
    const inlineDimensions = inlineBuild?.bounds.dimensions;
    const inlineContext = inlineBuild
        ? `Review summary for ${inlineName}, immutable hash ${inlineBuild.hash.slice(0, 12)}. ${inlineBlockCount?.toLocaleString() ?? "Unknown"} blocks, ${inlineMaterials.materialCount} exact materials. ${inlineAudit ? `${inlineAudit.errors} audit errors and ${inlineAudit.warnings} warnings.` : "Audit pending."} 3D is not loaded until explicitly opened.`
        : "Preparing a low-resource Blockwright review summary. 3D is not loaded.";
    if (!shouldLoadBuild)
        return _jsxs("section", { className: "inline-summary review-inline review-inline-summary", style: { maxHeight: maxHeight || undefined }, "aria-busy": isPending, "data-llm": inlineContext, children: [_jsx("div", { className: "brand-cube", children: _jsx(Eye, { size: 22 }) }), _jsxs("div", { className: "review-inline-copy", children: [_jsxs("h2", { children: ["Review ", inlineName] }), _jsxs("p", { children: [inlineBlockCount !== undefined ? `${inlineBlockCount.toLocaleString()} exact blocks` : "Preparing audited build summary…", inlineBuild ? ` · ${inlineBuild.input.edition} ${inlineBuild.input.version}${inlineDimensions ? ` · ${inlineDimensions.width}×${inlineDimensions.depth}×${inlineDimensions.height}` : ""}` : ""] }), inlineAudit && _jsxs("div", { className: "review-inline-facts", "aria-label": "Audit summary", children: [_jsxs("span", { children: [inlineAudit.errors, " errors"] }), _jsxs("span", { children: [inlineAudit.warnings, " warnings"] }), _jsxs("span", { children: [inlineMaterials.materialCount, " materials"] })] }), inlineMaterials.visible.length > 0 && _jsxs("p", { className: "review-inline-palette", children: [_jsx("strong", { children: "Top materials:" }), " ", inlineMaterials.visible.map(([block, count]) => `${formatBlock(block)} (${count.toLocaleString()})`).join(", "), inlineMaterials.hiddenCount > 0 ? `, +${inlineMaterials.hiddenCount} more` : ""] }), activity && _jsx("p", { className: `review-inline-notice ${activity.kind}`, role: activity.kind === "error" ? "alert" : "status", children: activity.message })] }), _jsxs("div", { className: "review-inline-actions", children: [_jsxs("button", { className: "primary-button", disabled: viewerOpening || isPending || !inlineBuild || !summary || !audit, onClick: () => void openReviewer(), children: [_jsx(Maximize2, { size: 16 }), viewerOpening ? "Opening…" : "Open 3D"] }), _jsxs("button", { type: "button", className: "review-close-button", onClick: closeReviewer, "aria-label": "Close viewer", children: [_jsx(X, { size: 16 }), _jsx("span", { children: "Close" })] })] })] });
    if (!isPending && metadata?.buildSummary && pagedBuild.error)
        return _jsxs("section", { className: "inline-summary review-inline-summary", style: { maxHeight: maxHeight || undefined }, role: "alert", children: [_jsx(AlertTriangle, { size: 34 }), _jsxs("div", { className: "review-inline-copy", children: [_jsx("h2", { children: "Exact review blocks could not be loaded" }), _jsx("p", { children: pagedBuild.error })] }), _jsxs("div", { className: "review-inline-actions", children: [_jsx("button", { type: "button", onClick: collapseReviewer, children: "Back to summary" }), _jsxs("button", { type: "button", className: "review-close-button", onClick: closeReviewer, "aria-label": "Close viewer", children: [_jsx(X, { size: 16 }), _jsx("span", { children: "Close" })] })] })] });
    if (isPending || !build || !summary || !audit)
        return _jsxs("section", { className: "inline-summary review-inline-summary", style: { maxHeight: maxHeight || undefined }, "aria-busy": "true", children: [_jsx(BoxIcon, { size: 34 }), _jsxs("div", { className: "review-inline-copy", children: [_jsx("h2", { children: "Loading exact review blocks" }), _jsx("p", { children: metadata?.buildSummary ? `${pagedBuild.loaded.toLocaleString()} / ${pagedBuild.total.toLocaleString()}` : "Preparing exact 3D review…" })] }), _jsxs("div", { className: "review-inline-actions", children: [_jsx("button", { type: "button", onClick: collapseReviewer, children: "Cancel 3D" }), _jsxs("button", { type: "button", className: "review-close-button", onClick: closeReviewer, "aria-label": "Close viewer", children: [_jsx(X, { size: 16 }), _jsx("span", { children: "Close" })] })] })] });
    const selectionForPlacement = (placement) => {
        const point = { x: placement.x, y: placement.y, z: placement.z };
        return { ...orderedBounds(point, point), type: "block", blockCount: 1, pickedBlock: placement.block, pickedState: placement.state, pickedPhase: placement.phase };
    };
    const frameBounds = (bounds) => {
        const metrics = getReviewBoundsMetrics(bounds, 0);
        setReviewState((state) => ({
            ...state,
            cameraTarget: boundsCenter(bounds),
            cameraDistance: Math.max(6, Math.max(metrics.width, metrics.height, metrics.depth) * 2.1),
            layer: Math.max(minBuildLayer, Math.min(maxBuildLayer, bounds.max.y)),
        }));
    };
    const jumpToPlacement = (placement, finding) => {
        const point = { x: placement.x, y: placement.y, z: placement.z };
        setReviewState((state) => ({
            ...state,
            mode: "select",
            selection: selectionForPlacement(placement),
            anchor: undefined,
            layer: point.y,
            hideRoof: isRoofPlacement(placement, build) ? false : state.hideRoof,
            cameraTarget: point,
            cameraDistance: 8,
            focusedFindingCode: finding?.code,
            focusedFindingIndex: finding?.coordinateIndex,
        }));
    };
    const jumpToAuditStop = (stop) => {
        const placement = placementByCoordinate.get(coordinateKey(stop.coordinate));
        if (!placement) {
            setActivity({ kind: "error", message: `Audit coordinate ${coordinateKey(stop.coordinate)} is not present in the immutable build.` });
            return;
        }
        jumpToPlacement(placement, { code: stop.finding.code, coordinateIndex: stop.coordinateIndex });
        setActivity({ kind: "info", message: `${stop.finding.code.replaceAll("_", " ")} · sample ${stop.coordinateIndex + 1} of ${stop.finding.coordinates.length}` });
    };
    const moveAudit = (direction) => {
        if (!auditStops.length)
            return;
        const current = auditStops.findIndex((stop) => stop.finding.code === reviewState.focusedFindingCode && stop.coordinateIndex === reviewState.focusedFindingIndex);
        const next = current < 0 ? (direction > 0 ? 0 : auditStops.length - 1) : (current + direction + auditStops.length) % auditStops.length;
        jumpToAuditStop(auditStops[next]);
    };
    const onPick = (placement) => {
        const point = { x: placement.x, y: placement.y, z: placement.z };
        if (mode === "orbit")
            return;
        if (mode === "select") {
            setReviewState((state) => ({ ...state, selection: selectionForPlacement(placement), anchor: undefined }));
            return;
        }
        if (!anchor) {
            setReviewState((state) => ({ ...state, anchor: point, selection: undefined }));
            return;
        }
        const bounds = orderedBounds(anchor, point);
        setReviewState((state) => ({ ...state, anchor: undefined, selection: { ...bounds, type: mode === "measure" ? "measure" : "region", blockCount: countPlacementsWithin(build, bounds), pickedBlock: placement.block, pickedState: placement.state, pickedPhase: placement.phase } }));
    };
    const saveAnnotation = () => {
        const cleanNote = note.trim();
        if (!selection || selection.type === "measure" || !cleanNote)
            return;
        if (!editingAnnotationId && annotations.length >= MAX_REVIEW_ANNOTATIONS) {
            setActivity({ kind: "error", message: `This review already has the maximum ${MAX_REVIEW_ANNOTATIONS} annotations. Resolve, edit, or remove an existing note before adding another.` });
            return;
        }
        const now = new Date().toISOString();
        if (editingAnnotationId) {
            if (!annotations.some((annotation) => annotation.id === editingAnnotationId)) {
                setEditingAnnotationId(undefined);
                setActivity({ kind: "error", message: "That annotation is no longer present; no changes were saved." });
                return;
            }
            setReviewState((state) => ({
                ...state,
                annotations: state.annotations.map((annotation) => annotation.id === editingAnnotationId ? {
                    ...annotation,
                    category,
                    note: cleanNote,
                    bounds: { min: selection.min, max: selection.max },
                    blockCount: selection.blockCount,
                    pickedBlock: selection.pickedBlock,
                    pickedState: selection.pickedState,
                    updatedAt: now,
                } : annotation),
                selection: undefined,
            }));
            setActivity({ kind: "success", message: "Annotation updated." });
            setEditingAnnotationId(undefined);
            setNote("");
            return;
        }
        const idCandidate = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        const annotation = {
            category,
            note: cleanNote,
            bounds: { min: selection.min, max: selection.max },
            blockCount: selection.blockCount,
            pickedBlock: selection.pickedBlock,
            pickedState: selection.pickedState,
            createdAt: now,
        };
        setReviewState((state) => {
            const current = Array.isArray(state.annotations) ? state.annotations : [];
            const next = prependReviewAnnotation(current, annotation, idCandidate);
            return next ? { ...state, annotations: next, selection: undefined } : state;
        });
        setNote("");
        setActivity({ kind: "success", message: "Annotation saved to exact coordinates." });
    };
    const editAnnotation = (annotation) => {
        setCategory(annotation.category);
        setNote(annotation.note);
        setEditingAnnotationId(annotation.id);
        const placement = build.placements.find((candidate) => candidate.x >= annotation.bounds.min.x && candidate.x <= annotation.bounds.max.x
            && candidate.y >= annotation.bounds.min.y && candidate.y <= annotation.bounds.max.y
            && candidate.z >= annotation.bounds.min.z && candidate.z <= annotation.bounds.max.z
            && (!annotation.pickedBlock || candidate.block === annotation.pickedBlock));
        setReviewState((state) => ({ ...state, selection: { ...annotation.bounds, type: annotation.bounds.min.x === annotation.bounds.max.x && annotation.bounds.min.y === annotation.bounds.max.y && annotation.bounds.min.z === annotation.bounds.max.z ? "block" : "region", blockCount: annotation.blockCount, pickedBlock: annotation.pickedBlock, pickedState: annotation.pickedState, pickedPhase: placement?.phase }, anchor: undefined }));
        frameBounds(annotation.bounds);
        setActivity({ kind: "info", message: "Editing annotation; save to apply changes." });
    };
    const deleteAnnotation = (annotation) => {
        const index = annotations.findIndex((item) => item.id === annotation.id);
        setLastDeleted({ annotation, index: Math.max(0, index) });
        setReviewState((state) => ({ ...state, annotations: state.annotations.filter((item) => item.id !== annotation.id) }));
        if (editingAnnotationId === annotation.id) {
            setEditingAnnotationId(undefined);
            setNote("");
        }
        setActivity({ kind: "info", message: "Annotation removed. Undo is available." });
    };
    const undoDelete = () => {
        if (!lastDeleted)
            return;
        setReviewState((state) => {
            if (state.annotations.some((annotation) => annotation.id === lastDeleted.annotation.id))
                return state;
            if (state.annotations.length >= MAX_REVIEW_ANNOTATIONS)
                return state;
            const annotations = [...state.annotations];
            annotations.splice(Math.min(lastDeleted.index, annotations.length), 0, lastDeleted.annotation);
            return { ...state, annotations };
        });
        setLastDeleted(undefined);
        setActivity({ kind: "success", message: "Annotation restored." });
    };
    const toggleResolved = (annotation) => {
        const resolved = !annotation.resolved;
        setReviewState((state) => ({ ...state, annotations: state.annotations.map((item) => item.id === annotation.id ? { ...item, resolved, updatedAt: new Date().toISOString() } : item) }));
        setActivity({ kind: "success", message: resolved ? "Annotation marked resolved." : "Annotation reopened." });
    };
    const exportReview = async () => {
        const requestedBuildIdentity = activeBuildIdentity;
        const safeName = build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
        const review = {
            schemaVersion: 1,
            type: "blockwright-review",
            build: { id: build.id, hash: build.hash, name: build.input.name, edition: build.input.edition, version: build.input.version, bounds: build.bounds },
            annotations,
            audit,
            viewer: { mode, layer, hideRoof, orthographic, cameraPreset, cameraTarget, cameraDistance },
            exportedAt: new Date().toISOString(),
        };
        try {
            // Run the same canonical checks used by import before offering a file, so
            // every completed export is accepted when brought back to this build.
            validateReviewDocument(review, build);
            const text = JSON.stringify(review, null, 2);
            if (new TextEncoder().encode(text).byteLength > MAX_REVIEW_IMPORT_BYTES)
                throw new Error(`This review exceeds the ${Math.round(MAX_REVIEW_IMPORT_BYTES / 1_000)} KB import limit. Shorten or remove annotations before exporting.`);
            if (activeBuildIdentityRef.current !== requestedBuildIdentity)
                throw new Error("The build changed before export completed. Export the newly opened review instead.");
            const result = await download({ contents: [{ type: "resource", resource: { uri: `file:///${safeName}-review.json`, mimeType: "application/json", text } }] });
            if (activeBuildIdentityRef.current !== requestedBuildIdentity)
                return;
            setActivity(result.isError ? { kind: "info", message: "Review export was canceled or unavailable." } : { kind: "success", message: `Exported ${annotations.length} annotations for build ${build.hash.slice(0, 12)}.` });
        }
        catch (error) {
            setActivity({ kind: "error", message: error instanceof Error ? error.message : "Could not export this review." });
        }
    };
    const importReview = async (file) => {
        if (!file)
            return;
        const requestedBuildIdentity = activeBuildIdentity;
        try {
            if (file.size > MAX_REVIEW_IMPORT_BYTES)
                throw new Error(`Review files must be ${Math.round(MAX_REVIEW_IMPORT_BYTES / 1_000)} KB or smaller.`);
            if (!file.name.toLowerCase().endsWith(".json"))
                throw new Error("Choose a Blockwright review JSON file.");
            const text = await file.text();
            if (activeBuildIdentityRef.current !== requestedBuildIdentity)
                throw new Error("The build changed while the review file was being read. Choose the file again for the current build.");
            const imported = validateReviewDocument(JSON.parse(text), build);
            setReviewState((state) => getReviewStateBuildStatus(state, build) === "current" ? { ...state, annotations: imported } : state);
            setEditingAnnotationId(undefined);
            setLastDeleted(undefined);
            setNote("");
            setActivity({ kind: "success", message: `Imported ${imported.length} validated annotation${imported.length === 1 ? "" : "s"}; build hash matched.` });
        }
        catch (error) {
            setActivity({ kind: "error", message: error instanceof Error ? error.message : "Could not import this review." });
        }
    };
    const loadTextures = async (file) => {
        if (!file)
            return;
        const requestedBuildIdentity = activeBuildIdentity;
        setTextureStatus(`Reading ${file.name}…`);
        try {
            const next = await loadResourcePack(file, build.placements);
            if (activeBuildIdentityRef.current !== requestedBuildIdentity) {
                next.dispose();
                return;
            }
            setTexturePack((current) => { current?.dispose(); return next; });
            setTextureStatus(`${next.name} · ${next.resolved}/${next.requested} states resolved`);
            setActivity({ kind: "success", message: `${next.resolved} of ${next.requested} material states resolved from ${next.name}.` });
        }
        catch (error) {
            setTextureStatus(error instanceof Error ? error.message : "Could not read this resource pack.");
            setActivity({ kind: "error", message: error instanceof Error ? error.message : "Could not read this resource pack." });
        }
    };
    const runSearch = () => {
        const coordinate = parseReviewCoordinate(searchQuery);
        if (coordinate) {
            const placement = placementByCoordinate.get(coordinateKey(coordinate));
            if (!placement) {
                setActivity({ kind: "error", message: `No canonical block exists at ${coordinateKey(coordinate)}.` });
                return;
            }
            jumpToPlacement(placement);
            setActivity({ kind: "success", message: `Focused ${placement.block} at ${coordinateKey(placement)}.` });
            return;
        }
        if (!searchMatches.length) {
            const query = searchQuery.trim();
            setActivity({ kind: "error", message: searchResults.tooShort ? `Use at least ${MIN_REVIEW_TEXT_SEARCH_LENGTH} characters for block, phase, or state search; exact coordinates are always accepted.` : query ? `No block, phase, or state matches “${query}”.` : "Enter coordinates, a block, phase, or state." });
            return;
        }
        const nextIndex = ((reviewState.searchCursor ?? -1) + 1) % searchMatches.length;
        const placement = searchMatches[nextIndex];
        jumpToPlacement(placement);
        setReviewState((state) => ({ ...state, searchCursor: nextIndex }));
        setActivity({ kind: "success", message: `Match ${nextIndex + 1} of ${searchMatches.length}${searchResults.capped ? "+ capped results" : ""}: ${placement.block} at ${coordinateKey(placement)}.` });
    };
    const copyText = async (text, description) => {
        try {
            if (!navigator.clipboard?.writeText)
                throw new Error("Clipboard access is unavailable in this host.");
            await navigator.clipboard.writeText(text);
            setActivity({ kind: "success", message: `${description} copied.` });
        }
        catch (error) {
            setActivity({ kind: "error", message: error instanceof Error ? error.message : "Could not copy to the clipboard." });
        }
    };
    const selectionMetrics = selection ? getReviewBoundsMetrics(selection, selection.blockCount) : undefined;
    const distance = selection?.type === "measure" ? getReviewMeasurement(selection) : undefined;
    const selectedState = selection?.pickedState ? stateString(selection.pickedState) : "";
    const layerValue = Math.max(minBuildLayer, Math.min(layer, maxBuildLayer));
    const openAnnotations = annotations.filter((annotation) => !annotation.resolved).length;
    const currentFinding = audit.findings.find((finding) => finding.code === reviewState.focusedFindingCode);
    const llmContext = `Reviewing ${build.input.name}, immutable hash ${build.hash.slice(0, 12)}. ${visibleBlockCount} of ${build.placements.length} blocks visible through Y ${layerValue}; ${hideRoof ? "roof hidden" : "roof visible"}. Camera ${cameraPreset} ${orthographic ? "orthographic" : "perspective"}${cameraTarget ? ` focused at ${coordinateKey(cameraTarget)}` : " framed on the full build"}. ${annotations.length} annotations: ${openAnnotations} open and ${annotations.length - openAnnotations} resolved. ${selection ? `Selected ${selection.type} from ${coordinateKey(selection.min)} to ${coordinateKey(selection.max)}${selection.pickedBlock ? `; canonical block ${selection.pickedBlock}${selectedState ? ` with state ${selectedState}` : ""}` : ""}.` : "No selection."} ${currentFinding ? `Current audit finding ${currentFinding.code}, sample ${(reviewState.focusedFindingIndex ?? 0) + 1}.` : ""} Global audit: ${audit.totals.errors} errors and ${audit.totals.warnings} warnings across ${audit.scannedPlacements} placements.`;
    return _jsxs("main", { className: "review-shell", style: { maxHeight: maxHeight || undefined }, "data-llm": llmContext, children: [_jsxs("header", { className: "review-header", children: [_jsxs("div", { children: [_jsx("span", { className: "panel-kicker", children: "Blockwright reviewer" }), _jsx("h1", { children: build.input.name })] }), _jsxs("div", { className: "review-header-actions", children: [_jsxs("button", { onClick: () => textureRef.current?.click(), children: [_jsx(Upload, { size: 15 }), "Textures"] }), _jsxs("button", { onClick: () => importRef.current?.click(), children: [_jsx(FileInput, { size: 15 }), "Import review"] }), _jsxs("button", { className: "primary-button", onClick: () => void exportReview(), children: [_jsx(Download, { size: 15 }), "Export review"] }), _jsx(ReviewButton, { label: "Collapse reviewer", onClick: collapseReviewer, children: _jsx(Maximize2, { size: 16 }) }), _jsxs("button", { type: "button", className: "review-close-button", onClick: closeReviewer, "aria-label": "Close viewer", children: [_jsx(X, { size: 16 }), _jsx("span", { children: "Close" })] })] }), _jsx("input", { ref: textureRef, hidden: true, type: "file", accept: ".zip,.jar,application/zip,application/java-archive", onChange: (event) => void loadTextures(event.target.files?.[0]) }), _jsx("input", { ref: importRef, hidden: true, type: "file", accept: ".json,application/json", onChange: (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importReview(file); } })] }), _jsxs("aside", { className: "review-tools", "aria-label": "Review tools", children: [_jsx(ReviewButton, { label: "Orbit", shortcut: "O", active: mode === "orbit", onClick: () => setReviewState((state) => ({ ...state, mode: "orbit", anchor: undefined })), children: _jsx(Orbit, { size: 19 }) }), _jsx(ReviewButton, { label: "Select block", shortcut: "B", active: mode === "select", onClick: () => setReviewState((state) => ({ ...state, mode: "select", anchor: undefined })), children: _jsx(MousePointer2, { size: 19 }) }), _jsx(ReviewButton, { label: "Select region", shortcut: "R", active: mode === "region", onClick: () => setReviewState((state) => ({ ...state, mode: "region", anchor: undefined })), children: _jsx(BoxSelect, { size: 19 }) }), _jsx(ReviewButton, { label: "Measure", shortcut: "M", active: mode === "measure", onClick: () => setReviewState((state) => ({ ...state, mode: "measure", anchor: undefined })), children: _jsx(Ruler, { size: 19 }) }), _jsx(ReviewButton, { label: "Frame whole build", shortcut: "0", active: !cameraTarget, onClick: () => setReviewState((state) => ({ ...state, cameraTarget: undefined, cameraDistance: undefined })), children: _jsx(Focus, { size: 19 }) }), _jsx("span", { className: "review-tools-spacer" }), _jsx(ReviewButton, { label: "Isometric view", shortcut: "1", active: cameraPreset === "iso", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "iso" })), children: _jsx(Crosshair, { size: 19 }) }), _jsx(ReviewButton, { label: "Top view", shortcut: "2", active: cameraPreset === "top", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "top" })), children: _jsx(ChevronUp, { size: 19 }) }), _jsx(ReviewButton, { label: "North view", shortcut: "3", active: cameraPreset === "north", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "north" })), children: _jsx(ChevronDown, { size: 19 }) }), _jsx(ReviewButton, { label: "South view", shortcut: "4", active: cameraPreset === "south", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "south" })), children: _jsx(ChevronUp, { size: 19 }) }), _jsx(ReviewButton, { label: "East view", shortcut: "5", active: cameraPreset === "east", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "east" })), children: _jsx(ChevronRight, { size: 19 }) }), _jsx(ReviewButton, { label: "West view", shortcut: "6", active: cameraPreset === "west", onClick: () => setReviewState((state) => ({ ...state, cameraPreset: "west" })), children: _jsx(ChevronLeft, { size: 19 }) }), _jsx(ReviewButton, { label: "Keyboard shortcuts", shortcut: "?", active: showShortcuts, onClick: () => setShowShortcuts((shown) => !shown), children: _jsx(HelpCircle, { size: 19 }) })] }), _jsxs("section", { className: "review-viewport", children: [_jsx(ReviewScene, { build: build, maxLayer: layerValue, hideRoof: hideRoof, cameraPreset: cameraPreset, cameraTarget: cameraTarget, cameraDistance: cameraDistance, orthographic: orthographic, selection: selection, annotations: annotations, texturePack: texturePack, mobileRendering: mobileRendering, onPick: onPick }), _jsxs("form", { className: "review-search", role: "search", onSubmit: (event) => { event.preventDefault(); runSearch(); }, children: [_jsx(Search, { size: 14, "aria-hidden": "true" }), _jsx("input", { ref: searchRef, "aria-label": "Find exact coordinates, block, phase, or state", value: searchQuery, onChange: (event) => setReviewState((state) => ({ ...state, searchQuery: event.target.value, searchCursor: -1 })), placeholder: "x,y,z or block / phase / state" }), searchQuery && _jsx("button", { type: "button", "aria-label": "Clear search", onClick: () => setReviewState((state) => ({ ...state, searchQuery: "", searchCursor: -1 })), children: _jsx(X, { size: 13 }) }), _jsxs("button", { type: "submit", children: ["Find", searchMatches.length ? ` · ${searchMatches.length}${searchResults.capped ? "+" : ""}` : ""] })] }), _jsxs("div", { className: "review-view-switch", "aria-label": "Camera projection", children: [_jsx("button", { type: "button", "aria-pressed": !orthographic, className: !orthographic ? "active" : "", onClick: () => setReviewState((state) => ({ ...state, orthographic: false })), children: "Perspective" }), _jsx("button", { type: "button", "aria-pressed": orthographic, className: orthographic ? "active" : "", onClick: () => setReviewState((state) => ({ ...state, orthographic: true })), children: "Orthographic" })] }), _jsxs("div", { className: "review-viewport-status", children: [_jsxs("span", { children: [visibleBlockCount.toLocaleString(), " / ", build.placements.length.toLocaleString(), " visible"] }), cameraTarget && _jsxs("span", { children: ["Focus ", coordinateKey(cameraTarget)] })] }), _jsxs("div", { className: "review-layer-control", children: [_jsx(Layers3, { size: 15 }), _jsx("input", { "aria-label": `Maximum visible Y layer ${layerValue}`, type: "range", min: minBuildLayer, max: maxBuildLayer, value: layerValue, onChange: (event) => setReviewState((state) => ({ ...state, layer: Number(event.target.value) })) }), _jsxs("strong", { children: ["Y \u2264 ", layerValue] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: hideRoof, onChange: (event) => setReviewState((state) => ({ ...state, hideRoof: event.target.checked })) }), "Hide roof ", _jsx("kbd", { children: "H" })] })] }), anchor && _jsxs("div", { className: "review-instruction", role: "status", children: ["First corner: ", coordinateKey(anchor), " \u00B7 choose the second point ", _jsx("button", { type: "button", onClick: () => setReviewState((state) => ({ ...state, anchor: undefined })), children: "Cancel" })] }), activity && _jsxs("div", { className: `review-activity ${activity.kind}`, role: activity.kind === "error" ? "alert" : "status", "aria-live": "polite", children: [activity.kind === "error" ? _jsx(AlertTriangle, { size: 14 }) : activity.kind === "success" ? _jsx(CheckCircle2, { size: 14 }) : _jsx(Eye, { size: 14 }), _jsx("span", { children: activity.message }), _jsx("button", { type: "button", "aria-label": "Dismiss message", onClick: () => setActivity(undefined), children: _jsx(X, { size: 13 }) })] }), showShortcuts && _jsxs("section", { className: "review-shortcuts", "aria-label": "Keyboard shortcuts", children: [_jsxs("header", { children: [_jsx("strong", { children: "Keyboard shortcuts" }), _jsx("button", { type: "button", "aria-label": "Close keyboard shortcuts", onClick: () => setShowShortcuts(false), children: _jsx(X, { size: 14 }) })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "O" }), " ", _jsx("kbd", { children: "B" }), " ", _jsx("kbd", { children: "R" }), " ", _jsx("kbd", { children: "M" })] }), _jsx("dd", { children: "Orbit, block, region, measure" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "1" }), "\u2013", _jsx("kbd", { children: "6" })] }), _jsx("dd", { children: "Isometric, top, cardinal views" })] }), _jsxs("div", { children: [_jsx("dt", { children: _jsx("kbd", { children: "0" }) }), _jsx("dd", { children: "Frame the whole build" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "P" }), " ", _jsx("kbd", { children: "H" })] }), _jsx("dd", { children: "Projection and roof visibility" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "[" }), " ", _jsx("kbd", { children: "]" })] }), _jsx("dd", { children: "Move the visible Y layer" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "/" }), " ", _jsx("kbd", { children: "?" })] }), _jsx("dd", { children: "Search and shortcut help" })] }), _jsxs("div", { children: [_jsx("dt", { children: _jsx("kbd", { children: "Esc" }) }), _jsx("dd", { children: "Cancel anchor or clear selection" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx("kbd", { children: "Ctrl" }), "+", _jsx("kbd", { children: "Enter" })] }), _jsx("dd", { children: "Save the annotation draft" })] })] })] })] }), _jsxs("aside", { className: "review-inspector", "aria-label": "Build review inspector", children: [_jsxs("section", { children: [_jsxs("div", { className: "review-section-heading", children: [_jsx("span", { className: "panel-kicker", children: editingAnnotationId ? "Edit annotation" : "New annotation" }), editingAnnotationId ? _jsx("button", { type: "button", className: "review-text-button", onClick: () => { setEditingAnnotationId(undefined); setNote(""); }, children: "Cancel edit" }) : _jsx("small", { children: "exact world coordinates" })] }), _jsx("div", { className: "review-category-row", children: REVIEW_CATEGORIES.map((item) => _jsx("button", { type: "button", "aria-pressed": category === item, className: category === item ? "active" : "", style: { "--category": COLORS[item] }, onClick: () => setCategory(item), children: item }, item)) }), _jsxs("label", { className: "review-field-label", htmlFor: "review-annotation-note", children: ["Actionable intent ", _jsxs("span", { children: [note.length, "/", MAX_REVIEW_NOTE_LENGTH] })] }), _jsx("textarea", { id: "review-annotation-note", maxLength: MAX_REVIEW_NOTE_LENGTH, value: note, onChange: (event) => setNote(event.target.value), onKeyDown: (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                                    event.preventDefault();
                                    saveAnnotation();
                                } }, placeholder: "Describe the issue, intended rule, or detail to preserve\u2026" }), _jsxs("button", { type: "button", className: "primary-button review-save", disabled: !selection || selection.type === "measure" || !note.trim() || (!editingAnnotationId && annotations.length >= MAX_REVIEW_ANNOTATIONS), onClick: saveAnnotation, children: [_jsx(Check, { size: 15 }), editingAnnotationId ? "Update annotation" : "Save annotation"] }), !editingAnnotationId && annotations.length >= MAX_REVIEW_ANNOTATIONS && _jsxs("small", { className: "review-help-text", children: ["Annotation limit reached (", MAX_REVIEW_ANNOTATIONS, "/", MAX_REVIEW_ANNOTATIONS, "). Existing notes can still be edited or resolved."] }), !selection && _jsx("small", { className: "review-help-text", children: "Select a block or region first. Measurements stay separate from annotations." })] }), _jsxs("section", { children: [_jsxs("div", { className: "review-section-heading", children: [_jsx("span", { className: "panel-kicker", children: "Selection" }), _jsx("small", { children: selection?.type ?? "none" })] }), selection ? _jsxs("div", { className: "review-selection-card", children: [_jsxs("div", { className: "review-selection-title", children: [_jsxs("strong", { children: [selection.blockCount.toLocaleString(), " occupied block", selection.blockCount === 1 ? "" : "s"] }), _jsx("button", { type: "button", title: "Frame selection", "aria-label": "Frame selection", onClick: () => frameBounds(selection), children: _jsx(LocateFixed, { size: 14 }) })] }), _jsxs("span", { children: ["Min ", _jsx("code", { children: coordinateKey(selection.min) })] }), _jsxs("span", { children: ["Max ", _jsx("code", { children: coordinateKey(selection.max) })] }), selectionMetrics && _jsxs("span", { children: ["Inclusive size ", _jsxs("b", { children: [selectionMetrics.width, " \u00D7 ", selectionMetrics.height, " \u00D7 ", selectionMetrics.depth] }), " \u00B7 volume ", selectionMetrics.volume.toLocaleString()] }), selectionMetrics && selection.type !== "block" && _jsxs("span", { children: ["Occupancy ", (selectionMetrics.density * 100).toFixed(1), "%"] }), selection.pickedBlock && _jsxs("span", { className: "review-canonical", children: [_jsx("b", { children: formatBlock(selection.pickedBlock) }), _jsx("code", { children: selection.pickedBlock })] }), selection.pickedPhase && _jsxs("span", { children: ["Phase ", _jsx("b", { children: selection.pickedPhase })] }), selectedState && _jsx("code", { children: selectedState }), distance && _jsxs("div", { className: "review-measurements", children: [_jsxs("span", { children: ["Axis \u0394 ", _jsxs("b", { children: [distance.dx, ", ", distance.dy, ", ", distance.dz] })] }), _jsxs("span", { children: ["Horizontal ", _jsx("b", { children: distance.horizontal.toFixed(2) })] }), _jsxs("span", { children: ["Direct center-to-center ", _jsx("b", { children: distance.direct.toFixed(2) })] }), _jsxs("span", { children: ["Manhattan ", _jsx("b", { children: distance.manhattan })] })] }), _jsxs("div", { className: "review-copy-row", children: [_jsxs("button", { type: "button", onClick: () => void copyText(coordinateKey(selection.min), "Minimum coordinates"), children: [_jsx(Clipboard, { size: 12 }), "Copy min"] }), _jsxs("button", { type: "button", onClick: () => void copyText(`/tp @s ${selection.min.x} ${selection.min.y} ${selection.min.z}`, "Teleport command"), children: [_jsx(Clipboard, { size: 12 }), "Copy /tp"] })] })] }) : _jsx("p", { className: "review-empty", children: "Choose block or region select, then click the model." })] }), _jsxs("section", { children: [_jsxs("div", { className: "review-section-heading", children: [_jsx("span", { className: "panel-kicker", children: "Global audit" }), _jsxs("span", { className: "review-heading-actions", children: [_jsxs("small", { children: [filteredFindings.length, "/", audit.findings.length, " categories"] }), _jsx(ReviewButton, { label: "Previous audit sample", disabled: !auditStops.length, onClick: () => moveAudit(-1), children: _jsx(ChevronLeft, { size: 14 }) }), _jsx(ReviewButton, { label: "Next audit sample", disabled: !auditStops.length, onClick: () => moveAudit(1), children: _jsx(ChevronRight, { size: 14 }) })] })] }), _jsxs("div", { className: "audit-totals", children: [_jsxs("span", { children: [_jsx("b", { children: audit.totals.errors }), " errors"] }), _jsxs("span", { children: [_jsx("b", { children: audit.totals.warnings }), " warnings"] }), _jsxs("span", { children: [_jsx("b", { children: audit.statefulPlacements.toLocaleString() }), " stateful"] })] }), _jsxs("div", { className: "review-filter-row", children: [_jsx(Search, { size: 13 }), _jsx("input", { "aria-label": "Filter audit findings", value: auditQuery, onChange: (event) => setReviewState((state) => ({ ...state, auditQuery: event.target.value, focusedFindingCode: undefined, focusedFindingIndex: undefined })), placeholder: "Filter code, message, coordinate" }), _jsxs("select", { "aria-label": "Audit severity", value: auditSeverity, onChange: (event) => setReviewState((state) => ({ ...state, auditSeverity: event.target.value, focusedFindingCode: undefined, focusedFindingIndex: undefined })), children: [_jsx("option", { value: "all", children: "All severity" }), _jsx("option", { value: "error", children: "Errors" }), _jsx("option", { value: "warning", children: "Warnings" }), _jsx("option", { value: "info", children: "Info" })] })] }), _jsx("div", { className: "audit-findings", children: filteredFindings.length ? filteredFindings.map((finding) => _jsxs("article", { className: reviewState.focusedFindingCode === finding.code ? "active" : "", children: [_jsxs("button", { type: "button", className: "audit-finding-main", disabled: !finding.coordinates.length, onClick: () => finding.coordinates.length && jumpToAuditStop({ finding, coordinate: finding.coordinates[0], coordinateIndex: 0 }), children: [_jsx("span", { className: `audit-dot ${finding.severity}` }), _jsxs("span", { children: [_jsx("strong", { children: finding.code.replaceAll("_", " ") }), _jsxs("small", { children: [finding.total.toLocaleString(), " affected \u00B7 ", finding.coordinates.length.toLocaleString(), " sampled"] }), _jsx("small", { children: finding.message })] }), finding.coordinates.length ? _jsx(LocateFixed, { size: 13 }) : null] }), finding.coordinates.length > 0 && _jsxs("div", { className: "audit-samples", "aria-label": `${finding.code} sampled coordinates`, children: [finding.coordinates.slice(0, 6).map((coordinate, coordinateIndex) => _jsx("button", { type: "button", className: reviewState.focusedFindingCode === finding.code && reviewState.focusedFindingIndex === coordinateIndex ? "active" : "", onClick: () => jumpToAuditStop({ finding, coordinate, coordinateIndex }), children: coordinateKey(coordinate) }, coordinateKey(coordinate))), finding.coordinates.length > 6 && _jsxs("span", { children: ["+", finding.coordinates.length - 6, " more via next"] })] })] }, finding.code)) : audit.findings.length ? _jsx("p", { className: "review-empty", children: "No audit categories match these filters." }) : _jsxs("div", { className: "review-pass", children: [_jsx(Check, { size: 16 }), "No structural audit findings"] }) })] }), _jsxs("section", { className: "review-history-section", children: [_jsxs("div", { className: "review-section-heading", children: [_jsx("span", { className: "panel-kicker", children: "Annotation history" }), _jsxs("span", { className: "review-heading-actions", children: [_jsxs("small", { children: [openAnnotations, " open \u00B7 ", annotations.length - openAnnotations, " resolved"] }), lastDeleted && _jsxs("button", { type: "button", className: "review-text-button", onClick: undoDelete, children: [_jsx(Undo2, { size: 12 }), "Undo"] })] })] }), _jsxs("div", { className: "review-filter-row", children: [_jsx(Search, { size: 13 }), _jsx("input", { "aria-label": "Filter annotations", value: annotationQuery, onChange: (event) => setReviewState((state) => ({ ...state, annotationQuery: event.target.value })), placeholder: "Filter notes, block, coordinate" }), _jsxs("select", { "aria-label": "Annotation category", value: annotationCategory, onChange: (event) => setReviewState((state) => ({ ...state, annotationCategory: event.target.value })), children: [_jsx("option", { value: "all", children: "All categories" }), REVIEW_CATEGORIES.map((item) => _jsx("option", { value: item, children: item }, item))] }), _jsxs("select", { "aria-label": "Annotation status", value: annotationStatus, onChange: (event) => setReviewState((state) => ({ ...state, annotationStatus: event.target.value })), children: [_jsx("option", { value: "all", children: "All status" }), _jsx("option", { value: "open", children: "Open" }), _jsx("option", { value: "resolved", children: "Resolved" })] })] }), _jsx("div", { className: "review-history", children: filteredAnnotations.length ? filteredAnnotations.map((annotation) => _jsxs("article", { className: annotation.resolved ? "resolved" : "", children: [_jsxs("button", { type: "button", className: "review-history-focus", onClick: () => { const placement = annotation.pickedBlock ? build.placements.find((candidate) => candidate.block === annotation.pickedBlock && candidate.x >= annotation.bounds.min.x && candidate.x <= annotation.bounds.max.x && candidate.y >= annotation.bounds.min.y && candidate.y <= annotation.bounds.max.y && candidate.z >= annotation.bounds.min.z && candidate.z <= annotation.bounds.max.z) : undefined; setReviewState((state) => ({ ...state, selection: { ...annotation.bounds, type: annotation.bounds.min.x === annotation.bounds.max.x && annotation.bounds.min.y === annotation.bounds.max.y && annotation.bounds.min.z === annotation.bounds.max.z ? "block" : "region", blockCount: annotation.blockCount, pickedBlock: annotation.pickedBlock, pickedState: annotation.pickedState, pickedPhase: placement?.phase }, anchor: undefined })); frameBounds(annotation.bounds); }, children: [_jsx("i", { style: { background: COLORS[annotation.category] } }), _jsxs("span", { children: [_jsxs("strong", { children: [annotation.resolved ? "Resolved · " : "", annotation.category, " \u00B7 ", annotation.blockCount, " block", annotation.blockCount === 1 ? "" : "s"] }), _jsx("small", { children: annotation.note || coordinateKey(annotation.bounds.min) }), _jsxs("small", { children: [coordinateKey(annotation.bounds.min), pointsEqual(annotation.bounds.min, annotation.bounds.max) ? "" : ` → ${coordinateKey(annotation.bounds.max)}`] })] })] }), _jsxs("div", { className: "review-history-actions", children: [_jsx("button", { type: "button", "aria-label": `Edit annotation ${annotation.note}`, title: "Edit annotation", onClick: () => editAnnotation(annotation), children: _jsx(Edit3, { size: 13 }) }), _jsx("button", { type: "button", "aria-label": annotation.resolved ? "Reopen annotation" : "Mark annotation resolved", title: annotation.resolved ? "Reopen" : "Mark resolved", onClick: () => toggleResolved(annotation), children: annotation.resolved ? _jsx(RotateCcw, { size: 13 }) : _jsx(Circle, { size: 13 }) }), _jsx("button", { type: "button", "aria-label": `Delete annotation ${annotation.note}`, title: "Delete annotation", onClick: () => deleteAnnotation(annotation), children: _jsx(Trash2, { size: 13 }) })] })] }, annotation.id)) : annotations.length ? _jsx("p", { className: "review-empty", children: "No annotations match these filters." }) : _jsx("p", { className: "review-empty", children: "No annotations yet." }) })] })] }), _jsxs("footer", { className: "review-status", children: [_jsxs("span", { children: [_jsx("i", {}), "Ready"] }), _jsx("span", { children: mode === "orbit" ? "Orbit, pan, and zoom" : anchor ? "Choose the second point" : `Review mode: ${mode}` }), _jsx("span", { children: textureStatus }), _jsxs("strong", { children: [visibleBlockCount.toLocaleString(), " visible \u00B7 ", openAnnotations, " open \u00B7 ", build.hash.slice(0, 8)] }), _jsx(Eye, { size: 16 })] })] });
}
//# sourceMappingURL=review-build.js.map