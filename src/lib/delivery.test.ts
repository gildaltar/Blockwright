import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { compileBuild } from "./compiler.js";
import { createDeliveryBundle, createMaterialList } from "./delivery.js";

const input = {
  name: "Client Delivery Fixture",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 13, depth: 11, height: 12 },
  origin: { x: 4, y: 64, z: -8 },
  blockBudget: 20_000,
  seed: "delivery-bundle",
  features: [],
};

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

describe("material list", () => {
  it("reports exact canonical state counts and clearly labeled planning estimates", () => {
    const build = compileBuild(input);
    const list = createMaterialList(build);
    expect(list.buildHash).toBe(build.hash);
    expect(list.exact).toBe(true);
    expect(list.totalBlocks).toBe(build.placements.length);
    expect(list.lines.reduce((total, line) => total + line.count, 0)).toBe(build.placements.length);
    expect(list.baseBlockTotals.reduce((total, line) => total + line.count, 0)).toBe(build.placements.length);
    expect(list.lines.some(({ canonicalBlockState }) => canonicalBlockState.includes("["))).toBe(true);
    expect(list.planningAid.assumptions.join(" ")).toMatch(/planning|assume|estimates/i);
    expect(list.planningAid.estimatedStacks).toBe(list.baseBlockTotals.reduce((total, line) => total + Math.ceil(line.count / 64), 0));
  });
});

describe("professional Java delivery bundle", () => {
  it("packages the artifact, contract, certificate, materials, compatibility, instructions, approval, and checksums", async () => {
    const build = compileBuild(input);
    const result = await createDeliveryBundle({
      build,
      format: "litematic",
      contract: build.contract,
      certificate: build.certificate,
      generatedAt: "2026-09-04T12:00:00.000Z",
      reviewApproval: {
        buildHash: build.hash,
        decision: "approved",
        actorId: "client-7",
        createdAt: "2026-09-04T11:55:00.000Z",
        provenance: "verified_blockwright_review_link",
        reviewLinkId: `link_${"7".repeat(32)}`,
        actorIdentityAssurance: "self_asserted",
      },
    });
    const zip = await JSZip.loadAsync(result.bytes);
    const required = [
      "build.litematic",
      "build.json",
      "material-list.json",
      "build-contract.json",
      "review-certificate.json",
      "compatibility.json",
      "placement-instructions.txt",
      "review-approval.json",
      "manifest.json",
    ];
    for (const name of required) expect(zip.file(name), name).not.toBeNull();
    expect(result.compatibility.verificationStatus).toBe("unverified");
    expect(result.compatibility.notes.join(" ")).toMatch(/not yet been opened/);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.buildHash).toBe(build.hash);
    expect(manifest.artifactFormat).toBe("litematic");
    for (const entry of manifest.files as { name: string; bytes: number; sha256: string }[]) {
      const bytes = await zip.file(entry.name)!.async("uint8array");
      expect(bytes.byteLength, entry.name).toBe(entry.bytes);
      expect(sha256(bytes), entry.name).toBe(entry.sha256);
    }
    expect(await zip.file("placement-instructions.txt")!.async("string")).toContain(`Placement origin: ${input.origin.x}, ${input.origin.y}, ${input.origin.z}`);
  });

  it("rejects mismatched hash-bound documents and premature Litematic verification claims", async () => {
    const build = compileBuild(input);
    await expect(createDeliveryBundle({
      build,
      format: "schem",
      contract: { buildHash: "0".repeat(64) },
      certificate: build.certificate,
    })).rejects.toThrow(/different build hash/);
    await expect(createDeliveryBundle({
      build,
      format: "litematic",
      contract: build.contract,
      certificate: build.certificate,
      compatibility: {
        format: "litematic",
        verificationStatus: "verified",
        minecraftEdition: "java",
        minecraftVersion: build.input.version,
        testedWith: ["Litematica unknown"],
        notes: [],
      },
    })).rejects.toThrow(/cannot be labeled verified/);
  });

  it("rejects client-supplied approval claims without persisted review-link provenance", async () => {
    const build = compileBuild(input);
    await expect(createDeliveryBundle({
      build,
      format: "schem",
      contract: build.contract,
      certificate: build.certificate,
      reviewApproval: {
        buildHash: build.hash,
        decision: "approved",
        actorId: "forged-client",
        createdAt: "2026-09-04T11:55:00.000Z",
        provenance: "verified_blockwright_review_link",
        reviewLinkId: "not-a-real-link-id",
        actorIdentityAssurance: "self_asserted",
      },
    })).rejects.toThrow(/persisted Blockwright review-link provenance/);
  });
});
