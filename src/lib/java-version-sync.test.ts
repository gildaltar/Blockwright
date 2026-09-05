import { describe, expect, it, vi } from "vitest";
import { JavaUpdateChecker } from "./java-version-sync.js";

function manifestResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      latest: { release: "26.2", snapshot: "26.3-snapshot" },
      versions: [],
    }),
  } as Response;
}

describe("JavaUpdateChecker", () => {
  it("coalesces concurrent checks and reuses a short-lived manifest result", async () => {
    let now = 1_800_000_000_000;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async () => {
      await held;
      return manifestResponse();
    });
    const checker = new JavaUpdateChecker({ request: request as typeof fetch, cacheTtlMs: 1_000, now: () => now });
    const checks = Array.from({ length: 12 }, () => checker.check("release"));
    release();
    expect((await Promise.all(checks)).every(({ latestVersion }) => latestVersion === "26.2")).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);

    await checker.check("release");
    expect(request).toHaveBeenCalledTimes(1);
    now += 1_001;
    await checker.check("release");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a distinct manifest check while the global slot is occupied", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async () => {
      await held;
      return manifestResponse();
    });
    const checker = new JavaUpdateChecker({ request: request as typeof fetch, maximumConcurrentChecks: 1 });
    const releaseCheck = checker.check("release");
    await expect(checker.check("snapshot")).rejects.toThrow(/already at capacity/);
    release();
    await releaseCheck;
  });
});
