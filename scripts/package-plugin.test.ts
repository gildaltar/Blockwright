import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commitStagedPackage, createRuntimeLock, createRuntimePackage, root } from "./package-plugin.mjs";

describe("plugin runtime packaging", () => {
  it("derives a production-only package and aligned npm lock", () => {
    const sourcePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const sourceLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
    const runtimePackage = createRuntimePackage(sourcePackage);
    const runtimeLock = createRuntimeLock(sourceLock, runtimePackage);

    expect(runtimePackage.version).toBe(sourcePackage.version);
    expect(runtimePackage.dependencies).toEqual(sourcePackage.dependencies);
    expect(runtimePackage).not.toHaveProperty("devDependencies");
    expect(runtimeLock.version).toBe(runtimePackage.version);
    expect(runtimeLock.packages[""].version).toBe(runtimePackage.version);
    expect(runtimeLock.packages[""].dependencies).toEqual(runtimePackage.dependencies);
    expect(runtimeLock.packages[""]).not.toHaveProperty("devDependencies");
  });

  it("commits a staged package and removes the backup only after success", () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-package-transaction-"));
    const destination = resolve(temporary, "app");
    const staging = resolve(temporary, "app-staging");
    const backup = resolve(temporary, "app-backup");
    try {
      mkdirSync(destination);
      mkdirSync(staging);
      writeFileSync(resolve(destination, "marker.txt"), "old");
      writeFileSync(resolve(staging, "marker.txt"), "new");
      expect(commitStagedPackage({ destination, staging, backup })).toEqual({ committed: true, replacedExisting: true });
      expect(readFileSync(resolve(destination, "marker.txt"), "utf8")).toBe("new");
      expect(existsSync(backup)).toBe(false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("restores the previous app and never deletes its backup when commit fails", () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-package-rollback-"));
    const destination = resolve(temporary, "app");
    const staging = resolve(temporary, "app-staging");
    const backup = resolve(temporary, "app-backup");
    const removed: string[] = [];
    let renameCount = 0;
    try {
      mkdirSync(destination);
      mkdirSync(staging);
      writeFileSync(resolve(destination, "marker.txt"), "old");
      writeFileSync(resolve(staging, "marker.txt"), "new");
      expect(() => commitStagedPackage({ destination, staging, backup }, {
        existsSync,
        renameSync(from: string, to: string) {
          renameCount += 1;
          if (renameCount === 2) throw new Error("injected staging rename failure");
          renameSync(from, to);
        },
        rmSync(path: string, options: object) {
          removed.push(path);
          rmSync(path, options);
        },
      })).toThrow("injected staging rename failure");
      expect(readFileSync(resolve(destination, "marker.txt"), "utf8")).toBe("old");
      expect(readFileSync(resolve(staging, "marker.txt"), "utf8")).toBe("new");
      expect(removed).not.toContain(backup);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("preserves a recoverable backup when both commit and rollback fail", () => {
    const temporary = mkdtempSync(join(tmpdir(), "blockwright-package-recovery-"));
    const destination = resolve(temporary, "app");
    const staging = resolve(temporary, "app-staging");
    const backup = resolve(temporary, "app-backup");
    const removed: string[] = [];
    let renameCount = 0;
    try {
      mkdirSync(destination);
      mkdirSync(staging);
      writeFileSync(resolve(destination, "marker.txt"), "old");
      writeFileSync(resolve(staging, "marker.txt"), "new");
      expect(() => commitStagedPackage({ destination, staging, backup }, {
        existsSync,
        renameSync(from: string, to: string) {
          renameCount += 1;
          if (renameCount >= 2) throw new Error(`injected rename failure ${renameCount}`);
          renameSync(from, to);
        },
        rmSync(path: string, options: object) {
          removed.push(path);
          rmSync(path, options);
        },
      })).toThrow("recoverable backup remains");
      expect(existsSync(destination)).toBe(false);
      expect(readFileSync(resolve(backup, "marker.txt"), "utf8")).toBe("old");
      expect(readFileSync(resolve(staging, "marker.txt"), "utf8")).toBe("new");
      expect(removed).not.toContain(backup);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
