import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { AlertTriangle, Box, BoxSelect, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cuboid, Download, Eye, Folder, Layers3, Maximize2, MessageCircle, MousePointer2, Move, Pause, Pencil, Play, Ruler, Settings, SkipBack, SkipForward, Upload, X, } from "lucide-react";
import { useDisplayMode, useDownload, useLayout, useViewState } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import {} from "../lib/build-view-paging.js";
import { loadResourcePack, placementTextureKey } from "../lib/resource-pack.js";
import { usePagedBuild } from "../use-paged-build.js";
const MATERIAL_COLORS = {
    "minecraft:spruce_planks": "#7a4a28",
    "minecraft:stripped_spruce_log": "#57351e",
    "minecraft:stone_bricks": "#70777a",
    "minecraft:glass_pane": "#9bc0c7",
    "minecraft:spruce_stairs": "#6a3d21",
    "minecraft:spruce_slab": "#89552f",
    "minecraft:lantern": "#f2a23a",
    "minecraft:spruce_door": "#684022",
    "minecraft:spruce_fence": "#5b351d",
};
const BLOCK_LABELS = {
    "minecraft:spruce_planks": "Spruce Planks",
    "minecraft:stripped_spruce_log": "Stripped Spruce Log",
    "minecraft:stone_bricks": "Stone Bricks",
    "minecraft:glass_pane": "Glass Panes",
    "minecraft:spruce_stairs": "Spruce Stairs",
    "minecraft:spruce_slab": "Spruce Slabs",
    "minecraft:lantern": "Lanterns",
    "minecraft:spruce_door": "Spruce Door",
    "minecraft:spruce_fence": "Spruce Fence",
};
function formatBlock(block) {
    return BLOCK_LABELS[block] ?? block.replace("minecraft:", "").split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
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
function VoxelInstances({ placements, block, color, highlighted, textures, textureMaps }) {
    const ref = useRef(null);
    const materials = useMemo(() => {
        if (!textures)
            return undefined;
        const transparent = /glass|pane|door|trapdoor|leaves|lantern/.test(block);
        return [textures.right, textures.left, textures.top, textures.bottom, textures.front, textures.back].map((url) => {
            const map = textureMaps.get(url);
            return new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0, transparent, alphaTest: transparent ? 0.08 : 0, emissive: highlighted ? new THREE.Color("#2a1608") : new THREE.Color("#000000"), emissiveIntensity: highlighted ? 0.24 : 0 });
        });
    }, [block, highlighted, textures, textureMaps]);
    useEffect(() => () => {
        materials?.forEach((material) => material.dispose());
    }, [materials]);
    useEffect(() => {
        if (!ref.current)
            return;
        const matrix = new THREE.Matrix4();
        const scale = highlighted ? 1.01 : 0.96;
        placements.forEach((placement, index) => {
            matrix.compose(new THREE.Vector3(placement.x, placement.y, placement.z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
            ref.current.setMatrixAt(index, matrix);
        });
        ref.current.instanceMatrix.needsUpdate = true;
    }, [placements, highlighted, materials]);
    return (_jsxs("instancedMesh", { ref: ref, args: [undefined, materials, placements.length], castShadow: true, receiveShadow: true, frustumCulled: false, children: [_jsx("boxGeometry", { args: [1, 1, 1] }), !materials && _jsx("meshStandardMaterial", { color: color, roughness: 0.82, metalness: 0.04, emissive: color, emissiveIntensity: highlighted ? 0.12 : 0, transparent: true, opacity: highlighted ? 1 : 0.96 })] }));
}
function VoxelScene({ build, maxLayer, selectedMaterial, orthographic, exploded, cameraPreset, texturePack }) {
    const textureMaps = useResourcePackTextures(texturePack);
    const grouped = useMemo(() => {
        const result = new Map();
        const minY = build.bounds.min.y;
        for (const placement of build.placements.filter((p) => p.y <= maxLayer)) {
            const adjusted = exploded ? { ...placement, y: placement.y + (placement.y - minY) * 0.22 } : placement;
            const key = placementTextureKey(placement.block, placement.state);
            const group = result.get(key) ?? { block: placement.block, state: placement.state, placements: [] };
            group.placements.push(adjusted);
            result.set(key, group);
        }
        return [...result.entries()];
    }, [build, exploded, maxLayer]);
    const center = [(build.bounds.min.x + build.bounds.max.x) / 2, (build.bounds.min.y + build.bounds.max.y) / 2, (build.bounds.min.z + build.bounds.max.z) / 2];
    const cameraPositions = {
        iso: [center[0] + 24, center[1] + 18, center[2] - 28],
        top: [center[0], center[1] + 46, center[2] + 0.01],
        front: [center[0], center[1] + 7, center[2] - 42],
        left: [center[0] - 42, center[1] + 7, center[2]],
        right: [center[0] + 42, center[1] + 7, center[2]],
    };
    const cameraPosition = cameraPositions[cameraPreset];
    return (_jsxs(Canvas, { shadows: true, dpr: [1, 1.5], gl: { antialias: true, alpha: false }, children: [_jsx("color", { attach: "background", args: ["#071724"] }), orthographic
                ? _jsx(OrthographicCamera, { makeDefault: true, position: cameraPosition, zoom: 16, onUpdate: (camera) => camera.lookAt(...center) }, `ortho-${cameraPreset}`)
                : _jsx(PerspectiveCamera, { makeDefault: true, position: cameraPosition, fov: 42, onUpdate: (camera) => camera.lookAt(...center) }, `perspective-${cameraPreset}`), _jsx("ambientLight", { intensity: 0.82, color: "#a9bed0" }), _jsx("directionalLight", { position: [12, 24, 18], intensity: 2.1, color: "#dce8f0", castShadow: true, "shadow-mapSize-width": 2048, "shadow-mapSize-height": 2048 }), _jsx("pointLight", { position: [center[0], center[1], center[2] - 2], intensity: 18, distance: 17, color: "#ff9d3b" }), _jsx("group", { children: grouped.map(([key, group]) => _jsx(VoxelInstances, { block: group.block, placements: group.placements, color: MATERIAL_COLORS[group.block] ?? "#9aa1a4", highlighted: selectedMaterial === group.block, textures: texturePack?.textures.get(placementTextureKey(group.block, group.state)), textureMaps: textureMaps }, key)) }), _jsx(Grid, { position: [center[0], build.bounds.min.y - 0.52, center[2]], args: [58, 58], cellSize: 1, cellThickness: 0.55, cellColor: "#294456", sectionSize: 5, sectionThickness: 0.9, sectionColor: "#36596d", fadeDistance: 42, fadeStrength: 1.5, infiniteGrid: true }), _jsx(OrbitControls, { makeDefault: true, target: center, minDistance: 10, maxDistance: 70, maxPolarAngle: Math.PI / 2.06 }, `${orthographic}-${cameraPreset}`)] }));
}
function ToolButton({ label, active, children, onClick }) {
    return _jsx("button", { className: `icon-button ${active ? "active" : ""}`, "aria-label": label, title: label, onClick: onClick, children: children });
}
function ExportMenu({ build }) {
    const [open, setOpen] = useState(false);
    const { download } = useDownload();
    const safeName = build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const makeText = (format) => {
        if (format === "json")
            return JSON.stringify(build, null, 2);
        if (format === "csv")
            return ["x,y,z,block,state,phase", ...build.placements.map((p) => `${p.x},${p.y},${p.z},${p.block},"${JSON.stringify(p.state ?? {}).replaceAll('"', '""')}","${p.phase}"`)].join("\n");
        if (format === "java" || format === "bedrock")
            return build.placements.map((p) => {
                const states = Object.entries(p.state ?? {});
                const suffix = !states.length ? "" : format === "java"
                    ? `[${states.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
                    : ` [${states.map(([key, value]) => `\"${key}\"=${typeof value === "string" ? `\"${value}\"` : value}`).join(",")}]`;
                return `setblock ${p.x} ${p.y} ${p.z} ${p.block}${suffix} replace`;
            }).join("\n");
        return `# ${build.input.name}\n# ${build.placements.length.toLocaleString()} exact placements\n\n${Object.entries(build.layerCounts).map(([layer, count]) => `Layer Y=${layer}: ${count} blocks`).join("\n")}`;
    };
    const save = async (format) => {
        const details = {
            json: { name: `${safeName}.json`, type: "application/json" },
            csv: { name: `${safeName}.csv`, type: "text/csv" },
            java: { name: `${safeName}.java.mcfunction`, type: "text/plain" },
            bedrock: { name: `${safeName}.bedrock.mcfunction`, type: "text/plain" },
            blueprint: { name: `${safeName}.blueprint.txt`, type: "text/plain" },
        }[format];
        await download({ contents: [{ type: "resource", resource: { uri: `file:///${details.name}`, mimeType: details.type, text: makeText(format) } }] });
        setOpen(false);
    };
    return (_jsxs("div", { className: "export-wrap", children: [_jsxs("button", { className: "primary-button", onClick: () => setOpen((value) => !value), children: [_jsx(Download, { size: 17 }), "Export build"] }), open && _jsx("div", { className: "export-menu", role: "menu", children: ["json", "csv", "java", "bedrock", "blueprint"].map((format) => _jsx("button", { onClick: () => void save(format), children: format === "json" ? "Blockwright JSON" : format === "csv" ? "Coordinate CSV" : format === "java" ? "Java .mcfunction" : format === "bedrock" ? "Bedrock .mcfunction" : "Layer blueprint" }, format)) })] }));
}
export default function CompileBuildView() {
    const { output, isPending, responseMetadata } = useToolInfo();
    const [displayMode, setDisplayMode] = useDisplayMode();
    const { maxHeight } = useLayout();
    const metadata = responseMetadata;
    const summary = output?.build ?? metadata?.buildSummary;
    const pagedBuild = usePagedBuild(summary, metadata?.buildPage, metadata?.build);
    const build = pagedBuild.build;
    const minLayer = (build ?? summary)?.bounds.min.y ?? 0;
    const maxLayer = (build ?? summary)?.bounds.max.y ?? 13;
    const [{ layer, selectedMaterial, orthographic, exploded, selectedStyle, cameraPreset }, setViewState] = useViewState({ layer: maxLayer, selectedMaterial: null, orthographic: false, exploded: false, selectedStyle: summary?.input.style ?? "nordic", cameraPreset: "iso" });
    const [playing, setPlaying] = useState(false);
    const [texturePack, setTexturePack] = useState(null);
    const [textureStatus, setTextureStatus] = useState("Procedural fallback");
    const [textureLoading, setTextureLoading] = useState(false);
    const textureInput = useRef(null);
    useEffect(() => {
        if (!build)
            return;
        setViewState((state) => ({
            ...state,
            layer: state.layer < build.bounds.min.y || state.layer > build.bounds.max.y ? build.bounds.max.y : state.layer,
        }));
    }, [build?.id]);
    useEffect(() => {
        if (!playing || !build)
            return;
        const timer = window.setInterval(() => setViewState((state) => ({ ...state, layer: state.layer >= maxLayer ? minLayer : state.layer + 1 })), 650);
        return () => window.clearInterval(timer);
    }, [playing, build?.id, maxLayer, minLayer]);
    useEffect(() => () => texturePack?.dispose(), [texturePack]);
    const selectTexturePack = async (file) => {
        if (!file || !build)
            return;
        setTextureLoading(true);
        setTextureStatus(`Reading ${file.name}…`);
        try {
            const next = await loadResourcePack(file, build.placements);
            setTexturePack(next);
            setTextureStatus(next.resolved
                ? `${next.name} · ${next.resolved}/${next.requested} material states`
                : `${next.name} contained no matching block textures`);
        }
        catch (error) {
            setTextureStatus(error instanceof Error ? error.message : "Could not read this resource pack.");
        }
        finally {
            setTextureLoading(false);
            if (textureInput.current)
                textureInput.current.value = "";
        }
    };
    const resetTexturePack = () => {
        setTexturePack(null);
        setTextureStatus("Procedural fallback");
    };
    if (!isPending && summary && pagedBuild.error)
        return _jsxs("div", { className: "loading-view", children: [_jsx(AlertTriangle, { size: 34 }), _jsxs("span", { children: ["Exact blocks could not be loaded. ", pagedBuild.error] })] });
    if (isPending || !summary || !build)
        return _jsxs("div", { className: "loading-view", children: [_jsx("div", { className: "loading-cube", children: _jsx(Box, { size: 34 }) }), _jsx("span", { children: summary ? `Loading exact blocks… ${pagedBuild.loaded.toLocaleString()} / ${pagedBuild.total.toLocaleString()}` : "Compiling exact blocks…" })] });
    if (displayMode !== "fullscreen") {
        return _jsxs("section", { className: "inline-summary", "data-llm": `Viewing ${build.input.name}, ${build.placements.length} blocks, layer ${layer}`, children: [_jsx("div", { className: "brand-cube", children: _jsx(Cuboid, { size: 23 }) }), _jsxs("div", { children: [_jsx("h2", { children: build.input.name }), _jsxs("p", { children: [build.placements.length.toLocaleString(), " exact blocks \u00B7 ", build.input.edition, " ", build.input.version, " \u00B7 ", build.bounds.dimensions.width, "\u00D7", build.bounds.dimensions.depth, "\u00D7", build.bounds.dimensions.height] })] }), _jsxs("button", { className: "primary-button", onClick: () => setDisplayMode("fullscreen"), children: [_jsx(Maximize2, { size: 16 }), "Open workbench"] })] });
    }
    const currentLayer = Math.max(minLayer, Math.min(layer, maxLayer));
    const roleEntries = Object.entries(build.input.rolePalette);
    const textureSwatch = (block) => [...(texturePack?.textures.entries() ?? [])].find(([key]) => key.startsWith(`${block}|`))?.[1].top;
    return (_jsxs("main", { className: "app-shell", style: { maxHeight: maxHeight || undefined }, "data-llm": `Viewing ${build.input.name}. Seed ${build.input.seed}. ${build.plan.footprint.kind} footprint with ${build.plan.roofGrammar.type} roof and ${build.plan.circulation.primary}. Preflight ${build.preflight.overallRisk}, ${build.preflight.chunksTouched} chunks. Layer ${currentLayer} of ${maxLayer}. Style preference: ${selectedStyle}. Camera: ${cameraPreset}. Texture source: ${texturePack ? `${texturePack.name}, ${texturePack.resolved} of ${texturePack.requested} material states resolved` : "procedural fallback"}. ${selectedMaterial ? `Highlighted ${formatBlock(selectedMaterial)}.` : "No material highlighted."}`, children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "brand", children: [_jsx("span", { className: "brand-cube", children: _jsx(Cuboid, { size: 22 }) }), _jsx("strong", { children: "Blockwright" }), _jsx(ChevronDown, { size: 15 })] }), _jsx("h1", { children: build.input.name }), _jsxs("div", { className: "top-actions", children: [_jsx(ToolButton, { label: "Collapse workbench", onClick: () => setDisplayMode("inline"), children: _jsx(Maximize2, { size: 17 }) }), _jsx(ExportMenu, { build: build })] })] }), _jsxs("aside", { className: "left-rail", children: [_jsxs("nav", { className: "rail-icons", "aria-label": "Workspace sections", children: [_jsx(ToolButton, { label: "Build brief", active: true, children: _jsx(MessageCircle, { size: 20 }) }), _jsx(ToolButton, { label: "Model", children: _jsx(Box, { size: 20 }) }), _jsx(ToolButton, { label: "Layers", children: _jsx(Layers3, { size: 20 }) }), _jsx(ToolButton, { label: "Files", children: _jsx(Folder, { size: 20 }) }), _jsx("span", { className: "rail-spacer" }), _jsx(ToolButton, { label: "Settings", children: _jsx(Settings, { size: 20 }) })] }), _jsxs("div", { className: "left-content", children: [_jsxs("section", { children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Build brief" }), _jsx(Pencil, { size: 14 })] }), _jsxs("p", { className: "brief", children: [build.plan.program.buildingType, " \u00B7 ", build.plan.footprint.kind, " footprint \u00B7 ", build.plan.roofGrammar.type, " roof. ", build.plan.program.spaces.join(", "), ". Circulation: ", build.plan.circulation.primary, "."] }), _jsxs("p", { className: "seed-line", children: ["Seed ", _jsx("code", { children: build.input.seed })] })] }), _jsxs("section", { children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Styles" }), _jsx(ChevronUp, { size: 14 })] }), _jsx("div", { className: "style-list", children: [build.input.style, build.plan.footprint.kind, build.plan.roofGrammar.type, build.input.buildingType].map((style, index) => _jsxs("button", { className: selectedStyle === style ? "selected" : "", onClick: () => setViewState((state) => ({ ...state, selectedStyle: style })), children: [_jsx("span", { className: `style-thumb style-${index}` }), style.replaceAll("-", " ")] }, `${style}-${index}`)) })] }), _jsxs("section", { className: "saved-section", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Saved builds" }), _jsx("span", { children: "\uFF0B" })] }), _jsx("div", { className: "saved-list", children: _jsxs("button", { className: "selected", children: [_jsx("span", { className: "saved-thumb saved-0" }), _jsxs("span", { children: [_jsx("strong", { children: build.input.name }), _jsxs("small", { children: [build.structuralFingerprint.slice(0, 8), " \u00B7 current"] })] })] }) })] })] })] }), _jsxs("section", { className: "viewport-panel", children: [_jsxs("div", { className: "canvas-tools canvas-tools-left", children: [_jsx(ToolButton, { label: "Select", active: true, children: _jsx(MousePointer2, { size: 18 }) }), _jsx(ToolButton, { label: "Box select", children: _jsx(BoxSelect, { size: 18 }) }), _jsx(ToolButton, { label: "Move", children: _jsx(Move, { size: 18 }) })] }), _jsxs("div", { className: "view-switch", children: [_jsx("button", { className: !orthographic ? "active" : "", onClick: () => setViewState((state) => ({ ...state, orthographic: false })), children: "Perspective" }), _jsx("button", { className: orthographic ? "active" : "", onClick: () => setViewState((state) => ({ ...state, orthographic: true })), children: "Orthographic" })] }), _jsxs("div", { className: "canvas-tools canvas-tools-right", children: [_jsx(ToolButton, { label: "View top", active: cameraPreset === "top", onClick: () => setViewState((state) => ({ ...state, cameraPreset: "top" })), children: _jsx(ChevronUp, { size: 19 }) }), _jsx(ToolButton, { label: "View front", active: cameraPreset === "front", onClick: () => setViewState((state) => ({ ...state, cameraPreset: "front" })), children: _jsx(ChevronDown, { size: 19 }) }), _jsx(ToolButton, { label: "View left", active: cameraPreset === "left", onClick: () => setViewState((state) => ({ ...state, cameraPreset: "left" })), children: _jsx(ChevronLeft, { size: 19 }) }), _jsx(ToolButton, { label: "View right", active: cameraPreset === "right", onClick: () => setViewState((state) => ({ ...state, cameraPreset: "right" })), children: _jsx(ChevronRight, { size: 19 }) }), _jsx(ToolButton, { label: "Explode layers", active: exploded, onClick: () => setViewState((state) => ({ ...state, exploded: !state.exploded })), children: _jsx(Layers3, { size: 19 }) })] }), _jsx("div", { className: "dimension-label dimension-height", children: _jsx("span", { children: build.bounds.dimensions.height }) }), _jsx("div", { className: "dimension-label dimension-depth", children: build.bounds.dimensions.depth }), _jsx("div", { className: "dimension-label dimension-width", children: build.bounds.dimensions.width }), _jsx(VoxelScene, { build: build, maxLayer: currentLayer, selectedMaterial: selectedMaterial, orthographic: orthographic, exploded: exploded, cameraPreset: cameraPreset, texturePack: texturePack }), _jsxs("div", { className: "timeline", children: [_jsx("button", { className: "play-button", "aria-label": playing ? "Pause construction playback" : "Play construction sequence", onClick: () => setPlaying((value) => !value), children: playing ? _jsx(Pause, { size: 21 }) : _jsx(Play, { size: 21 }) }), _jsx(ToolButton, { label: "Previous layer", onClick: () => setViewState((state) => ({ ...state, layer: Math.max(minLayer, state.layer - 1) })), children: _jsx(SkipBack, { size: 17 }) }), _jsx(ToolButton, { label: "Next layer", onClick: () => setViewState((state) => ({ ...state, layer: Math.min(maxLayer, state.layer + 1) })), children: _jsx(SkipForward, { size: 17 }) }), _jsxs("div", { className: "playing-label", children: [_jsx("strong", { children: playing ? "Playing" : "Paused" }), _jsxs("span", { children: ["Layer ", currentLayer - minLayer + 1, " / ", maxLayer - minLayer + 1] })] }), _jsxs("div", { className: "timeline-track", children: [_jsxs("div", { className: "timeline-labels", children: [_jsx("span", { children: minLayer }), _jsx("span", { children: Math.round((minLayer + maxLayer) / 2) }), _jsx("span", { children: maxLayer })] }), _jsx("input", { "aria-label": "Visible build layer", type: "range", min: minLayer, max: maxLayer, value: currentLayer, onChange: (event) => setViewState((state) => ({ ...state, layer: Number(event.target.value) })) })] }), _jsxs("div", { className: "layer-readout", children: ["Layer ", _jsx("strong", { children: currentLayer - minLayer + 1 }), _jsxs("span", { children: ["/ ", maxLayer - minLayer + 1] })] })] })] }), _jsxs("aside", { className: "right-rail", children: [_jsxs("section", { className: "inspector-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Edition" }), _jsx(ChevronUp, { size: 14 })] }), _jsxs("div", { className: "metric-row", children: [_jsx("span", { className: "block-icon grass", children: _jsx(Cuboid, { size: 22 }) }), _jsx("strong", { children: build.input.edition === "java" ? `Java ${build.input.version}` : `Bedrock ${build.input.version}` })] })] }), _jsxs("section", { className: "inspector-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Dimensions" }), _jsx(ChevronUp, { size: 14 })] }), _jsxs("div", { className: "metric-row", children: [_jsx(Box, { size: 22 }), _jsxs("strong", { children: [build.bounds.dimensions.width, " \u00D7 ", build.bounds.dimensions.depth, " \u00D7 ", build.bounds.dimensions.height] })] })] }), _jsxs("section", { className: "inspector-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Layer" }), _jsx(ChevronUp, { size: 14 })] }), _jsxs("div", { className: "metric-row", children: [_jsx(Layers3, { size: 22 }), _jsxs("strong", { children: ["Layer ", currentLayer - minLayer + 1, " / ", maxLayer - minLayer + 1] })] }), _jsx("input", { "aria-label": "Layer inspector slider", type: "range", min: minLayer, max: maxLayer, value: currentLayer, onChange: (event) => setViewState((state) => ({ ...state, layer: Number(event.target.value) })) })] }), _jsxs("section", { className: "inspector-group plan-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Design plan" }), _jsx(ChevronDown, { size: 14 })] }), _jsxs("div", { className: "plan-summary", children: [_jsxs("strong", { children: [build.plan.footprint.kind, " \u00B7 ", build.plan.roofGrammar.type] }), _jsx("span", { children: build.plan.structuralFrame.system }), _jsxs("small", { children: [build.plan.massing.volumes.length, " volume", build.plan.massing.volumes.length === 1 ? "" : "s", " \u00B7 ", build.plan.roomGraph.rooms.length, " rooms \u00B7 fingerprint ", build.structuralFingerprint.slice(0, 8)] })] })] }), _jsxs("section", { className: `inspector-group risk-group risk-${build.preflight.overallRisk}`, children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Safety preflight" }), _jsx("span", { children: build.preflight.overallRisk })] }), _jsxs("div", { className: "risk-metrics", children: [_jsxs("span", { children: [_jsx("b", { children: build.preflight.totalVolume.toLocaleString() }), " volume"] }), _jsxs("span", { children: [_jsx("b", { children: build.placements.length.toLocaleString() }), " blocks"] }), _jsxs("span", { children: [_jsx("b", { children: build.preflight.chunksTouched }), " chunks"] }), _jsxs("span", { children: [_jsx("b", { children: build.regions.length }), " regions"] })] }), build.preflight.warnings.map((warning) => _jsx("p", { children: warning }, warning))] }), _jsxs("section", { className: "inspector-group palette-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Role palette" }), _jsx(ChevronDown, { size: 14 })] }), _jsx("div", { className: "palette-list", children: roleEntries.map(([role, block]) => { const texture = textureSwatch(block); const count = build.materialCounts[block] ?? 0; return _jsxs("button", { className: selectedMaterial === block ? "selected" : "", onClick: () => setViewState((state) => ({ ...state, selectedMaterial: state.selectedMaterial === block ? null : block })), children: [_jsx("span", { className: "material-cube", style: texture ? { backgroundImage: `url(${texture})` } : { background: MATERIAL_COLORS[block] ?? "#999" } }), _jsxs("span", { children: [_jsx("small", { children: role }), formatBlock(block)] }), _jsx("strong", { children: count.toLocaleString() }), _jsx("i", { style: { background: MATERIAL_COLORS[block] ?? "#999" } })] }, role); }) })] }), _jsxs("section", { className: "inspector-group texture-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Textures" }), _jsx(ChevronDown, { size: 14 })] }), _jsxs("div", { className: "texture-source", children: [_jsx("span", { className: texturePack ? "texture-preview loaded" : "texture-preview", children: texturePack ? _jsx(Check, { size: 16 }) : _jsx(Box, { size: 16 }) }), _jsxs("span", { children: [_jsx("strong", { children: texturePack ? "Resource pack active" : "Procedural fallback" }), _jsx("small", { children: textureStatus })] })] }), _jsxs("div", { className: "texture-actions", children: [_jsxs("button", { onClick: () => textureInput.current?.click(), disabled: textureLoading, children: [_jsx(Upload, { size: 14 }), textureLoading ? "Loading…" : "Load pack"] }), texturePack && _jsxs("button", { className: "texture-reset", onClick: resetTexturePack, children: [_jsx(X, { size: 13 }), "Reset"] })] }), _jsx("input", { ref: textureInput, className: "texture-file", type: "file", accept: ".zip,.jar,application/zip,application/java-archive", onChange: (event) => void selectTexturePack(event.target.files?.[0]) }), _jsx("p", { className: "texture-note", children: "Java resource-pack ZIP or client JAR. Files stay in this browser." })] }), _jsxs("section", { className: "inspector-group validation-group", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Validation" }), _jsx(ChevronDown, { size: 14 })] }), _jsxs("div", { className: "validation-row", children: [_jsx("span", { className: "check-ring", children: _jsx(Check, { size: 22 }) }), _jsxs("div", { children: [_jsx("strong", { children: build.validation.valid ? "Build ready" : "Needs attention" }), _jsxs("span", { children: [build.validation.blockingIssues, " blocking issues"] })] })] }), build.validation.warnings > 0 && _jsx("p", { className: "coverage-note", children: "Registry coverage note available in build metadata." })] })] }), _jsxs("footer", { className: "statusbar", children: [_jsxs("span", { className: "ready", children: [_jsx("i", {}), "Ready"] }), _jsxs("span", { children: ["Coordinates: ", _jsx("b", { children: "X" }), " ", build.input.origin.x, " ", _jsx("b", { children: "Y" }), " ", currentLayer, " ", _jsx("b", { children: "Z" }), " ", build.input.origin.z] }), _jsxs("strong", { children: [build.placements.length.toLocaleString(), " blocks"] }), _jsxs("span", { children: ["Hash: ", _jsx("code", { children: build.hash.slice(0, 8) })] }), _jsxs("div", { className: "status-tools", children: [_jsx(Eye, { size: 18 }), _jsx(Layers3, { size: 18 }), _jsx(Ruler, { size: 18 })] })] })] }));
}
//# sourceMappingURL=compile-build.js.map