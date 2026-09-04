import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import "../index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Cuboid, Lock, LockOpen, Maximize2, Save, Upload } from "lucide-react";
import { useDisplayMode, useLayout, useViewState } from "skybridge/web";
import { useCallTool, useToolInfo } from "../helpers.js";
import { loadResourcePack } from "../lib/resource-pack.js";
const roleLabels = {
    foundation: "Foundation", wall: "Walls", frame: "Structural frame", roof: "Roof", trim: "Trim", glazing: "Glazing",
    lighting: "Lighting", doors: "Doors", railings: "Railings", accents: "Accents", landscaping: "Landscaping",
};
export default function PaletteStudio() {
    const { output, isPending } = useToolInfo();
    const [displayMode, setDisplayMode] = useDisplayMode();
    const { maxHeight } = useLayout();
    const { callTool: continueInterview, data: continued, isPending: isContinuing } = useCallTool("continue_palette_interview");
    const { callTool: savePalette, data: saved, isPending: isSaving } = useCallTool("save_palette");
    const initial = output;
    const newest = continued?.structuredContent;
    const result = newest ?? initial;
    const [paletteState, setState] = useViewState({ answer: "", replacementRole: "wall", replacementBlock: "", saveName: "My Palette" });
    const answer = paletteState.answer ?? "";
    const replacementRole = paletteState.replacementRole ?? "wall";
    const replacementBlock = paletteState.replacementBlock ?? "";
    const saveName = paletteState.saveName ?? "My Palette";
    const [pack, setPack] = useState(null);
    const [packStatus, setPackStatus] = useState("Vanilla-style fallback colors");
    const fileInput = useRef(null);
    const placements = useMemo(() => result ? Object.entries(result.session.roles).map(([role, block], index) => ({ x: index, y: 0, z: 0, block, phase: role })) : [], [result]);
    useEffect(() => () => pack?.dispose(), [pack]);
    if (isPending || !result)
        return _jsxs("div", { className: "loading-view", children: [_jsx(Cuboid, { size: 30 }), "Preparing Palette Studio\u2026"] });
    const session = result.session;
    const submitAnswer = () => {
        if (!result.nextQuestion || !answer.trim())
            return;
        continueInterview({ sessionId: session.id, edition: session.edition, version: session.version, answers: { [result.nextQuestion.key]: answer.trim() } });
        setState((state) => ({ ...state, answer: "" }));
    };
    const changeRole = (lock) => {
        const roleChanges = replacementBlock.trim() ? { [replacementRole]: replacementBlock.trim() } : undefined;
        continueInterview({ sessionId: session.id, edition: session.edition, version: session.version, roleChanges, ...(lock ? { lockRoles: [replacementRole] } : { unlockRoles: [replacementRole] }) });
        setState((state) => ({ ...state, replacementBlock: "" }));
    };
    const loadPack = async (file) => {
        if (!file)
            return;
        try {
            const loaded = await loadResourcePack(file, placements);
            setPack(loaded);
            setPackStatus(`${loaded.name} · ${loaded.resolved}/${loaded.requested} roles resolved`);
        }
        catch (error) {
            setPackStatus(error instanceof Error ? error.message : "Could not load this pack.");
        }
    };
    const swatch = (block) => {
        const entry = [...(pack?.textures.entries() ?? [])].find(([key]) => key.startsWith(`${block}|`));
        return entry?.[1].top;
    };
    if (displayMode !== "fullscreen")
        return _jsxs("section", { className: "studio-inline", "data-llm": `Palette ${session.name}; ${session.lockedRoles.length} locked roles; next question: ${result.nextQuestion?.question ?? "complete"}`, children: [_jsx(Cuboid, { size: 24 }), _jsxs("div", { children: [_jsx("h2", { children: "Palette Studio" }), _jsx("p", { children: result.nextQuestion?.question ?? "Palette complete and valid." })] }), _jsxs("button", { className: "primary-button", onClick: () => setDisplayMode("fullscreen"), children: [_jsx(Maximize2, { size: 16 }), "Open studio"] })] });
    return _jsxs("main", { className: "studio-shell", style: { maxHeight: maxHeight || undefined }, "data-llm": `Editing palette ${session.name} for ${session.edition} ${session.version}. Locked: ${session.lockedRoles.join(", ") || "none"}. Remaining: ${result.remainingTopics.join(", ") || "none"}. Texture preview: ${packStatus}.`, children: [_jsxs("header", { className: "studio-header", children: [_jsxs("div", { children: [_jsx("span", { children: "Blockwright" }), _jsx("h1", { children: "Conversational Palette Studio" })] }), _jsx("button", { className: "icon-button", onClick: () => setDisplayMode("inline"), "aria-label": "Collapse", children: _jsx(Maximize2, { size: 18 }) })] }), _jsxs("section", { className: "studio-question", children: [_jsx("span", { children: session.complete ? _jsx(Check, { size: 20 }) : `${12 - result.remainingTopics.length + 1}/12` }), _jsxs("div", { children: [_jsx("small", { children: "One useful question at a time" }), _jsx("h2", { children: result.nextQuestion?.question ?? "Your palette contract is complete." })] }), result.nextQuestion && _jsxs(_Fragment, { children: [_jsx("input", { value: answer, onChange: (event) => setState((state) => ({ ...state, answer: event.target.value })), onKeyDown: (event) => event.key === "Enter" && submitAnswer(), placeholder: "Answer naturally\u2026" }), _jsx("button", { onClick: submitAnswer, disabled: isContinuing || !answer.trim(), children: "Continue" })] })] }), _jsx("section", { className: "studio-grid", children: Object.entries(session.roles).map(([role, block]) => { const texture = swatch(block); const locked = session.lockedRoles.includes(role); return _jsxs("article", { className: locked ? "role-card locked" : "role-card", children: [_jsx("span", { className: "role-swatch", style: texture ? { backgroundImage: `url(${texture})` } : undefined, children: _jsx(Cuboid, { size: 19 }) }), _jsxs("div", { children: [_jsx("small", { children: roleLabels[role] }), _jsx("strong", { children: block.replace("minecraft:", "").replaceAll("_", " ") })] }), locked ? _jsx(Lock, { size: 15 }) : _jsx(LockOpen, { size: 15 })] }, role); }) }), _jsxs("aside", { className: "studio-controls", children: [_jsxs("section", { children: [_jsx("h3", { children: "Replace or lock a role" }), _jsx("select", { value: replacementRole, onChange: (event) => setState((state) => ({ ...state, replacementRole: event.target.value })), children: Object.entries(roleLabels).map(([role, label]) => _jsx("option", { value: role, children: label }, role)) }), _jsx("input", { value: replacementBlock, onChange: (event) => setState((state) => ({ ...state, replacementBlock: event.target.value })), placeholder: "minecraft:block_id" }), _jsxs("div", { children: [_jsx("button", { onClick: () => changeRole(false), disabled: isContinuing, children: "Replace / unlock" }), _jsxs("button", { onClick: () => changeRole(true), disabled: isContinuing, children: [_jsx(Lock, { size: 14 }), "Replace + lock"] })] })] }), _jsxs("section", { children: [_jsx("h3", { children: "Texture preview" }), _jsx("p", { children: packStatus }), _jsxs("button", { onClick: () => fileInput.current?.click(), children: [_jsx(Upload, { size: 14 }), "Load resource pack"] }), _jsx("input", { ref: fileInput, className: "texture-file", type: "file", accept: ".zip,.jar", onChange: (event) => void loadPack(event.target.files?.[0]) })] }), _jsxs("section", { children: [_jsx("h3", { children: "Save palette" }), _jsx("input", { value: saveName, onChange: (event) => setState((state) => ({ ...state, saveName: event.target.value })) }), _jsxs("button", { onClick: () => savePalette({ sessionId: session.id, name: saveName }), disabled: isSaving, children: [_jsx(Save, { size: 14 }), saved ? "Saved" : "Save named palette"] })] })] })] });
}
//# sourceMappingURL=palette-studio.js.map