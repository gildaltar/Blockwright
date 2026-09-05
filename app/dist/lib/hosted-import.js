import { Worker } from "node:worker_threads";
export function importHostedSchematic(bytes, options) {
    return new Promise((resolveImport, rejectImport) => {
        const transferred = Uint8Array.from(bytes);
        const worker = new Worker(new URL("./hosted-import-worker.js", import.meta.url), {
            workerData: { bytes: transferred, ...options },
            transferList: [transferred.buffer],
            resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        });
        let settled = false;
        const finish = (error, result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            void worker.terminate().catch(() => undefined);
            if (error)
                rejectImport(error);
            else
                resolveImport(result);
        };
        const timeout = setTimeout(() => finish(new Error("HOSTED_IMPORT_TIMEOUT: schematic parsing exceeded the hosted processing deadline.")), options.timeoutMs ?? 15_000);
        timeout.unref();
        worker.once("message", (message) => {
            if (!message || typeof message !== "object" || typeof message.ok !== "boolean") {
                finish(new Error("Hosted schematic worker returned an invalid response."));
            }
            else if (message.ok)
                finish(undefined, message.result);
            else
                finish(new Error(message.error));
        });
        worker.once("error", (error) => finish(error));
        worker.once("exit", (code) => {
            if (!settled && code !== 0)
                finish(new Error(`Hosted schematic worker exited with code ${code}.`));
        });
    });
}
//# sourceMappingURL=hosted-import.js.map