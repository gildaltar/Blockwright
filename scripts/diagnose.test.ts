import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDiagnostics } from "./diagnose.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function writeFixtureFile(root: string, path: string, value = "") {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function writeFixtureJson(root: string, path: string, value: unknown) {
  writeFixtureFile(root, path, `${JSON.stringify(value)}\n`);
}

function addBuildFixture(root: string, prefix: string) {
  writeFixtureFile(root, `${prefix}/dist/server.js`, "export default {};\n");
  writeFixtureFile(root, `${prefix}/dist/__entry.js`, "import './server.js';\n");
  writeFixtureJson(root, `${prefix}/dist/assets/.vite/manifest.json`, { main: { file: "assets/app.js", css: ["assets/app.css"], assets: ["assets/image.png"] } });
  writeFixtureFile(root, `${prefix}/dist/assets/assets/app.js`, "export {};\n");
  writeFixtureFile(root, `${prefix}/dist/assets/assets/app.css`, "body {}\n");
  writeFixtureFile(root, `${prefix}/dist/assets/assets/image.png`, "fixture\n");
  writeFixtureJson(root, `${prefix}/data/java/26.2.registry.json`, {
    schemaVersion: 1,
    edition: "java",
    version: "26.2",
    type: "release",
    releaseTime: "2026-06-16T12:03:33.000Z",
    syncedAt: "2026-09-03T05:54:30.053Z",
    source: "Mojang Java client JAR blockstate assets",
    sourceUrl: "https://example.invalid/client.jar",
    manifestUrl: "https://example.invalid/version_manifest.json",
    client: { sha1: "a".repeat(40), size: 1 },
    worldVersion: 1,
    protocolVersion: 1,
    resourcePackVersion: { major: 1, minor: 0 },
    dataPackVersion: { major: 1, minor: 0 },
    blockCount: 1,
    blocks: [{ id: "minecraft:stone", displayName: "Stone", blockstatePath: "assets/minecraft/blockstates/stone.json" }],
  });
}

function createHealthyPluginFixture() {
  const root = mkdtempSync(join(tmpdir(), "blockwright-diagnose-"));
  const manifest = { name: "blockwright", version: "1.2.3", engines: { node: ">=0.0.0" }, dependencies: {} };
  writeFixtureJson(root, "app/package.json", manifest);
  writeFixtureJson(root, "app/package-lock.json", { name: "blockwright", version: "1.2.3", lockfileVersion: 3, packages: { "": manifest } });
  writeFixtureJson(root, ".codex-plugin/plugin.json", { name: "blockwright", version: "1.2.3" });
  writeFixtureJson(root, ".mcp.json", { mcpServers: { blockwright: { command: "node", args: ["./mcp/server.mjs"] } } });
  writeFixtureFile(root, "mcp/server.mjs", "export {};\n");
  addBuildFixture(root, "app");
  for (const name of [
    "Blockwright-ControlCenter.ps1",
    "Install-BlockwrightShortcut.ps1",
    "Invoke-BlockwrightRuntimeRepair.ps1",
    "Launch-Blockwright-ControlCenter.cmd",
    "Launch-Blockwright-ControlCenter.vbs",
    "Test-ControlCenter.ps1",
    "README.md",
  ]) writeFixtureFile(root, `scripts/windows/${name}`);
  return root;
}

describe("Blockwright diagnostics", () => {
  it("returns stable summary and per-check records", () => {
    const report = runDiagnostics(projectRoot);
    expect(report.summary).toMatchObject({ mode: "source" });
    expect(["healthy", "degraded", "unhealthy"]).toContain(report.summary.status);
    expect(report.checks.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "version_alignment",
      "node_version",
      "npm_version",
      "runtime_dependencies",
      "server_bundle",
      "view_assets",
      "java_registries",
      "source_dependencies",
      "source_server_bundle",
      "source_view_assets",
      "source_java_registries",
      "skill_sync",
      "windows_control_center",
    ]));
    for (const check of report.checks) {
      expect(check.id).toEqual(expect.any(String));
      expect(check.area).toEqual(expect.any(String));
      expect(["pass", "warning", "error"]).toContain(check.status);
      expect(check.message).toEqual(expect.any(String));
    }
  });

  it("keeps --json stdout machine-readable", () => {
    const result = spawnSync(process.execPath, [resolve(projectRoot, "scripts", "diagnose.mjs"), "--json", "--root", projectRoot], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.summary.mode).toBe("source");
    expect(Array.isArray(report.checks)).toBe(true);
  });

  it("reports an intact packaged runtime as healthy", () => {
    const root = createHealthyPluginFixture();
    try {
      const report = runDiagnostics(root);
      expect(report.summary).toMatchObject({ mode: "plugin", status: "healthy", errors: 0, warnings: 0 });
      expect(report.checks.find(({ id }) => id === "server_bundle")).toMatchObject({ status: "pass" });
      expect(report.checks.find(({ id }) => id === "view_assets")).toMatchObject({ status: "pass" });
      expect(report.checks.find(({ id }) => id === "runtime_dependencies")).toMatchObject({ status: "pass" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps source checks separate when the managed app runtime is broken", () => {
    const root = createHealthyPluginFixture();
    try {
      const sourceManifest = { name: "blockwright", version: "1.2.3", engines: { node: ">=0.0.0" }, dependencies: {} };
      writeFixtureJson(root, "package.json", sourceManifest);
      writeFixtureJson(root, "package-lock.json", { name: "blockwright", version: "1.2.3", lockfileVersion: 3, packages: { "": sourceManifest } });
      writeFixtureFile(root, "src/server.ts", "export {};\n");
      addBuildFixture(root, ".");
      writeFixtureFile(root, "skill/SKILL.md", "same\n");
      writeFixtureFile(root, "skills/blockwright/SKILL.md", "same\n");
      mkdirSync(resolve(root, "skill/references"), { recursive: true });
      mkdirSync(resolve(root, "skills/blockwright/references"), { recursive: true });
      rmSync(resolve(root, "app/dist/server.js"));
      rmSync(resolve(root, "app/dist/__entry.js"));

      const report = runDiagnostics(root);
      const runtimeBundle = report.checks.find(({ id }) => id === "server_bundle");
      expect(report.summary).toMatchObject({ mode: "source", status: "unhealthy" });
      expect(runtimeBundle).toMatchObject({ status: "error" });
      expect(runtimeBundle?.message).toMatch(/app[\\/]dist[\\/]server\.js/);
      expect(report.checks.find(({ id }) => id === "source_server_bundle")).toMatchObject({ status: "pass" });
      expect(report.checks.find(({ id }) => id === "source_view_assets")).toMatchObject({ status: "pass" });
      expect(report.checks.find(({ id }) => id === "source_java_registries")).toMatchObject({ status: "pass" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the configured MCP bridge file is missing", () => {
    const root = createHealthyPluginFixture();
    try {
      rmSync(resolve(root, "mcp/server.mjs"));
      const report = runDiagnostics(root);
      expect(report.summary).toMatchObject({ status: "unhealthy", errors: 1 });
      expect(report.checks.find(({ id }) => id === "mcp_launch")).toMatchObject({ status: "error" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a CSS or asset-array Vite reference is missing", () => {
    const root = createHealthyPluginFixture();
    try {
      rmSync(resolve(root, "app/dist/assets/assets/app.css"));
      const report = runDiagnostics(root);
      expect(report.summary.status).toBe("unhealthy");
      expect(report.checks.find(({ id }) => id === "view_assets")).toMatchObject({ status: "error" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a Java registry is parseable but structurally incomplete", () => {
    const root = createHealthyPluginFixture();
    try {
      writeFixtureJson(root, "app/data/java/26.2.registry.json", { schemaVersion: 1, edition: "java", version: "26.2" });
      const report = runDiagnostics(root);
      expect(report.summary.status).toBe("unhealthy");
      expect(report.checks.find(({ id }) => id === "java_registries")).toMatchObject({ status: "error" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
