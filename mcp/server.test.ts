import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as requestHttp } from "node:http";
import { connect as connectSocket, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { loadBuildForView } from "../src/lib/build-view-paging.js";
import { isStrongLocalMcpToken, mcpRequestTargetDisposition, trustedClientAddress } from "../src/lib/runtime-listener.js";
import {
  appRoot,
  compareVersions,
  createAuthenticatedFetch,
  createBoundedFetch,
  createBridgeForwarder,
  createLocalMcpToken,
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

const LOCAL_TEST_TOKEN = "bw_test_local_mcp_token_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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

function canConnect(host: string, port: number, timeoutMs = 750) {
  return new Promise<boolean>((resolveConnection) => {
    const socket = connectSocket({ host, port });
    let settled = false;
    const settle = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnection(connected);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

function nonLoopbackIpv4Addresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter(({ family, internal, address }) => (family === "IPv4" || family === 4) && !internal && address !== "0.0.0.0")
    .map(({ address }) => address))];
}

function rawHttpExchange(port: number, request: string, timeoutMs = 1_000) {
  return new Promise<string>((resolveResponse, reject) => {
    const socket = connectSocket({ host: "127.0.0.1", port });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Raw local HTTP request timed out."));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      socket.destroy();
      resolveResponse(response);
    };
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) finish();
    });
    socket.once("end", finish);
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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
  it("creates strong per-launch tokens and overwrites caller-supplied authorization", async () => {
    const first = createLocalMcpToken();
    const second = createLocalMcpToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    let authorization: string | null = null;
    const authenticated = createAuthenticatedFetch(first, async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response("ok");
    });
    await authenticated("http://127.0.0.1/mcp", { headers: { authorization: "Bearer attacker-value" } });
    expect(authorization).toBe(`Bearer ${first}`);
    expect(isStrongLocalMcpToken(first)).toBe(true);
    expect(isStrongLocalMcpToken("short-or-predictable")).toBe(false);
  });

  it("derives hosted ingress identity only through the configured valid proxy chain", () => {
    const request = {
      socket: { remoteAddress: "10.0.0.9" },
      headers: { "x-forwarded-for": "203.0.113.41, 10.0.0.8" },
    } as any;
    expect(trustedClientAddress(request, 0)).toBe("10.0.0.9");
    expect(trustedClientAddress(request, 1)).toBe("10.0.0.8");
    expect(trustedClientAddress(request, 2)).toBe("203.0.113.41");
    expect(trustedClientAddress({ ...request, headers: { "x-forwarded-for": "not-an-ip, 10.0.0.8" } } as any, 2)).toBe("10.0.0.9");
    expect(trustedClientAddress({ ...request, headers: { "x-forwarded-for": "203.0.113.41" } } as any, 2)).toBe("10.0.0.9");
  });

  it("accepts only canonical MCP targets and fails closed on mount aliases", () => {
    expect(mcpRequestTargetDisposition("/mcp")).toBe("canonical");
    expect(mcpRequestTargetDisposition("/mcp/?transport=streamable-http")).toBe("trailing-slash");
    for (const target of ["/MCP", "/mcp/session", "/mcp//", "/%6dcp", "/mcp%2Fsession", "/mcp%252Fsession", "/safe/%2e%2e/mcp", "/mcp\\session"]) {
      expect(mcpRequestTargetDisposition(target), target).toBe("invalid");
    }
    expect(mcpRequestTargetDisposition("/api/mcp")).toBe("other");
    expect(mcpRequestTargetDisposition("/mcp.example")).toBe("other");
  });

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
  }, 20_000);

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
          BLOCKWRIGHT_LOCAL_MCP_TOKEN: LOCAL_TEST_TOKEN,
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

      const unauthorizedBeforeBody = await rawHttpExchange(port, [
        "POST /mcp HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 1048576",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
      expect(unauthorizedBeforeBody).toMatch(/^HTTP\/1\.1 401 /);

      const absoluteFormTarget = await rawHttpExchange(port, [
        `POST http://localhost:${port}/mcp HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 1048576",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
      expect(absoluteFormTarget).toMatch(/^HTTP\/1\.1 400 /);

      const unauthorizedTrailingSlashBeforeBody = await rawHttpExchange(port, [
        "POST /mcp/ HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 1048576",
        "Connection: close",
        "",
        "",
      ].join("\r\n")).catch((error) => { throw new Error(`unauthenticated /mcp/: ${error instanceof Error ? error.message : String(error)}`); });
      expect(unauthorizedTrailingSlashBeforeBody).toMatch(/^HTTP\/1\.1 401 /);

      const unexpectedMcpSubpath = await rawHttpExchange(port, [
        "POST /mcp/session HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 1048576",
        "Connection: close",
        "",
        "",
      ].join("\r\n")).catch((error) => { throw new Error(`unexpected /mcp subpath: ${error instanceof Error ? error.message : String(error)}`); });
      expect(unexpectedMcpSubpath).toMatch(/^HTTP\/1\.1 404 /);

      const hostileHost = await rawHttpExchange(port, [
        "POST /mcp HTTP/1.1",
        "Host: attacker.example",
        `Authorization: Bearer ${LOCAL_TEST_TOKEN}`,
        "Content-Type: application/json",
        "Content-Length: 2",
        "Connection: close",
        "",
        "{}",
      ].join("\r\n"));
      expect(hostileHost).toMatch(/^HTTP\/1\.1 403 /);

      const hostileOrigin = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${LOCAL_TEST_TOKEN}`, origin: "https://attacker.example" },
        body: "{}",
      });
      expect(hostileOrigin.status).toBe(403);

      const authenticatedMcp = await fetch(`http://127.0.0.1:${port}/mcp/`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${LOCAL_TEST_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: "loopback-runtime-test", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "loopback-runtime-test", version: "1" } } }),
      });
      expect(authenticatedMcp.status).toBe(200);
      expect(await authenticatedMcp.json()).toMatchObject({ result: { serverInfo: { name: "blockwright", version: "0.7.0" } } });

      for (let attempt = 0; attempt < 70; attempt += 1) {
        const unguarded = await fetch(`http://127.0.0.1:${port}/not-an-ingress-route`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(unguarded.status).not.toBe(429);
        await unguarded.arrayBuffer();
      }
      for (let attempt = 0; attempt < 59; attempt += 1) {
        const guarded = await fetch(`http://127.0.0.1:${port}/api/not-a-route`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(guarded.status).not.toBe(429);
        await guarded.arrayBuffer();
      }
      const perClientLimited = await fetch(`http://127.0.0.1:${port}/api/not-a-route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(perClientLimited.status).toBe(429);
      expect(await perClientLimited.json()).toMatchObject({ error: expect.stringMatching(/this client/i) });

      for (const address of nonLoopbackIpv4Addresses()) {
        expect(await canConnect(address, port), `local production listener must not accept ${address}:${port}`).toBe(false);
      }
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 20_000);

  it("fails closed before listening when local production has no per-launch MCP token", async () => {
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      processHandle = spawn(process.execPath, [resolve(appRoot, "dist", "__entry.js")], {
        cwd: appRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          __PORT: String(port),
          PORT: String(port),
          BLOCKWRIGHT_HOSTED_MODE: "0",
          BLOCKWRIGHT_LOCAL_MCP_TOKEN: "",
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      await waitForExit(processHandle, 5_000);
      expect(processHandle.exitCode).not.toBe(0);
      expect(stderr).toMatch(/requires a private .* per-launch token/i);
      expect(await canConnect("127.0.0.1", port)).toBe(false);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGKILL");
      if (processHandle) await waitForExit(processHandle).catch(() => undefined);
    }
  }, 10_000);

  it("rejects production serverless adapters until durable hosted storage exists", () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright serverless durability "));
    const runServerless = (overrides: NodeJS.ProcessEnv) => spawnSync(process.execPath, [resolve(appRoot, "dist", "server.js")], {
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        VERCEL: "1",
        BLOCKWRIGHT_LOCAL_MCP_TOKEN: "",
        ...overrides,
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    });
    try {
      const disabled = runServerless({ BLOCKWRIGHT_HOSTED_MODE: "0" });
      expect(disabled.status).not.toBe(0);
      expect(disabled.stderr).toMatch(/requires a durable hosted data adapter.*persistent volume/i);
      const fullyConfigured = runServerless({
        BLOCKWRIGHT_HOSTED_MODE: "1",
        BLOCKWRIGHT_DATABASE_PATH: resolve(temporary, "hosted.sqlite"),
        BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "projects"),
        BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
        BLOCKWRIGHT_SESSION_SECRET: "serverless-session-secret-used-only-by-tests-1234567890",
        BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "serverless-review-pepper-used-only-by-tests-1234567890",
        BLOCKWRIGHT_OPERATOR_TOKEN: "serverless-operator-token-used-only-by-tests-1234567890",
        BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: "serverless-registration-key-used-only-by-tests-1234567890",
        BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
        BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1",
        STRIPE_SECRET_KEY: "",
        STRIPE_STUDIO_PRICE_ID: "",
      });
      expect(fullyConfigured.status).not.toBe(0);
      expect(fullyConfigured.stderr).toMatch(/requires a durable hosted data adapter.*persistent volume/i);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

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
        env: { ...process.env, NODE_ENV: "production", __PORT: String(port), PORT: String(port), BLOCKWRIGHT_DATA_DIR: dataRoot, BLOCKWRIGHT_LOCAL_MCP_TOKEN: LOCAL_TEST_TOKEN },
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

  it("does not expose readiness exception details to unauthenticated callers", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright readiness disclosure "));
    const dataRoot = resolve(temporary, "private-registry-path-do-not-expose");
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(appRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      writeFileSync(dataRoot, "this path is intentionally a file, not a registry directory");
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: { ...process.env, NODE_ENV: "production", __PORT: String(port), PORT: String(port), BLOCKWRIGHT_DATA_DIR: dataRoot, BLOCKWRIGHT_LOCAL_MCP_TOKEN: LOCAL_TEST_TOKEN },
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
      const responseText = await response?.text();
      expect(responseText).toBeTruthy();
      expect(JSON.parse(responseText ?? "{}")).toMatchObject({
        status: "not_ready",
        checks: { registry: { ok: false, code: "registry_unavailable" } },
      });
      expect(responseText).not.toMatch(/private-registry-path-do-not-expose|ENOTDIR|scandir|\"detail\"/i);
      expect(stderr).toMatch(/readiness diagnostic \(registry_unavailable\)/i);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("requires Studio before parsing hosted MCP JSON when billing is configured", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright paid MCP gate "));
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(bridgeRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
          __PORT: String(port),
          PORT: String(port),
          BLOCKWRIGHT_HOSTED_MODE: "1",
          BLOCKWRIGHT_DATABASE_PATH: resolve(temporary, "hosted", "blockwright.sqlite"),
          BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "hosted", "projects"),
          BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
          BLOCKWRIGHT_SESSION_SECRET: "paid-session-secret-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "paid-review-pepper-used-only-by-tests-1234567890",
          BLOCKWRIGHT_OPERATOR_TOKEN: "paid-operator-token-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: "paid-registration-key-used-only-by-tests-1234567890",
          BLOCKWRIGHT_SUPPORT_EMAIL: "support@blockwright.example",
          STRIPE_SECRET_KEY: "sk_test_blockwright_mcp_gate",
          STRIPE_STUDIO_PRICE_ID: "price_blockwright_studio_test",
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Paid hosted entry exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) });
          if (response.ok) break;
        } catch { /* listener not ready */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "free-mcp@example.test", password: "long-test-password-123", tenantName: "Free MCP", accessKey: "paid-registration-key-used-only-by-tests-1234567890" }),
      });
      expect(registration.status, `paid registration: ${await registration.clone().text()}`).toBe(201);
      const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", cookie: cookie! },
        body: "{",
      });
      expect(response.status).toBe(402);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringMatching(/Studio subscription/i) });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nPaid hosted stderr:\n${stderr}`);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("caps hosted build work per workspace before one tenant can exhaust the global budget", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright global build budget "));
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(bridgeRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
          __PORT: String(port),
          PORT: String(port),
          BLOCKWRIGHT_HOSTED_MODE: "1",
          BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1",
          BLOCKWRIGHT_DATABASE_PATH: resolve(temporary, "hosted", "blockwright.sqlite"),
          BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "hosted", "projects"),
          BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
          BLOCKWRIGHT_SESSION_SECRET: "work-session-secret-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "work-review-pepper-used-only-by-tests-1234567890",
          BLOCKWRIGHT_OPERATOR_TOKEN: "work-operator-token-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: "work-registration-key-used-only-by-tests-1234567890",
          BLOCKWRIGHT_SUPPORT_EMAIL: "support@blockwright.example",
          BLOCKWRIGHT_RATE_REQUESTS: "100",
          BLOCKWRIGHT_AUTH_RATE_REQUESTS: "10",
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Build-budget entry exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) });
          if (response.ok) break;
        } catch { /* listener not ready */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "build-budget@example.test", password: "long-test-password-123", tenantName: "Build Budget", accessKey: "work-registration-key-used-only-by-tests-1234567890" }),
      });
      expect(registration.status, `build-budget registration: ${await registration.clone().text()}`).toBe(201);
      const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", cookie: cookie! };
      const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: "global-build-init", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "global-build-budget-test", version: "1.0.0" } } }),
      });
      expect(initialize.status).toBe(200);
      const callTool = async (id: string, name: string, arguments_: Record<string, unknown>) => {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } }),
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<any>;
      };
      const firstCompile = await callTool("global-build-0", "compile_build", {
        name: "Global 0",
        edition: "java",
        version: "26.2",
        style: "nordic",
        dimensions: { width: 5, depth: 5, height: 5 },
        seed: "global-0",
      });
      expect(firstCompile.result?.isError, JSON.stringify(firstCompile)).not.toBe(true);
      const firstSummary = firstCompile.result?.structuredContent?.build;
      for (const [index, build] of [firstSummary, firstSummary.id, firstSummary].entries()) {
        const cachedValidation = await callTool(`global-build-cache-${index}`, "validate_build", { build });
        expect(cachedValidation.result?.isError, JSON.stringify(cachedValidation)).not.toBe(true);
        expect(cachedValidation.result?.structuredContent).toMatchObject({ buildId: firstSummary.id, hash: firstSummary.hash });
      }
      for (let index = 1; index <= 10; index += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `global-build-${index}`,
            method: "tools/call",
            params: { name: "compile_build", arguments: { name: `Global ${index}`, edition: "java", version: "26.2", style: "nordic", dimensions: { width: 5, depth: 5, height: 5 }, seed: `global-${index}` } },
          }),
        });
        expect(response.status).toBe(200);
        const payload = await response.json() as any;
        if (index < 10) expect(payload.result?.isError).not.toBe(true);
        else {
          expect(payload.result?.isError).toBe(true);
          expect(JSON.stringify(payload)).toMatch(/HOSTED_TENANT_BUILD_WORK_RATE_LIMITED/);
        }
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nBuild-budget stderr:\n${stderr}`);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 25_000);

  it("exposes only the bounded unauthenticated public connector and rejects excessive design work before generation", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright public connector "));
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(bridgeRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BLOCKWRIGHT_HOSTED_MODE: "0",
          BLOCKWRIGHT_PUBLIC_CONNECTOR_MODE: "1",
          BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
          BLOCKWRIGHT_LOCAL_MCP_TOKEN: "",
          BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "project-state"),
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
          BLOCKWRIGHT_RATE_REQUESTS: "100",
          BLOCKWRIGHT_AUTH_RATE_REQUESTS: "100",
          BLOCKWRIGHT_RATE_WINDOW_MS: "60000",
          __PORT: String(port),
          PORT: String(port),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      let listening = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Public connector exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) });
          if (response.ok) {
            listening = true;
            break;
          }
        } catch {
          // Startup probing is expected to fail until the listener binds.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      expect(listening, `Public connector did not become ready.\n${stderr}`).toBe(true);

      const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
      const postMcp = (body: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { ...mcpHeaders, ...headers },
        body: JSON.stringify(body),
      });
      const postMcpFromLocalAddress = (body: unknown, localAddress: string, headers: Record<string, string> = {}) => new Promise<Response>((resolveResponse, rejectResponse) => {
        const payload = JSON.stringify(body);
        const request = requestHttp({
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          localAddress,
          headers: { ...mcpHeaders, ...headers, "content-length": Buffer.byteLength(payload) },
        }, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.once("error", rejectResponse);
          response.once("end", () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
            }
            resolveResponse(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500, headers: responseHeaders }));
          });
        });
        request.once("error", rejectResponse);
        request.end(payload);
      });
      const expectPublicResponseHeaders = (response: Response) => {
        expect(response.headers.get("cache-control")).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/i);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("ratelimit-limit")).toMatch(/^\d+$/);
        expect(response.headers.get("ratelimit-remaining")).toMatch(/^\d+$/);
        expect(response.headers.get("ratelimit-reset")).toEqual(expect.any(String));
      };
      const callTool = async (id: string, name: string, arguments_: Record<string, unknown>, headers: Record<string, string> = {}) => {
        const response = await postMcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } }, headers);
        expect(response.status, `${id}: ${await response.clone().text()}`).toBe(200);
        expectPublicResponseHeaders(response);
        return response.json() as Promise<any>;
      };

      const initialized = await postMcp({
        jsonrpc: "2.0",
        id: "public-connector-init",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "public-connector-test", version: "1.0.0" } },
      });
      expect(initialized.status).toBe(200);
      expectPublicResponseHeaders(initialized);
      expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "blockwright", version: "0.7.0" } } });

      const listed = await postMcp({ jsonrpc: "2.0", id: "public-connector-tools", method: "tools/list", params: {} });
      expect(listed.status).toBe(200);
      expectPublicResponseHeaders(listed);
      const listedPayload = await listed.json() as any;
      const listedNames = (listedPayload.result?.tools ?? []).map(({ name }: { name: string }) => name).sort();
      const explicitPublicAllowlist = [
        "analyze_world_region",
        "audit_build",
        "compile_build",
        "estimate_build",
        "export_bedrock_project",
        "export_build",
        "generate_build_candidates",
        "get_build_chunk",
        "get_material_list",
        "get_style_profile",
        "get_supported_versions",
        "review_build",
        "revise_build",
        "search_blocks",
        "validate_build",
        "validate_build_contract",
      ];
      const expectedVisibleNames = explicitPublicAllowlist
        .filter((name) => name !== "get_build_chunk" || listedNames.includes(name))
        .sort();
      expect(listedNames).toEqual(expectedVisibleNames);
      for (const unavailable of [
        "check_java_updates",
        "create_delivery_bundle",
        "create_project",
        "delete_project",
        "discover_worlds",
        "import_schematic",
        "install_worldedit_schematic",
        "list_palettes",
        "render_build",
        "save_palette",
        "save_project_version",
        "sync_java_version",
      ]) {
        expect(listedNames, `${unavailable} must not be advertised by the public connector`).not.toContain(unavailable);
      }

      // Invalid arguments prove the method allowlist runs before the omitted
      // handler's schema or any project-store mutation can execute.
      const omitted = await callTool("public-connector-omitted", "create_project", {});
      expect(omitted.result?.isError).toBe(true);
      expect(JSON.stringify(omitted)).toMatch(/PUBLIC_CONNECTOR_TOOL_UNAVAILABLE.*create_project/);
      expect(JSON.stringify(omitted)).not.toMatch(/required|expected string/i);

      const sparseRequirement = "A thin platform spans the site";
      const sparseSpan = { start: 0, end: sparseRequirement.length, text: sparseRequirement };
      const sharedSessionHeaders = { "mcp-session-id": "caller-supplied-shared-session" };
      const sparseCompiled = await callTool("public-connector-sparse", "compile_build", {
        name: "Sparse Large Envelope",
        edition: "java",
        version: "26.2",
        style: "unfamiliar sparse geometry",
        sourceBrief: sparseRequirement,
        dimensions: { width: 256, depth: 32, height: 64 },
        features: [sparseRequirement],
        blockBudget: 20_000,
        seed: "public-connector-sparse",
        materialLibrary: { platform: "minecraft:stone" },
        design: {
          schemaVersion: 1,
          description: "A sparse generic operation inside an envelope whose volume exceeds the hosted placement cap.",
          requirements: [{
            id: "sparse-platform",
            text: sparseRequirement,
            elementIds: ["platform-surface"],
            claims: [{ id: "sparse-platform-extent", sourceSpan: sparseSpan, predicate: "extent", status: "asserted" }],
            assertions: [
              { claimId: "sparse-platform-extent", sourceSpan: sparseSpan, elementIds: ["platform-surface"], kind: "axis_span", axis: "x", minimum: 256 },
              { claimId: "sparse-platform-extent", sourceSpan: sparseSpan, elementIds: ["platform-surface"], kind: "axis_span", axis: "z", minimum: 32 },
            ],
          }],
          elements: [{
            id: "platform-surface",
            kind: "fill",
            intent: sparseRequirement,
            requirementIds: ["sparse-platform"],
            min: { x: 0, y: 0, z: 0 },
            max: { x: 255, y: 0, z: 31 },
            material: "platform",
          }],
        },
      }, sharedSessionHeaders);
      expect(sparseCompiled.result?.isError, JSON.stringify(sparseCompiled)).not.toBe(true);
      const sparseBuild = sparseCompiled.result?.structuredContent?.build;
      expect(256 * 32 * 64).toBeGreaterThan(250_000);
      expect(sparseBuild).toMatchObject({
        cacheRef: expect.stringMatching(/^bwc_[A-Za-z0-9_-]{32}\.bw_[a-f0-9]{12}$/),
        blockCount: 8_192,
        input: { dimensions: { width: 256, depth: 32, height: 64 } },
        preflight: { totalVolume: 524_288, estimatedPlacementAttempts: 8_192 },
      });

      const sparseReview = await callTool(
        "public-connector-review-paging",
        "review_build",
        { build: sparseBuild.cacheRef },
        sharedSessionHeaders,
      );
      expect(sparseReview.result?.isError, JSON.stringify(sparseReview)).not.toBe(true);
      const reviewSummary = sparseReview.result?._meta?.buildSummary;
      const initialReviewPage = sparseReview.result?._meta?.buildPage;
      expect(reviewSummary).toMatchObject({
        id: sparseBuild.id,
        cacheRef: expect.stringMatching(/^bwc_[A-Za-z0-9_-]{32}\.bw_[a-f0-9]{12}$/),
        blockCount: 8_192,
      });
      expect(initialReviewPage).toMatchObject({
        buildId: reviewSummary.cacheRef,
        offset: 0,
        returned: 500,
        total: 8_192,
      });

      const pageReferences: string[] = [];
      const reassembledReviewBuild = await loadBuildForView({
        summary: reviewSummary,
        initialPage: initialReviewPage,
        fetchPage: async ({ buildId, offset, limit }) => {
          pageReferences.push(buildId);
          const response = await callTool(
            `public-connector-review-page-${offset}`,
            "get_build_chunk",
            { build: buildId, offset, limit },
            sharedSessionHeaders,
          );
          expect(response.result?.isError, JSON.stringify(response)).not.toBe(true);
          return { ...response.result?.structuredContent, placements: response.result?._meta?.placements };
        },
      });
      expect(pageReferences).toEqual([reviewSummary.cacheRef, reviewSummary.cacheRef]);
      expect(reassembledReviewBuild).toMatchObject({ id: sparseBuild.id, hash: sparseBuild.hash });
      expect(reassembledReviewBuild.placements).toHaveLength(8_192);

      // Trust-proxy=0 must ignore a caller-controlled forwarding header. The
      // cached id therefore resolves under the same synthetic request principal.
      const cachedValidation = await callTool(
        "public-connector-cached-build",
        "validate_build",
        { build: sparseBuild.cacheRef },
        { ...sharedSessionHeaders, "x-forwarded-for": "203.0.113.77" },
      );
      expect(cachedValidation.result?.isError, JSON.stringify(cachedValidation)).not.toBe(true);
      expect(cachedValidation.result?.structuredContent).toMatchObject({ buildId: sparseBuild.id, hash: sparseBuild.hash });

      // Hosted proxies may terminate the external MCP session and use different
      // origin connections. The random cache capability—not a proxy address or
      // caller-controlled session header—therefore carries the bounded build.
      const crossIngress = await postMcpFromLocalAddress({
        jsonrpc: "2.0",
        id: "public-connector-cross-ingress",
        method: "tools/call",
        params: { name: "validate_build", arguments: { build: sparseBuild.cacheRef } },
      }, "127.0.0.2", sharedSessionHeaders);
      expect(crossIngress.status).toBe(200);
      expectPublicResponseHeaders(crossIngress);
      const crossIngressPayload = await crossIngress.json() as any;
      expect(crossIngressPayload.result?.isError, JSON.stringify(crossIngressPayload)).not.toBe(true);
      expect(crossIngressPayload.result?.structuredContent).toMatchObject({ buildId: sparseBuild.id, hash: sparseBuild.hash });

      // A deterministic build id is not a public cache capability, even when a
      // different client guesses it or supplies its own MCP session header.
      const crossSession = await callTool(
        "public-connector-cross-session",
        "validate_build",
        { build: sparseBuild.id },
        { "mcp-session-id": "different-caller-session" },
      );
      expect(crossSession.result?.isError).toBe(true);
      expect(JSON.stringify(crossSession)).toMatch(/VIEW_BUILD_CACHE_MISS/);

      const excessiveRequirement = "A dense volume occupies the site";
      const excessiveSpan = { start: 0, end: excessiveRequirement.length, text: excessiveRequirement };
      const rejectedAtPreflight = await callTool("public-connector-excessive-design", "compile_build", {
        name: "Excessive Generic Operation",
        edition: "java",
        version: "26.2",
        style: "unfamiliar dense geometry",
        sourceBrief: excessiveRequirement,
        dimensions: { width: 300, depth: 300, height: 50 },
        features: [excessiveRequirement],
        seed: "public-connector-excessive-design",
        materialLibrary: { volume: "minecraft:stone" },
        design: {
          schemaVersion: 1,
          description: "A valid generic request whose conservative coordinate-operation estimate exceeds the public runtime cap.",
          requirements: [{
            id: "dense-volume",
            text: excessiveRequirement,
            elementIds: ["dense-fill"],
            claims: [{ id: "dense-volume-extent", sourceSpan: excessiveSpan, predicate: "extent", status: "asserted" }],
            assertions: [
              { claimId: "dense-volume-extent", sourceSpan: excessiveSpan, elementIds: ["dense-fill"], kind: "axis_span", axis: "x", minimum: 300 },
              { claimId: "dense-volume-extent", sourceSpan: excessiveSpan, elementIds: ["dense-fill"], kind: "axis_span", axis: "y", minimum: 50 },
              { claimId: "dense-volume-extent", sourceSpan: excessiveSpan, elementIds: ["dense-fill"], kind: "axis_span", axis: "z", minimum: 300 },
            ],
          }],
          elements: [{
            id: "dense-fill",
            kind: "fill",
            intent: excessiveRequirement,
            requirementIds: ["dense-volume"],
            min: { x: 0, y: 0, z: 0 },
            max: { x: 299, y: 49, z: 299 },
            material: "volume",
          }],
        },
      });
      expect(rejectedAtPreflight.result?.isError).toBe(true);
      expect(JSON.stringify(rejectedAtPreflight)).toMatch(/HOSTED_BUILD_WORK_LIMIT_EXCEEDED.*4,500,000 coordinate operations/);
      expect(JSON.stringify(rejectedAtPreflight)).not.toMatch(/BUILD_PLACEMENT_LIMIT_EXCEEDED|generic design exceeded/);

      // Cache access is capability-scoped, but public work quotas remain
      // address-scoped so rotating an untrusted session header cannot evade
      // the ten-build tenant budget. The sparse compile above used unit one.
      for (let unit = 2; unit <= 11; unit += 1) {
        const rotated = await callTool(`public-connector-rotated-quota-${unit}`, "compile_build", {
          name: `Rotated Public Quota ${unit}`,
          edition: "java",
          version: "26.2",
          style: "nordic",
          dimensions: { width: 5, depth: 5, height: 5 },
          seed: `public-connector-rotated-quota-${unit}`,
        }, { "mcp-session-id": `rotated-caller-session-${unit}` });
        if (unit <= 10) expect(rotated.result?.isError, JSON.stringify(rotated)).not.toBe(true);
        else {
          expect(rotated.result?.isError).toBe(true);
          expect(JSON.stringify(rotated)).toMatch(/HOSTED_TENANT_BUILD_WORK_RATE_LIMITED/);
        }
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nPublic connector stderr:\n${stderr}`);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  it("authenticates, rate-limits, and bounds work before hosted MCP dispatch", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "Blockwright hosted MCP guard "));
    const port = await unusedPort();
    let processHandle: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      cpSync(resolve(bridgeRoot, "dist"), resolve(temporary, "dist"), { recursive: true });
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(temporary, "node_modules"), "junction");
      processHandle = spawn(process.execPath, [resolve(temporary, "dist", "__entry.js")], {
        cwd: temporary,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BLOCKWRIGHT_TRUST_PROXY_HOPS: "0",
          __PORT: String(port),
          PORT: String(port),
          BLOCKWRIGHT_HOSTED_MODE: "1",
          BLOCKWRIGHT_ALLOW_UNBILLED_HOSTED_DEVELOPMENT: "1",
          BLOCKWRIGHT_DATABASE_PATH: resolve(temporary, "hosted", "blockwright.sqlite"),
          BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "hosted", "projects"),
          BLOCKWRIGHT_PUBLIC_URL: "https://blockwright.example",
          BLOCKWRIGHT_SESSION_SECRET: "hosted-session-secret-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REVIEW_TOKEN_PEPPER: "hosted-review-pepper-used-only-by-tests-1234567890",
          BLOCKWRIGHT_OPERATOR_TOKEN: "hosted-operator-token-used-only-by-tests-1234567890",
          BLOCKWRIGHT_REGISTRATION_ACCESS_KEY: "hosted-registration-key-used-only-by-tests-1234567890",
          BLOCKWRIGHT_SUPPORT_EMAIL: "support@blockwright.example",
          // Leave room for bounded paging/cache assertions, then exhaust this
          // budget explicitly at the end of the test.
          BLOCKWRIGHT_RATE_REQUESTS: "50",
          BLOCKWRIGHT_AUTH_RATE_REQUESTS: "2",
          BLOCKWRIGHT_RATE_WINDOW_MS: "60000",
          BLOCKWRIGHT_DATA_DIR: resolve(bridgeRoot, "data", "java"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (processHandle.exitCode !== null) throw new Error(`Hosted entry exited early (${processHandle.exitCode}): ${stderr}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) });
          if (response.ok) break;
        } catch {
          // Startup probing is expected to fail until the listener binds.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }

      const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
      const initializeBody = {
        jsonrpc: "2.0",
        id: "hosted-init",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hosted-guard-test", version: "1.0.0" } },
      };
      const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: mcpHeaders, body: JSON.stringify(initializeBody) });
      expect(unauthorized.status).toBe(401);
      expect(await unauthorized.json()).toMatchObject({ ok: false, error: expect.stringMatching(/sign in/i) });
      const unauthorizedTrailingSlash = await rawHttpExchange(port, [
        "POST /mcp/ HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 1048576",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
      expect(unauthorizedTrailingSlash).toMatch(/^HTTP\/1\.1 401 /);
      const unauthorizedRateLimited = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify({ ...initializeBody, id: "hosted-unauthorized-rate-limit" }),
      });
      expect(unauthorizedRateLimited.status).toBe(429);
      expect(await unauthorizedRateLimited.json()).toMatchObject({ ok: false, error: expect.stringMatching(/too many/i), resetAt: expect.any(String) });

      const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "hosted-mcp@example.test", password: "long-test-password-123", tenantName: "Hosted MCP Test", accessKey: "hosted-registration-key-used-only-by-tests-1234567890" }),
      });
      expect(registration.status, `hosted guard registration: ${await registration.clone().text()}`).toBe(201);
      const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toMatch(/^bw_session=/);
      const primaryAuthenticatedHeaders = { ...mcpHeaders, cookie: cookie! };
      let authenticatedHeaders = primaryAuthenticatedHeaders;
      const postMcp = (body: unknown) => fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: authenticatedHeaders, body: JSON.stringify(body) });
      const callHostedTool = async (id: string, name: string, arguments_: Record<string, unknown>) => {
        const response = await postMcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } });
        expect(response.status, `${id}: ${await response.clone().text()}`).toBe(200);
        return response.json() as Promise<any>;
      };

      const oversizedTrailingSlash = await rawHttpExchange(port, [
        "POST /mcp/ HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Cookie: ${cookie}`,
        "Content-Type: application/json",
        "Content-Length: 999999999",
        "Connection: close",
        "",
        "",
      ].join("\r\n"), 2_000);
      expect(oversizedTrailingSlash).toMatch(/^HTTP\/1\.1 413 /);

      const incompleteTrailingSlash = await rawHttpExchange(port, [
        "POST /mcp/ HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Cookie: ${cookie}`,
        "Content-Type: application/json",
        "Content-Length: 64",
        "Connection: close",
        "",
        "{",
      ].join("\r\n"), 12_000);
      expect(incompleteTrailingSlash).toMatch(/^HTTP\/1\.1 408 /);

      const initialized = await postMcp(initializeBody);
      expect(initialized.status).toBe(200);
      expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "blockwright", version: "0.7.0" } } });

      const excessiveCandidates = await postMcp({
        jsonrpc: "2.0",
        id: "hosted-candidates",
        method: "tools/call",
        params: { name: "generate_build_candidates", arguments: { name: "Candidates", edition: "java", version: "26.2", style: "nordic", dimensions: { width: 9, depth: 9, height: 9 }, candidateCount: 3 } },
      });
      expect(excessiveCandidates.status).toBe(200);
      expect(JSON.stringify(await excessiveCandidates.json())).toMatch(/HOSTED_CANDIDATE_LIMIT_EXCEEDED/);

      const boundedCandidatesResponse = await postMcp({
        jsonrpc: "2.0",
        id: "hosted-bounded-candidate",
        method: "tools/call",
        params: { name: "generate_build_candidates", arguments: { name: "Bounded Candidate", edition: "java", version: "26.2", style: "nordic", dimensions: { width: 9, depth: 9, height: 9 }, candidateCount: 1 } },
      });
      expect(boundedCandidatesResponse.status).toBe(200);
      const boundedCandidates = await boundedCandidatesResponse.json() as any;
      expect(boundedCandidates.result?.isError, JSON.stringify(boundedCandidates)).not.toBe(true);
      const candidateSummary = boundedCandidates.result?.structuredContent?.candidates?.[0]?.build;
      expect(candidateSummary?.placements).toBeUndefined();
      expect(boundedCandidates.result?._meta?.builds).toBeUndefined();
      expect(boundedCandidates.result?._meta?.candidates?.[0]?.buildSummary).toMatchObject({ id: candidateSummary.id, hash: candidateSummary.hash });
      expect(boundedCandidates.result?._meta?.candidates?.[0]?.buildPage?.returned).toBeLessThanOrEqual(500);
      expect(boundedCandidates.result?._meta?.candidates?.[0]?.buildPage?.placements).toHaveLength(boundedCandidates.result?._meta?.candidates?.[0]?.buildPage?.returned);
      const cachedCandidate = await callHostedTool("hosted-candidate-cache", "validate_build", { build: candidateSummary.id });
      expect(cachedCandidate.result?.isError, JSON.stringify(cachedCandidate)).not.toBe(true);
      expect(cachedCandidate.result?.structuredContent).toMatchObject({ buildId: candidateSummary.id, hash: candidateSummary.hash });

      const excessiveBuild = await postMcp({
        jsonrpc: "2.0",
        id: "hosted-build-cap",
        method: "tools/call",
        params: { name: "compile_build", arguments: { name: "Excessive Hosted Span", edition: "java", version: "26.2", style: "nordic", dimensions: { width: 513, depth: 5, height: 5 } } },
      });
      expect(excessiveBuild.status).toBe(200);
      expect(JSON.stringify(await excessiveBuild.json())).toMatch(/HOSTED_BUILD_SPAN_LIMIT_EXCEEDED/);

      const localPalette = await postMcp({ jsonrpc: "2.0", id: "hosted-local-palette", method: "tools/call", params: { name: "list_palettes", arguments: {} } });
      expect(localPalette.status).toBe(200);
      expect(JSON.stringify(await localPalette.json())).toMatch(/LOCAL_OPERATION_UNAVAILABLE/);
      const localProjectMutation = await postMcp({ jsonrpc: "2.0", id: "hosted-local-project", method: "tools/call", params: { name: "create_project", arguments: { name: "Must not use process-local tenant storage" } } });
      expect(localProjectMutation.status).toBe(200);
      expect(JSON.stringify(await localProjectMutation.json())).toMatch(/LOCAL_OPERATION_UNAVAILABLE/);

      const compileHostedBuild = async (
        id: string,
        name: string,
        dimensions: { width: number; depth: number; height: number },
        overrides: Record<string, unknown> = {},
      ) => {
        const response = await postMcp({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "compile_build", arguments: { name, edition: "java", version: "26.2", style: "nordic", dimensions, seed: id, ...overrides } },
        });
        expect(response.status, `${id}: ${await response.clone().text()}`).toBe(200);
        return response.json() as Promise<any>;
      };
      const largeRequirement = "Retain a canonical volume to exercise the hosted import placement limit";
      const largeCompiled = await compileHostedBuild(
        "hosted-large-import-compile",
        "Hosted Import Envelope",
        { width: 100, depth: 100, height: 25 },
        {
          sourceBrief: largeRequirement,
          blockBudget: 150_000,
          materialLibrary: { canonical_volume: "minecraft:stone" },
          design: {
            schemaVersion: 1,
            description: "Explicit generic geometry fixture; a large legacy shell request must still fail closed.",
            requirements: [{
              id: "large-canonical-volume",
              text: largeRequirement,
              elementIds: ["large-canonical-fill"],
              claims: [{ id: "large-canonical-volume-claim", sourceSpan: { start: 0, end: largeRequirement.length, text: largeRequirement }, predicate: "extent", status: "asserted" }],
              assertions: [
                { claimId: "large-canonical-volume-claim", sourceSpan: { start: 0, end: largeRequirement.length, text: largeRequirement }, elementIds: ["large-canonical-fill"], kind: "placement_count", minimum: 100_001 },
                { claimId: "large-canonical-volume-claim", sourceSpan: { start: 0, end: largeRequirement.length, text: largeRequirement }, elementIds: ["large-canonical-fill"], kind: "axis_span", axis: "x", minimum: 16 },
                { claimId: "large-canonical-volume-claim", sourceSpan: { start: 0, end: largeRequirement.length, text: largeRequirement }, elementIds: ["large-canonical-fill"], kind: "axis_span", axis: "z", minimum: 16 },
              ],
            }],
            elements: [{
              id: "large-canonical-fill",
              kind: "fill",
              intent: largeRequirement,
              requirementIds: ["large-canonical-volume"],
              min: { x: 0, y: 0, z: 0 },
              max: { x: 99, y: 10, z: 99 },
              material: "canonical_volume",
            }],
          },
        },
      );
      expect(largeCompiled.result?.isError, JSON.stringify(largeCompiled)).not.toBe(true);
      const largeBuildSummary = largeCompiled.result?.structuredContent?.build;
      expect(largeBuildSummary.blockCount).toBe(110_000);
      expect(largeCompiled.result?._meta).toBeUndefined();
      const hostedBuildPage = await callHostedTool("hosted-build-page", "get_build_chunk", { build: largeBuildSummary.id, offset: 0, limit: 5_000 });
      expect(hostedBuildPage.result?.isError, JSON.stringify(hostedBuildPage)).not.toBe(true);
      expect(hostedBuildPage.result?.structuredContent).toMatchObject({ buildId: largeBuildSummary.id, offset: 0, total: largeBuildSummary.blockCount });
      expect(hostedBuildPage.result?._meta?.placements).toHaveLength(hostedBuildPage.result?.structuredContent?.returned);
      const cachedIdAccepted = await callHostedTool("hosted-build-id-accept", "validate_build", { build: largeBuildSummary.id });
      expect(cachedIdAccepted.result?.isError, JSON.stringify(cachedIdAccepted)).not.toBe(true);
      expect(cachedIdAccepted.result?.structuredContent).toMatchObject({ buildId: largeBuildSummary.id, hash: largeBuildSummary.hash });
      const hostedRenderPage = await callHostedTool("hosted-render-page", "render_build", { build: largeBuildSummary.id, offset: 3, limit: 17 });
      expect(hostedRenderPage.result?.isError, JSON.stringify(hostedRenderPage)).not.toBe(true);
      expect(hostedRenderPage.result?.structuredContent).toMatchObject({ buildId: largeBuildSummary.id, offset: 3, returned: 17, total: largeBuildSummary.blockCount, count: 17 });
      expect(hostedRenderPage.result?._meta?.placements).toHaveLength(17);
      const oversizedHostedArtifact = await callHostedTool("hosted-artifact-output-cap", "export_build", { build: largeBuildSummary.id, format: "json" });
      expect(oversizedHostedArtifact.result?.isError).toBe(true);
      expect(JSON.stringify(oversizedHostedArtifact), JSON.stringify(oversizedHostedArtifact)).toMatch(/HOSTED_ARTIFACT_OUTPUT_LIMIT_EXCEEDED/);
      const largeExport = await callHostedTool("hosted-large-import-export", "export_build", { build: largeBuildSummary, format: "litematic" });
      expect(largeExport.result?.isError, JSON.stringify(largeExport)).not.toBe(true);
      const largeImport = await callHostedTool("hosted-large-import-reject", "import_schematic", { base64: largeExport.result?._meta?.base64, format: "litematic" });
      expect(largeImport.result?.isError, JSON.stringify(largeImport)).toBe(true);
      expect(JSON.stringify(largeImport)).toMatch(/HOSTED_IMPORT_LIMIT_EXCEEDED|100,000-block/i);

      const secondaryRegistration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "hosted-mcp-secondary@example.test", password: "long-test-password-456", tenantName: "Hosted MCP Secondary", accessKey: "hosted-registration-key-used-only-by-tests-1234567890" }),
      });
      expect(secondaryRegistration.status, `secondary registration: ${await secondaryRegistration.clone().text()}`).toBe(201);
      const secondaryCookie = secondaryRegistration.headers.get("set-cookie")?.split(";", 1)[0];
      expect(secondaryCookie).toMatch(/^bw_session=/);
      authenticatedHeaders = { ...mcpHeaders, cookie: secondaryCookie! };

      const crossTenantBuildPage = await callHostedTool("hosted-cross-tenant-build-page", "get_build_chunk", { build: largeBuildSummary.id, offset: 0, limit: 1 });
      expect(crossTenantBuildPage.result?.isError).toBe(true);
      expect(JSON.stringify(crossTenantBuildPage)).toMatch(/VIEW_BUILD_CACHE_MISS|reopen/i);
      const crossTenantBuildId = await callHostedTool("hosted-cross-tenant-build-id", "validate_build", { build: largeBuildSummary.id });
      expect(crossTenantBuildId.result?.isError).toBe(true);
      expect(JSON.stringify(crossTenantBuildId)).toMatch(/VIEW_BUILD_CACHE_MISS|reopen/i);
      const invalidHostedImport = await callHostedTool("hosted-invalid-import", "import_schematic", {
        base64: Buffer.from("attacker-private-region-name").toString("base64"),
        format: "litematic",
      });
      expect(invalidHostedImport.result?.isError).toBe(true);
      expect(JSON.stringify(invalidHostedImport)).toMatch(/HOSTED_IMPORT_INVALID/);
      expect(JSON.stringify(invalidHostedImport)).not.toMatch(/attacker-private-region-name|NBT|gzip/i);
      const secondaryReview = await callHostedTool("hosted-secondary-review", "review_build", { build: largeBuildSummary });
      expect(secondaryReview.result?.isError, JSON.stringify(secondaryReview)).not.toBe(true);
      expect(secondaryReview.result?._meta?.build).toBeUndefined();
      expect(secondaryReview.result?._meta?.buildSummary).toMatchObject({ id: largeBuildSummary.id, hash: largeBuildSummary.hash });
      const secondaryReviewPage = await callHostedTool("hosted-secondary-review-page", "get_build_chunk", { build: largeBuildSummary.id, offset: 0, limit: 1 });
      expect(secondaryReviewPage.result?.isError, JSON.stringify(secondaryReviewPage)).not.toBe(true);
      expect(secondaryReviewPage.result?._meta?.placements).toHaveLength(1);

      authenticatedHeaders = primaryAuthenticatedHeaders;
      const smallCompiled = await compileHostedBuild("hosted-small-import-compile", "Hosted Summary Import", { width: 9, depth: 9, height: 9 });
      expect(smallCompiled.result?.isError, JSON.stringify(smallCompiled)).not.toBe(true);
      expect(smallCompiled.result?._meta).toBeUndefined();
      const smallBuildSummary = smallCompiled.result?.structuredContent?.build;
      const smallBuildPlacements: any[] = [];
      while (smallBuildPlacements.length < smallBuildSummary.blockCount) {
        const offset = smallBuildPlacements.length;
        const page = await callHostedTool(`hosted-small-build-page-${offset}`, "get_build_chunk", { build: smallBuildSummary.id, offset, limit: 5_000 });
        expect(page.result?.isError, JSON.stringify(page)).not.toBe(true);
        expect(page.result?.structuredContent).toMatchObject({ buildId: smallBuildSummary.id, offset, total: smallBuildSummary.blockCount });
        smallBuildPlacements.push(...page.result?._meta?.placements ?? []);
      }
      const smallBuild = { ...smallBuildSummary, placements: smallBuildPlacements };
      expect(smallBuild.placements).toHaveLength(smallBuild.blockCount);
      const revisionTarget = smallBuild.placements.find((placement: any) => !placement.blockEntity);
      const oversizedPlacementMetadata = await callHostedTool("hosted-region-metadata-reject", "revise_build", {
        build: smallBuildSummary.id,
        region: { min: { x: revisionTarget.x, y: revisionTarget.y, z: revisionTarget.z }, max: { x: revisionTarget.x, y: revisionTarget.y, z: revisionTarget.z } },
        replacementPlacements: [{ ...revisionTarget, phase: "x".repeat(129) }],
      });
      expect(oversizedPlacementMetadata.result?.isError).toBe(true);
      const oversizedRegionRevision = await callHostedTool("hosted-region-envelope-reject", "revise_build", {
        build: smallBuildSummary.id,
        region: { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 50 } },
        replacementPlacements: [{ ...revisionTarget }],
      });
      expect(oversizedRegionRevision.result?.isError).toBe(true);
      expect(JSON.stringify(oversizedRegionRevision)).toMatch(/HOSTED_REVISION_LIMIT_EXCEEDED/);
      const hostedRegionalRevision = await callHostedTool("hosted-region-revise", "revise_build", {
        build: smallBuildSummary.id,
        region: { min: { x: revisionTarget.x, y: revisionTarget.y, z: revisionTarget.z }, max: { x: revisionTarget.x, y: revisionTarget.y, z: revisionTarget.z } },
        replacementPlacements: [{ ...revisionTarget, phase: `${revisionTarget.phase}-hosted-test` }],
      });
      expect(hostedRegionalRevision.result?.isError, JSON.stringify(hostedRegionalRevision)).not.toBe(true);
      const hostedRegionalBuild = hostedRegionalRevision.result?.structuredContent?.build;
      expect(hostedRegionalBuild?.placements).toBeUndefined();
      expect(hostedRegionalRevision.result?._meta?.build).toBeUndefined();
      expect(hostedRegionalRevision.result?._meta?.buildSummary).toMatchObject({ id: hostedRegionalBuild.id, hash: hostedRegionalBuild.hash });
      expect(hostedRegionalRevision.result?._meta?.buildPage?.returned).toBeLessThanOrEqual(500);
      expect(hostedRegionalRevision.result?._meta?.diff).toMatchObject({ addedCount: 0, removedCount: 0, changedCount: 1 });
      expect(hostedRegionalRevision.result?._meta?.diff?.added).toBeUndefined();
      expect(hostedRegionalRevision.result?._meta?.diff?.removed).toBeUndefined();
      expect(hostedRegionalRevision.result?._meta?.diff?.changed).toBeUndefined();
      const hostedRegionalMaterials = await callHostedTool("hosted-region-materials", "get_material_list", { build: hostedRegionalBuild.id });
      expect(hostedRegionalMaterials.result?.isError, JSON.stringify(hostedRegionalMaterials)).not.toBe(true);
      expect(hostedRegionalMaterials.result?.structuredContent).toMatchObject({ buildHash: hostedRegionalBuild.hash });

      const hostedOrigin = "https://blockwright.example";
      const hostedProjectResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie!, origin: hostedOrigin },
        body: JSON.stringify({ name: "Verified delivery project", build: hostedRegionalBuild }),
      });
      expect(hostedProjectResponse.status, `hosted project: ${await hostedProjectResponse.clone().text()}`).toBe(201);
      const hostedProject = await hostedProjectResponse.json() as any;
      const hostedProjectId = hostedProject.project?.project?.id;
      const hostedVersionId = hostedProject.project?.head?.id;
      const reviewLinkResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${hostedProjectId}/review-links`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie!, origin: hostedOrigin },
        body: JSON.stringify({ versionId: hostedVersionId, expiresInSeconds: 3600 }),
      });
      expect(reviewLinkResponse.status, `review link: ${await reviewLinkResponse.clone().text()}`).toBe(201);
      const reviewLink = await reviewLinkResponse.json() as any;
      const reviewToken = new URL(reviewLink.link.url).hash.slice("#review=".length);
      const reviewDecisionResponse = await fetch(`http://127.0.0.1:${port}/api/review/${reviewToken}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: hostedOrigin },
        body: JSON.stringify({ actorId: "Client reviewer", decision: "approved", comment: "Approved exact hash" }),
      });
      expect(reviewDecisionResponse.status, `review decision: ${await reviewDecisionResponse.clone().text()}`).toBe(201);
      const verifiedDelivery = await callHostedTool("hosted-verified-delivery", "create_delivery_bundle", { build: hostedRegionalBuild, format: "schem", reviewToken });
      expect(verifiedDelivery.result?.isError, JSON.stringify(verifiedDelivery)).not.toBe(true);
      expect(verifiedDelivery.result?._meta?.manifest?.files).toEqual(expect.arrayContaining([expect.objectContaining({ name: "review-approval.json" })]));

      const smallExport = await callHostedTool("hosted-small-import-export", "export_build", { build: hostedRegionalBuild, format: "litematic" });
      expect(smallExport.result?.isError, JSON.stringify(smallExport)).not.toBe(true);
      const smallImport = await callHostedTool("hosted-small-import-summary", "import_schematic", { base64: smallExport.result?._meta?.base64, format: "litematic" });
      expect(smallImport.result?.isError, JSON.stringify(smallImport)).not.toBe(true);
      expect(smallImport.result?.structuredContent).toMatchObject({ format: "litematic", placementsIncluded: false, blockCount: hostedRegionalBuild.blockCount });
      expect(smallImport.result?._meta).toMatchObject({ placementsOmitted: true, placementCount: hostedRegionalBuild.blockCount });
      expect(smallImport.result?._meta?.placements).toBeUndefined();
      expect(smallImport.result?._meta?.metadata).toBeUndefined();
      expect(smallImport.result?._meta?.regions).toBeUndefined();

      const hostedWholeRevision = await callHostedTool("hosted-whole-revise", "revise_build", {
        build: hostedRegionalBuild.id,
        changes: { seed: "hosted-whole-revision" },
      });
      expect(hostedWholeRevision.result?.isError, JSON.stringify(hostedWholeRevision)).not.toBe(true);
      expect(hostedWholeRevision.result?.structuredContent).toMatchObject({ mode: "whole_build", previousHash: hostedRegionalBuild.hash, build: { id: expect.any(String), hash: expect.any(String) } });
      expect(hostedWholeRevision.result?.structuredContent?.build?.placements).toBeUndefined();
      expect(hostedWholeRevision.result?._meta?.build).toBeUndefined();
      expect(hostedWholeRevision.result?._meta?.buildSummary).toMatchObject({ id: hostedWholeRevision.result?.structuredContent?.build?.id });
      expect(hostedWholeRevision.result?._meta?.buildPage?.returned).toBeLessThanOrEqual(500);

      let rateLimited: Response | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await postMcp({ ...initializeBody, id: `hosted-rate-limit-${attempt}` });
        if (response.status === 429) {
          rateLimited = response;
          break;
        }
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
      expect(rateLimited?.status).toBe(429);
      expect(await rateLimited?.json()).toMatchObject({ ok: false, error: expect.stringMatching(/too many/i), resetAt: expect.any(String) });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nHosted stderr:\n${stderr}`);
    } finally {
      if (processHandle?.exitCode === null) processHandle.kill("SIGTERM");
      if (processHandle) await waitForExit(processHandle).catch(() => processHandle?.kill("SIGKILL"));
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 30_000);

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
      cpSync(resolve(bridgeRoot, "dist"), resolve(app, "dist"), { recursive: true });
      const runtimePackage = JSON.parse(readFileSync(resolve(bridgeRoot, "app", "package.json"), "utf8"));
      const builtServer = readFileSync(resolve(bridgeRoot, "dist", "server.js"), "utf8");
      const runtimeVersion = /const APP_VERSION = "([^"]+)"/.exec(builtServer)?.[1];
      if (!runtimeVersion) throw new Error("Could not read the built Blockwright version for the bridge fixture.");
      runtimePackage.version = runtimeVersion;
      writeFileSync(resolve(app, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
      cpSync(resolve(bridgeRoot, "mcp", "server.mjs"), resolve(mcp, "server.mjs"));
      symlinkSync(resolve(bridgeRoot, "node_modules"), resolve(app, "node_modules"), "junction");
      symlinkSync(resolve(bridgeRoot, "data", "java"), resolve(app, "data", "java"), "junction");

      processHandle = spawn(process.execPath, [resolve(mcp, "server.mjs")], {
        cwd: temporary,
        env: {
          ...process.env,
          BLOCKWRIGHT_HOSTED_MODE: "0",
          BLOCKWRIGHT_PROJECT_ROOT: resolve(temporary, "project-state"),
        },
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
      expect(tools.result?.tools).toHaveLength(38);
      expect(tools.result?.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "validate_build_contract",
          title: "Validate Build Contract",
          inputSchema: expect.objectContaining({ properties: expect.objectContaining({ build: expect.any(Object), contract: expect.any(Object) }) }),
          outputSchema: expect.objectContaining({ properties: expect.objectContaining({ contract: expect.any(Object) }) }),
        }),
      ]));
      const assertInputPropertyDescriptions = (schema: any, toolName: string, path = "inputSchema") => {
        if (!schema || typeof schema !== "object") return;
        if (schema.properties && typeof schema.properties === "object") {
          for (const [propertyName, propertySchema] of Object.entries(schema.properties) as [string, any][]) {
            const propertyPath = `${path}.${propertyName}`;
            expect(
              typeof propertySchema.description === "string" && propertySchema.description.trim().length > 0,
              `${toolName} ${propertyPath} should have a useful description`,
            ).toBe(true);
            assertInputPropertyDescriptions(propertySchema, toolName, propertyPath);
          }
        }
        if (schema.items) assertInputPropertyDescriptions(schema.items, toolName, `${path}[]`);
        for (const unionKey of ["anyOf", "oneOf", "allOf"] as const) {
          if (Array.isArray(schema[unionKey])) {
            schema[unionKey].forEach((branch: any, index: number) => assertInputPropertyDescriptions(branch, toolName, `${path}<${unionKey}:${index}>`));
          }
        }
        if (schema.$defs && typeof schema.$defs === "object") {
          for (const [definitionName, definition] of Object.entries(schema.$defs)) {
            assertInputPropertyDescriptions(definition, toolName, `${path}<$defs:${definitionName}>`);
          }
        }
      };

      for (const tool of tools.result?.tools ?? []) {
        expect(tool, `${tool.name} should expose the complete MCP presentation contract`).toMatchObject({
          name: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
          inputSchema: expect.objectContaining({ type: "object" }),
          annotations: expect.objectContaining({
            title: tool.title,
            readOnlyHint: expect.any(Boolean),
            openWorldHint: expect.any(Boolean),
            destructiveHint: expect.any(Boolean),
          }),
          _meta: expect.objectContaining({
            "openai/toolInvocation/invoking": expect.any(String),
            "openai/toolInvocation/invoked": expect.any(String),
          }),
        });
        assertInputPropertyDescriptions(tool.inputSchema, tool.name);
      }
      const professionalToolNames = [
        "create_project",
        "list_projects",
        "get_project",
        "save_project_version",
        "diff_project_versions",
        "restore_project_version",
        "delete_project",
        "get_material_list",
        "create_delivery_bundle",
      ];
      for (const name of professionalToolNames) {
        const tool = tools.result?.tools.find((candidate: any) => candidate.name === name);
        expect(tool, `${name} should be advertised`).toBeDefined();
      }
      expect(tools.result?.tools.find((candidate: any) => candidate.name === "revise_build")?.inputSchema?.properties).toEqual(expect.objectContaining({ changes: expect.any(Object), region: expect.any(Object), replacementPlacements: expect.any(Object) }));
      expect(tools.result?.tools.find((candidate: any) => candidate.name === "export_build")?.inputSchema?.properties?.format?.enum).toContain("litematic");
      expect(tools.result?.tools.find((candidate: any) => candidate.name === "import_schematic")?.inputSchema?.properties?.format?.enum).toEqual(["auto", "schem", "litematic"]);
      const deliveryInputProperties = tools.result?.tools.find((candidate: any) => candidate.name === "create_delivery_bundle")?.inputSchema?.properties;
      expect(deliveryInputProperties).toEqual(expect.objectContaining({ reviewToken: expect.any(Object) }));
      expect(deliveryInputProperties?.reviewApproval).toBeUndefined();
      const compileTool = tools.result?.tools.find((candidate: any) => candidate.name === "compile_build");
      const reviewTool = tools.result?.tools.find((candidate: any) => candidate.name === "review_build");
      const exportTool = tools.result?.tools.find((candidate: any) => candidate.name === "export_build");
      const bedrockProjectTool = tools.result?.tools.find((candidate: any) => candidate.name === "export_bedrock_project");
      expect(compileTool?.description).toMatch(/never opens a webpage or 3D viewer/i);
      expect(compileTool?._meta?.["ui/resourceUri"]).toBeUndefined();
      expect(compileTool?._meta?.ui?.resourceUri).toBeUndefined();
      expect(reviewTool?._meta?.["ui/resourceUri"]).toEqual(expect.stringContaining("review-build"));
      expect(reviewTool?._meta?.ui?.resourceUri).toEqual(expect.stringContaining("review-build"));
      expect(bedrockProjectTool?.description).toMatch(/one or more non-overlapping.*\.mcpack/i);
      expect(exportTool?._meta?.["ui/resourceUri"]).toBeUndefined();
      expect(exportTool?._meta?.ui?.resourceUri).toBeUndefined();
      expect(bedrockProjectTool?._meta?.["ui/resourceUri"]).toEqual(expect.stringContaining("export-bedrock-project"));
      expect(bedrockProjectTool?._meta?.ui?.resourceUri).toEqual(bedrockProjectTool?._meta?.["ui/resourceUri"]);
      processHandle.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "bedrock-download-view-resource",
        method: "resources/read",
        params: { uri: bedrockProjectTool?._meta?.ui?.resourceUri },
      })}\n`);
      const bedrockDownloadView = await waitForMessage(messages, ({ id }) => id === "bedrock-download-view-resource");
      expect(bedrockDownloadView.result?.contents?.[0]).toMatchObject({
        uri: bedrockProjectTool?._meta?.ui?.resourceUri,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("export-bedrock-project"),
        _meta: expect.objectContaining({
          ui: expect.objectContaining({
            description: expect.stringMatching(/\.mcpack download card/i),
            prefersBorder: true,
          }),
        }),
      });
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
      expect(compiled.result?._meta).toBeUndefined();
      expect(JSON.stringify(compiled)).not.toMatch(/viewUUID/);

      const chunkProbe = await callTool("build-chunk-probe", "get_build_chunk", { build: build.id, offset: 0, limit: 7 });
      expect(chunkProbe.result?.isError).not.toBe(true);
      expect(chunkProbe.result?.structuredContent).toMatchObject({ buildId: build.id, offset: 0, total: build.blockCount, returned: Math.min(7, build.blockCount) });
      expect(chunkProbe.result?._meta?.placements).toHaveLength(Math.min(7, build.blockCount));

      const canonicalPlacements: any[] = [];
      while (canonicalPlacements.length < build.blockCount) {
        const offset = canonicalPlacements.length;
        const page = await callTool(`build-chunk-${offset}`, "get_build_chunk", { build: build.id, offset, limit: 5_000 });
        expect(page.result?.isError, JSON.stringify(page)).not.toBe(true);
        expect(page.result?.structuredContent).toMatchObject({ buildId: build.id, offset, total: build.blockCount });
        expect(page.result?._meta?.placements).toHaveLength(page.result?.structuredContent?.returned);
        canonicalPlacements.push(...page.result._meta.placements);
      }
      const canonicalBuild = { ...build, placements: canonicalPlacements };
      expect(canonicalBuild.placements).toHaveLength(build.blockCount);

      const reviewed = await callTool("review-build-page-metadata", "review_build", { build: build.id });
      expect(reviewed.result?.isError).not.toBe(true);
      expect(reviewed.result?._meta?.viewUUID).toEqual(expect.any(String));
      expect(reviewed.result?._meta?.build).toBeUndefined();
      expect(reviewed.result?._meta?.buildSummary).toMatchObject({ id: build.id, hash: build.hash, blockCount: build.blockCount });
      expect(reviewed.result?._meta?.buildPage).toMatchObject({ buildId: build.id, offset: 0, total: build.blockCount });
      expect(reviewed.result?._meta?.audit).toMatchObject({ buildId: build.id, hash: build.hash });

      const customRequirement = "Create an unfamiliar kinetic canopy from exact generic geometry";
      const largeMaterialLibrary = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`bespoke_material_${index}`, "minecraft:stone"]));
      const customCompiled = await callTool("custom-generic-design", "compile_build", {
        name: "Uncatalogued Kinetic Canopy",
        edition: "java",
        version: "26.2",
        style: "uncatalogued kinetic solarpunk",
        sourceBrief: customRequirement,
        dimensions: { width: 9, depth: 9, height: 9 },
        palette: Array.from({ length: 120 }, () => "minecraft:stone"),
        materialLibrary: largeMaterialLibrary,
        features: [customRequirement],
        seed: "uncatalogued-kinetic-canopy",
        design: {
          schemaVersion: 1,
          description: "A domain-independent filled canopy test that is not represented by a building-type catalog.",
          requirements: [{
            id: "custom-form",
            text: customRequirement,
            elementIds: ["canopy-form"],
            claims: [{ id: "custom-form-claim", sourceSpan: { start: 0, end: customRequirement.length, text: customRequirement }, predicate: "surface", status: "asserted" }],
            assertions: [
              { claimId: "custom-form-claim", sourceSpan: { start: 0, end: customRequirement.length, text: customRequirement }, elementIds: ["canopy-form"], kind: "element_kind", elementKind: "fill", minimum: 1 },
              { claimId: "custom-form-claim", sourceSpan: { start: 0, end: customRequirement.length, text: customRequirement }, elementIds: ["canopy-form"], kind: "axis_span", axis: "x", minimum: 7 },
            ],
          }],
          elements: [{
            id: "canopy-form",
            kind: "fill",
            intent: customRequirement,
            requirementIds: ["custom-form"],
            min: { x: 1, y: 1, z: 1 },
            max: { x: 7, y: 1, z: 7 },
            material: "bespoke_material_119",
          }],
        },
      });
      expect(customCompiled.result?.isError, JSON.stringify(customCompiled)).not.toBe(true);
      expect(customCompiled.result?._meta).toBeUndefined();
      expect(customCompiled.result?.structuredContent?.build?.input?.style).toBe("uncatalogued kinetic solarpunk");
      expect(customCompiled.result?.structuredContent?.build?.input?.palette).toHaveLength(120);
      expect(Object.keys(customCompiled.result?.structuredContent?.build?.input?.materialLibrary ?? {})).toHaveLength(120);
      expect(customCompiled.result?.structuredContent?.build?.input?.design?.elements?.[0]).toMatchObject({ id: "canopy-form", kind: "fill", material: "bespoke_material_119" });
      const customRecompiled = await callTool("custom-generic-recompile", "validate_build", { build: customCompiled.result?.structuredContent?.build });
      expect(customRecompiled.result?.isError, JSON.stringify(customRecompiled)).not.toBe(true);
      expect(customRecompiled.result?.structuredContent).toMatchObject({
        buildId: customCompiled.result?.structuredContent?.build?.id,
        hash: customCompiled.result?.structuredContent?.build?.hash,
      });
      const uncappedFeatureOverrides = await callTool("uncapped-feature-overrides", "validate_build_contract", {
        build: customCompiled.result?.structuredContent?.build?.id,
        contract: { features: Array.from({ length: 120 }, (_, index) => `warning: open ended material note ${index}`) },
      });
      expect(uncappedFeatureOverrides.result?.isError, JSON.stringify(uncappedFeatureOverrides)).not.toBe(true);
      expect(uncappedFeatureOverrides.result?.structuredContent?.contract?.warnings
        ?.filter((result: any) => /open ended material note/.test(result.requirement))).toHaveLength(120);

      const firstBedrockSector = await callTool("bedrock-project-sector-a", "compile_build", {
        name: "Project Sector A",
        edition: "bedrock",
        version: "stable",
        style: "modern",
        dimensions: { width: 9, depth: 9, height: 9 },
        origin: { x: 0, y: 64, z: 0 },
        seed: "bedrock-project-sector-a",
      });
      const secondBedrockSector = await callTool("bedrock-project-sector-b", "compile_build", {
        name: "Project Sector B",
        edition: "bedrock",
        version: "stable",
        style: "modern",
        dimensions: { width: 9, depth: 9, height: 9 },
        origin: { x: 20, y: 64, z: 0 },
        seed: "bedrock-project-sector-b",
      });
      expect(firstBedrockSector.result?.isError, JSON.stringify(firstBedrockSector)).not.toBe(true);
      expect(secondBedrockSector.result?.isError, JSON.stringify(secondBedrockSector)).not.toBe(true);
      const firstBedrockBuild = firstBedrockSector.result?.structuredContent?.build;
      const secondBedrockBuild = secondBedrockSector.result?.structuredContent?.build;
      expect(firstBedrockBuild.contract.status).toBe("valid");
      expect(secondBedrockBuild.contract.status).toBe("valid");
      expect(firstBedrockBuild.bounds.max.x).toBeLessThan(secondBedrockBuild.bounds.min.x);

      const bedrockProject = await callTool("bedrock-project-export", "export_bedrock_project", {
        builds: [firstBedrockBuild.id, secondBedrockBuild.id],
        name: "Two Sector MCP Project",
        description: "Two exact non-overlapping cached Bedrock sectors in one pack.",
        packId: "blockwright:mcp-regression:two-sector-project",
        manifestVersion: [1, 2, 3],
      });
      expect(bedrockProject.result?.isError, JSON.stringify(bedrockProject)).not.toBe(true);
      expect(bedrockProject.result?.structuredContent).toMatchObject({
        projectName: "Two Sector MCP Project",
        packId: "blockwright:mcp-regression:two-sector-project",
        manifestVersion: [1, 2, 3],
        format: "mcpack",
        filename: "two_sector_mcp_project.mcpack",
        buildIds: [firstBedrockBuild.id, secondBedrockBuild.id],
        buildHashes: [firstBedrockBuild.hash, secondBedrockBuild.hash],
        structureTiles: 2,
        bedrockRegistryVersion: expect.any(String),
        compatibilityStatus: "unverified",
      });
      expect(bedrockProject.result?._meta?.viewUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(bedrockProject.result?._meta?.base64).toEqual(expect.any(String));
      expect(Buffer.from(bedrockProject.result._meta.base64, "base64").subarray(0, 2).toString("ascii")).toBe("PK");
      expect(bedrockProject.result?._meta?.metadata?.builds).toEqual([
        expect.objectContaining({ id: firstBedrockBuild.id, hash: firstBedrockBuild.hash }),
        expect.objectContaining({ id: secondBedrockBuild.id, hash: secondBedrockBuild.hash }),
      ]);

      const createdProject = await callTool("project-create-test", "create_project", {
        name: "Professional Workflow Project",
        description: "Bridge integration fixture",
        build: build.id,
      });
      expect(createdProject.result?.isError).not.toBe(true);
      const project = createdProject.result?.structuredContent?.project;
      const initialVersion = createdProject.result?.structuredContent?.head;
      expect(project).toMatchObject({ private: true, versionCount: 1, headVersionId: initialVersion.id });
      expect(createdProject.result?._meta?.build).toMatchObject({ id: build.id, hash: build.hash });

      const target = canonicalBuild.placements.find((placement: any) => !placement.blockEntity);
      expect(target).toBeTruthy();
      const invalidBlockRevision = await callTool("regional-invalid-block-test", "revise_build", {
        build: build.id,
        region: { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } },
        replacementPlacements: [{ ...target, block: "Stone Bricks" }],
      });
      expect(invalidBlockRevision.result?.isError).toBe(true);
      expect(JSON.stringify(invalidBlockRevision)).toMatch(/block|namespaced|invalid/i);

      const invalidStateRevision = await callTool("regional-invalid-state-test", "revise_build", {
        build: build.id,
        region: { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } },
        replacementPlacements: [{ ...target, state: { "Invalid Key": "north" } }],
      });
      expect(invalidStateRevision.result?.isError).toBe(true);
      expect(JSON.stringify(invalidStateRevision)).toMatch(/state|invalid|key/i);

      const unverifiedStateRevision = await callTool("regional-unverified-state-test", "revise_build", {
        build: build.id,
        region: { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } },
        replacementPlacements: [{ ...target, state: { facing: "banana" } }],
      });
      expect(unverifiedStateRevision.result?.isError).toBe(true);
      expect(JSON.stringify(unverifiedStateRevision)).toMatch(/UNVERIFIED_BLOCK_STATE/);

      const regionalRevision = await callTool("regional-revise-test", "revise_build", {
        build: build.id,
        region: { min: { x: target.x, y: target.y, z: target.z }, max: { x: target.x, y: target.y, z: target.z } },
        replacementPlacements: [{ ...target, phase: `${target.phase}-bridge-test` }],
      });
      expect(regionalRevision.result?.isError).not.toBe(true);
      expect(regionalRevision.result?.structuredContent).toMatchObject({
        mode: "selected_region",
        previousHash: build.hash,
        diff: { addedCount: 0, removedCount: 0, changedCount: 1 },
        build: { contract: { status: "valid" } },
      });
      const regionalBuild = regionalRevision.result?.structuredContent?.build;
      expect(regionalRevision.result?._meta?.build).toBeUndefined();
      expect(regionalRevision.result?._meta?.buildSummary).toMatchObject({ id: regionalBuild.id, hash: regionalBuild.hash });
      expect(regionalRevision.result?._meta?.diff).toMatchObject({ addedCount: 0, removedCount: 0, changedCount: 1 });
      expect(regionalRevision.result?._meta?.diff?.changed).toBeUndefined();
      const regionalPlacements = [...regionalRevision.result?._meta?.buildPage?.placements ?? []];
      while (regionalPlacements.length < regionalBuild.blockCount) {
        const offset = regionalPlacements.length;
        const page = await callTool(`regional-build-page-${offset}`, "get_build_chunk", { build: regionalBuild.id, offset, limit: 5_000 });
        expect(page.result?.isError, JSON.stringify(page)).not.toBe(true);
        regionalPlacements.push(...page.result?._meta?.placements ?? []);
      }
      expect(regionalPlacements.filter((placement: any) => placement.x !== target.x || placement.y !== target.y || placement.z !== target.z)).toEqual(
        canonicalBuild.placements.filter((placement: any) => placement.x !== target.x || placement.y !== target.y || placement.z !== target.z),
      );

      const savedVersion = await callTool("project-save-test", "save_project_version", {
        projectId: project.id,
        build: regionalBuild.id,
        reason: "region_revision",
        expectedHeadVersionId: initialVersion.id,
      });
      expect(savedVersion.result?.isError).not.toBe(true);
      const regionalVersion = savedVersion.result?.structuredContent?.version;
      expect(regionalVersion).toMatchObject({ projectId: project.id, parentVersionId: initialVersion.id, reason: "region_revision", buildHash: regionalBuild.hash });

      const versionDiff = await callTool("project-diff-test", "diff_project_versions", {
        projectId: project.id,
        beforeVersionId: initialVersion.id,
        afterVersionId: regionalVersion.id,
      });
      expect(versionDiff.result?.structuredContent?.diff).toMatchObject({
        projectId: project.id,
        beforeVersionId: initialVersion.id,
        afterVersionId: regionalVersion.id,
        addedCount: 0,
        removedCount: 0,
        changedCount: 1,
      });
      expect(versionDiff.result?._meta?.diff?.changed).toHaveLength(1);

      const restoredVersion = await callTool("project-restore-test", "restore_project_version", {
        projectId: project.id,
        versionId: initialVersion.id,
        expectedHeadVersionId: regionalVersion.id,
      });
      expect(restoredVersion.result?.structuredContent?.version).toMatchObject({
        projectId: project.id,
        parentVersionId: regionalVersion.id,
        restoredFromVersionId: initialVersion.id,
        reason: "restore",
        buildHash: build.hash,
      });
      const restoredHead = restoredVersion.result?.structuredContent?.version;

      const loadedProject = await callTool("project-get-test", "get_project", { projectId: project.id });
      expect(loadedProject.result?.structuredContent).toMatchObject({
        project: { id: project.id, versionCount: 3, headVersionId: restoredHead.id },
        head: { id: restoredHead.id, buildHash: build.hash },
      });
      expect(loadedProject.result?.structuredContent?.versions).toHaveLength(3);

      const listedProjects = await callTool("project-list-test", "list_projects", {});
      expect(listedProjects.result?.structuredContent?.projects).toEqual([expect.objectContaining({ id: project.id, private: true, versionCount: 3 })]);

      const materialList = await callTool("material-list-test", "get_material_list", { build: regionalBuild.id });
      expect(materialList.result?.structuredContent).toMatchObject({ buildId: regionalBuild.id, buildHash: regionalBuild.hash, exact: true, planningAid: true });
      expect(materialList.result?.structuredContent?.totalBlocks).toBe(regionalBuild.blockCount);
      expect(materialList.result?._meta?.materialList?.lines?.length).toBeGreaterThan(0);

      const litematicExport = await callTool("litematic-export-test", "export_build", { build: build.id, format: "litematic" });
      expect(litematicExport.result?.structuredContent).toMatchObject({ buildId: build.id, format: "litematic", litematicVersion: 7, compatibilityStatus: "unverified" });
      expect(litematicExport.result?._meta?.base64).toEqual(expect.any(String));
      const litematicImport = await callTool("litematic-import-test", "import_schematic", { base64: litematicExport.result._meta.base64, format: "litematic" });
      expect(litematicImport.result?.structuredContent).toMatchObject({ format: "litematic", version: 7, blockCount: build.blockCount, regionCount: 1, compatibilityStatus: "unverified", placementsIncluded: true });
      expect(litematicImport.result?._meta?.placements).toHaveLength(build.blockCount);

      const deliveryBundle = await callTool("delivery-bundle-test", "create_delivery_bundle", { build: build.id, format: "schem" });
      expect(deliveryBundle.result?.isError).not.toBe(true);
      expect(deliveryBundle.result?.structuredContent).toMatchObject({ buildId: build.id, buildHash: build.hash, artifactFormat: "schem", compatibilityStatus: "unverified" });
      expect(deliveryBundle.result?.structuredContent?.fileCount).toBeGreaterThanOrEqual(8);
      expect(deliveryBundle.result?._meta?.base64).toEqual(expect.any(String));
      expect(deliveryBundle.result?._meta?.manifest?.files).toEqual(expect.arrayContaining([expect.objectContaining({ name: "build.schem", sha256: expect.any(String) })]));

      const semanticContract = await callTool("contract-test", "validate_build_contract", {
        build: build.id,
        contract: { clauses: ["four cardinal 9-wide entrances"] },
      });
      expect(semanticContract.result?.isError).not.toBe(true);
      expect(semanticContract.result?.structuredContent?.contract).toMatchObject({
        status: "invalid",
        buildHash: build.hash,
        certificate: { status: "invalid", buildHash: build.hash },
      });
      expect(semanticContract.result?.structuredContent?.contract?.hardResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ evaluator: "entrances", status: "fail" }),
      ]));

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
      const deletedProject = await callTool("project-delete-test", "delete_project", { projectId: project.id });
      expect(deletedProject.result?.structuredContent).toMatchObject({ deleted: true, projectId: project.id, deletedVersionCount: 3, deletedDependentRecords: 0 });
      const projectsAfterDelete = await callTool("project-list-after-delete-test", "list_projects", {});
      expect(projectsAfterDelete.result?.structuredContent?.projects).toEqual([]);
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
