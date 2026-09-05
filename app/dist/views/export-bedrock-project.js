import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import "../index.css";
import { useEffect, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, LoaderCircle, ShieldCheck, Smartphone, X } from "lucide-react";
import { useDownload, useRequestClose } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import { createBedrockDownloadRequest, formatArtifactBytes, releaseBedrockDownloadArtifact, resolveBedrockDownloadArtifact, } from "../lib/bedrock-download.js";
export default function ExportBedrockProjectView() {
    const tool = useToolInfo();
    const { download } = useDownload();
    const requestClose = useRequestClose();
    const artifactRef = useRef(undefined);
    const [downloadState, setDownloadState] = useState("ready");
    const [message, setMessage] = useState("Ready for the iPhone save or share sheet.");
    const output = tool.output;
    const metadata = tool.responseMetadata;
    let artifactError;
    if (!tool.isPending && output && downloadState !== "released" && !artifactRef.current) {
        try {
            artifactRef.current = resolveBedrockDownloadArtifact(output, metadata);
        }
        catch (error) {
            artifactError = error instanceof Error ? error.message : "The .mcpack download could not be prepared.";
        }
    }
    const releaseAndClose = () => {
        releaseBedrockDownloadArtifact(artifactRef);
        setDownloadState("released");
        setMessage("Artifact bytes released locally. Closing this card…");
        void requestClose().catch((error) => {
            setMessage(error instanceof Error
                ? `Artifact bytes were released, but ChatGPT could not dismiss the card: ${error.message}`
                : "Artifact bytes were released, but ChatGPT could not dismiss the card.");
        });
    };
    useEffect(() => () => releaseBedrockDownloadArtifact(artifactRef), []);
    const saveMcpack = async () => {
        const artifact = artifactRef.current;
        if (!artifact) {
            setDownloadState("error");
            setMessage("The .mcpack bytes are unavailable. Run the Bedrock project export again.");
            return;
        }
        setDownloadState("saving");
        setMessage("Opening the device save or share flow…");
        try {
            const result = await download(createBedrockDownloadRequest(artifact));
            if (result.isError) {
                setDownloadState("cancelled");
                setMessage("The device handoff was cancelled or this host does not support file downloads. The pack is still ready to retry.");
                return;
            }
            releaseAndClose();
        }
        catch (error) {
            setDownloadState("error");
            setMessage(error instanceof Error ? error.message : "The device could not start the .mcpack handoff.");
        }
    };
    if (downloadState === "released") {
        return (_jsxs("section", { className: "bedrock-download-card", "data-llm": "The Bedrock artifact was released locally and this download card is closing.", children: [_jsxs("header", { className: "bedrock-download-header", children: [_jsxs("div", { children: [_jsx("span", { className: "panel-kicker", children: "Bedrock export" }), _jsx("h1", { children: "Download handed off" })] }), _jsxs("button", { className: "bedrock-close", type: "button", onClick: releaseAndClose, "aria-label": "Close Bedrock export", children: [_jsx(X, { size: 17 }), _jsx("span", { children: "Close" })] })] }), _jsxs("div", { className: "bedrock-download-loading", children: [_jsx(CheckCircle2, { size: 24 }), _jsx("p", { children: message })] })] }));
    }
    if (tool.isPending || !output) {
        return (_jsxs("section", { className: "bedrock-download-card", "aria-busy": "true", "data-llm": "Packaging a Bedrock mcpack; no 3D viewer is running.", children: [_jsxs("header", { className: "bedrock-download-header", children: [_jsxs("div", { children: [_jsx("span", { className: "panel-kicker", children: "Bedrock export" }), _jsx("h1", { children: "Packaging project" })] }), _jsx("button", { className: "bedrock-close", type: "button", onClick: releaseAndClose, "aria-label": "Close Bedrock export", children: _jsx(X, { size: 17 }) })] }), _jsxs("div", { className: "bedrock-download-loading", children: [_jsx(LoaderCircle, { className: "spin", size: 24 }), _jsx("p", { children: "Creating bounded structure tiles and the installable pack\u2026" })] })] }));
    }
    const cannotDownload = Boolean(artifactError) || downloadState === "saving";
    const compatibilityNote = metadata?.compatibility?.note
        ?? "Package and structure checks passed internally. Import, activation, placement, and readback on this iPhone have not yet been verified.";
    return (_jsxs("section", { className: "bedrock-download-card", "data-llm": `${output.projectName} is packaged as ${output.filename}, ${output.bytes} bytes, ${output.structureTiles} structure tiles. Internal validation passed; iPhone runtime is unverified. No 3D viewer is running.`, children: [_jsxs("header", { className: "bedrock-download-header", children: [_jsxs("div", { children: [_jsx("span", { className: "panel-kicker", children: "Bedrock export" }), _jsx("h1", { children: output.projectName })] }), _jsxs("button", { className: "bedrock-close", type: "button", onClick: releaseAndClose, "aria-label": "Close Bedrock export", children: [_jsx(X, { size: 17 }), _jsx("span", { children: "Close" })] })] }), _jsxs("div", { className: "bedrock-download-file", children: [_jsx("span", { className: "bedrock-file-icon", children: _jsx(Archive, { size: 26 }) }), _jsxs("div", { children: [_jsx("strong", { children: output.filename }), _jsxs("span", { children: [formatArtifactBytes(output.bytes), " \u00B7 ", output.structureTiles.toLocaleString(), " structure tiles"] })] }), _jsx(CheckCircle2, { size: 20, "aria-label": "Package ready" })] }), _jsxs("dl", { className: "bedrock-download-facts", children: [_jsxs("div", { children: [_jsxs("dt", { children: [_jsx(ShieldCheck, { size: 15 }), "Pack checks"] }), _jsx("dd", { children: "Passed internally" })] }), _jsxs("div", { children: [_jsxs("dt", { children: [_jsx(Smartphone, { size: 15 }), "iPhone runtime"] }), _jsx("dd", { children: output.compatibilityStatus === "unverified" ? "Not yet verified" : output.compatibilityStatus })] }), _jsxs("div", { children: [_jsx("dt", { children: "Bedrock registry" }), _jsx("dd", { children: output.bedrockRegistryVersion })] })] }), _jsx("p", { className: "bedrock-compatibility-note", children: compatibilityNote }), _jsx("p", { className: `bedrock-download-status ${downloadState}`, role: "status", children: artifactError ?? message }), _jsxs("button", { className: "bedrock-download-action", type: "button", disabled: cannotDownload, onClick: () => void saveMcpack(), children: [downloadState === "saving" ? _jsx(LoaderCircle, { className: "spin", size: 18 }) : _jsx(Download, { size: 18 }), downloadState === "saving" ? "Starting device handoff…" : "Download .mcpack"] }), _jsx("small", { className: "bedrock-download-help", children: "On iPhone, save the file, then choose Share or Open in Minecraft. This card closes after ChatGPT accepts the download handoff." })] }));
}
//# sourceMappingURL=export-bedrock-project.js.map