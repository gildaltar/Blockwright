import { statfs } from "node:fs/promises";
import { arch, cpus, freemem, platform, totalmem, type CpuInfo } from "node:os";
import { BoundedPowerShellRunner, type PowerShellRunner } from "./bounded-powershell.js";
import { sanitizeDiagnosticText } from "./task-contract.js";

export type KnownHardwareMetric<T> = {
  status: "known";
  value: T;
  source: string;
};

export type UnknownHardwareMetric = {
  status: "unknown";
  reason: "not_reported" | "invalid_report" | "probe_failed" | "unsupported_platform" | "unsafe_numeric_range";
};

export type HardwareMetric<T> = KnownHardwareMetric<T> | UnknownHardwareMetric;

export type LocalGpu = {
  name: string;
  /** Present only when the operating system reports a positive, safe value. */
  dedicatedMemoryBytes?: number;
  dedicatedMemorySource?: string;
};

export type GpuDiscovery =
  | { status: "known"; source: string; devices: LocalGpu[] }
  | { status: "unknown"; reason: UnknownHardwareMetric["reason"]; devices: [] };

export type LocalHardwareProfile = {
  observedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  cpu: {
    logicalCores: HardwareMetric<number>;
  };
  memory: {
    totalBytes: HardwareMetric<number>;
    freeBytes: HardwareMetric<number>;
  };
  disk: {
    totalBytes: HardwareMetric<number>;
    freeBytes: HardwareMetric<number>;
  };
  gpu: GpuDiscovery;
};

export interface HardwareSystemProbe {
  platform(): NodeJS.Platform;
  architecture(): string;
  cpus(): CpuInfo[];
  totalMemory(): number;
  freeMemory(): number;
  statFileSystem(path: string): Promise<{ bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }>;
}

export interface GpuProbe {
  discover(signal?: AbortSignal): Promise<GpuDiscovery>;
}

const WINDOWS_GPU_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$devices = @(
  Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
    $memory = $null
    if ($null -ne $_.AdapterRAM) {
      try {
        $reported = [uint64]$_.AdapterRAM
        if ($reported -gt 0) { $memory = $reported }
      } catch { $memory = $null }
    }
    [pscustomobject]@{
      name = [string]$_.Name
      dedicatedMemoryBytes = $memory
    }
  }
)
[pscustomobject]@{ devices = $devices } | ConvertTo-Json -Compress -Depth 4
`;

function unknown(reason: UnknownHardwareMetric["reason"]): UnknownHardwareMetric {
  return { status: "unknown", reason };
}

function known<T>(value: T, source: string): KnownHardwareMetric<T> {
  return { status: "known", value, source };
}

function safePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeByteProduct(left: number | bigint, right: number | bigint) {
  let product: bigint;
  try {
    product = BigInt(left) * BigInt(right);
  } catch {
    return undefined;
  }
  if (product < 0n || product > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(product);
}

export class WindowsCimGpuProbe implements GpuProbe {
  constructor(private readonly runner: PowerShellRunner = new BoundedPowerShellRunner("win32"), private readonly timeoutMs = 8_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("GPU probe timeout must be an integer from 100 through 60000 milliseconds.");
  }

  async discover(signal?: AbortSignal): Promise<GpuDiscovery> {
    try {
      const output = await this.runner.run(WINDOWS_GPU_SCRIPT, { signal, timeoutMs: this.timeoutMs, maximumOutputBytes: 128 * 1024 });
      const parsed = JSON.parse(output) as { devices?: unknown };
      if (!Array.isArray(parsed.devices)) return { status: "unknown", reason: "invalid_report", devices: [] };
      const devices: LocalGpu[] = [];
      for (const raw of parsed.devices) {
        if (!raw || typeof raw !== "object") continue;
        const candidate = raw as { name?: unknown; dedicatedMemoryBytes?: unknown };
        if (typeof candidate.name !== "string" || !candidate.name.trim()) continue;
        const name = sanitizeDiagnosticText(candidate.name, 200);
        const dedicatedMemoryBytes = safePositiveInteger(candidate.dedicatedMemoryBytes);
        devices.push({
          name,
          ...(dedicatedMemoryBytes === undefined ? {} : {
            dedicatedMemoryBytes,
            dedicatedMemorySource: "windows-cim:Win32_VideoController.AdapterRAM",
          }),
        });
      }
      return { status: "known", source: "windows-cim:Win32_VideoController", devices };
    } catch {
      return { status: "unknown", reason: "probe_failed", devices: [] };
    }
  }
}

const defaultSystemProbe: HardwareSystemProbe = {
  platform,
  architecture: arch,
  cpus,
  totalMemory: totalmem,
  freeMemory: freemem,
  statFileSystem: async (path) => {
    const result = await statfs(path, { bigint: true });
    return { bsize: result.bsize, blocks: result.blocks, bavail: result.bavail };
  },
};

export async function discoverLocalHardware(options: {
  system?: HardwareSystemProbe;
  diskPath?: string;
  gpuProbe?: GpuProbe;
  powerShellRunner?: PowerShellRunner;
  powerShellTimeoutMs?: number;
  signal?: AbortSignal;
  clock?: () => number;
} = {}): Promise<LocalHardwareProfile> {
  const system = options.system ?? defaultSystemProbe;
  let hostPlatform: NodeJS.Platform;
  let architecture = "unknown";
  let logicalCores: number | undefined;
  let totalMemory: number | undefined;
  let freeMemoryCandidate: number | undefined;
  try { hostPlatform = system.platform(); } catch { hostPlatform = process.platform; }
  try { architecture = sanitizeDiagnosticText(system.architecture(), 80); } catch { architecture = "unknown"; }
  try { logicalCores = safePositiveInteger(system.cpus().length); } catch { logicalCores = undefined; }
  try { totalMemory = safePositiveInteger(system.totalMemory()); } catch { totalMemory = undefined; }
  try { freeMemoryCandidate = safeNonNegativeInteger(system.freeMemory()); } catch { freeMemoryCandidate = undefined; }
  const freeMemory = freeMemoryCandidate !== undefined && (totalMemory === undefined || freeMemoryCandidate <= totalMemory) ? freeMemoryCandidate : undefined;

  let diskTotal: HardwareMetric<number> = unknown("probe_failed");
  let diskFree: HardwareMetric<number> = unknown("probe_failed");
  try {
    const fileSystem = await system.statFileSystem(options.diskPath ?? process.cwd());
    const totalBytes = safeByteProduct(fileSystem.bsize, fileSystem.blocks);
    const freeBytes = safeByteProduct(fileSystem.bsize, fileSystem.bavail);
    diskTotal = totalBytes === undefined ? unknown("unsafe_numeric_range") : known(totalBytes, "filesystem-statfs");
    diskFree = freeBytes === undefined || (totalBytes !== undefined && freeBytes > totalBytes) ? unknown("invalid_report") : known(freeBytes, "filesystem-statfs");
  } catch {
    diskTotal = unknown("probe_failed");
    diskFree = unknown("probe_failed");
  }

  let gpu: GpuDiscovery;
  if (options.gpuProbe) {
    gpu = await options.gpuProbe.discover(options.signal).catch(() => ({ status: "unknown" as const, reason: "probe_failed" as const, devices: [] }));
  } else if (hostPlatform === "win32") {
    gpu = await new WindowsCimGpuProbe(options.powerShellRunner ?? new BoundedPowerShellRunner("win32"), options.powerShellTimeoutMs).discover(options.signal);
  } else {
    gpu = { status: "unknown", reason: "unsupported_platform", devices: [] };
  }

  return {
    observedAt: new Date((options.clock ?? Date.now)()).toISOString(),
    platform: hostPlatform,
    architecture,
    cpu: { logicalCores: logicalCores === undefined ? unknown("not_reported") : known(logicalCores, "node:os.cpus") },
    memory: {
      totalBytes: totalMemory === undefined ? unknown("not_reported") : known(totalMemory, "node:os.totalmem"),
      freeBytes: freeMemory === undefined ? unknown("invalid_report") : known(freeMemory, "node:os.freemem"),
    },
    disk: { totalBytes: diskTotal, freeBytes: diskFree },
    gpu,
  };
}
