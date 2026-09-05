# 3D Reviewer

Use `review_build` after compilation when the user wants to inspect or annotate the exact output rather than only read a summary.

## What is authoritative

- Coordinates, identifiers, states, phases, bounds, counts, and the build hash come from the immutable canonical build record.
- The reviewer renders common stateful shapes for stairs, slabs, trapdoors, doors, panes, fences, walls, and lanterns. Other blocks may use a full-cube approximation.
- User-selected Java resource-pack ZIPs or client JARs stay in the browser. Without one, procedural colors are labeled as fallback.
- Lighting and complex multipart geometry are architectural approximations, not the Minecraft engine.

## Review workflow

1. Choose Orbit, Select block, Select region, or Measure. Region and measurement modes use two exact world-coordinate clicks.
2. Use cardinal/elevation views, the Y-layer clipper, and Hide roof to inspect interiors, roof undersides, circulation, and support contact.
3. Save annotations as Change, Fix, Remove, or Liked. Include the intended rule in the note, not only what looks wrong at one coordinate.
4. Export review JSON when feedback needs to move between chats or tools. Import only when its build hash matches the current build.
5. Call `audit_build` after any issue is identified. Group the annotation into a defect class and check all analogous placements before revising.
6. After `revise_build`, invalidate the old hash-bound review and rerun the audit. Open one replacement review only when the user asks to inspect it; never auto-open another card after compile or revision.

## Mobile lifecycle

- Inline review is a compact audit/material summary. It must not download all placements or allocate WebGL resources.
- 3D is explicit, fullscreen, and single-owner. Opening it retires any older Blockwright 3D instance in the same host where cooperative lifecycle messaging is available.
- **Close viewer** must stay visible on narrow screens and release paging, textures, and Canvas immediately even if the host cannot remove an older result card.
- Keep exact high-cardinality palette data, but virtualize/search the list and create GPU resources only for the active layer or chunks.

## Global defect classes

The audit checks every placement for incomplete common block states, unsupported roof stairs and lights, dangling pane/fence/bars/wall arms, isolated non-landscape blocks, and generator writes that targeted the same coordinate. Counts are exact even when coordinate samples are capped for response size.

Audit findings are prompts for inspection, not automatic proof that Minecraft will reject a schematic. Explain likely false positives and use the visual reviewer plus design intent before changing valid decorative details.
