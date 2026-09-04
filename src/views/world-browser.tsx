import "../index.css";
import { FolderOpen, HardDrive, Maximize2, RefreshCw, ShieldCheck } from "lucide-react";
import { useDisplayMode, useLayout, useViewState } from "skybridge/web";
import { useCallTool, useToolInfo } from "../helpers.js";
import type { DiscoveredWorld } from "../lib/types.js";

type Discovery = { worlds: DiscoveredWorld[]; roots: string[]; warnings: string[]; localOnly: string };

export default function WorldBrowser() {
  const { output, isPending } = useToolInfo<"discover_worlds">(); const { callTool, data, isPending: refreshing } = useCallTool("discover_worlds");
  const [displayMode, setDisplayMode] = useDisplayMode(); const { maxHeight } = useLayout();
  const initial = output as Discovery | undefined; const refreshed = data?.structuredContent as Discovery | undefined; const discovery = refreshed ?? initial;
  const [worldState, setState] = useViewState({ selectedWorldId: "", authorizedSavesFolder: "" });
  const selectedWorldId = worldState.selectedWorldId ?? "";
  const authorizedSavesFolder = worldState.authorizedSavesFolder ?? "";
  if (isPending || !discovery) return <div className="loading-view"><HardDrive size={30} />Looking for local worlds…</div>;
  const selected = discovery.worlds.find(({ id }) => id === selectedWorldId) ?? discovery.worlds[0];
  if (displayMode !== "fullscreen") return <section className="studio-inline" data-llm={`Found ${discovery.worlds.length} local worlds. Selected: ${selected?.displayName ?? "none"}.`}><HardDrive size={24} /><div><h2>Minecraft worlds</h2><p>{discovery.worlds.length ? `${discovery.worlds.length} found on this PC` : "No worlds found yet"}</p></div><button className="primary-button" onClick={() => setDisplayMode("fullscreen")}><Maximize2 size={16} />Choose world</button></section>;
  return <main className="world-shell" style={{ maxHeight: maxHeight || undefined }} data-llm={`Local world selection: ${selected ? `${selected.displayName}, ${selected.minecraftVersion ?? "unknown version"}, ${selected.platform}, ${selected.locked ? "save open/locked" : "save not locked"}` : "none"}.`}>
    <header className="studio-header"><div><span>Blockwright local companion</span><h1>Choose a Minecraft world</h1></div><button className="icon-button" onClick={() => setDisplayMode("inline")} aria-label="Collapse"><Maximize2 size={18} /></button></header>
    <section className="world-toolbar"><select aria-label="Discovered world" value={selected?.id ?? ""} onChange={(event) => setState((state) => ({ ...state, selectedWorldId: event.target.value }))}><option value="">Select a saved world</option>{discovery.worlds.map((world) => <option key={world.id} value={world.id}>{world.displayName} · {world.minecraftVersion ?? `DataVersion ${world.dataVersion ?? "?"}`}</option>)}</select><button onClick={() => callTool({ authorizedSavesFolder: authorizedSavesFolder || undefined })} disabled={refreshing}><RefreshCw size={15} />Refresh</button></section>
    <section className="folder-picker"><FolderOpen size={18} /><input value={authorizedSavesFolder} onChange={(event) => setState((state) => ({ ...state, authorizedSavesFolder: event.target.value }))} placeholder="Paste another launcher’s saves folder" /><button onClick={() => callTool({ authorizedSavesFolder })} disabled={refreshing || !authorizedSavesFolder.trim()}>Choose another saves folder</button></section>
    {selected ? <section className="world-card"><div className="world-icon"><HardDrive size={34} /></div><div className="world-primary"><small>{selected.folderName}</small><h2>{selected.displayName}</h2><p>{selected.canonicalPath}</p></div><dl><div><dt>Minecraft</dt><dd>{selected.minecraftVersion ?? "Unknown"}</dd></div><div><dt>DataVersion</dt><dd>{selected.dataVersion ?? "Unknown"}</dd></div><div><dt>Mode</dt><dd>{selected.gameMode ?? "Unknown"}</dd></div><div><dt>Platform</dt><dd>{selected.platform}</dd></div><div><dt>Last played</dt><dd>{selected.lastPlayed ? new Date(selected.lastPlayed).toLocaleString() : "Unknown"}</dd></div><div><dt>Save status</dt><dd className={selected.locked ? "risk-red" : "risk-green"}>{selected.locked ? "Open or locked" : "Available"}</dd></div></dl><div className="worldedit-target"><ShieldCheck size={18} /><span><strong>WorldEdit schematic folder</strong><small>{selected.suggestedSchematicFolders[0]}</small></span></div></section> : <section className="world-empty"><HardDrive size={42} /><h2>No Java worlds found</h2><p>Use “Choose another saves folder” for Prism Launcher, CurseForge, or a server.</p></section>}
    <footer className="local-only">{discovery.localOnly} Direct save editing is not implemented; Blockwright installs reversible `.schem` files only after confirmation.</footer>
  </main>;
}
