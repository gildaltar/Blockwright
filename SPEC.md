# Blockwright — Minecraft Build Architect

## v0.6.0 Release Contract

Version 0.6.0 is the first commercially oriented Blockwright release. Its promise is narrower and stronger than “AI Minecraft builder”:

> Turn a measurable Java build brief into a deterministic, reviewable, client-ready schematic—or return an honest, actionable failure when the brief cannot be represented or verified.

The release is complete only when the supported local workflow can be installed by a non-developer, validates every declared hard requirement, persists revision history, exports a professional delivery bundle, and can be independently exercised on a clean Windows machine. Hosted commercial capabilities may ship behind explicit configuration gates, but must never appear enabled when identity, storage, billing, signing, DNS, or production credentials are absent.

**Release priorities, in order**

1. Truthful semantic contracts and immutable audit certificates.
2. A complete Java professional workflow: project, generate, review, revise, approve, and deliver.
3. A self-contained, repairable, updateable Windows distribution.
4. Essential WorldEdit and Litematica interoperability.
5. A direct browser product surface with production-safe tenant, quota, and deletion boundaries.
6. Evidence from repeatable benchmarks and real customer use; no invented case studies or compatibility claims.

**Explicit v0.6.0 boundaries**

- Supported commercial output is Java-first. Bedrock `.mcstructure`, Bedrock world output, and Marketplace workflows remain deferred.
- Code signing requires an externally supplied signing identity. Unsigned development artifacts must be labeled as such and may not satisfy the signed-release gate.
- A first-party domain, production payments, refunds, invoices, email delivery, and public review links require operator-owned service configuration. Missing configuration must fail closed.
- WinGet submission begins only after the exact installer has passed clean-machine and real-world validation.
- Showcase builds may be generated as demonstrations, but customer case studies must describe consenting real customers and measured outcomes.

## Value Proposition

Blockwright turns a plain-language Minecraft build idea into an exact, inspectable block plan. It is for players and creators who want ambitious builds without manually translating a visual idea into coordinates, layers, materials, and commands.

The painful part today is the gap between inspiration and construction: screenshots and tutorials are hard to adapt, generic AI images are not buildable, and schematic tools assume the user already has a finished block model.

**Core actions**

1. Describe a structure, style, edition, dimensions, palette, and constraints in natural language.
2. Compile and inspect a deterministic 1×1×1 voxel build with layers, counts, coordinates, and validation.
3. Export construction-ready JSON, CSV, Java `.mcfunction`, Bedrock `.mcfunction`, Sponge Schematic v3 `.schem`, blueprints, and a checksummed ZIP bundle.
4. Check Mojang's live release manifest and synchronize a new Java registry from the selected version's official client JAR.
5. Load a user-owned Java resource-pack ZIP or client JAR in the workbench and render the build with its resolved block textures.
6. Develop and persist an exact-version-valid role palette through an adaptive, one-question-at-a-time conversation.
7. Discover local Java worlds safely and install a verified schematic into an explicitly selected WorldEdit schematics folder.
8. Review any compiled build in a state-aware 3D surface with exact selections, measurements, roof hiding, layer clipping, and portable annotations.
9. Scan all placements for recurring structural defect classes so an example annotation leads to a whole-build audit rather than a one-coordinate patch.
10. Operate the PC-local server from a native Windows control center with dependency and required-file checks, start/stop/restart controls, live health details, and continuously visible logs.

## Why an LLM?

**Conversational win:** “Build a compact Nordic starter lodge for Java 26.2, 17 blocks wide, mostly spruce and stone, with a steep roof and storage loft” is much faster than drawing every layer or configuring dozens of geometry controls.

**LLM adds:** It translates intent into a constrained build specification, chooses appropriate architectural rules and palettes, explains tradeoffs, and revises the specification from natural feedback.

**What the LLM lacks:** It needs an authoritative block registry, a deterministic compiler, validation rules, world-region context, and exporters. Those are implemented as app tools rather than improvised by the model.

## UI Overview

**First view:** A cinematic voxel workbench with the active build centered on a dark blueprint grid. A concise left rail contains build presets and prompt context. A focused right inspector contains edition, dimensions, layer, palette, validation, and export controls.

**Generate:** A user invokes `compile_build` conversationally or edits a compact build brief in the widget. The server returns a single immutable build record and the view renders that exact record.

**Inspect:** Orbit, pan, zoom, switch perspective/orthographic views, isolate or explode layers, highlight materials, inspect coordinates, and play the construction sequence.

**Review:** A dedicated state-aware reviewer renders common stairs, slabs, trapdoors, doors, panes, fences, walls, and lanterns from their canonical state. Users can select blocks or regions, measure, hide roof phases, clip layers, and save Change, Fix, Remove, or Liked notes tied to exact world coordinates. The active mode, two-point progress, visible-block count, canonical selection details, inclusive dimensions, and measurement semantics stay visible while reviewing. Keyboard shortcuts accelerate mode, view, layer, roof, and annotation actions without hiding equivalent controls.

**Audit:** A global structural audit groups analogous state, contact, support, connection, isolation, and generator-overlap findings across the complete immutable placement record.

**Local Windows operation:** A native Windows utility checks Node/npm and the packaged runtime, reports actionable repair guidance, and controls one local server process. It exposes PID, endpoint, uptime, readiness, and bounded live stdout/stderr, with copy/export diagnostics for troubleshooting.

**Validate:** The same build record reports unsupported identifiers, collisions, unsupported or floating placements, protected-coordinate conflicts, and budget violations.

**Export:** Download exact block maps and commands individually or as a manifest-backed ZIP bundle with SHA-256 checksums.

**End state:** The player leaves with a verified, deterministic build plan that can be constructed manually or executed with edition-appropriate commands.

## Product Context

- **Surfaces:** ChatGPT MCP App and standalone responsive web app.
- **Protocol:** Streamable HTTP MCP endpoint at `/mcp` plus health/status endpoints.
- **Data:** Versioned Java and Bedrock block registries with source, checksum, and sync metadata. Java and Bedrock identifiers remain separate.
- **World context:** Canonical JSON region format for edition/version, origin, dimensions, blocks, protected coordinates, height maps, biome maps, structures, and terrain conflicts.
- **Auth:** Local desktop and portable modes are single-user and loopback-only. Hosted mode requires verified identity, tenant-scoped authorization on every private resource, durable tenant-scoped storage, revocable sessions, and explicit deletion. Hosted private tools fail closed when this configuration is absent.
- **Scaling:** Every placement uses integer coordinates and renders as exactly one 1×1×1 block.
- **Textures:** Do not redistribute Mojang artwork. Accept user-owned resource-pack ZIPs and official client JARs locally in the browser; otherwise use a clearly labeled procedural fallback palette. Texture files never leave the user's browser.
- **Java updates:** Resolve `latest` from Mojang's live version manifest, verify the official client JAR SHA-1, derive block identifiers from its blockstate assets, and record protocol/world/resource-pack versions. Synchronization is explicit and writes only to Blockwright's local data directory.
- **Lighting:** Minecraft-inspired directional face brightness, ambient/skylight response, and emissive response, clearly labeled as an approximation rather than the engine’s full propagation model.
- **Originality:** Architectural profiles encode general principles and failure modes, not copied creator builds.
- **Unavailable in this vertical slice:** Direct Java Anvil-region writes, Bedrock LevelDB/`.mcworld` parsing, exact Minecraft-engine lighting propagation, exhaustive reproduction of every Mojang multipart/custom block model, and automatic modification of a live/open world. World changes use the reversible WorldEdit schematic workflow.

## v0.6.0 Release Gates

**Semantic truth gate**

- Every normalized hard requirement is either linked to an executable check or rejected as unsupported before generation.
- A build is never reported as contract-valid while a hard requirement fails or remains unevaluated.
- The same normalized contract and checks run after initial generation and every revision, including selected-region revisions.
- Results distinguish hard failures, operational warnings, and subjective aesthetic observations.
- Contract and audit results are tied to the immutable build hash and can be reproduced from the build record.

**Professional workflow gate**

- Projects persist outside process memory and are private by default.
- Autosave creates immutable versions; history, before/after diff, undo-by-new-version, and selected-region revision preserve provenance.
- Client review links are random, revocable, expiring, read-only by default, and tenant-scoped. Approval or change-request state records actor and time without altering the build.
- One action creates a delivery bundle containing the selected Java artifact, material list, build contract, certificate, checksums, compatibility metadata, origin/rotation instructions, and review approval summary.

**Windows distribution gate**

- The portable ZIP and per-user x64 installer carry a private pinned Node.js runtime and do not rely on a machine-wide Node/npm installation.
- Install, same-version repair, upgrade, launch/readiness, stop, uninstall, and installer-owned-file cleanup are exercised on a clean Windows runner.
- Codex integration, `.schem` file association, and portable state are explicit user choices.
- Update checks retrieve release metadata over HTTPS, verify a published checksum and configured trusted signature before execution, stop only the managed server, install, and relaunch with rollback-safe failure reporting.
- Every published release includes `SHA256SUMS.txt`, an SPDX or CycloneDX SBOM, and a signed-artifact status that cannot be mistaken for a valid signature.
- The support bundle is generated locally with deterministic redaction of usernames, tokens, world contents, and unrelated absolute paths.

**Hosted-service gate**

- Browser onboarding works without Codex or ChatGPT.
- Authentication, tenant isolation, durable storage, deletion, rate limits, compressed and decompressed upload limits, and hostile-file parsing safeguards are covered by integration tests.
- Billing state is checked server-side. Checkout, invoices, cancellations, refunds, support contact, telemetry, and cost signals are observable without logging secrets or customer build contents.
- Local-only builds and user-owned texture data are not silently uploaded.

**Evidence gate**

- A versioned benchmark corpus contains at least 100 rights-cleared briefs across the advertised categories and records contract, export, and round-trip outcomes.
- Published compatibility claims identify the exact Minecraft Java, Sponge, WorldEdit, and Litematica versions exercised.
- Public customer case studies require customer permission and measured evidence; placeholder/demo content is labeled clearly.

## Acceptance Criteria

- Viewer, counts, validation, layers, and exports are all derived from one immutable build record.
- Repeat compilation of the same normalized input yields the same placements and hash.
- Java and Bedrock command syntax are never mixed or silently substituted.
- Large command exports are safely chunked.
- App UI is functional on desktop and mobile, keyboard accessible, and responsive.
- Core server, compiler, exporter, and HTTP/MCP behavior are covered by automated tests.
- Core build, candidate, preflight, audit, palette, and guarded-install responses publish concrete MCP schemas that are validated against their real handler data.
- Public claims distinguish verified behavior from unavailable capabilities.
- Java 26.2 compiles against an exact locally synchronized 26.2 block registry rather than a 1.21.x fallback.
- Resource-pack loading reports how many build materials were resolved and falls back per material when a texture is missing.
- A preflight report is returned before compilation and extreme builds require an explicit confirmation token.
- Build generation is modular and seeded. Style changes geometry and circulation, not only materials.
- Saved palettes round-trip by stable identifier and every Java role is validated against the exact synchronized registry.
- Sponge Schematic v3 exports round-trip through an independent NBT parser and preserve dimensions, offset, states, and supported block entities.
- World discovery is read-only, canonical-path based, bounded to standard or explicitly authorized roots, and reports `level.dat` metadata without modifying saves.
- Guided installation copies only a verified `.schem` file after explicit confirmation. Direct save editing is never attempted.
- Review selections and annotations preserve exact integer coordinates and canonical block state; imported reviews must match the immutable build hash.
- Review import rejects malformed, oversized, out-of-bounds, or unsupported annotation data without replacing the current review, and reports the result in the UI.
- Audit findings and annotation history can be searched and filtered without changing canonical totals, coordinates, or saved review state.
- Reviewer controls expose accessible names, pressed/selected state, focus indicators, and a responsive inspector usable without pointer-only interaction.
- Global review audits scan the complete placement record and preserve exact totals even when coordinate samples are capped for response size.
- The native Windows control center can diagnose a stopped installation without changing it, prevents duplicate managed launches, and leaves a clear process/log trail for every start, stop, restart, or failure.
- Windows dependency checks compare the installed Node version with the package engine requirement and verify required manifests, entry points, runtime modules, and packaged assets before launch.
- Dependency repair is serialized by an OS-owned mutex across bridge and controller processes; stale owner metadata is handled only while that mutex is held, so two `npm` repairs cannot overlap.
- The local production HTTP/MCP runtime proves an IPv4 loopback-only socket, rejects non-loopback Host/Origin values, and requires a private high-entropy bearer token before MCP JSON parsing. Hosted v0.6 is supported only on the bounded production Node listener with a persistent volume; production Vercel and Cloudflare adapters fail closed until a durable hosted data adapter can preserve tenant isolation and deletion across request lifetimes.

## UX Flows

**Create and inspect a build**

1. Describe the desired structure, edition, scale, style, and palette.
2. Compile a deterministic build record.
3. Inspect the voxel model, layers, coordinates, palette counts, and validation results in one view.
4. Revise the build from conversation or compact widget controls.

**Export a build**

1. Select an available export format from the active build.
2. Download the generated file or checksummed bundle.

**Manage a professional project**

1. Create or open a tenant-scoped project and autosave the normalized contract and current immutable build version.
2. Review version history and compare exact placement, material, contract, and certificate differences.
3. Revise the whole build or a selected inclusive region; locked requirements and placements outside the selected region remain protected.
4. Undo by restoring an earlier version as a new immutable head, preserving history rather than deleting it.
5. Create a revocable, expiring client review link and record Approved or Changes requested state.
6. Export a client delivery bundle from the approved version.

**Install, repair, and update on Windows**

1. Choose per-user installation or explicit portable mode, preferred loopback port, optional Codex integration, and optional `.schem` association.
2. Detect port conflicts, discover local Java worlds read-only, report WorldEdit compatibility, and launch the workbench.
3. Diagnose, repair, start, stop, or restart only the Blockwright-managed runtime from Control Center.
4. Check a trusted release feed, verify the downloaded artifact before execution, apply the update, and relaunch or show rollback-safe recovery guidance.
5. Export a locally redacted support bundle after a failure.

**Use Blockwright from a browser**

1. Understand the Java workflow, compatibility boundary, pricing state, and demonstrations from a first-party landing surface.
2. Create an account or sign in, enter an isolated private workspace, and complete onboarding without MCP.
3. Create, review, revise, export, and delete tenant-owned projects within enforced plan and upload limits.
4. Manage billing through the configured payment provider and reach a visible support contact.

**Review and annotate a build**

1. Open the dedicated reviewer for a canonical build record.
2. Inspect from multiple elevations or cardinal views, optionally hiding roof phases or clipping at a Y layer.
3. Select one block or a two-corner region, inspect canonical state and inclusive dimensions, measure center-to-center and axis distances if useful, and save a categorized annotation with actionable intent.
4. Search or filter annotations and audit findings, then jump to their exact sampled coordinates and visible Y layer.
5. Export a review JSON bound to the build id and hash, or import a validated matching review to continue without risking the current notes.
6. Run the whole-build audit before revision so every analogous issue is considered.

**Operate the local server on Windows**

1. Open the native Blockwright Control Center and inspect dependency, version, required-file, and runtime-module status.
2. Install or repair runtime dependencies only when requested, then start one managed local server instance.
3. Observe readiness, endpoint, PID, uptime, and live stdout/stderr while the server runs.
4. Stop or restart the managed process and copy or export bounded diagnostics when troubleshooting is needed.

**Develop a palette**

1. Begin or resume an adaptive interview; ask only the highest-value unresolved question.
2. Resolve role blocks against the exact edition/version registry.
3. Accept, reject, replace, or lock roles and inspect the live textured swatches.
4. Save, rename, reload, or delete the named palette.

**Plan and generate safely**

1. Estimate volume, occupancy, chunks, commands, export size, memory, time, and platform risk.
2. Continue normally at green risk; offer simplify/split/cancel choices at amber or red risk.
3. Require the returned confirmation token for extreme requests.
4. Generate deterministic regional phases and compare structural fingerprints when candidates are requested.

**Use a schematic in a world**

1. Discover local Java worlds or authorize another saves root.
2. Select a world, dimension, anchor, rotation, mirror, mask/include-air behavior, and installation method.
3. Review affected bounds/chunks and the preflight result.
4. Export/import a Sponge v3 `.schem`, or install the verified file into an explicitly selected WorldEdit schematics folder.
5. Receive the exact file path and `//schem load` / `//paste` instructions. No Anvil save write occurs.

**Analyze world context**

1. Provide a canonical world-region document.
2. Compare the active build with protected coordinates, existing blocks, and terrain constraints.
3. Review conflicts and cut/fill guidance.

## Tools and Views

**View: `compile_build`**

- **Input:** `{ name, edition, version, style, dimensions, palette?, origin?, features?, blockBudget? }`
- **Output:** Immutable build summary plus widget-only placement/layer data.
- **View:** Complete workbench: 3D model, layers, material list, validation, and export actions.

**Tool: `get_supported_versions`**

- **Input:** `{ edition? }`
- **Output:** Available Java and/or Bedrock registry versions with source and checksum metadata.

**Tool: `check_java_updates`**

- **Input:** `{ channel? }`
- **Output:** Mojang's current release/snapshot plus locally installed Java registries; no files are changed.

**Tool: `sync_java_version`**

- **Input:** `{ version?, includeTextures? }`
- **Output:** Verified registry metadata and local paths for the generated registry and optional vanilla resource pack.
- **Behavior:** Downloads only from URLs resolved through Mojang's official manifest and validates the client SHA-1 before writing.

**Tool: `search_blocks`**

- **Input:** `{ query, edition, version?, limit? }`
- **Output:** Matching canonical identifiers and state guidance.

**Tool: `get_style_profile`**

- **Input:** `{ style }`
- **Output:** Original architectural principles, palette guidance, and common failure modes.

**Tool: `validate_build`**

- **Input:** `{ build }`
- **Output:** Bounds, counts, collisions, identifier/state issues, support warnings, and budget status.

**Tool: `validate_build_contract`**

- **Input:** `{ build, contract? }`
- **Output:** Normalized clauses; hard pass/fail/unsupported results; warnings; aesthetic observations; aggregate status; build hash; and evaluator version.
- **Behavior:** Fails closed for unsupported or unevaluated hard clauses and never silently drops a user requirement.

**Tool: `audit_build`**

- **Input:** `{ build }`
- **Output:** Grouped whole-build findings for entrances, corridor clearance, spawn safety, room access, lighting, functional interiors, support/contact, state preservation, connection arms, isolation, generator overlap, palette legality, paste origin, budget, and exact-version compatibility, plus a human-readable certificate bound to the build hash.
- **Behavior:** Scans every canonical placement; coordinate samples are capped for response size while total counts remain exact.

**View: `review_build`**

- **Input:** `{ build }`
- **Output:** Concise build and audit summary plus view-only canonical placements and findings.
- **View:** Fullscreen state-aware 3D review surface with exact block/region selection, unambiguous inclusive and center-to-center measurements, layer clipping, roof hiding, searchable/filterable audits and annotations, keyboard shortcuts, user-owned textures, and guarded review JSON import/export.
- **State:** Camera preset/projection, layer, roof visibility, selection, in-progress two-point anchor, annotations, and reviewer filters persist in shared view state and remain available to the assistant for referential requests.

**Native utility: Blockwright Control Center (Windows)**

- **Input:** Local plugin checkout/package location and an optional preferred loopback port.
- **Output:** Dependency and required-file checks, process status, endpoint/readiness, PID, uptime, recent bounded logs, and exportable diagnostics.
- **Behavior:** Uses built-in Windows/.NET UI, owns only the server process it launches, rejects duplicate managed starts, and provides explicit start, stop, restart, refresh, repair, copy, and diagnostics actions.

**Tool: `analyze_world_region`**

- **Input:** `{ build, region }`
- **Output:** Protected-coordinate conflicts, occupied-space conflicts, and cut/fill summary.

**Tool: `render_build`**

- **Input:** `{ build, mode?, layer? }`
- **Output:** Render-ready placement data and camera guidance for the shared view.

**Tool: `export_build`**

- **Input:** `{ build, format }`
- **Output:** Downloadable JSON, CSV, Java commands, Bedrock commands, blueprint text, or ZIP bundle.

**Tool: `revise_build`**

- **Input:** `{ build, changes, region? }`
- **Output:** Newly compiled immutable build record with a new deterministic hash, parent hash, placement diff, and post-revision contract result.
- **Behavior:** A region is an inclusive integer cuboid. Region revision must preserve placements outside it and fail if the requested change cannot preserve locked hard requirements.

**Project tools: `create_project`, `list_projects`, `get_project`, `save_project_version`, `diff_project_versions`, `restore_project_version`, `delete_project`**

- **Behavior:** Durable project CRUD and append-only immutable version history. Restore creates a new head. Every private operation is tenant-scoped in hosted mode.
- **View:** Project summary, current certificate, autosave state, version timeline, exact before/after diff, approval state, and delivery action.

**Hosted review routes: create/revoke review link, resolve exact snapshot, page placements, and record decision**

- **Behavior:** Link creation and revocation require tenant-authorized hosted access. Snapshot reads and Approved or Changes requested decisions use a random expiring bearer token; the decision is hash-bound while the typed reviewer name is labeled self-asserted. All routes fail closed when hosted identity/storage are not configured.

**Tool: `create_delivery_bundle`**

- **Input:** `{ build, format, rotation?, origin?, reviewToken? }`
- **Output:** User-initiated downloadable ZIP metadata and checksums.
- **Behavior:** Includes the selected artifact, material list, normalized contract, hash-bound certificate, compatibility declaration, placement instructions, manifest, and optional persisted approval summary. Caller-authored approval claims are rejected; reviewer names remain explicitly self-asserted.

**Tool: `continue_palette_interview`**

- **Input:** `{ sessionId?, edition, version, answers?, roleChanges? }`
- **Output:** Persisted interview state, one adaptive next question, and an exact-version-valid role palette.

**Tools: `save_palette`, `list_palettes`, `load_palette`, `rename_palette`, `delete_palette`**

- **Behavior:** Durable local CRUD by stable palette identifier. Mutations are explicit and validation is version-aware.

**Tool: `estimate_build`**

- **Input:** Build contract and optional risk thresholds.
- **Output:** Volume, estimated occupied blocks/materials/chunks/commands/export bytes/memory/time, risk level, warnings, choices, and an extreme-build confirmation token when required.

**Tool: `generate_build_candidates`**

- **Input:** Validated build contract, visible seed, candidate count, and recent fingerprints.
- **Output:** Deterministic high-level plans, fingerprints, pairwise similarity, and build summaries; full placements remain widget-only.

**Tools: `export_schematic`, `import_schematic`**

- **Behavior:** Write/read GZip-compressed Sponge Schematic v3 NBT with Java `DataVersion`, unsigned dimensions, offset, state palette, varint block data, and supported block entities.

**Litematic modes: `export_build` with `format: "litematic"`, and `import_schematic` with `format: "litematic"`**

- **Behavior:** Write/read the documented Litematica container fields used by the declared compatibility matrix, preserving canonical block states, dimensions, origin, region bounds, timestamps, author metadata, and packed palette indices. Round-trip tests must use an independent parser or Litematica itself before compatibility is claimed.

**Tool: `get_material_list`**

- **Input:** `{ build, sortBy?, includeAir? }`
- **Output:** Exact canonical block-state counts, grouped base-block totals, stack/shulker estimates labeled as planning aids, and build hash.

**Tool: `discover_worlds`**

- **Input:** Optional explicitly authorized saves root.
- **Output:** Canonical stable path identifiers and safely parsed `level.dat` metadata. Read-only.

**Tool: `install_worldedit_schematic`**

- **Input:** World identifier, schematic name/data, explicit WorldEdit folder, transform/mask choices, and confirmation.
- **Output:** With `confirmed: false`, a no-write preview containing dimension, anchor, affected bounds/chunks, block and palette counts, risk, conflict status, overwrite state, and exact load/paste instructions. With `confirmed: true`, the verified installed path and post-write parse result. It never edits region files.

Compile and review responses expose the immutable build shell plus a first page capped at 500 placements; they do not attach a full build record. Both views assemble the exact record with sequential calls to an internal widget-only chunk tool capped at 5,000 placements per response. Hosted chunks are served without recompilation from a 15-minute cache keyed by tenant, user, and build id, bounded to two records per principal, four records globally, and 500,000 placements globally. Cross-principal access and cache misses fail closed with a recompile/review instruction. Views accept the older full-record metadata shape only when it contains at most 2,000 identity-matched placements.
