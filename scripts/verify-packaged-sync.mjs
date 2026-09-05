import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

const tracked = git(["diff", "--quiet", "--", "app"]);
if (tracked.error || (tracked.status !== 0 && tracked.status !== 1)) {
  throw tracked.error ?? new Error(`git diff failed with exit code ${tracked.status ?? "unknown"}: ${tracked.stderr.trim()}`);
}
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "app"]);
if (untracked.error || untracked.status !== 0) {
  throw untracked.error ?? new Error(`git ls-files failed with exit code ${untracked.status ?? "unknown"}: ${untracked.stderr.trim()}`);
}

const untrackedFiles = untracked.stdout.split(/\r?\n/).filter(Boolean);
if (tracked.status === 1 || untrackedFiles.length) {
  if (tracked.status === 1) {
    const summary = git(["diff", "--name-status", "--", "app"]);
    if (summary.status === 0 && summary.stdout.trim()) process.stderr.write(`Changed packaged files:\n${summary.stdout}`);
  }
  if (untrackedFiles.length) process.stderr.write(`Untracked packaged files:\n${untrackedFiles.map((path) => `  ${path}`).join("\n")}\n`);
  process.stderr.write("Committed app/ does not match the reproducibly generated Blockwright runtime. Run npm run build and npm run package:plugin, then commit the packaged changes.\n");
  process.exit(1);
}

console.log("Committed app/ matches the reproducibly generated Blockwright runtime.");
