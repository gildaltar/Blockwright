import { Worker } from "node:worker_threads";
import type { Vec3 } from "./types.js";

export type HostedImportFormat = "auto" | "schem" | "litematic";

export type HostedImportResult = {
  format: "litematic";
  version: number;
  subVersion?: number;
  dataVersion?: number;
  dimensions: { width: number; height: number; depth: number };
  origin: Vec3;
  paletteSize: number;
  blockCount: number;
  regionCount: number;
  compatibilityStatus: "unverified";
  compatibilityNote: string;
  unsupportedEntities: number;
  unsupportedPendingTicks: number;
  metadata: Record<string, unknown>;
  regions: unknown[];
  unsupportedContent: { entities: number; pendingTicks: number };
} | {
  format: "sponge_schematic_v3";
  version: 3;
  dataVersion?: number;
  dimensions: { width: number; height: number; depth: number };
  origin: Vec3;
  offset: Vec3;
  paletteSize: number;
  blockCount: number;
  metadata: Record<string, unknown>;
};

type WorkerResponse = { ok: true; result: HostedImportResult } | { ok: false; error: string };

export function importHostedSchematic(
  bytes: Uint8Array,
  options: {
    format: HostedImportFormat;
    origin?: Vec3;
    maximumCompressedBytes: number;
    maximumExpandedBytes: number;
    maximumVolume: number;
    timeoutMs?: number;
  },
) {
  return new Promise<HostedImportResult>((resolveImport, rejectImport) => {
    const transferred = Uint8Array.from(bytes);
    const worker = new Worker(new URL("./hosted-import-worker.js", import.meta.url), {
      workerData: { bytes: transferred, ...options },
      transferList: [transferred.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: Error, result?: HostedImportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().catch(() => undefined);
      if (error) rejectImport(error);
      else resolveImport(result!);
    };
    const timeout = setTimeout(() => finish(new Error("HOSTED_IMPORT_TIMEOUT: schematic parsing exceeded the hosted processing deadline.")), options.timeoutMs ?? 15_000);
    timeout.unref();
    worker.once("message", (message: WorkerResponse) => {
      if (!message || typeof message !== "object" || typeof message.ok !== "boolean") {
        finish(new Error("Hosted schematic worker returned an invalid response."));
      } else if (message.ok) finish(undefined, message.result);
      else finish(new Error(message.error));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`Hosted schematic worker exited with code ${code}.`));
    });
  });
}
