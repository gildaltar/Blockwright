import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRuntimeLock, createRuntimePackage, root } from "./package-plugin.mjs";

const temporary = mkdtempSync(join(tmpdir(), "blockwright-runtime-lock-"));
try {
  const sourcePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const sourceLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const runtimePackage = createRuntimePackage(sourcePackage);
  const runtimeLock = createRuntimeLock(sourceLock, runtimePackage);
  writeFileSync(resolve(temporary, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  writeFileSync(resolve(temporary, "package-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`);

  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const npmArgs = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"];
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...npmArgs] : npmArgs;
  const result = spawnSync(command, args, { cwd: temporary, encoding: "utf8", windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown npm failure").trim().slice(-4000);
    throw new Error(`Clean runtime npm ci failed with exit ${result.status ?? "unknown"}:\n${detail}`);
  }
  const missing = Object.keys(runtimePackage.dependencies).filter((name) => !existsSync(resolve(temporary, "node_modules", ...name.split("/"), "package.json")));
  if (missing.length) throw new Error(`Clean runtime npm ci omitted direct dependencies: ${missing.join(", ")}.`);
  console.log(`Verified clean production-only npm ci for Blockwright ${runtimePackage.version} (${Object.keys(runtimePackage.dependencies).length} direct dependencies).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
