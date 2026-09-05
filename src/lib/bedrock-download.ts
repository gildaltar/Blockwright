export type BedrockDownloadOutput = {
  projectName: string;
  format: "mcpack";
  filename: string;
  bytes: number;
  structureTiles: number;
  bedrockRegistryVersion: string;
  compatibilityStatus: "unverified";
};

export type BedrockDownloadMetadata = {
  mimeType?: string;
  base64?: string;
  compatibility?: {
    internalValidation?: string;
    iphoneRuntime?: string;
    note?: string;
  };
};

export type BedrockDownloadArtifact = {
  filename: string;
  mimeType: string;
  base64: string;
  bytes: number;
};

const MCPACK_MIME_TYPE = "application/zip";

function decodedBase64ByteLength(base64: string) {
  if (!base64.length || base64.length % 4 !== 0) return -1;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length / 4 * 3 - padding;
}

export function resolveBedrockDownloadArtifact(
  output: BedrockDownloadOutput,
  metadata: BedrockDownloadMetadata | undefined,
): BedrockDownloadArtifact {
  if (output.format !== "mcpack" || !output.filename.toLowerCase().endsWith(".mcpack")) {
    throw new Error("The export response did not identify a Bedrock .mcpack file.");
  }
  const filename = output.filename.split(/[\\/]/).at(-1) ?? "";
  if (!filename || filename !== output.filename || !/^[A-Za-z0-9._ -]+\.mcpack$/i.test(filename)) {
    throw new Error("The export response contained an unsafe .mcpack filename.");
  }
  const base64 = metadata?.base64;
  if (!base64 || !base64.startsWith("UEs") || decodedBase64ByteLength(base64) !== output.bytes) {
    throw new Error("The .mcpack download bytes are missing or do not match the export summary.");
  }
  return {
    filename,
    mimeType: metadata?.mimeType || MCPACK_MIME_TYPE,
    base64,
    bytes: output.bytes,
  };
}

export function createBedrockDownloadRequest(artifact: BedrockDownloadArtifact) {
  return {
    contents: [
      {
        type: "resource" as const,
        resource: {
          uri: `file:///${artifact.filename}`,
          mimeType: artifact.mimeType,
          blob: artifact.base64,
        },
      },
    ],
  };
}

export function releaseBedrockDownloadArtifact(reference: { current: BedrockDownloadArtifact | undefined }) {
  reference.current = undefined;
}

export function formatArtifactBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
