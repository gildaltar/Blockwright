import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedTaskError, exposeCommittedTaskResult, type TaskSnapshot } from "./task-contract.js";
import { FileTaskJournal, TaskManager, TaskQueueFullError, type TaskJournal } from "./task-manager.js";

class MemoryJournal implements TaskJournal {
  records: TaskSnapshot[];
  saves = 0;

  constructor(records: TaskSnapshot[] = []) {
    this.records = structuredClone(records);
  }

  async load() {
    return structuredClone(this.records);
  }

  async save(tasks: readonly TaskSnapshot[]) {
    this.records = structuredClone(tasks);
    this.saves += 1;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function journalSnapshot(id: string, state: TaskSnapshot["state"]): TaskSnapshot {
  return {
    id,
    operation: "Compile build",
    state,
    progress: { sequence: 2, phase: state, operation: "Stored task" },
    timing: {
      queuedAt: "2026-09-05T00:00:00.000Z",
      startedAt: state === "queued" ? undefined : "2026-09-05T00:00:01.000Z",
      updatedAt: "2026-09-05T00:00:02.000Z",
      ...(state === "completed" ? { finishedAt: "2026-09-05T00:00:02.000Z" } : {}),
      elapsedMs: 2_000,
    },
    resultAvailable: state === "completed",
  };
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("TaskManager", () => {
  it("keeps a committed result truthfully available at the client boundary after manager consumption", () => {
    const consumed = { ...journalSnapshot("task_committed_result", "completed"), resultAvailable: false };
    expect(exposeCommittedTaskResult(consumed, true)).toMatchObject({ state: "completed", resultAvailable: true });
    expect(exposeCommittedTaskResult(consumed, false)).toMatchObject({ state: "completed", resultAvailable: false });
    expect(exposeCommittedTaskResult({ ...consumed, state: "failed" }, true)).toMatchObject({ state: "failed", resultAvailable: false });
  });

  it("bounds concurrency and the waiting queue", async () => {
    const firstGate = deferred<string>();
    const manager = await TaskManager.create<string>({ concurrency: 1, maximumQueued: 1, idFactory: (() => {
      let index = 0;
      return () => `task_queue_${String(++index).padStart(4, "0")}`;
    })() });
    const first = await manager.submit({ operation: "First", run: () => firstGate.promise });
    const second = await manager.submit({ operation: "Second", run: () => "second" });

    expect(manager.get(first.id)?.state).toBe("preparing");
    expect(manager.get(second.id)?.state).toBe("queued");
    await expect(manager.submit({ operation: "Third", run: () => "third" })).rejects.toBeInstanceOf(TaskQueueFullError);

    firstGate.resolve("first");
    expect((await manager.waitForTerminal(first.id)).state).toBe("completed");
    expect((await manager.waitForTerminal(second.id)).state).toBe("completed");
  });

  it("cancels queued and running work without publishing partial results", async () => {
    const manager = await TaskManager.create<string>({ concurrency: 1, maximumQueued: 2, idFactory: (() => {
      let index = 0;
      return () => `task_cancel_${++index}`;
    })() });
    const running = await manager.submit({
      operation: "Running",
      run: ({ signal }) => new Promise<string>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        void resolve;
      }),
    });
    const queued = await manager.submit({ operation: "Queued", run: () => "must-not-run" });

    expect((await manager.cancel(queued.id))?.state).toBe("cancelled");
    expect(["cancelling", "cancelled"]).toContain((await manager.cancel(running.id))?.state);
    expect((await manager.waitForTerminal(running.id)).state).toBe("cancelled");
    expect(manager.getResult(running.id)).toBeUndefined();
    expect(manager.getResult(queued.id)).toBeUndefined();
  });

  it("keeps phase and work progress monotonic and reveals a result only at completion", async () => {
    const seen: TaskSnapshot[] = [];
    const manager = await TaskManager.create<string>({ idFactory: () => "task_progress_0001" });
    manager.subscribe((snapshot) => seen.push(snapshot));
    const task = await manager.submit({
      operation: "Compile",
      resultReference: () => "build_compiled_0001",
      run: ({ report }) => {
        report({ phase: "planning", operation: "Plan component graph", work: { unit: "components", completedUnits: 1, totalUnits: 2 } });
        report({ phase: "generating", operation: "Generate procedural operations", work: { unit: "components", completedUnits: 2, totalUnits: 2 } });
        report({ phase: "compiling", operation: "Compile", work: { unit: "occupied_blocks", completedUnits: 5, totalUnits: 10 } });
        report({ phase: "compiling", operation: "Compile", work: { unit: "occupied_blocks", completedUnits: 3, totalUnits: 8 } });
        report({ phase: "preparing", operation: "Regressive update must be ignored" });
        report({ phase: "validating", operation: "Validate", work: { unit: "build_records", completedUnits: 1, totalUnits: 1 } });
        return "compiled";
      },
    });
    const terminal = await manager.waitForTerminal(task.id);
    const sequences = seen.filter(({ id }) => id === task.id).map(({ progress }) => progress.sequence);
    const compiling = seen.filter(({ id, state }) => id === task.id && state === "compiling");

    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(compiling.at(-1)?.progress.work).toMatchObject({ completedUnits: 5, totalUnits: 10 });
    expect(terminal.state).toBe("completed");
    expect(terminal.resultAvailable).toBe(true);
    expect(terminal.resultReference).toBe("build_compiled_0001");
    expect(manager.getResult(task.id)).toBe("compiled");
    expect(manager.takeResult(task.id)).toBe("compiled");
    expect(manager.getResult(task.id)).toBeUndefined();
    expect(manager.get(task.id)?.resultAvailable).toBe(false);
  });

  it("creates sanitized structured diagnostics with retry guidance", async () => {
    const manager = await TaskManager.create<string>({ idFactory: () => "task_failure_0001", diagnosticIdFactory: () => "diag_failure_0001", logReference: "logs/tasks.log" });
    const task = await manager.submit({
      operation: "Provider-backed plan",
      run: () => {
        throw new ManagedTaskError({
          code: "MODEL_PROVIDER_UNAVAILABLE",
          message: "Authorization: Bearer top.secret.token api_key=hidden C:\\Users\\alice\\private.log",
          likelyCause: "Provider offline",
          retrySafe: true,
          retryReason: "No result was accepted",
          recommendedAction: "Start the provider",
        });
      },
    });
    const terminal = await manager.waitForTerminal(task.id);

    expect(terminal.state).toBe("failed");
    expect(terminal.resultAvailable).toBe(false);
    expect(terminal.diagnostic).toMatchObject({
      id: "diag_failure_0001",
      code: "MODEL_PROVIDER_UNAVAILABLE",
      retry: { safe: true },
      recommendedAction: "Start the provider",
      logReference: "logs/tasks.log",
    });
    expect(JSON.stringify(terminal.diagnostic)).not.toContain("top.secret.token");
    expect(JSON.stringify(terminal.diagnostic)).not.toContain("api_key=hidden");
    expect(JSON.stringify(terminal.diagnostic)).not.toContain("alice");
  });

  it("marks non-terminal journal entries interrupted after restart and never restores results", async () => {
    const journal = new MemoryJournal([
      journalSnapshot("task_restore_queued", "queued"),
      journalSnapshot("task_restore_running", "compiling"),
      journalSnapshot("task_restore_complete", "completed"),
    ]);
    const manager = await TaskManager.create<string>({ journal, clock: () => Date.parse("2026-09-05T00:01:00.000Z"), diagnosticIdFactory: (() => {
      let index = 0;
      return () => `diag_restore_${++index}`;
    })() });

    for (const id of ["task_restore_queued", "task_restore_running"]) {
      expect(manager.get(id)).toMatchObject({ state: "interrupted", resultAvailable: false, diagnostic: { code: "TASK_INTERRUPTED", retry: { safe: true } } });
    }
    expect(manager.get("task_restore_complete")).toMatchObject({ state: "completed", resultAvailable: false });
    expect(manager.getResult("task_restore_complete")).toBeUndefined();
    expect(journal.saves).toBeGreaterThan(0);
  });

  it("persists a bounded journal atomically and evicts the oldest retained result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blockwright-task-test-"));
    temporaryDirectories.push(directory);
    const journal = new FileTaskJournal(join(directory, "tasks.json"));
    const manager = await TaskManager.create<number>({ journal, maximumRetained: 2, idFactory: (() => {
      let index = 0;
      return () => `task_retained_${++index}`;
    })() });
    const ids: string[] = [];
    for (const value of [1, 2, 3]) {
      const task = await manager.submit({ operation: `Task ${value}`, run: () => value });
      ids.push(task.id);
      await manager.waitForTerminal(task.id);
    }
    await manager.flush();

    expect(manager.get(ids[0])).toBeUndefined();
    expect(manager.getResult(ids[1])).toBe(2);
    expect((await journal.load()).map(({ id }) => id)).toEqual(ids.slice(1));
  });
});
