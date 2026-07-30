# Visual Foundations

This note records the shared visual contract introduced in Phase 0.4.0.1. Feature styles should consume these roles instead of adding one-off font, icon, control, radius, or elevation values.

## Typography

Inter is Archeion's bundled default application UI font. The application does not depend on a system Inter installation. Segoe UI and system fonts remain defensive fallbacks, and the supported UI weights are regular (`400`), semibold (`600`), and bold (`700`).

The canonical `@font-face` declarations live in `src/styles/fonts.css`. Their three static WOFF2 sources come from the exact pinned `inter-ui@4.1.1` development package and are verified against the approved Inter v4.1 hashes in `scripts/inter-font-manifest.json`. Vite emits only those selected faces into the application bundle. The assets are owned by the Inter Project Authors, and their notice is stored at `public/licenses/fonts/Inter-OFL-1.1.txt`.

The application type scale is deliberately compact but readable. Sizes use `rem` so browser and system text scaling can enlarge the interface without changing its default 16px-root appearance:

| Role                 | Size        | Default size | Typical use                            |
| -------------------- | ----------- | ------------ | -------------------------------------- |
| `--type-caption`     | `0.75rem`   | 12px         | secondary labels and compact metadata  |
| `--type-meta`        | `0.8125rem` | 13px         | standard metadata and compact controls |
| `--type-body`        | `0.875rem`  | 14px         | primary UI copy and navigation         |
| `--type-body-large`  | `0.9375rem` | 15px         | emphasized body copy                   |
| `--type-title-small` | `1rem`      | 16px         | local titles                           |

Every canonical text role owns a size, line height, and default weight. Display roles also own their justified tracking. Semantic aliases identify application titles, control labels, supporting body text, and code or path content without introducing additional size steps.

These values apply to application surfaces such as the shell, library, archive and settings workflows, dialogs, menus, forms, empty states, and feedback. Normal and compact density may change spacing and control geometry, but they share the same type roles. Application-root font smoothing is intentionally not injected into EPUB publication documents.

Reader typography has separate ownership. `.reader-page` and `.reader-status-page` retain the established reader-control scale through scoped overrides, while reader-selected typefaces, sizes, and bundled reading fonts continue to apply only inside EPUB publication content. Application typography changes must not alter reader chrome or publication layout.

Use the named text roles from `tokens.css`:

- `--type-caption` for secondary labels and compact metadata
- `--type-meta` for standard metadata and supporting text
- `--type-body` and `--type-body-large` for primary UI copy
- `--type-control-label` for actionable labels and `--type-body-supporting` for explanatory copy
- `--type-code` for paths, identifiers, and code-like values
- `--type-application-title` for the mounted application wordmark
- `--type-title-small`, `--type-title`, and `--type-heading` for local hierarchy
- the dialog, section, page, and display roles for large headings

Consume the matching `-line-height`, `-weight`, and, where defined, `-letter-spacing` companion instead of rebuilding a role selector by selector.

Interactive labels, navigation, important status text, and primary metadata must not drop below `--type-caption`. Caption is the smallest application role and should remain reserved for genuinely secondary information.

## Icons and Geometry

Use `.icon-slot` around SVG glyphs. The slot owns layout stability while the glyph role owns visible size. Compact, standard, and prominent roles are available. Do not restore fractional borders or rotated CSS shapes for static icons when an SVG exists.

Recurring controls should consume the compact, standard, or prominent control-height tokens. Use the shared border, radius, danger, error, and elevation tokens before introducing a feature-specific value.

Surface geometry follows semantic roles rather than local numeric values:

| Role              | Token              | Typical use                                       |
| ----------------- | ------------------ | ------------------------------------------------- |
| Small nested item | `--radius-small`   | menu rows, compact covers, and shortcut caps      |
| Control           | `--radius-control` | buttons, fields, selectors, and compact utilities |
| Floating menu     | `--radius-menu`    | menus, popovers, and supplemental panels          |
| Inline card       | `--radius-card`    | collection cards, grouped content, and callouts   |
| Modal dialog      | `--radius-dialog`  | dialogs and other blocking raised surfaces        |
| Capsule           | `--radius-pill`    | badges, tags, and progress tracks                 |

Nested surfaces must remain concentric. An inner item should use a smaller radius than its containing surface after accounting for the container padding.

Elevation also follows surface ownership:

- `--shadow-card` gives inline cards and raised artwork restrained separation.
- `--shadow-tooltip` is reserved for compact supplemental overlays.
- `--shadow-popover` identifies menus, popovers, transient feedback, and floating panels.
- `--shadow-dialog` identifies blocking modal surfaces.
- `--shadow-drawer` identifies edge-attached drawers.

The primary workspace is attached to the application frame rather than elevated above it. Its open right and bottom edges, rounded leading corner, and quiet structural border establish the boundary without a shadow or outer inset.

Borders communicate structure. Shadows communicate overlap and elevation. Raised surfaces use the quiet structural border and the matching elevation token rather than pairing a strong border with a strong shadow. Forced-colors mode removes authored shadows and restores system-color borders, so geometry remains legible without relying on elevation.

## Motion

Application motion is opt-in. The appearance runtime sets `html[data-motion="on"]` only when the user enables animations and the operating system does not request reduced motion. Motion durations remain `0ms` at the root and return to `0ms` under `prefers-reduced-motion: reduce`, so feature styles must not place animation declarations outside the effective-motion selector.

The shared motion language assigns movement by purpose instead of applying one vertical entrance everywhere:

| Role                   | Primitive                             | Typical use                                                                               |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| View frame             | `app-motion-view-header-in`           | Library, Folder, and Series headers                                                       |
| View content           | `app-motion-view-content-in`          | Library, Folder, Series, and Settings content                                             |
| Raised overlay         | `app-motion-scale-in`                 | Dialogs and Quick Actions                                                                 |
| Transient notice       | `app-motion-notice-in`                | Settings status and Library feedback                                                      |
| Hierarchy disclosure   | `app-motion-disclosure-in`            | Nested folder children                                                                    |
| Spatial panel          | directional slide                     | Details drawers, Reader table of contents, and Archive Manager forward or back navigation |
| Supplemental hint      | `app-tooltip-bounce-in`               | Tooltips, with a restrained placement-aware scale overshoot                               |
| Indeterminate activity | `app-motion-pulse` or `loading-sheen` | Loading indicators that remain visible while work is active                               |

Collection-facing views use a restrained split settle rather than an opacity-only fade. The header drops into place by 6px, then the content rises by 8px after a 42ms delay. Both movements resolve directly with no overshoot, scale, or blur, so text stays at its native raster size instead of appearing soft while the view settles. Nested grids and empty states do not run a second entrance animation. Larger directional translation remains reserved for edge-attached panels or navigation where movement communicates where the surface came from. Tooltip bounce is intentionally compact and must not be reused for routine controls.

Keep one-shot entrance keyframes brief. Interactive state changes continue to use interruptible transitions. Never add a generic `transition: all`, and never rely on motion as the only indication of state.

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

## UI Integration Gate

Phase 0.4.0.6 keeps recurring menu rows and disclosure triggers on the shared menu contract, requires explicit focus-visible treatment when a surface suppresses the global outline, and preserves the 900 by 600 main-window minimum. `tests/uiIntegrationGate.test.ts` protects these cross-surface invariants without replacing the owner-run Windows matrix.
