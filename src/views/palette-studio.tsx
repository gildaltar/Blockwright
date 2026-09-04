import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Cuboid, Lock, LockOpen, Maximize2, Save, Upload } from "lucide-react";
import { useDisplayMode, useLayout, useViewState } from "skybridge/web";
import { useCallTool, useToolInfo } from "../helpers.js";
import { loadResourcePack, type LoadedResourcePack } from "../lib/resource-pack.js";
import type { PaletteRole, Placement, SavedPalette } from "../lib/types.js";

type InterviewOutput = { session: SavedPalette & { complete: boolean }; nextQuestion?: { key: string; question: string }; remainingTopics: string[] };

const roleLabels: Record<PaletteRole, string> = {
  foundation: "Foundation", wall: "Walls", frame: "Structural frame", roof: "Roof", trim: "Trim", glazing: "Glazing",
  lighting: "Lighting", doors: "Doors", railings: "Railings", accents: "Accents", landscaping: "Landscaping",
};

export default function PaletteStudio() {
  const { output, isPending } = useToolInfo<"continue_palette_interview">();
  const [displayMode, setDisplayMode] = useDisplayMode(); const { maxHeight } = useLayout();
  const { callTool: continueInterview, data: continued, isPending: isContinuing } = useCallTool("continue_palette_interview");
  const { callTool: savePalette, data: saved, isPending: isSaving } = useCallTool("save_palette");
  const initial = output as InterviewOutput | undefined; const newest = continued?.structuredContent as InterviewOutput | undefined; const result = newest ?? initial;
  const [paletteState, setState] = useViewState({ answer: "", replacementRole: "wall" as PaletteRole, replacementBlock: "", saveName: "My Palette" });
  const answer = paletteState.answer ?? "";
  const replacementRole = paletteState.replacementRole ?? "wall";
  const replacementBlock = paletteState.replacementBlock ?? "";
  const saveName = paletteState.saveName ?? "My Palette";
  const [pack, setPack] = useState<LoadedResourcePack | null>(null); const [packStatus, setPackStatus] = useState("Vanilla-style fallback colors");
  const fileInput = useRef<HTMLInputElement>(null);
  const placements = useMemo<Placement[]>(() => result ? Object.entries(result.session.roles).map(([role, block], index) => ({ x: index, y: 0, z: 0, block, phase: role })) : [], [result]);
  useEffect(() => () => pack?.dispose(), [pack]);
  if (isPending || !result) return <div className="loading-view"><Cuboid size={30} />Preparing Palette Studio…</div>;
  const session = result.session;
  const submitAnswer = () => {
    if (!result.nextQuestion || !answer.trim()) return;
    continueInterview({ sessionId: session.id, edition: session.edition, version: session.version, answers: { [result.nextQuestion.key]: answer.trim() } });
    setState((state) => ({ ...state, answer: "" }));
  };
  const changeRole = (lock: boolean) => {
    const roleChanges = replacementBlock.trim() ? { [replacementRole]: replacementBlock.trim() } : undefined;
    continueInterview({ sessionId: session.id, edition: session.edition, version: session.version, roleChanges, ...(lock ? { lockRoles: [replacementRole] } : { unlockRoles: [replacementRole] }) });
    setState((state) => ({ ...state, replacementBlock: "" }));
  };
  const loadPack = async (file?: File) => {
    if (!file) return;
    try { const loaded = await loadResourcePack(file, placements); setPack(loaded); setPackStatus(`${loaded.name} · ${loaded.resolved}/${loaded.requested} roles resolved`); }
    catch (error) { setPackStatus(error instanceof Error ? error.message : "Could not load this pack."); }
  };
  const swatch = (block: string) => {
    const entry = [...(pack?.textures.entries() ?? [])].find(([key]) => key.startsWith(`${block}|`));
    return entry?.[1].top;
  };
  if (displayMode !== "fullscreen") return <section className="studio-inline" data-llm={`Palette ${session.name}; ${session.lockedRoles.length} locked roles; next question: ${result.nextQuestion?.question ?? "complete"}`}><Cuboid size={24} /><div><h2>Palette Studio</h2><p>{result.nextQuestion?.question ?? "Palette complete and valid."}</p></div><button className="primary-button" onClick={() => setDisplayMode("fullscreen")}><Maximize2 size={16} />Open studio</button></section>;
  return <main className="studio-shell" style={{ maxHeight: maxHeight || undefined }} data-llm={`Editing palette ${session.name} for ${session.edition} ${session.version}. Locked: ${session.lockedRoles.join(", ") || "none"}. Remaining: ${result.remainingTopics.join(", ") || "none"}. Texture preview: ${packStatus}.`}>
    <header className="studio-header"><div><span>Blockwright</span><h1>Conversational Palette Studio</h1></div><button className="icon-button" onClick={() => setDisplayMode("inline")} aria-label="Collapse"><Maximize2 size={18} /></button></header>
    <section className="studio-question"><span>{session.complete ? <Check size={20} /> : `${12 - result.remainingTopics.length + 1}/12`}</span><div><small>One useful question at a time</small><h2>{result.nextQuestion?.question ?? "Your palette contract is complete."}</h2></div>{result.nextQuestion && <><input value={answer} onChange={(event) => setState((state) => ({ ...state, answer: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && submitAnswer()} placeholder="Answer naturally…" /><button onClick={submitAnswer} disabled={isContinuing || !answer.trim()}>Continue</button></>}</section>
    <section className="studio-grid">
      {Object.entries(session.roles).map(([role, block]) => { const texture = swatch(block); const locked = session.lockedRoles.includes(role as PaletteRole); return <article key={role} className={locked ? "role-card locked" : "role-card"}><span className="role-swatch" style={texture ? { backgroundImage: `url(${texture})` } : undefined}><Cuboid size={19} /></span><div><small>{roleLabels[role as PaletteRole]}</small><strong>{block.replace("minecraft:", "").replaceAll("_", " ")}</strong></div>{locked ? <Lock size={15} /> : <LockOpen size={15} />}</article>; })}
    </section>
    <aside className="studio-controls">
      <section><h3>Replace or lock a role</h3><select value={replacementRole} onChange={(event) => setState((state) => ({ ...state, replacementRole: event.target.value as PaletteRole }))}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select><input value={replacementBlock} onChange={(event) => setState((state) => ({ ...state, replacementBlock: event.target.value }))} placeholder="minecraft:block_id" /><div><button onClick={() => changeRole(false)} disabled={isContinuing}>Replace / unlock</button><button onClick={() => changeRole(true)} disabled={isContinuing}><Lock size={14} />Replace + lock</button></div></section>
      <section><h3>Texture preview</h3><p>{packStatus}</p><button onClick={() => fileInput.current?.click()}><Upload size={14} />Load resource pack</button><input ref={fileInput} className="texture-file" type="file" accept=".zip,.jar" onChange={(event) => void loadPack(event.target.files?.[0])} /></section>
      <section><h3>Save palette</h3><input value={saveName} onChange={(event) => setState((state) => ({ ...state, saveName: event.target.value }))} /><button onClick={() => savePalette({ sessionId: session.id, name: saveName })} disabled={isSaving}><Save size={14} />{saved ? "Saved" : "Save named palette"}</button></section>
    </aside>
  </main>;
}
