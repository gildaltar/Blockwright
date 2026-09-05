import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

const modulePath = fileURLToPath(import.meta.url);
export const pluginRoot = resolve(dirname(modulePath), "..");
export const appRoot = resolve(pluginRoot, "app");
const appManifestPath = resolve(appRoot, "package.json");
const STARTUP_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 1_500;
const RESPONSE_TIMEOUT_MS = 600_000;
const MAX_SSE_BYTES = 8 * 1024 * 1024;
const REPAIR_LOCK_NAME = ".blockwright-runtime-repair.lock";
const REPAIR_LOCK_PATH = resolve(appRoot, REPAIR_LOCK_NAME);
const REPAIR_LOCK_RETRIES = Math.floor(STARTUP_TIMEOUT_MS / 250);
const REPAIR_LOCK_RETRY_MS = 250;
const VALID_LOCK_STALE_MS = 5_000;
const INVALID_LOCK_STALE_MS = 10 * 60_000;
const PROCESS_START_TOLERANCE_MS = 2_000;
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

let child;
let shuttingDown = false;
const requestController = new AbortController();
const managedProcesses = new Set();
let activeTransport;
let bridgeForwarder;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function compareVersions(left, right) {
  const normalize = (value) => String(value).split("-", 1)[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

export function minimumNodeVersion(engine) {
  return /(?:^|\s)>=\s*(\d+(?:\.\d+){0,2})/.exec(String(engine ?? ""))?.[1];
}

export function runtimeEntryCandidates(root = appRoot) {
  return [resolve(root, "dist", "__entry.js"), resolve(root, "dist", "server.js")];
}

export function resolveRuntimeEntry(root = appRoot) {
  return runtimeEntryCandidates(root).find((path) => existsSync(path));
}

export function requiredRuntimeFiles(manifest) {
  return [
    resolve(appRoot, "dist", "server.js"),
    resolve(appRoot, "dist", "assets", ".vite", "manifest.json"),
    resolve(appRoot, "data", "java"),
    ...Object.keys(manifest.dependencies ?? {}).map((name) => resolve(appRoot, "node_modules", ...name.split("/"), "package.json")),
  ];
}

function npmInvocation(args) {
  return process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] }
    : { command: "npm", args };
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const processHandle = spawn(command, args, {
      ...options,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    managedProcesses.add(processHandle);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      managedProcesses.delete(processHandle);
      if (error) reject(error);
      else resolveRun();
    };
    processHandle.stdout.on("data", (chunk) => process.stderr.write(chunk));
    processHandle.stderr.on("data", (chunk) => process.stderr.write(chunk));
    processHandle.once("error", (error) => finish(error));
    processHandle.once("exit", (code) => finish(code === 0 ? undefined : new Error(`Runtime dependency command exited with code ${code ?? "unknown"}.`)));
  });
}

function dependenciesHealthy() {
  const npm = npmInvocation(["ls", "--omit=dev", "--depth=0", "--json"]);
  const result = spawnSync(npm.command, npm.args, { cwd: appRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0;
}

function sleep(ms, signal) {
  return new Promise((resolveWait, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Blockwright bridge is shutting down."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Blockwright bridge is shutting down."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveWait();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function windowsProcessStartedAt(pid) {
  if (process.platform !== "win32") return undefined;
  const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $p) { $p.StartTime.ToUniversalTime().ToString('o') }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

function readLockOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(resolve(lockPath, "owner.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export function repairMutexAddress(lockPath = REPAIR_LOCK_PATH) {
  const normalized = resolve(lockPath).replaceAll("\\", "/").toLowerCase();
  const digest = createHash("sha256").update(normalized).digest("hex");
  if (process.platform === "win32") {
    return { kind: "pipe", address: `\\\\.\\pipe\\blockwright-runtime-repair-${digest.slice(0, 24)}` };
  }
  return { kind: "tcp", host: "127.0.0.1", port: 20_000 + (Number.parseInt(digest.slice(0, 8), 16) % 20_000) };
}

function tryAcquireRepairMutex(lockPath) {
  const endpoint = repairMutexAddress(lockPath);
  return new Promise((resolveMutex, reject) => {
    const listener = createServer((socket) => socket.destroy());
    const fail = (error) => {
      listener.removeAllListeners();
      reject(error);
    };
    listener.once("error", fail);
    listener.once("listening", () => {
      listener.removeListener("error", fail);
      listener.on("error", () => undefined);
      resolveMutex(listener);
    });
    if (endpoint.kind === "pipe") listener.listen(endpoint.address);
    else listener.listen({ host: endpoint.host, port: endpoint.port, exclusive: true });
  });
}

async function acquireRepairMutex(lockPath, retries, retryMs, signal) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    signal?.throwIfAborted?.();
    try {
      return await tryAcquireRepairMutex(lockPath);
    } catch (error) {
      if (error?.code !== "EADDRINUSE" && error?.code !== "EACCES") throw error;
      if (attempt === retries) {
        const owner = readLockOwner(lockPath);
        const detail = owner?.actor ? ` by ${owner.actor} (PID ${owner.pid})` : "";
        throw new Error(`Blockwright runtime dependency repair is already in progress${detail}. Try again after it finishes.`);
      }
      await sleep(retryMs, signal);
    }
  }
  throw new Error("Blockwright could not acquire the operating-system runtime repair mutex.");
}

function closeRepairMutex(listener) {
  return new Promise((resolveClose) => {
    if (!listener?.listening) return resolveClose();
    listener.close(() => resolveClose());
  });
}

function validLockOwner(owner) {
  return owner
    && owner.schemaVersion === 1
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.startedAt === "string"
    && Number.isFinite(Date.parse(owner.startedAt))
    && typeof owner.acquiredAt === "string"
    && Number.isFinite(Date.parse(owner.acquiredAt))
    && typeof owner.token === "string"
    && owner.token.length > 0;
}

export function repairLockDisposition(lockPath, now = Date.now()) {
  let ageMs;
  try {
    const owner = readLockOwner(lockPath);
    const modifiedAt = statSync(lockPath).mtimeMs;
    ageMs = Math.max(0, now - (validLockOwner(owner) ? Date.parse(owner.acquiredAt) : modifiedAt));
    if (!validLockOwner(owner)) {
      return { reclaim: ageMs >= INVALID_LOCK_STALE_MS, ageMs, owner };
    }
    if (ageMs < VALID_LOCK_STALE_MS) return { reclaim: false, ageMs, owner };
    if (!processExists(owner.pid)) return { reclaim: true, ageMs, owner };
    const actualStartedAt = windowsProcessStartedAt(owner.pid);
    if (actualStartedAt) {
      const reused = Math.abs(Date.parse(actualStartedAt) - Date.parse(owner.startedAt)) > PROCESS_START_TOLERANCE_MS;
      return { reclaim: reused, ageMs, owner, actualStartedAt };
    }
    return { reclaim: false, ageMs, owner };
  } catch {
    return { reclaim: false, ageMs: ageMs ?? 0, owner: undefined };
  }
}

// The OS-owned mutex is held whenever this runs, so no updated contender can
// replace the inspected directory between stale-owner proof and quarantine.
function reclaimRepairLockWhileMutexHeld(lockPath) {
  const quarantine = resolve(dirname(lockPath), `${basename(lockPath)}.stale-${process.pid}-${randomUUID()}`);
  try {
    renameSync(lockPath, quarantine);
    rmSync(quarantine, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (existsSync(quarantine)) rmSync(quarantine, { recursive: true, force: true });
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function withRuntimeRepairLock(action, {
  lockPath = REPAIR_LOCK_PATH,
  retries = REPAIR_LOCK_RETRIES,
  retryMs = REPAIR_LOCK_RETRY_MS,
  signal = requestController.signal,
} = {}) {
  if (basename(lockPath) !== REPAIR_LOCK_NAME) throw new Error(`Runtime repair lock must be named ${REPAIR_LOCK_NAME}.`);
  const mutex = await acquireRepairMutex(lockPath, retries, retryMs, signal);
  const token = randomUUID();
  const owner = {
    schemaVersion: 1,
    pid: process.pid,
    startedAt: PROCESS_STARTED_AT,
    acquiredAt: undefined,
    actor: "mcp-bridge",
    token,
  };
  try {
    let acquired = false;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        mkdirSync(lockPath);
        try {
          owner.acquiredAt = new Date().toISOString();
          writeFileSync(resolve(lockPath, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx" });
        } catch (error) {
          rmSync(lockPath, { recursive: true, force: true });
          throw error;
        }
        acquired = true;
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const disposition = repairLockDisposition(lockPath);
        if (disposition.reclaim && reclaimRepairLockWhileMutexHeld(lockPath)) continue;
        if (attempt === retries) {
          const detail = disposition.owner?.actor ? ` by ${disposition.owner.actor} (PID ${disposition.owner.pid})` : "";
          throw new Error(`Blockwright runtime dependency repair is already in progress${detail}. Try again after it finishes.`);
        }
        await sleep(retryMs, signal);
      }
    }
    if (!acquired) throw new Error("Blockwright could not acquire the runtime repair lock.");
    try {
      return await action();
    } finally {
      const current = readLockOwner(lockPath);
      if (current?.token === token) rmSync(lockPath, { recursive: true, force: true });
    }
  } finally {
    await closeRepairMutex(mutex);
  }
}

async function prepareRuntime() {
  if (!existsSync(appManifestPath)) throw new Error(`Blockwright runtime manifest is missing: ${appManifestPath}`);
  const manifest = readJson(appManifestPath);
  const requiredNode = minimumNodeVersion(manifest.engines?.node);
  if (requiredNode && compareVersions(process.versions.node, requiredNode) < 0) {
    throw new Error(`Blockwright ${manifest.version ?? "runtime"} requires Node ${requiredNode} or newer; found ${process.versions.node}.`);
  }
  const coreFiles = requiredRuntimeFiles({ dependencies: {} });
  const missingCore = coreFiles.filter((path) => !existsSync(path));
  if (missingCore.length) throw new Error(`Blockwright runtime is incomplete; missing ${missingCore.join(", ")}. Reinstall the plugin package.`);

  const missingDependencies = requiredRuntimeFiles(manifest).slice(coreFiles.length).filter((path) => !existsSync(path));
  if (missingDependencies.length || !dependenciesHealthy()) {
    await withRuntimeRepairLock(async () => {
      if (dependenciesHealthy()) return;
      const lockfile = resolve(appRoot, "package-lock.json");
      const installMode = existsSync(lockfile) ? "ci" : "install";
      process.stderr.write(`Blockwright: repairing local runtime dependencies with npm ${installMode}…\n`);
      const npm = npmInvocation([installMode, "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline"]);
      await run(npm.command, npm.args, { cwd: appRoot });
    });
    if (!dependenciesHealthy()) throw new Error("Blockwright runtime dependencies remain invalid after npm completed. Run the local diagnostics for exact package details.");
  }
  return manifest;
}

async function openPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Blockwright could not allocate an isolated loopback port.")));
        return;
      }
      probe.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

export function isJsonRpcMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") return false;
  if (typeof message.method === "string") return !("result" in message) && !("error" in message);
  return "id" in message && (("result" in message) !== ("error" in message));
}

function isJsonRpcRequest(message) {
  return isJsonRpcMessage(message) && typeof message.method === "string" && "id" in message;
}

function isJsonRpcResponse(message) {
  return isJsonRpcMessage(message) && typeof message.method !== "string";
}

function sameRequestId(left, right) {
  return typeof left === typeof right && left === right;
}

function messagesFromData(data) {
  try {
    const parsed = JSON.parse(data);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter(isJsonRpcMessage);
  } catch {
    return [];
  }
}

export async function readPayload(response, {
  timeoutMs = RESPONSE_TIMEOUT_MS,
  maxBytes = MAX_SSE_BYTES,
  expectedId,
  onMessage,
} = {}) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = (await response.text()).trim();
    if (expectedId === undefined || !data) return data;
    for (const message of messagesFromData(data)) {
      await onMessage?.(message);
      if (isJsonRpcResponse(message) && sameRequestId(message.id, expectedId)) return JSON.stringify(message);
    }
    return "";
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let bytesRead = 0;
  let lastData = "";

  const parseEvent = async (event) => {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .join("\n");
    if (!data) return undefined;
    for (const message of messagesFromData(data)) {
      lastData = JSON.stringify(message);
      await onMessage?.(message);
      if (expectedId === undefined || (isJsonRpcResponse(message) && sameRequestId(message.id, expectedId))) {
        return JSON.stringify(message);
      }
    }
    return undefined;
  };

  try {
    while (true) {
      const read = reader.read();
      let timeoutHandle;
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Blockwright SSE response timed out after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
      });
      const { done, value } = await Promise.race([read, timeout]).finally(() => clearTimeout(timeoutHandle));
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) throw new Error(`Blockwright SSE response exceeded the ${maxBytes} byte safety limit before a JSON event arrived.`);
        buffer += decoder.decode(value, { stream: !done });
      }
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const payload = await parseEvent(event);
        if (payload) {
          await reader.cancel();
          return payload;
        }
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
      if (done) {
        buffer += decoder.decode();
        const payload = await parseEvent(buffer);
        return payload ?? (expectedId === undefined ? lastData : "");
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function probeMcp(baseUrl, expectedVersion) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "blockwright-ready", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "blockwright-bridge", version: expectedVersion } } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const payload = await readPayload(response, { expectedId: "blockwright-ready", timeoutMs: PROBE_TIMEOUT_MS });
  if (!response.ok || !payload) return false;
  try {
    const message = JSON.parse(payload);
    return message.result?.serverInfo?.name === "blockwright" && message.result.serverInfo.version === expectedVersion;
  } catch {
    return false;
  }
}

async function probeReady(baseUrl, expectedVersion) {
  try {
    const response = await fetch(`${baseUrl}/ready`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (response.ok) {
      const body = await response.json();
      return body.service === "blockwright" && body.version === expectedVersion && body.status === "ready";
    }
    if (response.status !== 404) return false;
  } catch {
    return false;
  }
  return probeMcp(baseUrl, expectedVersion);
}

async function startServer() {
  const manifest = await prepareRuntime();
  const port = await openPort();
  const entryPath = resolveRuntimeEntry();
  if (!entryPath) throw new Error("Blockwright runtime has no built entry point. Reinstall the plugin package.");
  let startupError;
  let exitCode;
  const processHandle = spawn(process.execPath, [entryPath], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      __PORT: String(port),
      PORT: String(port),
      BLOCKWRIGHT_DATA_DIR: resolve(appRoot, "data", "java"),
    },
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = processHandle;
  managedProcesses.add(processHandle);
  processHandle.stdout.on("data", (chunk) => process.stderr.write(chunk));
  processHandle.stderr.on("data", (chunk) => process.stderr.write(chunk));
  processHandle.once("error", (error) => { startupError = error; });
  processHandle.once("exit", (code) => {
    exitCode = code ?? -1;
    managedProcesses.delete(processHandle);
    const unexpected = !shuttingDown && child === processHandle;
    if (child === processHandle) child = undefined;
    if (unexpected) {
      endpointState.reset();
      resetHttpTransport(`Blockwright server exited with code ${code ?? "unknown"}.`);
      process.stderr.write(`Blockwright server exited with code ${code ?? "unknown"}; the next request will restart it.\n`);
    }
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (exitCode !== undefined) throw new Error(`Blockwright local server exited during startup with code ${exitCode}.`);
      if (await probeReady(baseUrl, String(manifest.version))) {
        process.stderr.write(`Blockwright ${manifest.version} ready on isolated loopback port ${port}.\n`);
        return `${baseUrl}/mcp`;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error(`Blockwright local MCP server did not become ready within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
  } catch (error) {
    stopProcessTree(processHandle);
    if (child === processHandle) child = undefined;
    throw error;
  }
}

export function createRestartable(start) {
  let pending;
  return {
    get() {
      if (pending) return pending;
      const current = Promise.resolve().then(start);
      const guarded = current.catch((error) => {
        if (pending === guarded) pending = undefined;
        throw error;
      });
      pending = guarded;
      return pending;
    },
    reset() {
      pending = undefined;
    },
  };
}

const endpointState = createRestartable(startServer);

function getEndpoint() {
  return endpointState.get();
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function requestIdKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

export function createBridgeForwarder({ getTransport, writeOutput, writeError, onTransportFailure = () => undefined }) {
  const configured = new WeakMap();
  const pending = new Map();
  let generation = 0;
  let stopped = false;

  const emit = (message) => {
    if (!stopped) writeOutput(`${JSON.stringify(message)}\n`);
  };

  const configure = (transport) => {
    if (configured.has(transport)) return;
    const transportGeneration = generation;
    configured.set(transport, transportGeneration);
    transport.onmessage = (message) => {
      if (stopped || transportGeneration !== generation || !isJsonRpcMessage(message)) return;
      if (isJsonRpcResponse(message)) {
        const record = pending.get(requestIdKey(message.id));
        if (record) {
          pending.delete(requestIdKey(message.id));
          if (record.method === "initialize" && typeof message.result?.protocolVersion === "string") {
            transport.setProtocolVersion?.(message.result.protocolVersion);
          }
        }
      }
      emit(message);
    };
    transport.onerror = (error) => {
      if (!stopped && transportGeneration === generation) {
        writeError(`Blockwright HTTP transport error: ${error instanceof Error ? error.message : String(error)}\n`);
        onTransportFailure(error, transport);
      }
    };
  };

  const forwardLine = async (line) => {
    if (stopped) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeOutput(`${jsonRpcError(null, -32700, "Invalid JSON received by the Blockwright bridge.")}\n`);
      return;
    }
    if (!isJsonRpcMessage(message)) {
      writeOutput(`${jsonRpcError(null, -32600, "Invalid JSON-RPC request received by the Blockwright bridge.")}\n`);
      return;
    }
    const request = isJsonRpcRequest(message);
    const key = request ? requestIdKey(message.id) : undefined;
    let transport;
    try {
      transport = await getTransport();
      if (stopped) return;
      configure(transport);
      if (request) pending.set(key, { id: message.id, method: message.method });
      await transport.send(message);
    } catch (error) {
      if (stopped) return;
      const detail = error instanceof Error ? error.message : "Blockwright proxy error";
      if (transport && configured.get(transport) === generation) onTransportFailure(error, transport);
      if (request && pending.delete(key)) writeOutput(`${jsonRpcError(message.id, -32603, detail)}\n`);
      writeError(`Blockwright bridge error: ${detail}\n`);
    }
  };

  return {
    forwardLine,
    reset(reason = "Blockwright HTTP transport was reset.") {
      generation += 1;
      if (!stopped) {
        for (const { id } of pending.values()) writeOutput(`${jsonRpcError(id, -32603, reason)}\n`);
      }
      pending.clear();
    },
    close() {
      stopped = true;
      generation += 1;
      pending.clear();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

export function createBoundedFetch(fetchImplementation = fetch, lifetimeSignal = requestController.signal, timeoutMs = RESPONSE_TIMEOUT_MS) {
  return (input, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const signals = [lifetimeSignal, init.signal].filter(Boolean);
    if (method !== "GET") signals.push(AbortSignal.timeout(timeoutMs));
    return fetchImplementation(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

const boundedFetch = createBoundedFetch();

let transportGeneration = 0;
async function startHttpTransport() {
  const generation = transportGeneration;
  const endpoint = await getEndpoint();
  const transportPath = resolve(appRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "streamableHttp.js");
  if (!existsSync(transportPath)) throw new Error(`Blockwright MCP transport dependency is missing: ${transportPath}`);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(transportPath).href);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { fetch: boundedFetch });
  await transport.start();
  if (shuttingDown || generation !== transportGeneration) {
    await transport.close();
    throw new Error("Blockwright HTTP transport startup was superseded.");
  }
  activeTransport = transport;
  return transport;
}

const httpTransportState = createRestartable(startHttpTransport);

function getHttpTransport() {
  return httpTransportState.get();
}

function resetHttpTransport(reason) {
  transportGeneration += 1;
  httpTransportState.reset();
  bridgeForwarder?.reset(reason);
  const transport = activeTransport;
  activeTransport = undefined;
  if (transport) void transport.close().catch(() => undefined);
}

function stopProcessTree(processHandle) {
  if (!processHandle?.pid || processHandle.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    try { processHandle.kill("SIGTERM"); } catch { /* already gone */ }
  }
  const force = setTimeout(() => {
    if (processHandle.exitCode !== null) return;
    try { process.kill(-processHandle.pid, "SIGKILL"); } catch { /* already gone */ }
  }, 2_000);
  force.unref();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  bridgeForwarder?.close();
  requestController.abort(new Error("Blockwright bridge input closed."));
  endpointState.reset();
  resetHttpTransport();
  for (const processHandle of [...managedProcesses]) stopProcessTree(processHandle);
  managedProcesses.clear();
  child = undefined;
}

export async function main() {
  bridgeForwarder = createBridgeForwarder({
    getTransport: getHttpTransport,
    writeOutput: (value) => process.stdout.write(value),
    writeError: (value) => process.stderr.write(value),
    onTransportFailure: (error, transport) => {
      if (transport === activeTransport) resetHttpTransport(error instanceof Error ? error.message : "Blockwright HTTP transport failed.");
    },
  });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => { void bridgeForwarder.forwardLine(line); });
  process.once("SIGINT", () => { shutdown(); process.exit(130); });
  process.once("SIGTERM", () => { shutdown(); process.exit(143); });
  process.once("exit", shutdown);
  input.once("close", () => {
    shutdown();
    process.exitCode = 0;
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain = process.platform === "win32" ? invokedPath.toLowerCase() === modulePath.toLowerCase() : invokedPath === modulePath;
if (isMain) await main();
