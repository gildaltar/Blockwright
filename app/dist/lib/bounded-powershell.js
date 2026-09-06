import { spawn } from "node:child_process";
import { sanitizeDiagnosticText } from "./task-contract.js";
export class PowerShellExecutionError extends Error {
    code;
    constructor(code, message) {
        super(sanitizeDiagnosticText(message, 320));
        this.name = "PowerShellExecutionError";
        this.code = code;
    }
}
function boundedInteger(value, fallback, minimum, maximum, label) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum)
        throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
    return resolved;
}
function boundedPowerShellEnvironment(source = process.env) {
    const allowed = new Set(["systemroot", "windir", "temp", "tmp", "path", "pathext", "psmodulepath", "comspec"]);
    return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined));
}
/**
 * Executes a non-secret PowerShell program with bounded resources. Any sensitive
 * payload is written only to stdin; it is never included in argv or environment.
 */
export class BoundedPowerShellRunner {
    platform;
    spawnProcess;
    constructor(platform = process.platform, spawnProcess = spawn) {
        this.platform = platform;
        this.spawnProcess = spawnProcess;
    }
    async run(script, options = {}) {
        if (this.platform !== "win32")
            throw new PowerShellExecutionError("POWERSHELL_UNSUPPORTED", "The Windows PowerShell bridge is unavailable on this operating system.");
        if (!script.trim() || Buffer.byteLength(script, "utf8") > 128 * 1024)
            throw new Error("PowerShell bridge scripts must contain 1-131072 UTF-8 bytes.");
        const timeoutMs = boundedInteger(options.timeoutMs, 10_000, 100, 60_000, "timeoutMs");
        const maximumOutputBytes = boundedInteger(options.maximumOutputBytes, 256 * 1024, 1024, 1024 * 1024, "maximumOutputBytes");
        if (options.input && options.input.byteLength > 1024 * 1024)
            throw new Error("PowerShell stdin exceeds the one-megabyte boundary.");
        if (options.signal?.aborted)
            throw new PowerShellExecutionError("POWERSHELL_CANCELLED", "The PowerShell operation was cancelled before launch.");
        const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
        const argumentsList = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand];
        const input = options.input ? Buffer.from(options.input) : Buffer.alloc(0);
        return new Promise((resolve, reject) => {
            let child;
            try {
                child = this.spawnProcess("powershell.exe", argumentsList, {
                    windowsHide: true,
                    shell: false,
                    stdio: ["pipe", "pipe", "pipe"],
                    env: boundedPowerShellEnvironment(),
                });
            }
            catch {
                input.fill(0);
                reject(new PowerShellExecutionError("POWERSHELL_START_FAILED", "Windows PowerShell could not be started."));
                return;
            }
            const childStdin = child.stdin;
            const childStdout = child.stdout;
            const childStderr = child.stderr;
            if (!childStdin || !childStdout || !childStderr) {
                input.fill(0);
                child.kill();
                reject(new PowerShellExecutionError("POWERSHELL_START_FAILED", "Windows PowerShell did not expose the required bounded pipes."));
                return;
            }
            let settled = false;
            let outputBytes = 0;
            const stdout = [];
            const finish = (error, result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                options.signal?.removeEventListener("abort", abort);
                input.fill(0);
                if (error)
                    reject(error);
                else
                    resolve(result ?? "");
            };
            const stopForLimit = () => {
                child.kill();
                finish(new PowerShellExecutionError("POWERSHELL_OUTPUT_LIMIT", "The bounded PowerShell operation exceeded its output limit."));
            };
            const capture = (chunk, keep) => {
                outputBytes += chunk.byteLength;
                if (outputBytes > maximumOutputBytes) {
                    stopForLimit();
                    return;
                }
                if (keep)
                    stdout.push(Buffer.from(chunk));
            };
            childStdout.on("data", (chunk) => capture(chunk, true));
            childStderr.on("data", (chunk) => capture(chunk, false));
            child.once("error", () => finish(new PowerShellExecutionError("POWERSHELL_START_FAILED", "Windows PowerShell could not execute the requested operation.")));
            child.once("close", (code) => {
                if (settled)
                    return;
                if (code !== 0) {
                    finish(new PowerShellExecutionError("POWERSHELL_FAILED", `Windows PowerShell exited with code ${code ?? "unknown"}.`));
                    return;
                }
                finish(undefined, Buffer.concat(stdout).toString("utf8").trim());
            });
            const abort = () => {
                child.kill();
                finish(new PowerShellExecutionError("POWERSHELL_CANCELLED", "The bounded PowerShell operation was cancelled."));
            };
            const timeout = setTimeout(() => {
                child.kill();
                finish(new PowerShellExecutionError("POWERSHELL_TIMEOUT", `The bounded PowerShell operation exceeded ${timeoutMs} milliseconds.`));
            }, timeoutMs);
            timeout.unref();
            options.signal?.addEventListener("abort", abort, { once: true });
            childStdin.once("error", () => {
                input.fill(0);
            });
            childStdin.end(input, () => input.fill(0));
        });
    }
}
//# sourceMappingURL=bounded-powershell.js.map