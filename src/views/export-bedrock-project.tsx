import "../index.css";
import { useEffect, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, LoaderCircle, ShieldCheck, Smartphone, X } from "lucide-react";
import { useDownload, useRequestClose } from "skybridge/web";
import { useToolInfo } from "../helpers.js";
import {
  createBedrockDownloadRequest,
  formatArtifactBytes,
  releaseBedrockDownloadArtifact,
  resolveBedrockDownloadArtifact,
  type BedrockDownloadArtifact,
  type BedrockDownloadMetadata,
  type BedrockDownloadOutput,
} from "../lib/bedrock-download.js";

type DownloadState = "ready" | "saving" | "cancelled" | "error" | "released";

export default function ExportBedrockProjectView() {
  const tool = useToolInfo<"export_bedrock_project">();
  const { download } = useDownload();
  const requestClose = useRequestClose();
  const artifactRef = useRef<BedrockDownloadArtifact | undefined>(undefined);
  const [downloadState, setDownloadState] = useState<DownloadState>("ready");
  const [message, setMessage] = useState("Ready for the iPhone save or share sheet.");

  const output = tool.output as BedrockDownloadOutput | undefined;
  const metadata = tool.responseMetadata as BedrockDownloadMetadata | undefined;
  let artifactError: string | undefined;
  if (!tool.isPending && output && downloadState !== "released" && !artifactRef.current) {
    try {
      artifactRef.current = resolveBedrockDownloadArtifact(output, metadata);
    } catch (error) {
      artifactError = error instanceof Error ? error.message : "The .mcpack download could not be prepared.";
    }
  }

  const releaseAndClose = () => {
    releaseBedrockDownloadArtifact(artifactRef);
    setDownloadState("released");
    setMessage("Artifact bytes released locally. Closing this card…");
    void requestClose().catch((error: unknown) => {
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
    } catch (error) {
      setDownloadState("error");
      setMessage(error instanceof Error ? error.message : "The device could not start the .mcpack handoff.");
    }
  };

  if (downloadState === "released") {
    return (
      <section className="bedrock-download-card" data-llm="The Bedrock artifact was released locally and this download card is closing.">
        <header className="bedrock-download-header">
          <div><span className="panel-kicker">Bedrock export</span><h1>Download handed off</h1></div>
          <button className="bedrock-close" type="button" onClick={releaseAndClose} aria-label="Close Bedrock export"><X size={17} /><span>Close</span></button>
        </header>
        <div className="bedrock-download-loading"><CheckCircle2 size={24} /><p>{message}</p></div>
      </section>
    );
  }

  if (tool.isPending || !output) {
    return (
      <section className="bedrock-download-card" aria-busy="true" data-llm="Packaging a Bedrock mcpack; no 3D viewer is running.">
        <header className="bedrock-download-header">
          <div><span className="panel-kicker">Bedrock export</span><h1>Packaging project</h1></div>
          <button className="bedrock-close" type="button" onClick={releaseAndClose} aria-label="Close Bedrock export"><X size={17} /></button>
        </header>
        <div className="bedrock-download-loading"><LoaderCircle className="spin" size={24} /><p>Creating bounded structure tiles and the installable pack…</p></div>
      </section>
    );
  }

  const cannotDownload = Boolean(artifactError) || downloadState === "saving";
  const compatibilityNote = metadata?.compatibility?.note
    ?? "Package and structure checks passed internally. Import, activation, placement, and readback on this iPhone have not yet been verified.";

  return (
    <section className="bedrock-download-card" data-llm={`${output.projectName} is packaged as ${output.filename}, ${output.bytes} bytes, ${output.structureTiles} structure tiles. Internal validation passed; iPhone runtime is unverified. No 3D viewer is running.`}>
      <header className="bedrock-download-header">
        <div><span className="panel-kicker">Bedrock export</span><h1>{output.projectName}</h1></div>
        <button className="bedrock-close" type="button" onClick={releaseAndClose} aria-label="Close Bedrock export"><X size={17} /><span>Close</span></button>
      </header>

      <div className="bedrock-download-file">
        <span className="bedrock-file-icon"><Archive size={26} /></span>
        <div><strong>{output.filename}</strong><span>{formatArtifactBytes(output.bytes)} · {output.structureTiles.toLocaleString()} structure tiles</span></div>
        <CheckCircle2 size={20} aria-label="Package ready" />
      </div>

      <dl className="bedrock-download-facts">
        <div><dt><ShieldCheck size={15} />Pack checks</dt><dd>Passed internally</dd></div>
        <div><dt><Smartphone size={15} />iPhone runtime</dt><dd>{output.compatibilityStatus === "unverified" ? "Not yet verified" : output.compatibilityStatus}</dd></div>
        <div><dt>Bedrock registry</dt><dd>{output.bedrockRegistryVersion}</dd></div>
      </dl>

      <p className="bedrock-compatibility-note">{compatibilityNote}</p>
      <p className={`bedrock-download-status ${downloadState}`} role="status">{artifactError ?? message}</p>

      <button className="bedrock-download-action" type="button" disabled={cannotDownload} onClick={() => void saveMcpack()}>
        {downloadState === "saving" ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
        {downloadState === "saving" ? "Starting device handoff…" : "Download .mcpack"}
      </button>
      <small className="bedrock-download-help">On iPhone, save the file, then choose Share or Open in Minecraft. This card closes after ChatGPT accepts the download handoff.</small>
    </section>
  );
}
