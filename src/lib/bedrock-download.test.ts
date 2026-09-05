import { describe, expect, it } from "vitest";
import {
  createBedrockDownloadRequest,
  formatArtifactBytes,
  releaseBedrockDownloadArtifact,
  resolveBedrockDownloadArtifact,
  type BedrockDownloadArtifact,
} from "./bedrock-download.js";

const zipBytes = Buffer.from("PK\u0003\u0004Blockwright mcpack fixture");
const output = {
  projectName: "Aqua Meridian Waterpark",
  format: "mcpack" as const,
  filename: "aqua_meridian_waterpark.mcpack",
  bytes: zipBytes.byteLength,
  structureTiles: 187,
  bedrockRegistryVersion: "1.26.40",
  compatibilityStatus: "unverified" as const,
};

describe("Bedrock download handoff", () => {
  it("passes the exact base64 mcpack to the supported host download resource shape", () => {
    const base64 = zipBytes.toString("base64");
    const artifact = resolveBedrockDownloadArtifact(output, { mimeType: "application/zip", base64 });
    expect(createBedrockDownloadRequest(artifact)).toEqual({
      contents: [{
        type: "resource",
        resource: {
          uri: "file:///aqua_meridian_waterpark.mcpack",
          mimeType: "application/zip",
          blob: base64,
        },
      }],
    });
  });

  it("fails closed on mismatched bytes or an unsafe filename", () => {
    const base64 = zipBytes.toString("base64");
    expect(() => resolveBedrockDownloadArtifact({ ...output, bytes: output.bytes + 1 }, { base64 })).toThrow(/do not match/);
    expect(() => resolveBedrockDownloadArtifact({ ...output, filename: "../unsafe.mcpack" }, { base64 })).toThrow(/unsafe/);
  });

  it("releases the large local artifact reference synchronously", () => {
    const reference: { current: BedrockDownloadArtifact | undefined } = {
      current: resolveBedrockDownloadArtifact(output, { base64: zipBytes.toString("base64") }),
    };
    releaseBedrockDownloadArtifact(reference);
    expect(reference.current).toBeUndefined();
  });

  it("formats compact, device-readable sizes", () => {
    expect(formatArtifactBytes(622_881)).toBe("608 KB");
    expect(formatArtifactBytes(5_242_880)).toBe("5.0 MB");
  });
});
