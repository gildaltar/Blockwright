# Blockwright 0.8 Editor Semantic Contract

## Approval and evidence

- Governing directive: `C:\Users\ezraj\Desktop\UpgradePrompt.md`, which explicitly requests implementation rather than a design brainstorming pause.
- Desktop concept: `assets/design/blockwright-080-editor-concept.png`.
- Approval status: implementation-authorized by the upgrade directive. The generated concept is a fidelity reference; it does not add requirements or substitute for working behavior.
- Purpose: let a user inspect, edit, compile, and revise canonical procedural components without invoking any model.
- Audience: Minecraft builders using the Blockwright Windows app or a full-screen MCP view.
- Truth invariants: component ids and hashes are stable; cache state is measured; exact block counts and conflicts remain data-bound; terrain effects are explicitly previewed; no terrain or world change occurs from the editor alone.

## Artifact and renderer ownership

- Artifact family: operational tri-pane procedural workspace with a component outline, a spatial voxel viewport, an exact inspector, and a task rail.
- React owns shell layout, component selection, filters, editable fields, task state, keyboard actions, and accessible summaries.
- React Three Fiber/Three.js owns the single central 3D voxel scene. Depth is evidence-bearing: it communicates component bounds, terrain grade, layer height, and spatial overlap.
- The DOM owns every exact value, label, status, and action. No factual label is baked into the concept image.
- Static fallback: component table, bounds, material list, compile report, conflict totals, and terrain metrics remain readable if WebGL is unavailable.
- Simultaneous scene count: one. Placements are grouped and instanced; React does not create one DOM node per block.
- Render-ready signal: the view exposes a stable ready marker only after the build pages and first nonblank scene frame are available.

## Coordinate and visual encoding

| Layer | Coordinates | Owner | Alignment check |
| --- | --- | --- | --- |
| Build placements | exact Minecraft x/y/z | compiler and Three.js transform | selected component bounds contain its attributed placements |
| Terrain preview | exact world x/z columns and y heights | TerrainFit and Three.js overlay | selected anchor and grading bounds match DOM readouts |
| Component graph | stable ids and dependency order | compiler and React outline | outline order matches deterministic graph order |

- Neutral context: blue-charcoal panels and grid.
- Primary focal accent: warm amber for selected/editable state.
- Success/cache hit: green with a text label.
- Rebuild/changed: amber with a text label.
- Conflict/blocking risk: red with an icon and text; color is never the sole encoding.
- Essential values visible without hover: selected component, revision, bounds, seed, dependencies, cache state, rebuild count, conflicts, task state, progress, cut/fill, and confirmation boundary.

## Workspace state and interaction

- Persisted view state: selected component id, open outline branches, camera preset, layer, active inspector section, and compact-panel preferences.
- Ephemeral state: hover, drag-in-progress, pointer position, and transient animation frame.
- Default selection: the first component in deterministic graph order.
- Selecting an outline item, scene mark, or search result updates the same inspector selection.
- Empty-surface click clears selection only when no drag occurred.
- Camera: orbit/pan/zoom plus named isometric, top, front, left, and right presets; reset is always visible.
- Keyboard: outline arrows navigate, Enter selects, Escape clears or closes, and focused controls retain native keyboard behavior.
- Reduced motion: no autoplay; camera and layer changes snap directly.
- Narrow layout: the viewport remains first; outline and inspector become closable command panels with the active selection summarized in the command bar.

## Performance and lifecycle

- The view consumes bounded build pages and bounded TerrainFit detail pages.
- WebGL resources, textures, event listeners, and animation handles are disposed on unmount and context loss has a readable fallback.
- Camera/view preferences may use small local view state; canonical designs and task results stay in Blockwright stores, not browser local storage.
- No remote or live data is required for compile, edit, validation, export, or TerrainFit. Provider status must visibly distinguish none, local, cloud-disabled, unavailable, and ready.

## QA gates

- Typecheck and deterministic unit tests for component graph, cache, revision, task state, provider routing, and TerrainFit.
- Desktop and narrow screenshots with deterministic seed, camera, layer, selected component, and reduced motion.
- Nonblank WebGL pixel/frame check plus readable no-WebGL fallback.
- Interaction smoke checks for selection synchronization, outline keyboard navigation, inspector edits, compile task submission, progress, cancellation, camera reset, and terrain-preview confirmation boundary.
- Concept comparison checks hierarchy, central viewport dominance, color roles, exact data labels, and the bottom task rail; cosmetic spacing may vary when needed for accessibility.
