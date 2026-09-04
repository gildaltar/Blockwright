import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(pluginRoot, "app");
let child;

function npmInvocation(args) {
  return process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] }
    : { command: "npm", args };
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const processHandle = spawn(command, args, { ...options, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    processHandle.stdout.on("data", (chunk) => process.stderr.write(chunk));
    processHandle.stderr.on("data", (chunk) => process.stderr.write(chunk));
    processHandle.once("error", reject);
    processHandle.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function openPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 32147;
      probe.close(() => resolvePort(port));
    });
  });
}

async function startServer() {
  if (!existsSync(resolve(appRoot, "node_modules", "skybridge", "package.json")) || !existsSync(resolve(appRoot, "node_modules", "prismarine-nbt", "package.json"))) {
    process.stderr.write("Blockwright: installing local runtime dependencies (first launch only)…\n");
    const npm = npmInvocation(["install", "--omit=dev", "--no-audit", "--no-fund"]);
    await run(npm.command, npm.args, { cwd: appRoot });
  }
  const port = await openPort();
  child = spawn(process.execPath, [resolve(appRoot, "node_modules", "skybridge", "bin", "run.js"), "start"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), BLOCKWRIGHT_DATA_DIR: resolve(appRoot, "data", "java") },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.once("exit", (code) => process.stderr.write(`Blockwright server exited with code ${code ?? "unknown"}.\n`));
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return `${url}/mcp`;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Blockwright local MCP server did not become ready.");
}

const endpointPromise = startServer();

async function readPayload(response) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return (await response.text()).trim();
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const boundary = buffer.search(/\r?\n\r?\n/);
    if (boundary >= 0 || done) {
      const event = boundary >= 0 ? buffer.slice(0, boundary) : buffer;
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1) ?? "";
      await reader.cancel();
      return data;
    }
  }
}

async function forward(line) {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  try {
    const endpoint = await endpointPromise;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(message),
    });
    if (response.status === 202 || response.status === 204) return;
    const payload = await readPayload(response);
    if (payload) process.stdout.write(`${payload}\n`);
  } catch (error) {
    if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : "Blockwright proxy error" } })}\n`);
  }
}

let queue = Promise.resolve();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  queue = queue.then(() => forward(line));
});

function shutdown() {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", shutdown);
input.once("close", () => queue.finally(() => { shutdown(); process.exit(0); }));
