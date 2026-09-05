import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import {
  appRoot,
  compareVersions,
  createBoundedFetch,
  createBridgeForwarder,
  createRestartable,
  minimumNodeVersion,
  readPayload,
  repairLockDisposition,
  repairMutexAddress,
  requiredRuntimeFiles,
  resolveRuntimeEntry,
  pluginRoot as bridgeRoot,
  runtimeEntryCandidates,
  withRuntimeRepairLock,
} from "./server.mjs";

function unusedPort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port was allocated."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForExit(processHandle: ReturnType<typeof spawn>, timeoutMs = 5_000) {
  if (processHandle.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveExit) => processHandle.once("exit", () => resolveExit())),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Child process did not exit in time.")), timeoutMs)),
  ]);
}

function waitForMessage(messages: any[], predicate: (message: any) => boolean, timeoutMs = 12_000) {
  return new Promise<any>((resolveMessage, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const match = messages.find(predicate);
      if (match) {
        resolveMessage(match);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Timed out waiting for a bridge JSON-RPC response."));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

describe("Blockwright stdio bridge helpers", () => {
  it("compares runtime versions numerically", () => {
    expect(compareVersions("22.23.1", "22.23.1")).toBe(0);
    expect(compareVersions("24.0.0", "22.23.1")).toBe(1);
    expect(compareVersions("22.9.0", "22.23.1")).toBe(-1);
    expect(compareVersions("22.23.1-rc.1", "22.23.1")).toBe(0);
  });

  it("extracts the minimum supported Node version", () => {
    expect(minimumNodeVersion(">=22.23.1")).toBe("22.23.1");
    expect(minimumNodeVersion("node >= 24")).toBe("24");
    expect(minimumNodeVersion("*")).toBeUndefined();
  });

  it("lists core files and every direct runtime dependency", () => {
    const files = requiredRuntimeFiles({ dependencies: { skybridge: "^1.4.1", "@scope/example": "^2.0.0" } });
    expect(files).toContain(resolve(appRoot, "dist", "server.js"));
    expect(files).toContain(resolve(appRoot, "node_modules", "skybridge", "package.json"));
    expect(files).toContain(resolve(appRoot, "node_modules", "@scope", "example", "package.json"));
  });

  it("prefers the manifest-priming production entry over the server fallback", () => {
    expect(runtimeEntryCandidates(appRoot)).toEqual([
      resolve(appRoot, "dist", "__entry.js"),
      resolve(appRoot, "dist", "server.js"),
    ]);
    expect(resolveRuntimeEntry(appRoot)).toBe(resolve(appRoot, "dist", "__entry.js"));
  });

  it("falls back to the built server when the manifest-priming entry is absent", () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-entry-fallback-"));
    try {
      mkdirSync(resolve(temporary, "dist"));
      writeFileSync(resolve(temporary, "dist", "server.js"), "export default undefined;\n");
      expect(resolveRuntimeEntry(temporary)).toBe(resolve(temporary, "dist", "server.js"));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("reads JSON and selects the first JSON SSE data event", async () => {
    const json = new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { "content-type": "application/json" } });
    expect(await readPayload(json)).toContain('"result"');

    const sse = new Response("event: endpoint\ndata: /mcp/session\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    expect(JSON.parse(await readPayload(sse))).toMatchObject({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("returns and cancels after a JSON SSE event without waiting for stream close", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: endpoint\ndata: /mcp/session\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ready\":true}}\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { headers: { "content-type": "text/event-stream" } });
    await expect(readPayload(response, { timeoutMs: 100, maxBytes: 4096 })).resolves.toContain('"ready":true');
    expect(cancelled).toBe(true);
  });

  it("relays a notification and waits for the matching result in a multi-event SSE response", async () => {
    let cancelled = false;
    const seen: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}\n\n',
          'event: message\ndata: {"jsonrpc":"2.0","id":"other","result":{"ignored":true}}\n\n',
          'event: message\ndata: {"jsonrpc":"2.0","id":"wanted","result":{"ready":true}}\n\n',
        ].join("")));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { headers: { "content-type": "text/event-stream" } });
    const payload = await readPayload(response, {
      expectedId: "wanted",
      onMessage: (message) => { seen.push(message); },
      timeoutMs: 100,
      maxBytes: 4096,
    });
    expect(JSON.parse(payload)).toMatchObject({ id: "wanted", result: { ready: true } });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ method: "notifications/progress" });
    expect(cancelled).toBe(true);
  });

  it("forwards concurrent requests and cancellation without globally serializing stdin", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const sent: any[] = [];
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolveSlow) => { releaseSlow = resolveSlow; });
    const transport: any = {
      protocolVersion: undefined,
      async send(message: any) {
        sent.push(message);
        if (message.method === "tools/call") await slow;
      },
      setProtocolVersion(version: string) {
        this.protocolVersion = version;
      },
    };
    const forwarder = createBridgeForwarder({
      getTransport: async () => transport,
      writeOutput: (value) => output.push(value),
      writeError: (value) => errors.push(value),
    });

    await forwarder.forwardLine('{"jsonrpc":"2.0","id":"init","method":"initialize","params":{}}');
    transport.onmessage({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } });
    transport.onmessage({ jsonrpc: "2.0", id: "init", result: { protocolVersion: "2025-03-26" } });
    expect(transport.protocolVersion).toBe("2025-03-26");

    const pendingCall = forwarder.forwardLine('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{}}');
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    await forwarder.forwardLine('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}');
    expect(sent.map(({ method }) => method)).toEqual(["initialize", "tools/call", "notifications/cancelled"]);
    transport.onmessage({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } });
    transport.onmessage({ jsonrpc: "2.0", id: 7, result: { content: [] } });
    expect(forwarder.pendingCount).toBe(0);
    expect(output.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "notifications/message" }),
      expect.objectContaining({ method: "notifications/progress" }),
      expect.objectContaining({ id: 7, result: { content: [] } }),
    ]));
    expect(errors).toEqual([]);
    releaseSlow();
    await pendingCall;
  });

  it("drops a failed cached HTTP transport and retries with a fresh one", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const first: any = {
      async send() { throw new Error("session transport died"); },
      async close() {},
    };
    const second: any = {
      async send(message: any) {
        queueMicrotask(() => second.onmessage({ jsonrpc: "2.0", id: message.id, result: { recovered: true } }));
      },
      async close() {},
    };
    let current = first;
    let resets = 0;
    let forwarder: ReturnType<typeof createBridgeForwarder>;
    forwarder = createBridgeForwarder({
      getTransport: async () => current,
      writeOutput: (value) => output.push(value),
      writeError: (value) => errors.push(value),
      onTransportFailure: (error: Error, transport: any) => {
        expect(transport).toBe(first);
        expect(error.message).toContain("transport died");
        resets += 1;
        current = second;
        forwarder.reset(error.message);
      },
    });
    await forwarder.forwardLine('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}');
    await forwarder.forwardLine('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}');
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    expect(resets).toBe(1);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ id: 1, error: expect.objectContaining({ code: -32603 }) }),
      expect.objectContaining({ id: 2, result: { recovered: true } }),
    ]);
    expect(errors.join("\n")).toContain("session transport died");
  });

  it("invalidates pending work on an asynchronous transport error", async () => {
    const output: string[] = [];
    const transports: any[] = [
      { async send() {}, async close() {} },
      {
        async send(message: any) {
          queueMicrotask(() => transports[1].onmessage({ jsonrpc: "2.0", id: message.id, result: { reconnected: true } }));
        },
        async close() {},
      },
    ];
    let index = 0;
    let forwarder: ReturnType<typeof createBridgeForwarder>;
    forwarder = createBridgeForwarder({
      getTransport: async () => transports[index],
      writeOutput: (value) => output.push(value),
      writeError: () => undefined,
      onTransportFailure: (error: Error) => {
        index = 1;
        forwarder.reset(error.message);
      },
    });
    await forwarder.forwardLine('{"jsonrpc":"2.0","id":"old","method":"tools/list","params":{}}');
    expect(forwarder.pendingCount).toBe(1);
    transports[0].onerror(new Error("SSE connection aborted"));
    expect(forwarder.pendingCount).toBe(0);
    await forwarder.forwardLine('{"jsonrpc":"2.0","id":"new","method":"tools/list","params":{}}');
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ id: "old", error: expect.objectContaining({ code: -32603 }) }),
      expect.objectContaining({ id: "new", result: { reconnected: true } }),
    ]);
  });

  it("times out POST requests without expiring the long-lived GET event stream", async () => {
    const lifetime = new AbortController();
    const transport = new AbortController();
    const seen: AbortSignal[] = [];
    const bounded = createBoundedFetch(async (_input: any, init: any) => {
      seen.push(init.signal);
      return new Response(null, { status: 200 });
    }, lifetime.signal, 10);
    await bounded("http://127.0.0.1/mcp", { method: "GET", signal: transport.signal });
    await bounded("http://127.0.0.1/mcp", { method: "POST", signal: transport.signal });
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    expect(seen[0].aborted).toBe(false);
    expect(seen[1].aborted).toBe(true);
    lifetime.abort();
    expect(seen[0].aborted).toBe(true);
  });

  it("retries rejected starts and can reset a resolved endpoint", async () => {
    let attempts = 0;
    const state = createRestartable(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("not ready");
      return `endpoint-${attempts}`;
    });
    await expect(state.get()).rejects.toThrow("not ready");
    await expect(state.get()).resolves.toBe("endpoint-2");
    expect(attempts).toBe(2);
    state.reset();
    await expect(state.get()).resolves.toBe("endpoint-3");
  });

  it("holds the shared repair lock with owner metadata and releases only its token", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-lock-test-"));
    const lockPath = resolve(temporary, ".blockwright-runtime-repair.lock");
    try {
      await withRuntimeRepairLock(async () => {
        expect(existsSync(lockPath)).toBe(true);
        const owner = JSON.parse(readFileSync(resolve(lockPath, "owner.json"), "utf8"));
        expect(owner).toMatchObject({ schemaVersion: 1, pid: process.pid, actor: "mcp-bridge" });
        expect(typeof owner.token).toBe("string");
      }, { lockPath, retries: 0, signal: new AbortController().signal });
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("serializes two contenders while safely reclaiming stale metadata", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-lock-contenders-"));
    const lockPath = resolve(temporary, ".blockwright-runtime-repair.lock");
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolveEntered) => { firstEntered = resolveEntered; });
    const holdFirst = new Promise<void>((resolveFirst) => { releaseFirst = resolveFirst; });
    try {
      mkdirSync(lockPath);
      const staleTime = new Date(Date.now() - 10_000).toISOString();
      writeFileSync(resolve(lockPath, "owner.json"), JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        startedAt: staleTime,
        acquiredAt: staleTime,
        actor: "stale-test-owner",
        token: "stale-test-token",
      }));
      const first = withRuntimeRepairLock(async () => {
        firstEntered();
        await holdFirst;
      }, { lockPath, retries: 100, retryMs: 10, signal: new AbortController().signal });
      await entered;
      let secondEntered = false;
      const second = withRuntimeRepairLock(async () => {
        secondEntered = true;
      }, { lockPath, retries: 100, retryMs: 10, signal: new AbortController().signal });
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      expect(secondEntered).toBe(false);
      releaseFirst();
      await Promise.all([first, second]);
      expect(secondEntered).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      releaseFirst?.();
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("shares the same OS mutex with the PowerShell repair helper", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-cross-runtime-mutex-"));
    const lockPath = resolve(temporary, ".blockwright-runtime-repair.lock");
    try {
      const endpoint = repairMutexAddress(lockPath);
      expect(endpoint.kind).toBe("pipe");
      const pipeName = endpoint.address.slice("\\\\.\\pipe\\".length);
      await withRuntimeRepairLock(async () => {
        const script = [
          "$pipe=$null",
          "try {",
          `  $pipe=[System.IO.Pipes.NamedPipeServerStream]::new('${pipeName}',[System.IO.Pipes.PipeDirection]::InOut,1,[System.IO.Pipes.PipeTransmissionMode]::Byte,[System.IO.Pipes.PipeOptions]::Asynchronous)`,
          "  exit 0",
          "} catch {",
          "  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)",
          "  exit 23",
          "} finally {",
          "  if ($null -ne $pipe) { $pipe.Dispose() }",
          "}",
        ].join("\n");
        const contender = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
        expect(contender.status).toBe(23);
        expect(contender.stderr).toMatch(/denied|busy|pipe/i);
      }, { lockPath, retries: 0, signal: new AbortController().signal });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("does not steal a fresh repair lock from a live owner", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-lock-owner-test-"));
    const lockPath = resolve(temporary, ".blockwright-runtime-repair.lock");
    try {
      mkdirSync(lockPath);
      writeFileSync(resolve(lockPath, "owner.json"), JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        acquiredAt: new Date().toISOString(),
        actor: "windows-control-center",
        token: "other-owner",
      }));
      await expect(withRuntimeRepairLock(async () => undefined, {
        lockPath,
        retries: 0,
        retryMs: 1,
        signal: new AbortController().signal,
      })).rejects.toThrow("windows-control-center");
      expect(JSON.parse(readFileSync(resolve(lockPath, "owner.json"), "utf8")).token).toBe("other-owner");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("reclaims repair locks only after the matching stale-owner proof", () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-lock-stale-test-"));
    const lockPath = resolve(temporary, ".blockwright-runtime-repair.lock");
    try {
      mkdirSync(lockPath);
      const now = Date.now();
      writeFileSync(resolve(lockPath, "owner.json"), JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        startedAt: new Date(now - 60_000).toISOString(),
        acquiredAt: new Date(now - 6_000).toISOString(),
        actor: "mcp-bridge",
        token: "dead-owner",
      }));
      expect(repairLockDisposition(lockPath, now)).toMatchObject({ reclaim: true });
      writeFileSync(resolve(lockPath, "owner.json"), "not-json");
      expect(repairLockDisposition(lockPath, now)).toMatchObject({ reclaim: false });
      expect(repairLockDisposition(lockPath, now + 11 * 60_000)).toMatchObject({ reclaim: true });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("starts the built entry directly from a path containing spaces", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright path with spaces "));
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(appRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      const entryPath = resolve(temporary, "dist", "__entry.js");
      processHandle = spawn(process.execPath, [entryPath], {
        cwd: temporary,
        env: {
          ...process.env,
          NODE_ENV: "production",
          __PORT: String(port),
          PORT: String(port),
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      let health: any;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Built entry exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) });
          if (response.ok) {
            health = await response.json();
            break;
          }
        } catch {
          // Startup probing is expected to fail until the listener binds.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      expect(health).toMatchObject({ service: "blockwright", status: "ok" });
      const readyResponse = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2_000) });
      expect(readyResponse.status).toBe(200);
      expect(await readyResponse.json()).toMatchObject({ service: "blockwright", status: "ready", checks: { registry: { ok: true }, assets: { ok: true } } });
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("reports not-ready for a structurally truncated Java registry", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright invalid registry "));
    const dataRoot = resolve(temporary, "java-data");
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(appRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      mkdirSync(dataRoot, { recursive: true });
      writeFileSync(resolve(dataRoot, "26.2.registry.json"), JSON.stringify({ schemaVersion: 1, edition: "java", version: "26.2" }));
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: { ...process.env, NODE_ENV: "production", __PORT: String(port), PORT: String(port), BLOCKWRIGHT_DATA_DIR: dataRoot },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      let response: Response | undefined;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Built entry exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          response = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(250) });
          break;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
      }
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({ status: "not_ready", checks: { registry: { ok: false } } });
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("bridges a real initialize and tools/list exchange over the SDK transport", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright bridge path with spaces "));
    const app = resolve(temporary, "app");
    const mcp = resolve(temporary, "mcp");
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      mkdirSync(app, { recursive: true });
      mkdirSync(mcp, { recursive: true });
      mkdirSync(resolve(app, "data"), { recursive: true });
      cpSync(resolve(appRoot, "dist"), resolve(app, "dist"), { recursive: true });
      const runtimePackage = JSON.parse(readFileSync(resolve(bridgeRoot, "app", "package.json"), "utf8"));
      const builtServer = readFileSync(resolve(appRoot, "dist", "server.js"), "utf8");
      const runtimeVersion = /const APP_VERSION = "([^"]+)"/.exec(builtServer)?.[1];
      if (!runtimeVersion) throw new Error("Could not read the built Blockwright version for the bridge fixture.");
      runtimePackage.version = runtimeVersion;
      writeFileSync(resolve(app, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
      cpSync(resolve(bridgeRoot, "mcp", "server.mjs"), resolve(mcp, "server.mjs"));
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(app, "node_modules"), "junction");
      symlinkSync(resolve(bridgeRoot, "data", "java"), resolve(app, "data", "java"), "junction");

      processHandle = spawn(process.execPath, [resolve(mcp, "server.mjs")], {
        cwd: temporary,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      const messages: any[] = [];
      const output = createInterface({ input: processHandle.stdout! });
      output.on("line", (line) => {
        try { messages.push(JSON.parse(line)); } catch { /* stdout purity is asserted below */ }
      });
      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "initialize-test",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "blockwright-bridge-test", version: "1.0.0" },
        },
      })}\n`);
      const initialized = await waitForMessage(messages, ({ id }) => id === "initialize-test");
      expect(initialized.result?.serverInfo).toMatchObject({ name: "blockwright", version: runtimeVersion });
      processHandle.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      processHandle.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: "tools-test", method: "tools/list", params: {} })}\n`);
      const tools = await waitForMessage(messages, ({ id }) => id === "tools-test");
      expect(tools.result?.tools).toHaveLength(27);
      const callTool = async (id: string, name: string, arguments_: Record<string, unknown>) => {
        processHandle?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
        return waitForMessage(messages, (message) => message.id === id);
      };

      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "compile-test",
        method: "tools/call",
        params: {
          name: "compile_build",
          arguments: {
            name: "Schema Regression Pavilion",
            edition: "java",
            version: "26.2",
            style: "japanese",
            dimensions: { width: 9, depth: 9, height: 9 },
            seed: "schema-regression",
          },
        },
      })}\n`);
      const compiled = await waitForMessage(messages, ({ id }) => id === "compile-test");
      const build = compiled.result?.structuredContent?.build;
      expect(compiled.result?.isError).not.toBe(true);
      expect(build?.input?.style).toBe("japanese");

      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "revise-test",
        method: "tools/call",
        params: { name: "revise_build", arguments: { build: build.id, changes: { name: "Renamed Pavilion" } } },
      })}\n`);
      const revised = await waitForMessage(messages, ({ id }) => id === "revise-test");
      const revisedBuild = revised.result?.structuredContent?.build;
      expect(revisedBuild?.input).toEqual({ ...build.input, name: "Renamed Pavilion" });

      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "empty-revise-test",
        method: "tools/call",
        params: { name: "revise_build", arguments: { build: revisedBuild.id, changes: {} } },
      })}\n`);
      const identityRevision = await waitForMessage(messages, ({ id }) => id === "empty-revise-test");
      expect(identityRevision.result?.structuredContent?.build).toMatchObject({ hash: revisedBuild.hash, input: revisedBuild.input });

      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "tamper-test",
        method: "tools/call",
        params: {
          name: "validate_build",
          arguments: { build: { id: build.id, hash: build.hash, input: { ...build.input, name: "Tampered Pavilion" } } },
        },
      })}\n`);
      const tampered = await waitForMessage(messages, ({ id }) => id === "tamper-test");
      expect(tampered.result?.isError ?? Boolean(tampered.error)).toBe(true);
      expect(JSON.stringify(tampered)).toMatch(/integrity/i);

      const cachedLookup = await callTool("cached-lookup-test", "validate_build", { build: build.id });
      expect(cachedLookup.result?.structuredContent).toMatchObject({ buildId: build.id, hash: build.hash });
      const reconstructed = await callTool("reconstruct-test", "validate_build", { build: { hash: build.hash, input: build.input } });
      expect(reconstructed.result?.structuredContent).toMatchObject({ buildId: build.id, hash: build.hash });
      for (const [id, reference] of [
        ["bad-hash-test", { id: build.id, hash: "0".repeat(64), input: build.input }],
        ["bad-id-test", { id: "bw_not_the_build", hash: build.hash, input: build.input }],
      ] as const) {
        const rejected = await callTool(id, "validate_build", { build: reference });
        expect(rejected.result?.isError ?? Boolean(rejected.error)).toBe(true);
        expect(JSON.stringify(rejected)).toMatch(/integrity/i);
      }

      const vanillaCompatibility = await callTool("vanilla-compatibility-test", "get_worldedit_compatibility", { minecraftVersion: "26.2", platform: "vanilla" });
      expect(vanillaCompatibility.result?.structuredContent).toMatchObject({ minecraftVersion: "26.2", platform: "vanilla", compatible: false });
      expect(messages.every(({ jsonrpc }) => jsonrpc === "2.0")).toBe(true);
      processHandle.stdin?.end();
      await waitForExit(processHandle, 5_000);
      expect(processHandle.exitCode).toBe(0);
      output.close();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nBridge stderr:\n${stderr}`);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGKILL");
      if (processHandle) await waitForExit(processHandle).catch(() => undefined);
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  it("exits promptly when stdin closes instead of waiting for queued work", async () => {
    const processHandle = spawn(process.execPath, [resolve(bridgeRoot, "mcp", "server.mjs")], {
      cwd: bridgeRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const started = Date.now();
    processHandle.stdin?.end();
    await waitForExit(processHandle, 2_000);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(processHandle.exitCode).toBe(0);
  });
});
