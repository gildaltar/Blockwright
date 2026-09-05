# Blockwright — Minecraft Build Architect

Blockwright is a deployable Skybridge MCP/ChatGPT App and responsive React + Three.js workbench that turns a constrained build specification into a deterministic, exact Minecraft block plan.

## What ships

- Streamable HTTP MCP endpoint at `/mcp`.
- Local liveness and readiness endpoints at `/health` and `/ready` for operator tooling.
- Twenty-seven MCP tools, including adaptive palette sessions, safety preflight, seeded candidates, live Java synchronization, local world discovery, real schematic import/export, whole-build structural auditing, a dedicated 3D reviewer, and guarded WorldEdit installation.
- Human-readable tool titles, complete parameter guidance, structured output schemas, and invocation status text for MCP hosts.
- Exact integer `x/y/z` placements; one viewer cube equals one Minecraft block.
- One immutable build record feeds the viewer, counts, layers, validation, hash, and every export.
- Interactive perspective/orthographic viewer with orbit, preset cameras, layer slicing, exploded layers, material highlighting, and construction playback.
- State-aware 3D reviewer with exact block/region selection, distance measurement, roof hiding, layer clipping, categorized annotations, matching review JSON import/export, and global defect-class findings.
- JSON, CSV, Java `.mcfunction`, Bedrock `.mcfunction`, Sponge Schematic v3 `.schem`, layer blueprint, and checksummed ZIP bundle generation.
- Stateful named role palettes with exact-version validation, locking, rejection/replacement, and local texture previews.
- Modular courtyard, interlocking-volume, tower, and framed-hall generators driven by validated high-level plans and visible reproducible seeds.
- Configurable green/amber/red sizing preflight with regional generation metadata and explicit confirmation for extreme requests.
- Read-only Windows Java-world discovery plus an atomic, re-verified WorldEdit schematic installation workflow.
- More than 20 original architectural profiles.
- Java and Bedrock registries are separate and source/coverage gaps stay visible.
- Java resource-pack ZIP and client-JAR loading with blockstate/model-aware texture resolution entirely in the browser.
- A reusable ChatGPT skill in `skill/SKILL.md`.
- A real compiled example in `examples/nordic-hearth-lodge/`.

## Accuracy and data policy

The Java release manifest reported `26.2` when registry metadata was synchronized on 2026-09-02. Blockwright verified the official Java 26.2 client JAR SHA-1 and derived 1,198 namespaced block identifiers from its blockstate assets. Bedrock identifiers come from Microsoft’s `@minecraft/vanilla-data` package.

Blockwright does not redistribute Mojang texture artwork. The viewer accepts a resource-pack ZIP or official client JAR selected by the user, resolves its blockstate/model texture references locally, and never uploads the archive. Unresolved materials use procedural colors. Exact engine light propagation remains outside this vertical slice.

Sponge Schematic v3 export was successfully loaded by the released WorldEdit CLI 7.4.4 against Java 26.2 data. Direct Java Anvil editing and Bedrock LevelDB/`.mcworld` parsing remain explicitly unavailable. Blockwright never claims it directly changed a save; it installs a reversible schematic only after confirmation.

## Run locally

Requirements: Node.js 22.23.1 or newer (Node 24 recommended) and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, run `compile_build`, and choose **Open workbench**. The MCP endpoint is `http://localhost:3000/mcp`.

To check Mojang's current Java release and synchronize it:

```bash
npm run check:java
npm run sync:java -- latest
```

The sync command verifies the official client SHA-1, writes an exact local registry, and creates a local vanilla resource ZIP for the workbench. You can also load your existing resource-pack ZIP or select the matching client JAR from the Minecraft launcher version folder.

## Verify

```bash
npm test
npm run sample
npm run build
npm run diagnose
```

`npm run verify` runs the tests, production build and packaging, clean runtime installation, read-only diagnostics, and a clean production-runtime lock verification together. CI additionally runs `npm run verify:packaged-sync` so a rebuilt-but-uncommitted `app/` cannot pass and later ship stale generated files. Diagnostics check the Node and npm versions, manifest and lock alignment, direct dependency versions, MCP launch configuration, packaged runtime assets and Java registries, separate source-build health, skill-copy drift, packaged-build drift, and Windows control-center files. Use `node scripts/diagnose.mjs --json` for stable machine-readable `{ summary, checks }` output.

## Connect to ChatGPT

Run `npm run dev:tunnel`, copy the HTTPS forwarding URL, enable Developer Mode in ChatGPT, and create an app pointing to `{forwarding-url}/mcp` with no authentication.

## Codex plugin

The companion `blockwright` plugin bundles the skill, local MCP bridge, production workbench, exact Java 26.2 registry, starter prompts, and a native Windows control center. Launch `scripts/windows/Launch-Blockwright-ControlCenter.vbs` for a hidden-console desktop UI that can start, stop, restart, inspect, and diagnose the local service; `Install-BlockwrightShortcut.ps1` can create a convenient shortcut.

The stdio MCP bridge starts its own local service on an isolated ephemeral port, validates the Node/runtime/dependency state first, waits for a matching ready response, and removes the full child process tree when the task ends. First launch uses the packaged runtime lock for a reproducible production-only install. If its child exits unexpectedly, the next MCP request starts a fresh instance. The bridge writes only JSON-RPC to stdout and sends operator logs to stderr.

The private app-only `get_build_chunk` helper is reserved for paginating large immutable build records inside a future reviewer paging protocol. It is intentionally hidden from model-facing workflows; the current reviewer receives the complete record so counts, search, selections, and audits remain exact.

`GET /health` is a lightweight liveness response: if it returns HTTP 200, the Blockwright process and versioned HTTP route are alive. `GET /ready` is stricter: it returns HTTP 200 only when the runtime is loaded, at least one synchronized Java registry is valid, and every asset referenced by the production Vite manifest exists; otherwise it returns HTTP 503 with per-check details. These routes are local/self-hosted operator endpoints—Alpic Cloud routes only `/mcp`.

The development command itself is intentionally stricter: it uses port 3000 only, reuses a healthy matching Blockwright server, and reports an ownership/version conflict rather than silently incrementing to another port.

## Project map

- `SPEC.md` — requirements, flows, tool architecture, and acceptance criteria.
- `DESIGN.md` / `blockwright-concept.png` — visual design source of truth.
- `src/lib/compiler.ts` — deterministic voxel compiler.
- `src/lib/preflight.ts` — configurable size/resource risk estimation and confirmation tokens.
- `src/lib/palette-studio.ts` — adaptive palette state and durable named palettes.
- `src/lib/schematic.ts` — Sponge Schematic v3 NBT import/export.
- `src/lib/reviewer.ts` — whole-build state/contact/support/connection audit and portable review types.
- `src/lib/worlds.ts` — safe `level.dat` discovery and guarded WorldEdit installation.
- `src/lib/exports.ts` — construction exports and checksummed bundle.
- `src/server.ts` — MCP tools and shared view registration.
- `mcp/server.mjs` — resilient stdio-to-local-HTTP bridge used by the Codex plugin.
- `scripts/diagnose.mjs` — read-only source or installed-plugin diagnostics with text and JSON output.
- `scripts/windows/` — native Windows service control center, launchers, shortcut installer, and operator notes.
- `src/views/compile-build.tsx` — interactive seeded workbench and textured role palette.
- `src/views/review-build.tsx` — state-aware exact-coordinate reviewer and annotation workflow.
- `src/views/palette-studio.tsx` / `world-browser.tsx` — palette interview and local-world UI.
- `src/data/` — registry provenance and original style profiles.
- `examples/nordic-hearth-lodge/` — generated build artifacts.
- `skill/SKILL.md` — reusable app-usage skill.
