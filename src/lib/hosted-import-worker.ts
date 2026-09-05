import { parentPort, workerData } from "node:worker_threads";
import { gunzip } from "node:zlib";
import { importLitematic } from "./litematic.js";
import { importSchematic } from "./schematic.js";
import type { HostedImportFormat, HostedImportResult } from "./hosted-import.js";
import type { Vec3 } from "./types.js";

type ImportWorkerData = {
  bytes: Uint8Array;
  format: HostedImportFormat;
  origin?: Vec3;
  maximumCompressedBytes: number;
  maximumExpandedBytes: number;
  maximumVolume: number;
};

async function parseHostedImport(input: ImportWorkerData): Promise<HostedImportResult> {
  if (input.bytes.byteLength > input.maximumCompressedBytes) throw new Error(`Schematic input exceeds the configured ${input.maximumCompressedBytes}-byte compressed limit.`);
  if (input.bytes[0] !== 0x1f || input.bytes[1] !== 0x8b) throw new Error("Schematic input must be gzip-compressed Java NBT.");
  const expanded = await new Promise<Buffer>((resolveExpanded, rejectExpanded) => {
    gunzip(Buffer.from(input.bytes), { maxOutputLength: input.maximumExpandedBytes }, (error, result) => {
      if (error) rejectExpanded(error);
      else resolveExpanded(result);
    });
  });
  if (expanded.byteLength > input.maximumExpandedBytes) throw new Error(`Schematic input exceeds the configured ${input.maximumExpandedBytes}-byte expanded limit.`);
  const limits = {
    maximumCompressedBytes: input.maximumCompressedBytes,
    maximumExpandedBytes: input.maximumExpandedBytes,
    maximumVolume: input.maximumVolume,
    expandedBytes: expanded,
  };
  let litematicError: unknown;
  if (input.format === "litematic" || input.format === "auto") {
    try {
      const imported = importLitematic(input.bytes, { ...limits, origin: input.origin });
      return {
        format: imported.format,
        version: imported.version,
        subVersion: imported.subVersion,
        dataVersion: imported.minecraftDataVersion,
        dimensions: imported.bounds.dimensions,
        origin: imported.origin,
        paletteSize: imported.regions.reduce((total, region) => total + region.paletteSize, 0),
        blockCount: imported.placements.length,
        regionCount: imported.regions.length,
        compatibilityStatus: imported.compatibility.status,
        compatibilityNote: imported.compatibility.note,
        unsupportedEntities: imported.unsupportedContent.entities,
        unsupportedPendingTicks: imported.unsupportedContent.pendingTicks,
        metadata: imported.metadata,
        regions: imported.regions,
        unsupportedContent: imported.unsupportedContent,
      };
    } catch (error) {
      litematicError = error;
      if (input.format === "litematic") throw error;
    }
  }
  try {
    const imported = await importSchematic(input.bytes, input.origin ?? { x: 0, y: 0, z: 0 }, limits);
    return {
      format: imported.format,
      version: 3,
      dataVersion: imported.dataVersion,
      dimensions: imported.dimensions,
      origin: input.origin ?? { x: 0, y: 0, z: 0 },
      offset: imported.offset,
      paletteSize: imported.paletteSize,
      blockCount: imported.placements.length,
      metadata: imported.metadata,
    };
  } catch (schematicError) {
    if (input.format !== "auto") throw schematicError;
    const detail = schematicError instanceof Error ? schematicError.message : "Sponge parsing failed.";
    const detection = litematicError instanceof Error ? ` Litematica detection: ${litematicError.message}` : "";
    throw new Error(`Unsupported schematic input: expected Litematica v7 or Sponge Schematic v3. ${detail}${detection}`);
  }
}

try {
  const result = await parseHostedImport(workerData as ImportWorkerData);
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : "Hosted schematic parsing failed." });
}
