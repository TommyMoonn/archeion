# Visual Foundations

This note records the shared visual contract introduced in Phase 0.4.0.1. Feature styles should consume these roles instead of adding one-off font, icon, control, radius, or elevation values.

## Typography

Inter is Archeion's bundled default application UI font. The application does not depend on a system Inter installation. Segoe UI and system fonts remain defensive fallbacks, and the supported UI weights are regular (`400`), semibold (`600`), and bold (`700`).

The canonical `@font-face` declarations live in `src/styles/fonts.css`. Their three static WOFF2 sources come from the exact pinned `inter-ui@4.1.1` development package and are verified against the approved Inter v4.1 hashes in `scripts/inter-font-manifest.json`. Vite emits only those selected faces into the application bundle. The assets are owned by the Inter Project Authors, and their notice is stored at `public/licenses/fonts/Inter-OFL-1.1.txt`.

EPUB reader typography remains independently configurable. Reader-selected typefaces and bundled reading fonts are applied only inside publication content.

Use the named text roles from `tokens.css`:

- `--type-caption` for secondary labels and compact metadata
- `--type-meta` for standard metadata and supporting text
- `--type-body` and `--type-body-large` for primary UI copy
- `--type-title-small`, `--type-title`, and `--type-heading` for local hierarchy
- the dialog, section, page, and display roles for large headings

Interactive labels, important status text, and primary metadata must not drop below `--type-caption`.

## Icons and Geometry

Use `.icon-slot` around SVG glyphs. The slot owns layout stability while the glyph role owns visible size. Compact, standard, and prominent roles are available. Do not restore fractional borders or rotated CSS shapes for static icons when an SVG exists.

Recurring controls should consume the compact, standard, or prominent control-height tokens. Use the shared border, radius, danger, error, and elevation tokens before introducing a feature-specific value.

## Owner Visual Review

The automated checks protect token resolution and static geometry, but the final acceptance remains a Windows Tauri WebView review.

Review these representative surfaces at 100, 125, and 150 percent display scaling:

- custom title bar and window controls
- sidebar navigation and archive switcher
- library toolbar, book grid, and list rows
- reader toolbar, page click-zone arrows, table of contents, and settings
- dialogs, selects, popovers, and status feedback
- Archive Manager at 860 by 620

Repeat the review in dark and light appearance, normal and compact density, and the 1280 by 800, 900 by 600, and maximized main-window sizes. Check pointer and keyboard focus-visible states separately.
