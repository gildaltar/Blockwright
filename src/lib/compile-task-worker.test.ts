import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  COMPILE_WORKER_PROTOCOL,
  CompileTaskCancelledError,
  CompileTaskTimeoutError,
  CompileTaskWorkerError,
  compileTaskWorkerMain,
  runCompileTask,
  type CompileTaskWorkerHandle,
  type CompileTaskWorkerMessage,
} from "./compile-task-worker.js";

const input = {
  name: "Task Worker Lodge",
  edition: "java" as const,
  version: "26.2",
  style: "nordic",
  dimensions: { width: 7, depth: 7, height: 7 },
  seed: "task-worker-test",
};

class FakeWorker extends EventEmitter implements CompileTaskWorkerHandle {
  terminations = 0;

  async terminate() {
    this.terminations += 1;
    return 0;
  }
}

describe("compile task worker", () => {
  it("runs the existing deterministic compiler and reports only real completed work", () => {
    const progress: Array<{ phase?: string; completed?: number; total?: number }> = [];
    const build = compileTaskWorkerMain(input, (update) => progress.push({
      phase: update.phase,
      completed: update.work?.completedUnits,
      total: update.work?.totalUnits,
    }));

    expect(build.placements.length).toBeGreaterThan(0);
    expect(progress.map(({ phase }) => phase)).toEqual(["preparing", "compiling", "compiling", "validating"]);
    expect(progress[2]).toMatchObject({ completed: build.placements.length, total: build.placements.length });
    expect(progress[1].completed).toBeUndefined();
  });

  it("relays worker progress and publishes a valid result only after the final message", async () => {
    const fake = new FakeWorker();
    const expected = compileTaskWorkerMain(input, () => undefined);
    const seen: string[] = [];
    const resultPromise = runCompileTask(input, {
      workerFactory: () => {
        queueMicrotask(() => {
          fake.emit("message", { protocol: COMPILE_WORKER_PROTOCOL, type: "progress", update: { phase: "compiling", operation: "Compile" } } satisfies CompileTaskWorkerMessage);
          fake.emit("message", { protocol: COMPILE_WORKER_PROTOCOL, type: "result", result: expected } satisfies CompileTaskWorkerMessage);
        });
        return fake;
      },
      onProgress: ({ phase }) => seen.push(phase ?? "unknown"),
    });

    await expect(resultPromise).resolves.toMatchObject({ id: expected.id, hash: expected.hash });
    expect(seen).toEqual(["compiling"]);
    expect(fake.terminations).toBe(1);
  });

  it("terminates running work on abort and exposes no result", async () => {
    const fake = new FakeWorker();
    const controller = new AbortController();
    const resultPromise = runCompileTask(input, { workerFactory: () => fake, signal: controller.signal });
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(CompileTaskCancelledError);
    expect(fake.terminations).toBe(1);
  });

  it("maps worker crashes and timeouts to structured managed errors", async () => {
    const crashed = new FakeWorker();
    const crashPromise = runCompileTask(input, {
      workerFactory: () => {
        queueMicrotask(() => crashed.emit("error", new Error("native crash with token=secret-value")));
        return crashed;
      },
    });
    const crash = await crashPromise.catch((error) => error as CompileTaskWorkerError);
    expect(crash).toBeInstanceOf(CompileTaskWorkerError);
    expect(crash.code).toBe("TASK_WORKER_CRASH");
    expect(crash.message).not.toContain("secret-value");

    const silent = new FakeWorker();
    await expect(runCompileTask(input, { workerFactory: () => silent, timeoutMs: 10 })).rejects.toBeInstanceOf(CompileTaskTimeoutError);
    expect(silent.terminations).toBe(1);
  });
});
