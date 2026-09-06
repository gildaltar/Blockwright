import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { BoundedPowerShellRunner } from "./bounded-powershell.js";

describe("BoundedPowerShellRunner", () => {
  it("puts the sensitive payload only on stdin and bounds the child process surface", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    let receivedInput = "";
    child.stdin.on("data", (chunk) => { receivedInput += chunk.toString("utf8"); });
    child.stdin.on("finish", () => {
      child.stdout.write("bounded-result");
      child.emit("close", 0);
    });
    let captured: { executable?: string; args?: readonly string[]; options?: Record<string, unknown> } = {};
    const fakeSpawn = ((executable: string, args: readonly string[], options: Record<string, unknown>) => {
      captured = { executable, args, options };
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const secretInput = Buffer.from("fake-sensitive-stdin-value", "utf8");
    const runner = new BoundedPowerShellRunner("win32", fakeSpawn);

    await expect(runner.run("Write-Output 'bounded-result'", { input: secretInput, timeoutMs: 1_000, maximumOutputBytes: 4_096 })).resolves.toBe("bounded-result");
    expect(captured.executable).toBe("powershell.exe");
    expect(captured.args).toContain("-EncodedCommand");
    expect(JSON.stringify(captured)).not.toContain("fake-sensitive-stdin-value");
    expect(captured.options).toMatchObject({ windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    expect(Object.keys(captured.options?.env as Record<string, string> ?? {}).every((key) => ["systemroot", "windir", "temp", "tmp", "path", "pathext", "psmodulepath", "comspec"].includes(key.toLowerCase()))).toBe(true);
    expect(receivedInput).toBe("fake-sensitive-stdin-value");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("fails closed without starting PowerShell off Windows", async () => {
    const fakeSpawn = vi.fn();
    const runner = new BoundedPowerShellRunner("linux", fakeSpawn as unknown as typeof import("node:child_process").spawn);
    await expect(runner.run("Write-Output ok")).rejects.toMatchObject({ code: "POWERSHELL_UNSUPPORTED" });
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it("kills a child whose combined output exceeds the configured boundary", async () => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    child.stdin.on("finish", () => child.stdout.write(Buffer.alloc(2_048, 0x41)));
    const fakeSpawn = (() => child) as unknown as typeof import("node:child_process").spawn;
    const runner = new BoundedPowerShellRunner("win32", fakeSpawn);

    await expect(runner.run("Write-Output ok", { maximumOutputBytes: 1_024 })).rejects.toMatchObject({ code: "POWERSHELL_OUTPUT_LIMIT" });
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
