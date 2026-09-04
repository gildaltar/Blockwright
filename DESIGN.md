# Blockwright Design System

Source of truth: `blockwright-concept.png` (1584×960).

## Visual direction

A cinematic architectural drafting table: deep charcoal-blue shell, slim graphite rails, pale blueprint lines, restrained spruce amber, and moss-green validation. The 3D voxel model is the only dominant visual.

## Layout

- 64px top bar; 52px bottom status bar.
- 300px left rail and 286px right inspector at desktop widths.
- Central canvas fills all remaining space and owns camera/tool/playback controls.
- Below 980px, rails become drawers; below 680px, the right inspector becomes a bottom sheet and compact controls wrap.
- Fullscreen is the primary mode. Inline mode renders a compact summary with an explicit user-triggered expand action.

## Tokens

- `--bg: #09131c`
- `--canvas: #071724`
- `--panel: #111a21`
- `--panel-2: #172129`
- `--line: #31404a`
- `--line-soft: #24323b`
- `--text: #f4f6f7`
- `--muted: #a5afb5`
- `--accent: #d98232`
- `--accent-bright: #f0a04a`
- `--success: #78c451`
- `--danger: #ef6d61`
- Radius: 6px controls, 8px panels; no giant rounded containers.
- Shadows: restrained 0 10px 28px black at 20–30%.

## Typography

- UI: Inter/system sans, 12–14px for controls, 15–16px for section headings.
- Build title: 20–24px, 500 weight, slight negative tracking.
- Metrics: tabular numerals where coordinates, counts, or dimensions appear.

## Components

- Quiet top bar, icon buttons with 1.5px outline icons, compact segmented controls.
- Open rails separated by 1px borders; groups divided by rules rather than nested cards.
- Palette rows with cube swatch, title, count, and selected amber outline.
- Validation uses a single green check ring and plain text.
- Timeline uses small block-shaped steps and an amber playhead.

## Copy lock

Above the fold: `Blockwright`, `Nordic Hearth Lodge`, `Export build`, `Build brief`, `Styles`, `Saved builds`, `Java 26.2`, `17 × 13 × 14`, `Layer 8 / 14`, `Palette`, `Textures`, `Validation`, `Build ready`, `2,846 blocks`.

## Asset and rendering rules

- App text and controls are code-native.
- Voxel model uses exact cube geometry. Procedural materials are the fallback; user-selected Java resource-pack ZIPs and client JARs resolve textures locally in the browser and are never bundled or uploaded.
- Icons are Lucide outline icons at 1.5px stroke.
- Motion: 160ms control transitions; 500ms camera easing; construction playback advances one layer per 650ms and respects reduced motion.
## Texture pack state

The right inspector gains one compact `Textures` section below `Palette`. Its default state reads `Procedural fallback`; after a user selects a ZIP or client JAR it shows the pack filename and resolved-material ratio. `Load pack` is the primary compact control and `Reset` is a low-emphasis text action. This extends the accepted workbench without changing its composition, density, palette, or hierarchy.

## Companion surfaces

Palette Studio and the local world picker reuse the same graphite/navy shell, amber primary actions, green verified targets, square-edged panels, compact typography, and fullscreen transition. Palette Studio exposes one adaptive question plus the eleven stable material roles. The world picker exposes canonical local metadata and the exact guarded WorldEdit destination without presenting direct world editing as available.
