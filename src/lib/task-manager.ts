import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ManagedTaskError,
  TASK_STATES,
  createTaskDiagnostic,
  isTerminalTaskState,
  sanitizeDiagnosticText,
  validateTaskWork,
  type TaskDiagnostic,
  type TaskProgressUpdate,
  type TaskSnapshot,
  type TaskState,
  type TaskWork,
} from "./task-contract.js";

export type TaskExecutionContext = {
  signal: AbortSignal;
  report(update: TaskProgressUpdate): void;
};

export type TaskRunner<Result> = (context: TaskExecutionContext) => Result | Promise<Result>;

export type TaskSubmission<Result> = {
  operation: string;
  run: TaskRunner<Result>;
  resultReference?: (result: Result) => string;
  retryOf?: string;
};

export interface TaskJournal {
  load(): Promise<TaskSnapshot[]>;
  save(tasks: readonly TaskSnapshot[]): Promise<void>;
}

export type TaskManagerOptions = {
  concurrency?: number;
  maximumQueued?: number;
  maximumRetained?: number;
  journal?: TaskJournal;
  clock?: () => number;
  idFactory?: () => string;
  diagnosticIdFactory?: () => string;
  logReference?: string;
};

type InternalTask<Result> = {
  snapshot: TaskSnapshot;
  run?: TaskRunner<Result>;
  resultReference?: (result: Result) => string;
  controller?: AbortController;
};

const phaseRank: Record<Extract<TaskState, "queued" | "preparing" | "planning" | "generating" | "compiling" | "validating" | "auditing" | "rendering" | "exporting" | "installing">, number> = {
  queued: 0,
  preparing: 1,
  planning: 2,
  generating: 3,
  compiling: 4,
  validating: 5,
  auditing: 6,
  rendering: 7,
  exporting: 8,
  installing: 9,
};

function positiveInteger(value: number | undefined, fallback: number, label: string, allowZero = false) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} safe integer.`);
  return resolved;
}

function cloneSnapshot(snapshot: TaskSnapshot): TaskSnapshot {
  return structuredClone(snapshot);
}

function dateValue(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRestoredSnapshot(value: TaskSnapshot): TaskSnapshot {
  if (!value || typeof value !== "object") throw new Error("Task journal contains a non-object task record.");
  if (typeof value.id !== "string" || !/^task_[A-Za-z0-9_-]{8,80}$/.test(value.id)) throw new Error("Task journal contains an invalid task id.");
  if (typeof value.operation !== "string" || !value.operation.trim()) throw new Error(`Task journal record ${value.id} has no operation.`);
  if (!TASK_STATES.includes(value.state)) throw new Error(`Task journal record ${value.id} has an invalid state.`);
  if (value.resultReference !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value.resultReference)) throw new Error(`Task journal record ${value.id} has an invalid result reference.`);
  if (!value.progress || !Number.isSafeInteger(value.progress.sequence) || value.progress.sequence < 0) throw new Error(`Task journal record ${value.id} has invalid progress.`);
  if (!value.timing || !Number.isFinite(Date.parse(value.timing.queuedAt)) || !Number.isFinite(Date.parse(value.timing.updatedAt))) throw new Error(`Task journal record ${value.id} has invalid timing.`);
  return cloneSnapshot(value);
}

export class FileTaskJournal implements TaskJournal {
  readonly path: string;

  constructor(path: string) {
    if (!path.trim()) throw new Error("Task journal path is required.");
    this.path = path;
  }

  async load(): Promise<TaskSnapshot[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed = JSON.parse(text) as { schemaVersion?: unknown; tasks?: unknown };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) throw new Error("Task journal has an unsupported or invalid schema.");
    return parsed.tasks.map((task) => normalizeRestoredSnapshot(task as TaskSnapshot));
  }

  async save(tasks: readonly TaskSnapshot[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify({ schemaVersion: 1, tasks }, null, 2)}\n`;
    try {
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.path);
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export class TaskQueueFullError extends ManagedTaskError {
  constructor(maximumQueued: number) {
    super({
      code: "TASK_QUEUE_FULL",
      message: `The task queue already contains the configured maximum of ${maximumQueued} waiting task(s).`,
      likelyCause: "All worker slots and queue capacity are in use.",
      retrySafe: true,
      retryReason: "No work was accepted or committed for this request.",
      recommendedAction: "Wait for an active task to finish or cancel an unneeded task, then retry.",
    });
    this.name = "TaskQueueFullError";
  }
}

export class TaskManager<Result> {
  readonly concurrency: number;
  readonly maximumQueued: number;
  readonly maximumRetained: number;

  private readonly journal?: TaskJournal;
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly diagnosticIdFactory: () => string;
  private readonly logReference?: string;
  private readonly tasks = new Map<string, InternalTask<Result>>();
  private readonly results = new Map<string, Result>();
  private readonly queue: string[] = [];
  private readonly listeners = new Set<(snapshot: TaskSnapshot) => void>();
  private running = 0;
  private closed = false;
  private persistence = Promise.resolve();
  private persistenceError: unknown;

  private constructor(options: TaskManagerOptions) {
    this.concurrency = positiveInteger(options.concurrency, 1, "concurrency");
    this.maximumQueued = positiveInteger(options.maximumQueued, 32, "maximumQueued", true);
    this.maximumRetained = positiveInteger(options.maximumRetained, 128, "maximumRetained");
    this.journal = options.journal;
    this.clock = options.clock ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `task_${randomUUID().replaceAll("-", "")}`);
    this.diagnosticIdFactory = options.diagnosticIdFactory ?? (() => `diag_${randomUUID().replaceAll("-", "")}`);
    this.logReference = options.logReference;
  }

  static async create<Result>(options: TaskManagerOptions = {}): Promise<TaskManager<Result>> {
    const manager = new TaskManager<Result>(options);
    await manager.restore();
    return manager;
  }

  private nowIso() {
    return new Date(this.clock()).toISOString();
  }

  private nextTaskId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.idFactory();
      if (!/^task_[A-Za-z0-9_-]{8,80}$/.test(candidate)) throw new Error("Task id factories must return task_ followed by 8-80 URL-safe characters.");
      if (!this.tasks.has(candidate)) return candidate;
    }
    throw new Error("Task id factory repeatedly returned an existing id.");
  }

  private touch(snapshot: TaskSnapshot, finished = false) {
    const now = this.clock();
    const queuedAt = dateValue(snapshot.timing.queuedAt, now);
    const startedAt = dateValue(snapshot.timing.startedAt, now);
    snapshot.timing.updatedAt = new Date(now).toISOString();
    snapshot.timing.elapsedMs = Math.max(0, now - queuedAt);
    if (snapshot.timing.startedAt) {
      snapshot.timing.queueMs = Math.max(0, startedAt - queuedAt);
      snapshot.timing.runMs = Math.max(0, now - startedAt);
    }
    if (finished) snapshot.timing.finishedAt = snapshot.timing.updatedAt;
  }

  private schedulePersistence() {
    if (!this.journal) return Promise.resolve();
    const snapshots = this.list();
    this.persistence = this.persistence
      .catch(() => undefined)
      .then(() => this.journal!.save(snapshots))
      .catch((error) => {
        this.persistenceError = error;
        throw error;
      });
    return this.persistence;
  }

  private publish(record: InternalTask<Result>, persist = true) {
    const snapshot = cloneSnapshot(record.snapshot);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A status listener cannot corrupt task execution.
      }
    }
    if (persist) void this.schedulePersistence().catch(() => undefined);
  }

  private mergeWork(previous: TaskWork | undefined, incoming: TaskWork | undefined, samePhase: boolean) {
    const normalized = validateTaskWork(incoming);
    if (!normalized || !previous || !samePhase || normalized.unit !== previous.unit) return normalized;
    const merged = { ...normalized };
    if (previous.completedUnits !== undefined) merged.completedUnits = Math.max(previous.completedUnits, normalized.completedUnits ?? 0);
    if (previous.totalUnits !== undefined) merged.totalUnits = Math.max(previous.totalUnits, normalized.totalUnits ?? 0);
    if (merged.completedUnits !== undefined && merged.totalUnits !== undefined) merged.totalUnits = Math.max(merged.totalUnits, merged.completedUnits);
    if (previous.cacheHits !== undefined) merged.cacheHits = Math.max(previous.cacheHits, normalized.cacheHits ?? 0);
    if (previous.cacheReusedUnits !== undefined) merged.cacheReusedUnits = Math.max(previous.cacheReusedUnits, normalized.cacheReusedUnits ?? 0);
    return merged;
  }

  private report(record: InternalTask<Result>, update: TaskProgressUpdate) {
    if (isTerminalTaskState(record.snapshot.state) || record.snapshot.state === "cancelling") return;
    const previousPhase = record.snapshot.progress.phase;
    const requestedPhase = update.phase ?? (record.snapshot.state === "queued" ? "preparing" : record.snapshot.state);
    const currentComparable = record.snapshot.state === "queued" ? "queued" : record.snapshot.state;
    if (!(currentComparable in phaseRank) || phaseRank[requestedPhase] < phaseRank[currentComparable as keyof typeof phaseRank]) return;
    const samePhase = previousPhase === requestedPhase;
    record.snapshot.state = requestedPhase;
    record.snapshot.progress = {
      sequence: record.snapshot.progress.sequence + 1,
      phase: requestedPhase,
      operation: sanitizeDiagnosticText(update.operation ?? record.snapshot.progress.operation, 160),
      ...(update.detail ? { detail: sanitizeDiagnosticText(update.detail, 320) } : {}),
      ...(update.work ? { work: this.mergeWork(record.snapshot.progress.work, update.work, samePhase) } : {}),
    };
    this.touch(record.snapshot);
    this.publish(record);
  }

  private finish(record: InternalTask<Result>, state: Extract<TaskState, "completed" | "cancelled" | "failed" | "interrupted">, diagnostic?: TaskDiagnostic) {
    record.run = undefined;
    record.resultReference = undefined;
    record.snapshot.state = state;
    record.snapshot.resultAvailable = state === "completed" && this.results.has(record.snapshot.id);
    record.snapshot.progress = {
      ...record.snapshot.progress,
      sequence: record.snapshot.progress.sequence + 1,
      phase: state,
      operation: state === "completed" ? "Task completed" : state === "cancelled" ? "Task cancelled" : state === "interrupted" ? "Task interrupted" : "Task failed",
    };
    if (diagnostic) record.snapshot.diagnostic = diagnostic;
    else delete record.snapshot.diagnostic;
    if (state !== "completed") this.results.delete(record.snapshot.id);
    this.touch(record.snapshot, true);
    this.publish(record);
    this.enforceRetention();
    void this.schedulePersistence().catch(() => undefined);
  }

  private diagnostic(record: InternalTask<Result>, error: unknown, defaults: Parameters<typeof createTaskDiagnostic>[0] = {
    phase: record.snapshot.state,
    operation: record.snapshot.progress.operation,
    error,
  }) {
    return createTaskDiagnostic({
      ...defaults,
      phase: record.snapshot.state,
      operation: record.snapshot.progress.operation,
      error,
      diagnosticId: this.diagnosticIdFactory(),
      logReference: this.logReference,
    });
  }

  private async execute(record: InternalTask<Result>) {
    const run = record.run!;
    record.run = undefined;
    record.controller = new AbortController();
    this.running += 1;
    record.snapshot.state = "preparing";
    record.snapshot.timing.startedAt = this.nowIso();
    record.snapshot.progress = {
      sequence: record.snapshot.progress.sequence + 1,
      phase: "preparing",
      operation: "Preparing task",
    };
    this.touch(record.snapshot);
    this.publish(record);
    try {
      const result = await run({
        signal: record.controller.signal,
        report: (update) => this.report(record, update),
      });
      if (isTerminalTaskState(record.snapshot.state)) return;
      if (record.controller.signal.aborted || (record.snapshot.state as TaskState) === "cancelling") {
        this.finish(record, "cancelled");
        return;
      }
      // The result becomes observable in the same turn as the completed state.
      if (record.resultReference) {
        const reference = record.resultReference(result);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(reference)) throw new ManagedTaskError({
          code: "TASK_RESULT_REFERENCE_INVALID",
          message: "The task produced an invalid stable result reference.",
          likelyCause: "The result-reference adapter returned an unsupported identifier.",
          retrySafe: false,
          retryReason: "Retrying cannot correct the result-reference adapter.",
          recommendedAction: "Repair the service integration so it returns a stable opaque identifier.",
        });
        record.snapshot.resultReference = reference;
      }
      this.results.set(record.snapshot.id, result);
      this.finish(record, "completed");
    } catch (error) {
      if (isTerminalTaskState(record.snapshot.state)) return;
      if (record.controller.signal.aborted || (record.snapshot.state as TaskState) === "cancelling" || (error instanceof ManagedTaskError && error.code === "TASK_CANCELLED")) {
        this.finish(record, "cancelled");
      } else {
        this.finish(record, "failed", this.diagnostic(record, error));
      }
    } finally {
      record.controller = undefined;
      this.running = Math.max(0, this.running - 1);
      this.pump();
    }
  }

  private pump() {
    if (this.closed) return;
    while (this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      const record = this.tasks.get(id);
      if (!record || record.snapshot.state !== "queued" || !record.run) continue;
      void this.execute(record);
    }
  }

  private enforceRetention() {
    const terminal = [...this.tasks.values()]
      .filter((record) => isTerminalTaskState(record.snapshot.state))
      .sort((left, right) => dateValue(left.snapshot.timing.finishedAt, 0) - dateValue(right.snapshot.timing.finishedAt, 0));
    while (terminal.length > this.maximumRetained) {
      const record = terminal.shift()!;
      this.tasks.delete(record.snapshot.id);
      this.results.delete(record.snapshot.id);
    }
  }

  private async restore() {
    if (!this.journal) return;
    const restored = await this.journal.load();
    const now = this.clock();
    for (const raw of restored) {
      const snapshot = normalizeRestoredSnapshot(raw);
      snapshot.resultAvailable = false;
      const record: InternalTask<Result> = { snapshot };
      this.tasks.set(snapshot.id, record);
      if (!isTerminalTaskState(snapshot.state)) {
        const previousState = snapshot.state;
        record.snapshot.state = "interrupted";
        record.snapshot.progress = {
          ...record.snapshot.progress,
          sequence: record.snapshot.progress.sequence + 1,
          phase: "interrupted",
          operation: "Task interrupted by service restart",
        };
        record.snapshot.diagnostic = createTaskDiagnostic({
          phase: "interrupted",
          operation: record.snapshot.operation,
          error: new ManagedTaskError({
            code: "TASK_INTERRUPTED",
            message: `The service restarted while this task was ${previousState}.`,
            likelyCause: "The prior service process ended before the task reached a terminal state.",
            retrySafe: true,
            retryReason: "No result from the interrupted task was restored or published.",
            recommendedAction: "Review the current project state, then retry the task if it is still needed.",
          }),
          diagnosticId: this.diagnosticIdFactory(),
          logReference: this.logReference,
        });
        record.snapshot.timing.updatedAt = new Date(now).toISOString();
        record.snapshot.timing.finishedAt = record.snapshot.timing.updatedAt;
        record.snapshot.timing.elapsedMs = Math.max(0, now - dateValue(record.snapshot.timing.queuedAt, now));
        if (record.snapshot.timing.startedAt) record.snapshot.timing.runMs = Math.max(0, now - dateValue(record.snapshot.timing.startedAt, now));
      }
    }
    this.enforceRetention();
    await this.schedulePersistence();
  }

  async submit(submission: TaskSubmission<Result>): Promise<TaskSnapshot> {
    if (this.closed) throw new Error("Task manager is closed.");
    if (!submission.operation.trim()) throw new Error("Task operation is required.");
    const accepted = [...this.tasks.values()].filter(({ snapshot }) => !isTerminalTaskState(snapshot.state)).length;
    if (accepted >= this.concurrency + this.maximumQueued) throw new TaskQueueFullError(this.maximumQueued);
    const now = this.nowIso();
    const id = this.nextTaskId();
    const record: InternalTask<Result> = {
      run: submission.run,
      resultReference: submission.resultReference,
      snapshot: {
        id,
        operation: sanitizeDiagnosticText(submission.operation, 160),
        state: "queued",
        progress: { sequence: 0, phase: "queued", operation: "Waiting for a worker" },
        timing: { queuedAt: now, updatedAt: now, elapsedMs: 0 },
        resultAvailable: false,
        ...(submission.retryOf ? { retryOf: submission.retryOf } : {}),
      },
    };
    this.tasks.set(id, record);
    this.queue.push(id);
    this.publish(record, false);
    await this.schedulePersistence();
    this.pump();
    return cloneSnapshot(record.snapshot);
  }

  get(taskId: string): TaskSnapshot | undefined {
    const snapshot = this.tasks.get(taskId)?.snapshot;
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  list(): TaskSnapshot[] {
    return [...this.tasks.values()].map(({ snapshot }) => cloneSnapshot(snapshot));
  }

  getResult(taskId: string): Result | undefined {
    const record = this.tasks.get(taskId);
    if (!record || record.snapshot.state !== "completed" || !record.snapshot.resultAvailable) return undefined;
    return this.results.get(taskId);
  }

  /** Atomically consumes the in-memory result after the service commits it elsewhere. */
  takeResult(taskId: string): Result | undefined {
    const result = this.getResult(taskId);
    if (result === undefined) return undefined;
    this.results.delete(taskId);
    const record = this.tasks.get(taskId)!;
    record.snapshot.resultAvailable = false;
    this.touch(record.snapshot);
    this.publish(record);
    return result;
  }

  subscribe(listener: (snapshot: TaskSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async cancel(taskId: string): Promise<TaskSnapshot | undefined> {
    const record = this.tasks.get(taskId);
    if (!record || isTerminalTaskState(record.snapshot.state)) return record ? cloneSnapshot(record.snapshot) : undefined;
    if (record.snapshot.state === "queued") {
      record.run = undefined;
      this.finish(record, "cancelled");
    } else if (record.snapshot.state !== "cancelling") {
      record.snapshot.state = "cancelling";
      record.snapshot.progress = {
        ...record.snapshot.progress,
        sequence: record.snapshot.progress.sequence + 1,
        phase: "cancelling",
        operation: "Cancelling task",
      };
      this.touch(record.snapshot);
      this.publish(record);
      record.controller?.abort(new Error("Task cancellation requested."));
    }
    await this.flush();
    return cloneSnapshot(record.snapshot);
  }

  async waitForTerminal(taskId: string, timeoutMs = 30_000): Promise<TaskSnapshot> {
    const current = this.get(taskId);
    if (!current) throw new Error(`Task ${taskId} was not found.`);
    if (isTerminalTaskState(current.state)) return current;
    return new Promise<TaskSnapshot>((resolve, reject) => {
      let unsubscribe: () => void = () => undefined;
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for task ${taskId}.`));
      }, timeoutMs);
      timeout.unref();
      unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.id !== taskId || !isTerminalTaskState(snapshot.state)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot);
      });
      const latest = this.get(taskId);
      if (latest && isTerminalTaskState(latest.state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(latest);
      }
    });
  }

  async interruptAll(): Promise<void> {
    this.closed = true;
    for (const record of this.tasks.values()) {
      if (isTerminalTaskState(record.snapshot.state)) continue;
      record.run = undefined;
      record.controller?.abort(new Error("Task manager interrupted."));
      this.finish(record, "interrupted", this.diagnostic(record, new ManagedTaskError({
        code: "TASK_INTERRUPTED",
        message: "The task was interrupted while the service was stopping.",
        likelyCause: "The task manager was shut down before work completed.",
        retrySafe: true,
        retryReason: "No incomplete result was published.",
        recommendedAction: "Restart the service and retry the task if it is still needed.",
      })));
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.persistence.catch(() => undefined);
    if (this.persistenceError) throw this.persistenceError;
  }
}
