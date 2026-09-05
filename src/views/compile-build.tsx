import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  AlertTriangle,
  Box,
  BoxSelect,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cuboid,
  Download,
  Eye,
  Folder,
  Layers3,
  Maximize2,
  MessageCircle,
  MousePointer2,
  Move,
  Pause,
  Pencil,
  Play,
  Ruler,
  Settings,
  SkipBack,
  SkipForward,
  Upload,
  X,
} from "lucide-react";
import { useDisplayMode, useDownload, useLayout, useViewState } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import { type BuildPlacementPage, type BuildSummary } from "../lib/build-view-paging.js";
import { constructionExportBlocker } from "../lib/export-policy.js";
import type { BuildRecord, Placement } from "../lib/types.js";
import { loadResourcePack, placementTextureKey, type FaceTextures, type LoadedResourcePack } from "../lib/resource-pack.js";
import { usePagedBuild } from "../use-paged-build.js";

type ToolOutput = { build?: BuildSummary };
type ToolMetadata = { buildSummary?: BuildSummary; buildPage?: BuildPlacementPage; build?: BuildRecord };

const MATERIAL_COLORS: Record<string, string> = {
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

const BLOCK_LABELS: Record<string, string> = {
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

function formatBlock(block: string) {
  return BLOCK_LABELS[block] ?? block.replace("minecraft:", "").split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function useResourcePackTextures(texturePack: LoadedResourcePack | null) {
  const textureMaps = useMemo(() => {
    const maps = new Map<string, THREE.Texture>();
    if (!texturePack) return maps;
    const loader = new THREE.TextureLoader();
    for (const faces of texturePack.textures.values()) {
      for (const url of Object.values(faces)) {
        if (maps.has(url)) continue;
        const map = loader.load(url);
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = THREE.NearestFilter;
        map.minFilter = THREE.NearestMipmapNearestFilter;
        maps.set(url, map);
      }
    }
    return maps;
  }, [texturePack]);
  useEffect(() => () => { for (const map of textureMaps.values()) map.dispose(); }, [textureMaps]);
  return textureMaps;
}

function VoxelInstances({ placements, block, color, highlighted, textures, textureMaps }: { placements: Placement[]; block: string; color: string; highlighted: boolean; textures?: FaceTextures; textureMaps: Map<string, THREE.Texture> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const materials = useMemo(() => {
    if (!textures) return undefined;
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
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    const scale = highlighted ? 1.01 : 0.96;
    placements.forEach((placement, index) => {
      matrix.compose(new THREE.Vector3(placement.x, placement.y, placement.z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      ref.current!.setMatrixAt(index, matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [placements, highlighted, materials]);
  return (
    <instancedMesh ref={ref} args={[undefined, materials, placements.length]} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      {!materials && <meshStandardMaterial color={color} roughness={0.82} metalness={0.04} emissive={color} emissiveIntensity={highlighted ? 0.12 : 0} transparent opacity={highlighted ? 1 : 0.96} />}
    </instancedMesh>
  );
}

type CameraPreset = "iso" | "top" | "front" | "left" | "right";

function VoxelScene({ build, maxLayer, selectedMaterial, orthographic, exploded, cameraPreset, texturePack }: { build: BuildRecord; maxLayer: number; selectedMaterial: string | null; orthographic: boolean; exploded: boolean; cameraPreset: CameraPreset; texturePack: LoadedResourcePack | null }) {
  const textureMaps = useResourcePackTextures(texturePack);
  const grouped = useMemo(() => {
    const result = new Map<string, { block: string; state: Placement["state"]; placements: Placement[] }>();
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
  const center = [(build.bounds.min.x + build.bounds.max.x) / 2, (build.bounds.min.y + build.bounds.max.y) / 2, (build.bounds.min.z + build.bounds.max.z) / 2] as [number, number, number];
  const cameraPositions: Record<CameraPreset, [number, number, number]> = {
    iso: [center[0] + 24, center[1] + 18, center[2] - 28],
    top: [center[0], center[1] + 46, center[2] + 0.01],
    front: [center[0], center[1] + 7, center[2] - 42],
    left: [center[0] - 42, center[1] + 7, center[2]],
    right: [center[0] + 42, center[1] + 7, center[2]],
  };
  const cameraPosition = cameraPositions[cameraPreset];
  return (
    <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }}>
      <color attach="background" args={["#071724"]} />
      {orthographic
        ? <OrthographicCamera key={`ortho-${cameraPreset}`} makeDefault position={cameraPosition} zoom={16} onUpdate={(camera) => camera.lookAt(...center)} />
        : <PerspectiveCamera key={`perspective-${cameraPreset}`} makeDefault position={cameraPosition} fov={42} onUpdate={(camera) => camera.lookAt(...center)} />}
      <ambientLight intensity={0.82} color="#a9bed0" />
      <directionalLight position={[12, 24, 18]} intensity={2.1} color="#dce8f0" castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <pointLight position={[center[0], center[1], center[2] - 2]} intensity={18} distance={17} color="#ff9d3b" />
      <group>
        {grouped.map(([key, group]) => <VoxelInstances key={key} block={group.block} placements={group.placements} color={MATERIAL_COLORS[group.block] ?? "#9aa1a4"} highlighted={selectedMaterial === group.block} textures={texturePack?.textures.get(placementTextureKey(group.block, group.state))} textureMaps={textureMaps} />)}
      </group>
      <Grid position={[center[0], build.bounds.min.y - 0.52, center[2]]} args={[58, 58]} cellSize={1} cellThickness={0.55} cellColor="#294456" sectionSize={5} sectionThickness={0.9} sectionColor="#36596d" fadeDistance={42} fadeStrength={1.5} infiniteGrid />
      <OrbitControls key={`${orthographic}-${cameraPreset}`} makeDefault target={center} minDistance={10} maxDistance={70} maxPolarAngle={Math.PI / 2.06} />
    </Canvas>
  );
}

function ToolButton({ label, active, children, onClick }: { label: string; active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return <button className={`icon-button ${active ? "active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function ExportMenu({ build }: { build: BuildRecord }) {
  const [open, setOpen] = useState(false);
  const { download } = useDownload();
  const safeName = build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const commandFormat = build.input.edition === "java" ? "java" : "bedrock";
  const constructionBlocker = constructionExportBlocker(build, build.input.edition === "java" ? "java_mcfunction" : "bedrock_mcfunction");
  const availableFormats = ["json", "csv", "blueprint", ...(constructionBlocker ? [] : [commandFormat])] as Array<"json" | "csv" | "java" | "bedrock" | "blueprint">;
  const makeText = (format: "json" | "csv" | "java" | "bedrock" | "blueprint") => {
    if (format === "json") return JSON.stringify(build, null, 2);
    if (format === "csv") return ["x,y,z,block,state,phase", ...build.placements.map((p) => `${p.x},${p.y},${p.z},${p.block},"${JSON.stringify(p.state ?? {}).replaceAll('"', '""')}","${p.phase}"`)].join("\n");
    if (format === "java" || format === "bedrock") return build.placements.map((p) => {
      const states = Object.entries(p.state ?? {});
      const suffix = !states.length ? "" : format === "java"
        ? `[${states.map(([key, value]) => `${key}=${String(value)}`).join(",")}]`
        : ` [${states.map(([key, value]) => `\"${key}\"=${typeof value === "string" ? `\"${value}\"` : value}`).join(",")}]`;
      return `setblock ${p.x} ${p.y} ${p.z} ${p.block}${suffix} replace`;
    }).join("\n");
    return `# ${build.input.name}\n# ${build.placements.length.toLocaleString()} exact placements\n\n${Object.entries(build.layerCounts).map(([layer, count]) => `Layer Y=${layer}: ${count} blocks`).join("\n")}`;
  };
  const save = async (format: "json" | "csv" | "java" | "bedrock" | "blueprint") => {
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
  return (
    <div className="export-wrap">
      <button className="primary-button" onClick={() => setOpen((value) => !value)}><Download size={17} />Export build</button>
      {open && <div className="export-menu" role="menu">
        {constructionBlocker && <p className="export-blocked" role="status">Construction export blocked. Diagnostic files remain available.</p>}
        {availableFormats.map((format) => <button key={format} onClick={() => void save(format)}>{format === "json" ? "Blockwright JSON" : format === "csv" ? "Coordinate CSV" : format === "java" ? "Java .mcfunction" : format === "bedrock" ? "Bedrock .mcfunction" : "Layer blueprint"}</button>)}
      </div>}
    </div>
  );
}

export default function CompileBuildView() {
  const { output, isPending, responseMetadata } = useToolInfo<"compile_build">();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { maxHeight } = useLayout();
  const metadata = responseMetadata as ToolMetadata | undefined;
  const summary = (output as ToolOutput | undefined)?.build ?? metadata?.buildSummary;
  const pagedBuild = usePagedBuild(summary, metadata?.buildPage, metadata?.build);
  const build = pagedBuild.build;
  const minLayer = (build ?? summary)?.bounds.min.y ?? 0;
  const maxLayer = (build ?? summary)?.bounds.max.y ?? 13;
  const [{ layer, selectedMaterial, orthographic, exploded, selectedStyle, cameraPreset }, setViewState] = useViewState({ layer: maxLayer, selectedMaterial: null as string | null, orthographic: false, exploded: false, selectedStyle: summary?.input.style ?? "nordic", cameraPreset: "iso" as CameraPreset });
  const [playing, setPlaying] = useState(false);
  const [texturePack, setTexturePack] = useState<LoadedResourcePack | null>(null);
  const [textureStatus, setTextureStatus] = useState("Procedural fallback");
  const [textureLoading, setTextureLoading] = useState(false);
  const textureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!build) return;
    setViewState((state) => ({
      ...state,
      layer: state.layer < build.bounds.min.y || state.layer > build.bounds.max.y ? build.bounds.max.y : state.layer,
    }));
  }, [build?.id]);
  useEffect(() => {
    if (!playing || !build) return;
    const timer = window.setInterval(() => setViewState((state) => ({ ...state, layer: state.layer >= maxLayer ? minLayer : state.layer + 1 })), 650);
    return () => window.clearInterval(timer);
  }, [playing, build?.id, maxLayer, minLayer]);
  useEffect(() => () => texturePack?.dispose(), [texturePack]);

  const selectTexturePack = async (file: File | undefined) => {
    if (!file || !build) return;
    setTextureLoading(true);
    setTextureStatus(`Reading ${file.name}…`);
    try {
      const next = await loadResourcePack(file, build.placements);
      setTexturePack(next);
      setTextureStatus(next.resolved
        ? `${next.name} · ${next.resolved}/${next.requested} material states`
        : `${next.name} contained no matching block textures`);
    } catch (error) {
      setTextureStatus(error instanceof Error ? error.message : "Could not read this resource pack.");
    } finally {
      setTextureLoading(false);
      if (textureInput.current) textureInput.current.value = "";
    }
  };

  const resetTexturePack = () => {
    setTexturePack(null);
    setTextureStatus("Procedural fallback");
  };

  if (!isPending && summary && pagedBuild.error) return <div className="loading-view"><AlertTriangle size={34} /><span>Exact blocks could not be loaded. {pagedBuild.error}</span></div>;
  if (isPending || !summary || !build) return <div className="loading-view"><div className="loading-cube"><Box size={34} /></div><span>{summary ? `Loading exact blocks… ${pagedBuild.loaded.toLocaleString()} / ${pagedBuild.total.toLocaleString()}` : "Compiling exact blocks…"}</span></div>;
  if (displayMode !== "fullscreen") {
    return <section className="inline-summary" data-llm={`Viewing ${build.input.name}, ${build.placements.length} blocks, layer ${layer}`}>
      <div className="brand-cube"><Cuboid size={23} /></div>
      <div><h2>{build.input.name}</h2><p>{build.placements.length.toLocaleString()} exact blocks · {build.input.edition} {build.input.version} · {build.bounds.dimensions.width}×{build.bounds.dimensions.depth}×{build.bounds.dimensions.height}</p></div>
      <button className="primary-button" onClick={() => setDisplayMode("fullscreen")}><Maximize2 size={16} />Open workbench</button>
    </section>;
  }

  const currentLayer = Math.max(minLayer, Math.min(layer, maxLayer));
  const roleEntries = Object.entries(build.input.rolePalette) as [string, string][];
  const textureSwatch = (block: string) => [...(texturePack?.textures.entries() ?? [])].find(([key]) => key.startsWith(`${block}|`))?.[1].top;
  return (
    <main className="app-shell" style={{ maxHeight: maxHeight || undefined }} data-llm={`Viewing ${build.input.name}. Seed ${build.input.seed}. ${build.plan.footprint.kind} footprint with ${build.plan.roofGrammar.type} roof and ${build.plan.circulation.primary}. Preflight ${build.preflight.overallRisk}, ${build.preflight.chunksTouched} chunks. Layer ${currentLayer} of ${maxLayer}. Style preference: ${selectedStyle}. Camera: ${cameraPreset}. Texture source: ${texturePack ? `${texturePack.name}, ${texturePack.resolved} of ${texturePack.requested} material states resolved` : "procedural fallback"}. ${selectedMaterial ? `Highlighted ${formatBlock(selectedMaterial)}.` : "No material highlighted."}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-cube"><Cuboid size={22} /></span><strong>Blockwright</strong><ChevronDown size={15} /></div>
        <h1>{build.input.name}</h1>
        <div className="top-actions"><ToolButton label="Collapse workbench" onClick={() => setDisplayMode("inline")}><Maximize2 size={17} /></ToolButton><ExportMenu build={build} /></div>
      </header>

      <aside className="left-rail">
        <nav className="rail-icons" aria-label="Workspace sections">
          <ToolButton label="Build brief" active><MessageCircle size={20} /></ToolButton>
          <ToolButton label="Model"><Box size={20} /></ToolButton>
          <ToolButton label="Layers"><Layers3 size={20} /></ToolButton>
          <ToolButton label="Files"><Folder size={20} /></ToolButton>
          <span className="rail-spacer" />
          <ToolButton label="Settings"><Settings size={20} /></ToolButton>
        </nav>
        <div className="left-content">
          <section><div className="section-heading"><h2>Build brief</h2><Pencil size={14} /></div><p className="brief">{build.plan.program.buildingType} · {build.plan.footprint.kind} footprint · {build.plan.roofGrammar.type} roof. {build.plan.program.spaces.join(", ")}. Circulation: {build.plan.circulation.primary}.</p><p className="seed-line">Seed <code>{build.input.seed}</code></p></section>
          <section><div className="section-heading"><h2>Styles</h2><ChevronUp size={14} /></div><div className="style-list">
            {[build.input.style, build.plan.footprint.kind, build.plan.roofGrammar.type, build.input.buildingType].map((style, index) => <button className={selectedStyle === style ? "selected" : ""} key={`${style}-${index}`} onClick={() => setViewState((state) => ({ ...state, selectedStyle: style }))}><span className={`style-thumb style-${index}`} />{style.replaceAll("-", " ")}</button>)}
          </div></section>
          <section className="saved-section"><div className="section-heading"><h2>Saved builds</h2><span>＋</span></div><div className="saved-list">
            <button className="selected"><span className="saved-thumb saved-0" /><span><strong>{build.input.name}</strong><small>{build.structuralFingerprint.slice(0, 8)} · current</small></span></button>
          </div></section>
        </div>
      </aside>

      <section className="viewport-panel">
        <div className="canvas-tools canvas-tools-left"><ToolButton label="Select" active><MousePointer2 size={18} /></ToolButton><ToolButton label="Box select"><BoxSelect size={18} /></ToolButton><ToolButton label="Move"><Move size={18} /></ToolButton></div>
        <div className="view-switch"><button className={!orthographic ? "active" : ""} onClick={() => setViewState((state) => ({ ...state, orthographic: false }))}>Perspective</button><button className={orthographic ? "active" : ""} onClick={() => setViewState((state) => ({ ...state, orthographic: true }))}>Orthographic</button></div>
        <div className="canvas-tools canvas-tools-right"><ToolButton label="View top" active={cameraPreset === "top"} onClick={() => setViewState((state) => ({ ...state, cameraPreset: "top" }))}><ChevronUp size={19} /></ToolButton><ToolButton label="View front" active={cameraPreset === "front"} onClick={() => setViewState((state) => ({ ...state, cameraPreset: "front" }))}><ChevronDown size={19} /></ToolButton><ToolButton label="View left" active={cameraPreset === "left"} onClick={() => setViewState((state) => ({ ...state, cameraPreset: "left" }))}><ChevronLeft size={19} /></ToolButton><ToolButton label="View right" active={cameraPreset === "right"} onClick={() => setViewState((state) => ({ ...state, cameraPreset: "right" }))}><ChevronRight size={19} /></ToolButton><ToolButton label="Explode layers" active={exploded} onClick={() => setViewState((state) => ({ ...state, exploded: !state.exploded }))}><Layers3 size={19} /></ToolButton></div>
        <div className="dimension-label dimension-height"><span>{build.bounds.dimensions.height}</span></div>
        <div className="dimension-label dimension-depth">{build.bounds.dimensions.depth}</div>
        <div className="dimension-label dimension-width">{build.bounds.dimensions.width}</div>
        <VoxelScene build={build} maxLayer={currentLayer} selectedMaterial={selectedMaterial} orthographic={orthographic} exploded={exploded} cameraPreset={cameraPreset} texturePack={texturePack} />
        <div className="timeline">
          <button className="play-button" aria-label={playing ? "Pause construction playback" : "Play construction sequence"} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={21} /> : <Play size={21} />}</button>
          <ToolButton label="Previous layer" onClick={() => setViewState((state) => ({ ...state, layer: Math.max(minLayer, state.layer - 1) }))}><SkipBack size={17} /></ToolButton>
          <ToolButton label="Next layer" onClick={() => setViewState((state) => ({ ...state, layer: Math.min(maxLayer, state.layer + 1) }))}><SkipForward size={17} /></ToolButton>
          <div className="playing-label"><strong>{playing ? "Playing" : "Paused"}</strong><span>Layer {currentLayer - minLayer + 1} / {maxLayer - minLayer + 1}</span></div>
          <div className="timeline-track"><div className="timeline-labels"><span>{minLayer}</span><span>{Math.round((minLayer + maxLayer) / 2)}</span><span>{maxLayer}</span></div><input aria-label="Visible build layer" type="range" min={minLayer} max={maxLayer} value={currentLayer} onChange={(event) => setViewState((state) => ({ ...state, layer: Number(event.target.value) }))} /></div>
          <div className="layer-readout">Layer <strong>{currentLayer - minLayer + 1}</strong><span>/ {maxLayer - minLayer + 1}</span></div>
        </div>
      </section>

      <aside className="right-rail">
        <section className="inspector-group"><div className="section-heading"><h2>Edition</h2><ChevronUp size={14} /></div><div className="metric-row"><span className="block-icon grass"><Cuboid size={22} /></span><strong>{build.input.edition === "java" ? `Java ${build.input.version}` : `Bedrock ${build.input.version}`}</strong></div></section>
        <section className="inspector-group"><div className="section-heading"><h2>Dimensions</h2><ChevronUp size={14} /></div><div className="metric-row"><Box size={22} /><strong>{build.bounds.dimensions.width} × {build.bounds.dimensions.depth} × {build.bounds.dimensions.height}</strong></div></section>
        <section className="inspector-group"><div className="section-heading"><h2>Layer</h2><ChevronUp size={14} /></div><div className="metric-row"><Layers3 size={22} /><strong>Layer {currentLayer - minLayer + 1} / {maxLayer - minLayer + 1}</strong></div><input aria-label="Layer inspector slider" type="range" min={minLayer} max={maxLayer} value={currentLayer} onChange={(event) => setViewState((state) => ({ ...state, layer: Number(event.target.value) }))} /></section>
        <section className="inspector-group plan-group"><div className="section-heading"><h2>Design plan</h2><ChevronDown size={14} /></div><div className="plan-summary"><strong>{build.plan.footprint.kind} · {build.plan.roofGrammar.type}</strong><span>{build.plan.structuralFrame.system}</span><small>{build.plan.massing.volumes.length} volume{build.plan.massing.volumes.length === 1 ? "" : "s"} · {build.plan.roomGraph.rooms.length} rooms · fingerprint {build.structuralFingerprint.slice(0, 8)}</small></div></section>
        <section className={`inspector-group risk-group risk-${build.preflight.overallRisk}`}><div className="section-heading"><h2>Safety preflight</h2><span>{build.preflight.overallRisk}</span></div><div className="risk-metrics"><span><b>{build.preflight.totalVolume.toLocaleString()}</b> volume</span><span><b>{build.placements.length.toLocaleString()}</b> blocks</span><span><b>{build.preflight.chunksTouched}</b> chunks</span><span><b>{build.regions.length}</b> regions</span></div>{build.preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section>
        <section className="inspector-group palette-group"><div className="section-heading"><h2>Role palette</h2><ChevronDown size={14} /></div><div className="palette-list">{roleEntries.map(([role, block]) => { const texture = textureSwatch(block); const count = build.materialCounts[block] ?? 0; return <button key={role} className={selectedMaterial === block ? "selected" : ""} onClick={() => setViewState((state) => ({ ...state, selectedMaterial: state.selectedMaterial === block ? null : block }))}><span className="material-cube" style={texture ? { backgroundImage: `url(${texture})` } : { background: MATERIAL_COLORS[block] ?? "#999" }} /><span><small>{role}</small>{formatBlock(block)}</span><strong>{count.toLocaleString()}</strong><i style={{ background: MATERIAL_COLORS[block] ?? "#999" }} /></button>; })}</div></section>
        <section className="inspector-group texture-group"><div className="section-heading"><h2>Textures</h2><ChevronDown size={14} /></div><div className="texture-source"><span className={texturePack ? "texture-preview loaded" : "texture-preview"}>{texturePack ? <Check size={16} /> : <Box size={16} />}</span><span><strong>{texturePack ? "Resource pack active" : "Procedural fallback"}</strong><small>{textureStatus}</small></span></div><div className="texture-actions"><button onClick={() => textureInput.current?.click()} disabled={textureLoading}><Upload size={14} />{textureLoading ? "Loading…" : "Load pack"}</button>{texturePack && <button className="texture-reset" onClick={resetTexturePack}><X size={13} />Reset</button>}</div><input ref={textureInput} className="texture-file" type="file" accept=".zip,.jar,application/zip,application/java-archive" onChange={(event) => void selectTexturePack(event.target.files?.[0])} /><p className="texture-note">Java resource-pack ZIP or client JAR. Files stay in this browser.</p></section>
        <section className="inspector-group validation-group"><div className="section-heading"><h2>Validation</h2><ChevronDown size={14} /></div><div className="validation-row"><span className="check-ring"><Check size={22} /></span><div><strong>{build.validation.valid ? "Build ready" : "Needs attention"}</strong><span>{build.validation.blockingIssues} blocking issues</span></div></div>{build.validation.warnings > 0 && <p className="coverage-note">Registry coverage note available in build metadata.</p>}</section>
      </aside>

      <footer className="statusbar">
        <span className="ready"><i />Ready</span><span>Coordinates: <b>X</b> {build.input.origin.x} <b>Y</b> {currentLayer} <b>Z</b> {build.input.origin.z}</span><strong>{build.placements.length.toLocaleString()} blocks</strong><span>Hash: <code>{build.hash.slice(0, 8)}</code></span><div className="status-tools"><Eye size={18} /><Layers3 size={18} /><Ruler size={18} /></div>
      </footer>
    </main>
  );
}
