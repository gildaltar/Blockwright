import { describe, expect, it, vi } from "vitest";
import { discoverLocalHardware, WindowsCimGpuProbe, type HardwareSystemProbe } from "./hardware-discovery.js";
import type { PowerShellRunOptions, PowerShellRunner } from "./bounded-powershell.js";

const cpu = {
  model: "Test CPU",
  speed: 3000,
  times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 },
};

function system(overrides: Partial<HardwareSystemProbe> = {}): HardwareSystemProbe {
  return {
    platform: () => "win32",
    architecture: () => "x64",
    cpus: () => [cpu, cpu, cpu, cpu],
    totalMemory: () => 16 * 1024 ** 3,
    freeMemory: () => 6 * 1024 ** 3,
    statFileSystem: async () => ({ bsize: 4096n, blocks: 1_000_000n, bavail: 250_000n }),
    ...overrides,
  };
}

describe("local hardware discovery", () => {
  it("reports exact OS/runtime values and only reported dedicated GPU memory", async () => {
    const calls: Array<{ script: string; options?: PowerShellRunOptions }> = [];
    const runner: PowerShellRunner = {
      run: async (script, options) => {
        calls.push({ script, options });
        return JSON.stringify({ devices: [
          { name: "Example Dedicated GPU", dedicatedMemoryBytes: 8 * 1024 ** 3 },
          { name: "Example Integrated GPU", dedicatedMemoryBytes: null },
        ] });
      },
    };
    const profile = await discoverLocalHardware({
      system: system(),
      diskPath: "C:\\bounded-state-root",
      powerShellRunner: runner,
      powerShellTimeoutMs: 2_500,
      clock: () => Date.parse("2026-09-05T12:00:00.000Z"),
    });

    expect(profile).toMatchObject({
      observedAt: "2026-09-05T12:00:00.000Z",
      platform: "win32",
      architecture: "x64",
      cpu: { logicalCores: { status: "known", value: 4, source: "node:os.cpus" } },
      memory: {
        totalBytes: { status: "known", value: 16 * 1024 ** 3 },
        freeBytes: { status: "known", value: 6 * 1024 ** 3 },
      },
      disk: {
        totalBytes: { status: "known", value: 4096 * 1_000_000 },
        freeBytes: { status: "known", value: 4096 * 250_000 },
      },
      gpu: { status: "known", devices: [{ name: "Example Dedicated GPU", dedicatedMemoryBytes: 8 * 1024 ** 3 }, { name: "Example Integrated GPU" }] },
    });
    expect(profile.gpu.devices[1]).not.toHaveProperty("dedicatedMemoryBytes");
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ timeoutMs: 2_500, maximumOutputBytes: 128 * 1024 });
    expect(calls[0].script).toContain("Get-CimInstance -ClassName Win32_VideoController");
  });

  it("preserves unknown values instead of substituting zeros or guesses", async () => {
    const profile = await discoverLocalHardware({
      system: system({
        platform: () => "linux",
        architecture: () => "arm64",
        cpus: () => [],
        totalMemory: () => 0,
        freeMemory: () => -1,
        statFileSystem: async () => { throw new Error("not available"); },
      }),
    });

    expect(profile.cpu.logicalCores).toEqual({ status: "unknown", reason: "not_reported" });
    expect(profile.memory.totalBytes).toEqual({ status: "unknown", reason: "not_reported" });
    expect(profile.memory.freeBytes).toEqual({ status: "unknown", reason: "invalid_report" });
    expect(profile.disk.totalBytes).toEqual({ status: "unknown", reason: "probe_failed" });
    expect(profile.disk.freeBytes).toEqual({ status: "unknown", reason: "probe_failed" });
    expect(profile.gpu).toEqual({ status: "unknown", reason: "unsupported_platform", devices: [] });
  });

  it("marks unsafe filesystem ranges and failed or malformed GPU probes unknown", async () => {
    const malformed: PowerShellRunner = { run: async () => JSON.stringify({ devices: "not-an-array" }) };
    const profile = await discoverLocalHardware({
      system: system({ statFileSystem: async () => ({ bsize: 2n ** 40n, blocks: 2n ** 40n, bavail: 1n }) }),
      gpuProbe: new WindowsCimGpuProbe(malformed),
    });
    expect(profile.disk.totalBytes).toEqual({ status: "unknown", reason: "unsafe_numeric_range" });
    expect(profile.disk.freeBytes).toMatchObject({ status: "known", value: Number(2n ** 40n) });
    expect(profile.gpu).toEqual({ status: "unknown", reason: "invalid_report", devices: [] });

    const failed: PowerShellRunner = { run: vi.fn(async () => { throw new Error("driver details must not escape"); }) };
    await expect(new WindowsCimGpuProbe(failed).discover()).resolves.toEqual({ status: "unknown", reason: "probe_failed", devices: [] });
  });
});
