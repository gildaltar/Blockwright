import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRuntimeLock, createRuntimePackage, root } from "./package-plugin.mjs";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_LIMIT = 4 * 1024 * 1024;
const PROCESS_EXIT_GRACE_MS = 10_000;

function appendTail(current, chunk) {
  const combined = current + chunk;
  return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      resolveExit(exited);
    };
    const onClose = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    timer.unref?.();
    child.once("close", onClose);
    child.once("error", onError);
  });
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const taskkill = spawn(resolve(systemRoot, "System32", "taskkill.exe"), ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (!(await waitForExit(taskkill, PROCESS_EXIT_GRACE_MS))) taskkill.kill("SIGKILL");
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    if (!(await waitForExit(child, PROCESS_EXIT_GRACE_MS))) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }

  if (!(await waitForExit(child, PROCESS_EXIT_GRACE_MS))) {
    child.kill("SIGKILL");
    await waitForExit(child, PROCESS_EXIT_GRACE_MS);
  }
}

function npmInvocation(npmArgs) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath, ...npmArgs] };
  }
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...npmArgs],
    };
  }
  return { command: "npm", args: npmArgs };
}

async function runNpmInstall(cwd, timeoutMs = INSTALL_TIMEOUT_MS) {
  const npmArgs = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"];
  const invocation = npmInvocation(npmArgs);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = appendTail(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendTail(stderr, chunk);
  });

  let timeout;
  const completion = new Promise((resolveCompletion) => {
    child.once("error", (error) => resolveCompletion({ status: null, signal: null, error }));
    child.once("close", (status, signal) => resolveCompletion({ status, signal, error: null }));
  });
  const timedOut = new Promise((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs);
  });

  const outcome = await Promise.race([completion, timedOut]);
  clearTimeout(timeout);
  if (outcome.timedOut) {
    await terminateProcessTree(child);
    return {
      status: null,
      signal: null,
      error: new Error(`Clean runtime npm ci timed out after ${Math.round(timeoutMs / 1000)} seconds.`),
      stdout,
      stderr,
      timedOut: true,
    };
  }
  return { ...outcome, stdout, stderr, timedOut: false };
}

async function verifyRuntimeLock() {
  const temporary = mkdtempSync(join(tmpdir(), "blockwright-runtime-lock-"));
  let primaryError;
  try {
    const sourcePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const sourceLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
    const runtimePackage = createRuntimePackage(sourcePackage);
    const runtimeLock = createRuntimeLock(sourceLock, runtimePackage);
    writeFileSync(resolve(temporary, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
    writeFileSync(resolve(temporary, "package-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`);

    const result = await runNpmInstall(temporary);
    if (result.status !== 0) {
      const outputTail = (result.stderr || result.stdout).trim().slice(-4000);
      const detail = [result.error?.message, outputTail ? `Output tail:\n${outputTail}` : undefined].filter(Boolean).join("\n") || "unknown npm failure";
      throw new Error(`Clean runtime npm ci failed with exit ${result.status ?? "unknown"}:\n${detail}`, { cause: result.error });
    }
    const missing = Object.keys(runtimePackage.dependencies).filter((name) => !existsSync(resolve(temporary, "node_modules", ...name.split("/"), "package.json")));
    if (missing.length) throw new Error(`Clean runtime npm ci omitted direct dependencies: ${missing.join(", ")}.`);
    console.log(`Verified clean production-only npm ci for Blockwright ${runtimePackage.version} (${Object.keys(runtimePackage.dependencies).length} direct dependencies).`);
  } catch (error) {
    primaryError = error;
  }

  try {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError;
    console.error(`Cleanup warning: could not remove temporary runtime-lock directory ${temporary}: ${cleanupError.message}`);
  }
  if (primaryError) throw primaryError;
}

await verifyRuntimeLock();
