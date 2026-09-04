import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Box as DreiBox, Edges, Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  Box as BoxIcon, BoxSelect, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Download, Eye, FileInput, Focus, Layers3, Maximize2, MousePointer2, Orbit, Ruler,
  Trash2, Upload,
} from "lucide-react";
import { useDisplayMode, useDownload, useLayout, useViewState } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import { loadResourcePack, placementTextureKey, type FaceTextures, type LoadedResourcePack } from "../lib/resource-pack.js";
import { isRoofPlacement, type AuditFinding, type BuildAudit, type ReviewAnnotation, type ReviewBounds, type ReviewCategory } from "../lib/reviewer.js";
import type { BuildRecord, Placement, Vec3 } from "../lib/types.js";

type ToolOutput = { review?: { buildId: string; hash: string; name: string; blockCount: number; audit: BuildAudit["totals"] } };
type ToolMetadata = { build?: BuildRecord; audit?: BuildAudit };
type ReviewMode = "orbit" | "select" | "region" | "measure";
type CameraPreset = "iso" | "top" | "north" | "south" | "east" | "west";
type Selection = ReviewBounds & { type: "block" | "region" | "measure"; blockCount: number; pickedBlock?: string; pickedState?: Placement["state"] };
type ShapePart = { size: [number, number, number]; offset: [number, number, number]; rotationY?: number; role?: string };

const COLORS: Record<string, string> = {
  change: "#e9ad4f", fix: "#ef6b5b", remove: "#c74f76", liked: "#5ec6a7",
};

const coordinateKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`;
const formatBlock = (block: string) => block.replace("minecraft:", "").split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
const stateString = (state: Placement["state"]) => Object.entries(state ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${String(value)}`).join(", ");
const value = (placement: Placement, key: string) => String(placement.state?.[key] ?? "");
const direction = (facing: string) => ({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[facing] ?? [0, -1]);
const rotation = (facing: string) => ({ north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[facing] ?? 0);

function colorFor(block: string) {
  if (/lantern|glowstone|froglight|shroomlight/.test(block)) return "#e9ad4f";
  if (/deepslate|blackstone|coal/.test(block)) return "#30383d";
  if (/stone|tuff|andesite|cobble/.test(block)) return "#747a78";
  if (/mangrove|crimson|brick|terracotta/.test(block)) return "#7d3428";
  if (/spruce|dark_oak/.test(block)) return "#49311f";
  if (/oak|bamboo|birch/.test(block)) return "#ad8250";
  if (/glass|pane|ice/.test(block)) return "#8fc4cc";
  if (/moss|grass|leaves|vine/.test(block)) return "#52724c";
  return "#9ba0a2";
}

function geometryParts(placement: Placement): ShapePart[] {
  const id = placement.block;
  const facing = value(placement, "facing") || "north";
  const half = value(placement, "half") || "bottom";
  const [dx, dz] = direction(facing);
  if (id.endsWith("_slab")) {
    const type = value(placement, "type") || "bottom";
    if (type === "double") return [{ size: [1, 1, 1], offset: [0, 0, 0] }];
    return [{ size: [1, .5, 1], offset: [0, type === "top" ? .25 : -.25, 0] }];
  }
  if (id.endsWith("_stairs")) {
    const top = half === "top";
    return [
      { size: [1, .5, 1], offset: [0, top ? .25 : -.25, 0] },
      { size: [Math.abs(dx) ? .5 : 1, .5, Math.abs(dz) ? .5 : 1], offset: [dx * .25, top ? -.25 : .25, dz * .25] },
    ];
  }
  if (id.endsWith("_trapdoor")) {
    const open = value(placement, "open") === "true";
    if (!open) return [{ size: [1, .1875, 1], offset: [0, half === "top" ? .40625 : -.40625, 0] }];
    return [{ size: [Math.abs(dx) ? .1875 : 1, 1, Math.abs(dz) ? .1875 : 1], offset: [dx * .40625, 0, dz * .40625] }];
  }
  if (/glass_pane|iron_bars/.test(id)) {
    const parts: ShapePart[] = [{ size: [.125, 1, .125], offset: [0, 0, 0] }];
    if (value(placement, "north") === "true") parts.push({ size: [.125, 1, .5], offset: [0, 0, -.25] });
    if (value(placement, "south") === "true") parts.push({ size: [.125, 1, .5], offset: [0, 0, .25] });
    if (value(placement, "west") === "true") parts.push({ size: [.5, 1, .125], offset: [-.25, 0, 0] });
    if (value(placement, "east") === "true") parts.push({ size: [.5, 1, .125], offset: [.25, 0, 0] });
    return parts;
  }
  if (/_fence$|_wall$/.test(id)) {
    const parts: ShapePart[] = [{ size: [.25, 1, .25], offset: [0, 0, 0] }];
    const connected = (side: string) => ["true", "low", "tall"].includes(value(placement, side));
    if (connected("north")) parts.push({ size: [.25, .5, .5], offset: [0, .05, -.25] });
    if (connected("south")) parts.push({ size: [.25, .5, .5], offset: [0, .05, .25] });
    if (connected("west")) parts.push({ size: [.5, .5, .25], offset: [-.25, .05, 0] });
    if (connected("east")) parts.push({ size: [.5, .5, .25], offset: [.25, .05, 0] });
    return parts;
  }
  if (/_door$/.test(id) && !/_trapdoor$/.test(id)) {
    const yaw = rotation(facing);
    return [{ size: [1, 1, .1875], offset: [0, 0, 0], rotationY: yaw }];
  }
  if (/(^|:)lantern$|soul_lantern$/.test(id)) {
    const hanging = value(placement, "hanging") === "true";
    return [
      { size: [.5, .5, .5], offset: [0, -.05, 0], role: "lantern" },
      { size: [.25, .18, .25], offset: [0, .29, 0], role: "metal" },
      ...(hanging ? [{ size: [.12, .28, .12] as [number, number, number], offset: [0, .43, 0] as [number, number, number], role: "metal" }] : []),
    ];
  }
  return [{ size: [1, 1, 1], offset: [0, 0, 0] }];
}

function InstancePart({ placements, part, block, textures, dimmed, onPick }: { placements: Placement[]; part: ShapePart; block: string; textures?: FaceTextures; dimmed: boolean; onPick: (placement: Placement) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => {
    const url = textures?.top;
    const map = url ? new THREE.TextureLoader().load(url) : undefined;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestMipmapNearestFilter; }
    const emissive = part.role === "lantern" ? new THREE.Color("#b86b22") : new THREE.Color("#000000");
    return new THREE.MeshStandardMaterial({ color: url ? "#ffffff" : part.role === "metal" ? "#242a2c" : colorFor(block), map, roughness: part.role === "metal" ? .45 : .88, metalness: part.role === "metal" ? .5 : 0, transparent: dimmed || /glass|pane|leaves/.test(block), opacity: dimmed ? .2 : 1, alphaTest: /glass|pane|leaves|door|trapdoor/.test(block) ? .08 : 0, emissive, emissiveIntensity: part.role === "lantern" ? 1.1 : 0 });
  }, [block, dimmed, part.role, textures?.top]);
  useEffect(() => () => { material.map?.dispose(); material.dispose(); }, [material]);
  useEffect(() => {
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, part.rotationY ?? 0, 0));
    placements.forEach((placement, index) => {
      matrix.compose(new THREE.Vector3(placement.x + part.offset[0], placement.y + part.offset[1], placement.z + part.offset[2]), quaternion, new THREE.Vector3(...part.size));
      ref.current!.setMatrixAt(index, matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [placements, part]);
  return <instancedMesh ref={ref} args={[undefined, undefined, placements.length]} material={material} frustumCulled={false} onClick={(event) => { event.stopPropagation(); if (event.instanceId !== undefined) onPick(placements[event.instanceId]); }}>
    <boxGeometry args={[1, 1, 1]} />
  </instancedMesh>;
}

function SelectionBox({ selection, color = "#f2b661" }: { selection?: ReviewBounds; color?: string }) {
  if (!selection) return null;
  const size: [number, number, number] = [selection.max.x - selection.min.x + 1.08, selection.max.y - selection.min.y + 1.08, selection.max.z - selection.min.z + 1.08];
  const center: [number, number, number] = [(selection.min.x + selection.max.x) / 2, (selection.min.y + selection.max.y) / 2, (selection.min.z + selection.max.z) / 2];
  return <DreiBox args={size} position={center}><meshBasicMaterial transparent opacity={.035} color={color} depthWrite={false} /><Edges color={color} /></DreiBox>;
}

function ReviewScene({ build, maxLayer, hideRoof, cameraPreset, orthographic, selection, annotations, texturePack, onPick }: { build: BuildRecord; maxLayer: number; hideRoof: boolean; cameraPreset: CameraPreset; orthographic: boolean; selection?: Selection; annotations: ReviewAnnotation[]; texturePack: LoadedResourcePack | null; onPick: (placement: Placement) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { placement: Placement; placements: Placement[]; parts: ShapePart[] }>();
    for (const placement of build.placements) {
      if (placement.y > maxLayer || (hideRoof && isRoofPlacement(placement, build))) continue;
      const key = placementTextureKey(placement.block, placement.state);
      const group = map.get(key) ?? { placement, placements: [], parts: geometryParts(placement) };
      group.placements.push(placement);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [build, hideRoof, maxLayer]);
  const center: [number, number, number] = [(build.bounds.min.x + build.bounds.max.x) / 2, (build.bounds.min.y + build.bounds.max.y) / 2, (build.bounds.min.z + build.bounds.max.z) / 2];
  const radius = Math.max(build.bounds.dimensions.width, build.bounds.dimensions.depth, build.bounds.dimensions.height) * 1.35;
  const positions: Record<CameraPreset, [number, number, number]> = {
    iso: [center[0] + radius, center[1] + radius * .65, center[2] - radius],
    top: [center[0], center[1] + radius * 1.6, center[2] + .01],
    north: [center[0], center[1] + radius * .3, center[2] - radius * 1.3],
    south: [center[0], center[1] + radius * .3, center[2] + radius * 1.3],
    east: [center[0] + radius * 1.3, center[1] + radius * .3, center[2]],
    west: [center[0] - radius * 1.3, center[1] + radius * .3, center[2]],
  };
  return <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }} onPointerMissed={() => undefined}>
    <color attach="background" args={["#06141e"]} />
    {orthographic
      ? <OrthographicCamera key={`review-ortho-${cameraPreset}`} makeDefault position={positions[cameraPreset]} zoom={Math.max(4, 850 / radius)} onUpdate={(camera) => camera.lookAt(...center)} />
      : <PerspectiveCamera key={`review-perspective-${cameraPreset}`} makeDefault position={positions[cameraPreset]} fov={42} onUpdate={(camera) => camera.lookAt(...center)} />}
    <ambientLight intensity={1.05} color="#a8bfd0" />
    <directionalLight position={[center[0] + radius, center[1] + radius, center[2] - radius]} intensity={2.2} color="#f5e7cf" castShadow />
    {groups.flatMap(([key, group]) => group.parts.map((part, index) => <InstancePart key={`${key}-${index}`} placements={group.placements} part={part} block={group.placement.block} textures={texturePack?.textures.get(key)} dimmed={false} onPick={onPick} />))}
    <SelectionBox selection={selection} />
    {annotations.map((annotation) => <SelectionBox key={annotation.id} selection={annotation.bounds} color={COLORS[annotation.category]} />)}
    <Grid position={[center[0], build.bounds.min.y - .51, center[2]]} args={[Math.max(64, radius * 2), Math.max(64, radius * 2)]} cellSize={1} cellColor="#294554" sectionSize={5} sectionColor="#3f6170" fadeDistance={radius * 1.8} infiniteGrid />
    <OrbitControls makeDefault target={center} minDistance={3} maxDistance={radius * 4} maxPolarAngle={Math.PI / 2.01} enabled />
  </Canvas>;
}

function countWithin(build: BuildRecord, bounds: ReviewBounds) {
  return build.placements.filter((placement) => placement.x >= bounds.min.x && placement.x <= bounds.max.x && placement.y >= bounds.min.y && placement.y <= bounds.max.y && placement.z >= bounds.min.z && placement.z <= bounds.max.z).length;
}

function orderedBounds(a: Vec3, b: Vec3): ReviewBounds {
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) } };
}

function ReviewButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`review-icon-button ${active ? "active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

export default function ReviewBuildView() {
  const { output, isPending, responseMetadata } = useToolInfo<"review_build">();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { maxHeight } = useLayout();
  const { download } = useDownload();
  const build = (responseMetadata as ToolMetadata | undefined)?.build;
  const audit = (responseMetadata as ToolMetadata | undefined)?.audit;
  const summary = (output as ToolOutput | undefined)?.review;
  const maxBuildLayer = build?.bounds.max.y ?? 0;
  const minBuildLayer = build?.bounds.min.y ?? 0;
  const [{ mode, layer, hideRoof, orthographic, cameraPreset, annotations, selection, anchor }, setReviewState] = useViewState({
    mode: "orbit" as ReviewMode,
    layer: maxBuildLayer,
    hideRoof: false,
    orthographic: false,
    cameraPreset: "iso" as CameraPreset,
    annotations: [] as ReviewAnnotation[],
    selection: undefined as Selection | undefined,
    anchor: undefined as Vec3 | undefined,
  });
  const [category, setCategory] = useState<ReviewCategory>("fix");
  const [note, setNote] = useState("");
  const [texturePack, setTexturePack] = useState<LoadedResourcePack | null>(null);
  const [textureStatus, setTextureStatus] = useState("Procedural fallback");
  const importRef = useRef<HTMLInputElement>(null);
  const textureRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!build) return;
    setReviewState((state) => ({ ...state, layer: state.layer < build.bounds.min.y || state.layer > build.bounds.max.y ? build.bounds.max.y : state.layer }));
  }, [build?.id]);
  useEffect(() => () => texturePack?.dispose(), [texturePack]);

  if (isPending || !build || !summary || !audit) return <div className="loading-view"><BoxIcon size={34} /><span>Preparing exact 3D review…</span></div>;

  const onPick = (placement: Placement) => {
    const point = { x: placement.x, y: placement.y, z: placement.z };
    if (mode === "orbit") return;
    if (mode === "select") {
      const bounds = orderedBounds(point, point);
      setReviewState((state) => ({ ...state, selection: { ...bounds, type: "block", blockCount: 1, pickedBlock: placement.block, pickedState: placement.state }, anchor: undefined }));
      return;
    }
    if (!anchor) {
      setReviewState((state) => ({ ...state, anchor: point, selection: undefined }));
      return;
    }
    const bounds = orderedBounds(anchor, point);
    setReviewState((state) => ({ ...state, anchor: undefined, selection: { ...bounds, type: mode === "measure" ? "measure" : "region", blockCount: countWithin(build, bounds), pickedBlock: placement.block, pickedState: placement.state } }));
  };

  const saveAnnotation = () => {
    if (!selection || selection.type === "measure") return;
    const annotation: ReviewAnnotation = {
      id: `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      category,
      note: note.trim(),
      bounds: { min: selection.min, max: selection.max },
      blockCount: selection.blockCount,
      pickedBlock: selection.pickedBlock,
      pickedState: selection.pickedState,
      createdAt: new Date().toISOString(),
    };
    setReviewState((state) => ({ ...state, annotations: [annotation, ...state.annotations], selection: undefined }));
    setNote("");
  };

  const exportReview = async () => {
    const safeName = build.input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blockwright-build";
    const review = { schemaVersion: 1, type: "blockwright-review", build: { id: build.id, hash: build.hash, name: build.input.name, edition: build.input.edition, version: build.input.version, bounds: build.bounds }, annotations, audit, exportedAt: new Date().toISOString() };
    await download({ contents: [{ type: "resource", resource: { uri: `file:///${safeName}-review.json`, mimeType: "application/json", text: JSON.stringify(review, null, 2) } }] });
  };

  const importReview = async (file: File | undefined) => {
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as { type?: string; build?: { hash?: string }; annotations?: ReviewAnnotation[] };
    if (parsed.type !== "blockwright-review" || parsed.build?.hash !== build.hash || !Array.isArray(parsed.annotations)) throw new Error("This review is not for the current immutable build hash.");
    setReviewState((state) => ({ ...state, annotations: parsed.annotations ?? [] }));
  };

  const loadTextures = async (file: File | undefined) => {
    if (!file) return;
    setTextureStatus(`Reading ${file.name}…`);
    try {
      const next = await loadResourcePack(file, build.placements);
      setTexturePack((current) => { current?.dispose(); return next; });
      setTextureStatus(`${next.name} · ${next.resolved}/${next.requested} states resolved`);
    } catch (error) {
      setTextureStatus(error instanceof Error ? error.message : "Could not read this resource pack.");
    }
  };

  const distance = selection?.type === "measure" ? {
    dx: selection.max.x - selection.min.x,
    dy: selection.max.y - selection.min.y,
    dz: selection.max.z - selection.min.z,
    length: Math.hypot(selection.max.x - selection.min.x, selection.max.y - selection.min.y, selection.max.z - selection.min.z),
  } : undefined;
  const selectedState = selection?.pickedState ? stateString(selection.pickedState) : "";
  const layerValue = Math.max(minBuildLayer, Math.min(layer, maxBuildLayer));
  const llmContext = `Reviewing ${build.input.name}, hash ${build.hash.slice(0, 12)}. ${annotations.length} annotations. ${selection ? `Selected ${selection.type} from ${coordinateKey(selection.min)} to ${coordinateKey(selection.max)}.` : "No selection."} ${hideRoof ? "Roof blocks hidden." : "Roof blocks visible."} Global audit: ${audit.totals.errors} errors and ${audit.totals.warnings} warnings across ${audit.scannedPlacements} placements.`;

  if (displayMode !== "fullscreen") return <section className="inline-summary review-inline" data-llm={llmContext}>
    <div className="brand-cube"><Eye size={22} /></div>
    <div><h2>Review {build.input.name}</h2><p>{build.placements.length.toLocaleString()} exact blocks · {audit.findings.length} audit categories · {annotations.length} annotations</p></div>
    <button className="primary-button" onClick={() => setDisplayMode("fullscreen")}><Maximize2 size={16} />Open reviewer</button>
  </section>;

  return <main className="review-shell" style={{ maxHeight: maxHeight || undefined }} data-llm={llmContext}>
    <header className="review-header">
      <div><span className="panel-kicker">Blockwright reviewer</span><h1>{build.input.name}</h1></div>
      <div className="review-header-actions">
        <button onClick={() => textureRef.current?.click()}><Upload size={15} />Textures</button>
        <button onClick={() => importRef.current?.click()}><FileInput size={15} />Import review</button>
        <button className="primary-button" onClick={() => void exportReview()}><Download size={15} />Export review</button>
        <ReviewButton label="Collapse reviewer" onClick={() => setDisplayMode("inline")}><Maximize2 size={16} /></ReviewButton>
      </div>
      <input ref={textureRef} hidden type="file" accept=".zip,.jar,application/zip,application/java-archive" onChange={(event) => void loadTextures(event.target.files?.[0])} />
      <input ref={importRef} hidden type="file" accept=".json,application/json" onChange={(event) => void importReview(event.target.files?.[0])} />
    </header>

    <aside className="review-tools" aria-label="Review tools">
      <ReviewButton label="Orbit" active={mode === "orbit"} onClick={() => setReviewState((state) => ({ ...state, mode: "orbit", anchor: undefined }))}><Orbit size={19} /></ReviewButton>
      <ReviewButton label="Select block" active={mode === "select"} onClick={() => setReviewState((state) => ({ ...state, mode: "select", anchor: undefined }))}><MousePointer2 size={19} /></ReviewButton>
      <ReviewButton label="Select region" active={mode === "region"} onClick={() => setReviewState((state) => ({ ...state, mode: "region", anchor: undefined }))}><BoxSelect size={19} /></ReviewButton>
      <ReviewButton label="Measure" active={mode === "measure"} onClick={() => setReviewState((state) => ({ ...state, mode: "measure", anchor: undefined }))}><Ruler size={19} /></ReviewButton>
      <span />
      <ReviewButton label="Top" active={cameraPreset === "top"} onClick={() => setReviewState((state) => ({ ...state, cameraPreset: "top" }))}><ChevronUp size={19} /></ReviewButton>
      <ReviewButton label="North" active={cameraPreset === "north"} onClick={() => setReviewState((state) => ({ ...state, cameraPreset: "north" }))}><ChevronDown size={19} /></ReviewButton>
      <ReviewButton label="West" active={cameraPreset === "west"} onClick={() => setReviewState((state) => ({ ...state, cameraPreset: "west" }))}><ChevronLeft size={19} /></ReviewButton>
      <ReviewButton label="East" active={cameraPreset === "east"} onClick={() => setReviewState((state) => ({ ...state, cameraPreset: "east" }))}><ChevronRight size={19} /></ReviewButton>
      <ReviewButton label="Isometric" active={cameraPreset === "iso"} onClick={() => setReviewState((state) => ({ ...state, cameraPreset: "iso" }))}><Focus size={19} /></ReviewButton>
    </aside>

    <section className="review-viewport">
      <ReviewScene build={build} maxLayer={layerValue} hideRoof={hideRoof} cameraPreset={cameraPreset} orthographic={orthographic} selection={selection} annotations={annotations} texturePack={texturePack} onPick={onPick} />
      <div className="review-view-switch"><button className={!orthographic ? "active" : ""} onClick={() => setReviewState((state) => ({ ...state, orthographic: false }))}>Perspective</button><button className={orthographic ? "active" : ""} onClick={() => setReviewState((state) => ({ ...state, orthographic: true }))}>Orthographic</button></div>
      <div className="review-layer-control"><Layers3 size={15} /><input aria-label="Maximum visible Y layer" type="range" min={minBuildLayer} max={maxBuildLayer} value={layerValue} onChange={(event) => setReviewState((state) => ({ ...state, layer: Number(event.target.value) }))} /><strong>Y ≤ {layerValue}</strong><label><input type="checkbox" checked={hideRoof} onChange={(event) => setReviewState((state) => ({ ...state, hideRoof: event.target.checked }))} />Hide roof</label></div>
      {anchor && <div className="review-instruction">First corner: {coordinateKey(anchor)} · choose the second point</div>}
    </section>

    <aside className="review-inspector">
      <section>
        <div className="review-section-heading"><span className="panel-kicker">Annotation</span><small>exact world coordinates</small></div>
        <div className="review-category-row">{(["change", "fix", "remove", "liked"] as const).map((item) => <button key={item} className={category === item ? "active" : ""} style={{ "--category": COLORS[item] } as React.CSSProperties} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe the issue, intent, or detail to preserve…" />
        <button className="primary-button review-save" disabled={!selection || selection.type === "measure"} onClick={saveAnnotation}><Check size={15} />Save annotation</button>
      </section>

      <section>
        <div className="review-section-heading"><span className="panel-kicker">Selection</span><small>{selection?.type ?? "none"}</small></div>
        {selection ? <div className="review-selection-card">
          <strong>{selection.blockCount.toLocaleString()} block{selection.blockCount === 1 ? "" : "s"}</strong>
          <span>Min {coordinateKey(selection.min)}</span><span>Max {coordinateKey(selection.max)}</span>
          {selection.pickedBlock && <span>{formatBlock(selection.pickedBlock)}</span>}
          {selectedState && <code>{selectedState}</code>}
          {distance && <span>Δ {distance.dx}, {distance.dy}, {distance.dz} · {distance.length.toFixed(2)} blocks</span>}
        </div> : <p className="review-empty">Choose block or region select, then click the model.</p>}
      </section>

      <section>
        <div className="review-section-heading"><span className="panel-kicker">Global audit</span><small>{audit.scannedPlacements.toLocaleString()} scanned</small></div>
        <div className="audit-totals"><span><b>{audit.totals.errors}</b> errors</span><span><b>{audit.totals.warnings}</b> warnings</span><span><b>{audit.statefulPlacements.toLocaleString()}</b> stateful</span></div>
        <div className="audit-findings">{audit.findings.length ? audit.findings.slice(0, 8).map((finding: AuditFinding) => <button key={finding.code} onClick={() => finding.coordinates[0] && setReviewState((state) => ({ ...state, selection: { ...orderedBounds(finding.coordinates[0], finding.coordinates[0]), type: "block", blockCount: 1 } }))}><span className={`audit-dot ${finding.severity}`} /><span><strong>{finding.code.replaceAll("_", " ")}</strong><small>{finding.total.toLocaleString()} · {finding.message}</small></span></button>) : <div className="review-pass"><Check size={16} />No structural audit findings</div>}</div>
      </section>

      <section className="review-history-section">
        <div className="review-section-heading"><span className="panel-kicker">Annotation history</span><small>{annotations.length}</small></div>
        <div className="review-history">{annotations.length ? annotations.map((annotation) => <button key={annotation.id} onClick={() => setReviewState((state) => ({ ...state, selection: { ...annotation.bounds, type: annotation.bounds.min.x === annotation.bounds.max.x && annotation.bounds.min.y === annotation.bounds.max.y && annotation.bounds.min.z === annotation.bounds.max.z ? "block" : "region", blockCount: annotation.blockCount, pickedBlock: annotation.pickedBlock, pickedState: annotation.pickedState } }))}><i style={{ background: COLORS[annotation.category] }} /><span><strong>{annotation.category} · {annotation.blockCount} block{annotation.blockCount === 1 ? "" : "s"}</strong><small>{annotation.note || coordinateKey(annotation.bounds.min)}</small></span><Trash2 size={14} onClick={(event) => { event.stopPropagation(); setReviewState((state) => ({ ...state, annotations: state.annotations.filter((item) => item.id !== annotation.id) })); }} /></button>) : <p className="review-empty">No annotations yet.</p>}</div>
      </section>
    </aside>

    <footer className="review-status"><span><i />Ready</span><span>{mode === "orbit" ? "Orbit, pan, and zoom" : anchor ? "Choose the second point" : `Review mode: ${mode}`}</span><span>{textureStatus}</span><strong>{build.placements.length.toLocaleString()} blocks · {build.hash.slice(0, 8)}</strong><Eye size={16} /></footer>
  </main>;
}
