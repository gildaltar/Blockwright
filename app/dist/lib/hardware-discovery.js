import { statfs } from "node:fs/promises";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import { BoundedPowerShellRunner } from "./bounded-powershell.js";
import { sanitizeDiagnosticText } from "./task-contract.js";
const WINDOWS_GPU_SCRIPT = String.raw `
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
function unknown(reason) {
    return { status: "unknown", reason };
}
function known(value, source) {
    return { status: "known", value, source };
}
function safePositiveInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function safeNonNegativeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function safeByteProduct(left, right) {
    let product;
    try {
        product = BigInt(left) * BigInt(right);
    }
    catch {
        return undefined;
    }
    if (product < 0n || product > BigInt(Number.MAX_SAFE_INTEGER))
        return undefined;
    return Number(product);
}
export class WindowsCimGpuProbe {
    runner;
    timeoutMs;
    constructor(runner = new BoundedPowerShellRunner("win32"), timeoutMs = 8_000) {
        this.runner = runner;
        this.timeoutMs = timeoutMs;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
            throw new Error("GPU probe timeout must be an integer from 100 through 60000 milliseconds.");
    }
    async discover(signal) {
        try {
            const output = await this.runner.run(WINDOWS_GPU_SCRIPT, { signal, timeoutMs: this.timeoutMs, maximumOutputBytes: 128 * 1024 });
            const parsed = JSON.parse(output);
            if (!Array.isArray(parsed.devices))
                return { status: "unknown", reason: "invalid_report", devices: [] };
            const devices = [];
            for (const raw of parsed.devices) {
                if (!raw || typeof raw !== "object")
                    continue;
                const candidate = raw;
                if (typeof candidate.name !== "string" || !candidate.name.trim())
                    continue;
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
        }
        catch {
            return { status: "unknown", reason: "probe_failed", devices: [] };
        }
    }
}
const defaultSystemProbe = {
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
export async function discoverLocalHardware(options = {}) {
    const system = options.system ?? defaultSystemProbe;
    let hostPlatform;
    let architecture = "unknown";
    let logicalCores;
    let totalMemory;
    let freeMemoryCandidate;
    try {
        hostPlatform = system.platform();
    }
    catch {
        hostPlatform = process.platform;
    }
    try {
        architecture = sanitizeDiagnosticText(system.architecture(), 80);
    }
    catch {
        architecture = "unknown";
    }
    try {
        logicalCores = safePositiveInteger(system.cpus().length);
    }
    catch {
        logicalCores = undefined;
    }
    try {
        totalMemory = safePositiveInteger(system.totalMemory());
    }
    catch {
        totalMemory = undefined;
    }
    try {
        freeMemoryCandidate = safeNonNegativeInteger(system.freeMemory());
    }
    catch {
        freeMemoryCandidate = undefined;
    }
    const freeMemory = freeMemoryCandidate !== undefined && (totalMemory === undefined || freeMemoryCandidate <= totalMemory) ? freeMemoryCandidate : undefined;
    let diskTotal = unknown("probe_failed");
    let diskFree = unknown("probe_failed");
    try {
        const fileSystem = await system.statFileSystem(options.diskPath ?? process.cwd());
        const totalBytes = safeByteProduct(fileSystem.bsize, fileSystem.blocks);
        const freeBytes = safeByteProduct(fileSystem.bsize, fileSystem.bavail);
        diskTotal = totalBytes === undefined ? unknown("unsafe_numeric_range") : known(totalBytes, "filesystem-statfs");
        diskFree = freeBytes === undefined || (totalBytes !== undefined && freeBytes > totalBytes) ? unknown("invalid_report") : known(freeBytes, "filesystem-statfs");
    }
    catch {
        diskTotal = unknown("probe_failed");
        diskFree = unknown("probe_failed");
    }
    let gpu;
    if (options.gpuProbe) {
        gpu = await options.gpuProbe.discover(options.signal).catch(() => ({ status: "unknown", reason: "probe_failed", devices: [] }));
    }
    else if (hostPlatform === "win32") {
        gpu = await new WindowsCimGpuProbe(options.powerShellRunner ?? new BoundedPowerShellRunner("win32"), options.powerShellTimeoutMs).discover(options.signal);
    }
    else {
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
//# sourceMappingURL=hardware-discovery.js.map