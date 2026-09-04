import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

const PORT = 3000;
const projectRoot = resolve(process.cwd()).toLowerCase();
const projectVersion = (JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

async function portOpen() {
  return new Promise<boolean>((resolveOpen) => {
    const socket = connect({ host: "127.0.0.1", port: PORT });
    socket.setTimeout(800);
    socket.once("connect", () => { socket.destroy(); resolveOpen(true); });
    socket.once("timeout", () => { socket.destroy(); resolveOpen(false); });
    socket.once("error", () => resolveOpen(false));
  });
}

async function healthyBlockwright() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "blockwright-dev-check", version: "1" } } }),
      signal: AbortSignal.timeout(2500),
    });
    const body = await response.json() as { result?: { serverInfo?: { name?: string; version?: string } } };
    return body.result?.serverInfo?.name === "blockwright" ? body.result.serverInfo : undefined;
  } catch {
    return undefined;
  }
}

function windowsPortOwner() {
  const script = `$c=Get-NetTCPConnection -State Listen -LocalPort ${PORT} -ErrorAction SilentlyContinue|Select-Object -First 1; if($c){$p=Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\"; [pscustomobject]@{pid=$c.OwningProcess;commandLine=$p.CommandLine}|ConvertTo-Json -Compress}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) return undefined;
  try { return JSON.parse(result.stdout.trim()) as { pid: number; commandLine?: string }; } catch { return undefined; }
}

function stopOwnedStaleServer() {
  if (process.platform !== "win32") return false;
  const owner = windowsPortOwner();
  const command = owner?.commandLine?.toLowerCase() ?? "";
  if (!owner?.pid || !command.includes(projectRoot) || !command.includes("blockwright")) return false;
  const result = spawnSync("taskkill", ["/PID", String(owner.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  return result.status === 0;
}

if (await portOpen()) {
  const server = await healthyBlockwright();
  if (server?.version === projectVersion) {
    console.log(`Blockwright ${server.version ?? ""} is already healthy at http://localhost:${PORT}/mcp`.trim());
    process.exit(0);
  }
  if (!stopOwnedStaleServer()) {
    console.error(server
      ? `Port ${PORT} is occupied by Blockwright ${server.version ?? "unknown"}, but this project is ${projectVersion}. Ownership could not be verified, so it was not stopped and Blockwright will not switch ports automatically.`
      : `Port ${PORT} is occupied by another or unverifiable process. Blockwright will not switch ports automatically.`);
    process.exit(2);
  }
  console.log(`Stopped the stale Blockwright process that owned port ${PORT}.`);
}

const skybridge = resolve(process.cwd(), "node_modules", "skybridge", "bin", "run.js");
const child = spawn(process.execPath, [skybridge, "dev", ...(process.argv.includes("--tunnel") ? ["--tunnel"] : [])], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdio: "inherit",
  windowsHide: true,
});
function stopChildTree() {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}
process.once("SIGINT", () => { stopChildTree(); process.exit(130); });
process.once("SIGTERM", () => { stopChildTree(); process.exit(143); });
process.once("exit", stopChildTree);
child.once("exit", (code) => process.exit(code ?? 1));
