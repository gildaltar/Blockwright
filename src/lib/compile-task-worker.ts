import { isMainThread, parentPort, Worker, workerData, type WorkerOptions } from "node:worker_threads";
import { compileBuild, type CompileBuildLimits } from "./compiler.js";
import { ManagedTaskError, sanitizeDiagnosticText, type TaskProgressUpdate } from "./task-contract.js";
import type { BuildInput, BuildRecord } from "./types.js";

export const COMPILE_WORKER_PROTOCOL = "blockwright-compile-task-v1";

export type CompileTaskWorkerInput = {
  protocol: typeof COMPILE_WORKER_PROTOCOL;
  input: BuildInput;
  limits?: CompileBuildLimits;
};

export type CompileTaskWorkerMessage =
  | { protocol: typeof COMPILE_WORKER_PROTOCOL; type: "progress"; update: TaskProgressUpdate }
  | { protocol: typeof COMPILE_WORKER_PROTOCOL; type: "result"; result: BuildRecord }
  | {
      protocol: typeof COMPILE_WORKER_PROTOCOL;
      type: "error";
      error: {
        code: string;
        message: string;
        likelyCause: string;
        retrySafe: boolean;
        retryReason: string;
        recommendedAction: string;
      };
    };

export type CompileTaskOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (update: TaskProgressUpdate) => void;
  workerFactory?: CompileTaskWorkerFactory;
  resourceLimits?: WorkerOptions["resourceLimits"];
  compileLimits?: CompileBuildLimits;
};

export interface CompileTaskWorkerHandle {
  on(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export type CompileTaskWorkerFactory = (url: URL, options: WorkerOptions) => CompileTaskWorkerHandle;

export class CompileTaskCancelledError extends ManagedTaskError {
  constructor() {
    super({
      code: "TASK_CANCELLED",
      message: "Compilation was cancelled before a build result was published.",
      likelyCause: "A client or the service requested task cancellation.",
      retrySafe: true,
      retryReason: "The worker result was discarded and no build record was committed.",
      recommendedAction: "Retry the compile task if the build is still needed.",
      component: "compiler",
    });
    this.name = "CompileTaskCancelledError";
  }
}

export class CompileTaskTimeoutError extends ManagedTaskError {
  constructor(timeoutMs: number) {
    super({
      code: "TASK_TIMEOUT",
      message: `Compilation exceeded its ${timeoutMs}-millisecond worker deadline.`,
      likelyCause: "The requested geometry exceeded the configured processing time or the worker became unresponsive.",
      retrySafe: true,
      retryReason: "The timed-out worker was terminated before its result could be published.",
      recommendedAction: "Review preflight complexity, raise the deadline only when resources permit, or simplify the build before retrying.",
      component: "compiler",
    });
    this.name = "CompileTaskTimeoutError";
  }
}

export class CompileTaskWorkerError extends ManagedTaskError {
  constructor(input: { code?: string; message: string; likelyCause?: string; retrySafe?: boolean; retryReason?: string; recommendedAction?: string; cause?: unknown }) {
    super({
      code: input.code ?? "TASK_WORKER_CRASH",
      message: sanitizeDiagnosticText(input.message),
      likelyCause: input.likelyCause ?? "The isolated compiler worker exited or returned an invalid response.",
      retrySafe: input.retrySafe ?? true,
      retryReason: input.retryReason ?? "No worker result was accepted or published.",
      recommendedAction: input.recommendedAction ?? "Inspect the task diagnostic and retry once; collect a support bundle if the worker fails again.",
      component: "compiler-worker",
      cause: input.cause,
    });
    this.name = "CompileTaskWorkerError";
  }
}

function assertCompiledResult(result: BuildRecord) {
  if (!result || typeof result !== "object" || typeof result.id !== "string" || typeof result.hash !== "string" || !Array.isArray(result.placements)) {
    throw new CompileTaskWorkerError({
      code: "TASK_WORKER_INVALID_RESULT",
      message: "The compiler worker produced an invalid build record.",
      likelyCause: "The worker and service are using incompatible build-record contracts.",
      retrySafe: false,
      retryReason: "Retrying the same incompatible runtime is not expected to change the result.",
      recommendedAction: "Repair or update Blockwright so the service and compiler worker versions match.",
    });
  }
}

/**
 * Worker-side implementation, exported so its deterministic protocol can be tested
 * without creating a nested worker inside the test runner.
 */
export function compileTaskWorkerMain(input: BuildInput, report: (update: TaskProgressUpdate) => void, limits: CompileBuildLimits = {}): BuildRecord {
  report({ phase: "preparing", operation: "Prepare deterministic compiler input" });
  report({ phase: "compiling", operation: "Compile deterministic build" });
  const result = compileBuild(input, limits);
  report({
    phase: "compiling",
    operation: "Compile deterministic build",
    detail: `Compiled ${result.placements.length.toLocaleString()} occupied block(s).`,
    work: { unit: "occupied_blocks", completedUnits: result.placements.length, totalUnits: result.placements.length },
  });
  assertCompiledResult(result);
  report({
    phase: "validating",
    operation: "Validate compiled build envelope",
    work: { unit: "build_records", completedUnits: 1, totalUnits: 1 },
  });
  return result;
}

function serializedFailure(error: unknown): Extract<CompileTaskWorkerMessage, { type: "error" }>["error"] {
  if (error instanceof ManagedTaskError) {
    return {
      code: error.code,
      message: sanitizeDiagnosticText(error),
      likelyCause: error.likelyCause,
      retrySafe: error.retrySafe,
      retryReason: error.retryReason,
      recommendedAction: error.recommendedAction,
    };
  }
  return {
    code: "TASK_COMPILE_FAILED",
    message: sanitizeDiagnosticText(error),
    likelyCause: "The deterministic compiler rejected the build input or could not complete it.",
    retrySafe: false,
    retryReason: "Retry safety depends on correcting the reported deterministic compiler error.",
    recommendedAction: "Correct the build input or resource limit reported by the diagnostic, then submit a new task.",
  };
}

function isCompileWorkerInput(value: unknown): value is CompileTaskWorkerInput {
  return Boolean(value && typeof value === "object" && (value as CompileTaskWorkerInput).protocol === COMPILE_WORKER_PROTOCOL && (value as CompileTaskWorkerInput).input);
}

if (!isMainThread && isCompileWorkerInput(workerData)) {
  try {
    const result = compileTaskWorkerMain(workerData.input, (update) => {
      parentPort?.postMessage({ protocol: COMPILE_WORKER_PROTOCOL, type: "progress", update } satisfies CompileTaskWorkerMessage);
    }, workerData.limits);
    parentPort?.postMessage({ protocol: COMPILE_WORKER_PROTOCOL, type: "result", result } satisfies CompileTaskWorkerMessage);
  } catch (error) {
    parentPort?.postMessage({ protocol: COMPILE_WORKER_PROTOCOL, type: "error", error: serializedFailure(error) } satisfies CompileTaskWorkerMessage);
  }
}

const defaultWorkerFactory: CompileTaskWorkerFactory = (url, options) => new Worker(url, options);

function isWorkerMessage(value: unknown): value is CompileTaskWorkerMessage {
  return Boolean(value && typeof value === "object" && (value as CompileTaskWorkerMessage).protocol === COMPILE_WORKER_PROTOCOL && ["progress", "result", "error"].includes((value as CompileTaskWorkerMessage).type));
}

export function runCompileTask(input: BuildInput, options: CompileTaskOptions = {}): Promise<BuildRecord> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error("timeoutMs must be a positive safe integer."));
  if (options.signal?.aborted) return Promise.reject(new CompileTaskCancelledError());

  return new Promise<BuildRecord>((resolve, reject) => {
    let worker: CompileTaskWorkerHandle;
    try {
      worker = (options.workerFactory ?? defaultWorkerFactory)(new URL("./compile-task-worker.js", import.meta.url), {
        workerData: { protocol: COMPILE_WORKER_PROTOCOL, input, limits: options.compileLimits } satisfies CompileTaskWorkerInput,
        resourceLimits: options.resourceLimits ?? { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
      });
    } catch (error) {
      reject(new CompileTaskWorkerError({ message: "The compiler worker could not be started.", cause: error }));
      return;
    }

    let settled = false;
    const finish = (error?: Error, result?: BuildRecord) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new CompileTaskCancelledError());
    const timeout = setTimeout(() => finish(new CompileTaskTimeoutError(timeoutMs)), timeoutMs);
    timeout.unref();
    options.signal?.addEventListener("abort", abort, { once: true });

    worker.on("message", (message) => {
      if (!isWorkerMessage(message)) {
        finish(new CompileTaskWorkerError({ code: "TASK_WORKER_PROTOCOL_ERROR", message: "The compiler worker returned an unrecognized message." }));
        return;
      }
      if (message.type === "progress") {
        try {
          options.onProgress?.(message.update);
        } catch {
          // Observers do not control compilation or result integrity.
        }
        return;
      }
      if (message.type === "result") {
        try {
          assertCompiledResult(message.result);
          finish(undefined, message.result);
        } catch (error) {
          finish(error instanceof Error ? error : new CompileTaskWorkerError({ message: "The compiler worker result could not be validated." }));
        }
        return;
      }
      finish(new CompileTaskWorkerError({ ...message.error }));
    });
    worker.once("error", (error) => finish(new CompileTaskWorkerError({ message: "The compiler worker crashed before returning a result.", cause: error })));
    worker.once("exit", (code) => {
      if (!settled) finish(new CompileTaskWorkerError({ message: `The compiler worker exited with code ${code} before returning a result.` }));
    });
  });
}
