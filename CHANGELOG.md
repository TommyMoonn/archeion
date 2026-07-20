# Changelog

## [Unreleased]

## [0.7.0] - 2026-07-20

Archeion's responsiveness and interface-polish release for smoother large libraries, faster archive work, safer resource handling, and more reliable local persistence.

### Added

- Added windowed rendering for large Library grid and list collections so mounted books and covers remain proportional to the visible viewport while selection, keyboard access, focus restoration, and reader-return position continue to work across unmounted ranges.
- Added one reusable in-memory library index for book lookup, folder membership, searchable fields, metadata facets, Smart Views, reading-state counts, and series derivation without introducing a database or changing archive formats.
- Added viewport-aware AppSelect placement that can open above or below its trigger, stay inside the visible window, clamp its height and width, and scroll long option lists without taking scroll ownership away from dialogs.
- Added Website, Documentation, and Source code destinations to the About dialog, together with a centralized runtime application-version fallback and the shared modal lifecycle and motion behavior.
- Added explicit safety limits for oversized EPUB cover resources, extreme image dimensions or pixel counts, and active reader EPUB files above 256 MiB.

### Changed

- Made archive updates incremental for known add, remove, rename, move, folder, metadata, cover, favorite, progress, and bulk-operation outcomes, while retaining one safe full-scan fallback for ambiguous or externally changed state.
- Improved cold archive scanning with a reusable scanner-cache signature index, bounded metadata parsing, deterministic publication order, cancellation checks, and typed watcher batching without adding unbounded filesystem concurrency.
- Revised the non-reader typography scale for clearer navigation, metadata, controls, menus, dialogs, Settings, Archive Manager, Library, Folder, and Series surfaces while preserving reader publication typography and reader-specific controls.
- Unified collection spacing across Library and Folder grid and list modes and replaced the cramped framed view selector with one shared accessible icon-only grid/list control.
- Deduplicated concurrent same-cover work, moved stale cover cleanup out of the per-cover load path, and kept cache maintenance bounded without changing negative-cover cache behavior.
- Tightened active reader file ownership so concurrent same-book opens share one frontend load, stale or cancelled results cannot replace the current book, and EPUB.js resources are released on replacement, failure, and reader teardown.
- Streamlined startup by resolving preferences and the archive registry concurrently, beginning window restoration as soon as preferences are ready, preparing active storage once, and preserving remembered-reader restoration and Archive Manager startup behavior.
- Coalesced rapid reading-progress and permitted preference updates into bounded latest-value writes, with explicit flushing on reader exits, archive transitions, and window close while immediate library, annotation, appearance, filesystem, and destructive writes remain immediate.
- Consolidated the identical low-level temporary-file, flush, replacement, restoration, and cleanup mechanics used by archive metadata, scanner invalidation state, and global settings while preserving each format's existing validation, backup, recovery, and error policies.

### Fixed

- Preserved the active folder route, breadcrumb, sidebar state, focus, and collection scroll position when the current folder or one of its ancestors is renamed or moved.
- Prevented select menus near viewport or dialog edges from opening off-screen, detaching from their trigger, or disabling the dialog panel's intended scrolling behavior.
- Prevented duplicate cover extraction and decode work for concurrent requests and blocked oversized or pathological cover fallbacks from crossing the application boundary.
- Prevented stale EPUB reads, reader sessions, startup results, archive operations, and queued metadata outcomes from publishing after their book, archive, window, or operation ownership changed.
- Corrected the Archive Manager close lifecycle so startup resumes whether the close signal arrives before or after the manager screen commits, without duplicate storage preparation or a later obsolete startup result restoring the manager state.
- Made failed coalesced progress writes roll back once to the last persisted progress fields without overwriting favorites, paths, source metadata, cover revisions, added books, removed books, or newer progress selections.
- Kept explicit progress retries, concurrent flushes, superseded writes, and callback failures synchronized so a lifecycle flush cannot settle while owned metadata work continues in the background.
- Preserved previous files and removed incomplete transaction files when an eligible atomic metadata or settings replacement fails.

### Testing

- Expanded large-library coverage for window ranges, mounted item counts, scrolling, selection, search, filters, sorting, folders, series, cover request bounds, and reader-return restoration.
- Added representative 50, 500, and 2,000 EPUB scanner fixtures covering cold and warm scans, bounded parsing, deterministic results, cache reuse, watcher convergence, import suppression, cancellation, and archive switching.
- Expanded interface coverage for semantic typography, collection spacing, accessible view controls, viewport-aware select placement, dialog scrolling, About links, motion, focus restoration, and reduced-motion behavior.
- Added native and frontend coverage for cover request ownership, image and EPUB resource limits, cover cache maintenance, active EPUB byte lifetime, startup ordering, Archive Manager close races, folder path continuity, metadata coalescing, failure recovery, explicit retries, lifecycle flushes, and atomic replacement restoration.

## [0.6.0] - 2026-07-16

Archeion's reader-fidelity release for footnotes, safe links, illustration viewing, and original-image export.

### Added

- Added footnote and endnote popovers that keep the current reading position and preserve useful text, lists, emphasis, links, and supported local images.
- Added safe routing for EPUB links: internal links use the existing reader navigation flow, while external HTTP and HTTPS links require confirmation before opening in the system browser.
- Added a focused local illustration viewer with Fit, Actual size, bounded zoom, wheel and trackpad zoom, keyboard controls, and drag-to-pan interaction.
- Added native **Save image** support for original AVIF, GIF, JPEG, PNG, and WebP resources without capturing, resizing, or re-encoding the displayed view.

### Changed

- Made safe standalone EPUB illustrations accessible by click, Enter, and Space while keeping wheel page turns and continuous scrolling responsive when the pointer is over the image.
- Kept footnotes, links, and illustration actions within the active reader lifecycle so the EPUB book, rendition, reading location, focus, and theme remain stable.

### Fixed

- Prevented illustration-modal wheel, trackpad, pointer, and keyboard input from reaching the reader underneath it.
- Rejected malformed, remote, traversal, scriptable, ambiguous, oversized, and unsupported local content before it can be opened or exported.
- Prevented stale illustration work, object URLs, loaded target documents, and temporary export files from surviving close, replacement, cancellation, or reader-session changes.

### Testing

- Expanded reader coverage for link classification, footnote sanitization, focus and dismissal, illustration resolution, zoom and pan geometry, input isolation, resource cleanup, and rendition preservation.
- Added frontend and Rust coverage for native image export validation, supported image types, byte limits, atomic replacement, restoration after failure, and shared media-type rules.

## [0.5.0] - 2026-07-16

Archeion's make-it-yours release for safe, archive-local application and reader themes.

### Added

- Added archive-local JSON theme packages under `.archeion/themes/`, with independent application and reader selections that remain portable with the archive.
- Added a Theme Manager for browsing built-in and custom application themes, inspecting validation diagnostics and color swatches, importing packages, previewing changes, selecting a theme, deleting packages, reloading external edits, and opening the archive themes folder.
- Added temporary application-theme previews with safe Keep and Revert controls, contrast-warning acknowledgement, and automatic rollback when the manager closes or the active archive changes.
- Added a public version 1 JSON Schema, dark and light example packages, and a complete authoring guide for creating themes in external editors.
- Added shared archive reader-theme selection in Settings and the in-reader settings panel, including Light, Sepia, Dark, and compatible custom reader palettes.

### Changed

- Consolidated active-archive appearance into one **App themes** control and one **Reader theme** control while retaining global preferences only as safe startup, legacy, and recovery fallbacks.
- Made application and reader theme references archive-owned and stored them in version 2 of `.archeion/settings.json` without requiring existing archives to be reorganized.
- Routed supported application, dialog, library, settings, Archive Manager, reader chrome, and EPUB content colors through the semantic theme contract.
- Made Theme Manager application-only, with one flat theme list, a visible Selected state, and focused import, preview, selection, deletion, reload, folder, guide, and schema actions.
- Made external theme editing an explicit Reload workflow rather than introducing a watcher or polling loop.
- Kept annotation highlight identities, Windows close-button treatment, and cover-overlay controls fixed where their visual meaning must remain stable across themes.

### Fixed

- Fixed archive theme selection failing with `Cannot read properties of undefined (reading 'createArchiveCommandScope')` by preserving the storage receiver behind a narrow appearance settings boundary.
- Prevented rapid application and reader changes from overwriting one another while archive settings writes are pending.
- Prevented stale theme reads, writes, previews, and catalog operations from publishing after an archive switch or newer appearance operation.
- Reconciled failed appearance writes and reloads with the authoritative persisted archive settings instead of leaving runtime state different from disk.
- Preserved missing or invalid custom theme references while applying safe fallback palettes so restored packages can recover after Reload.
- Preserved the active EPUB book, rendition, chapter, and reading location when reader palette colors change.
- Hardened managed theme package operations against traversal, invalid Windows names, oversized or invalid files, symlink or junction escapes, partial writes, and unconfirmed replacement.

### Testing

- Added regression coverage for schema and runtime validation, built-in bootstrap parity, derived colors, contrast warnings, package path safety, atomic replacement, catalog diagnostics, archive settings migration, and archive-generation invalidation.
- Expanded integration coverage for application and reader persistence, preview Keep and Revert behavior, rapid cross-channel changes, Theme Manager workflows, shared reader selectors, EPUB palette updates, and removal of obsolete theme-management paths.

## [0.4.0] - 2026-07-15

Archeion's annotation-focused release for bookmarks, highlights, attached notes, and durable reading research.

### Added

- Added persistent reader bookmarks, text highlights, and optional notes attached to highlights.
- Added a unified annotation panel for browsing, navigating, editing, and deleting saved annotations.
- Added Markdown and versioned JSON exports for bookmarks, highlights, and attached notes from the reader or a multi-book library selection.
- Bundled Inter locally for application UI typography with pinned asset hashes and packaged license notices.

### Changed

- Unified recurring controls, menus, focus states, status tokens, typography, and layout geometry across library, reader, settings, dialogs, and Archive Manager surfaces.
- Made saved highlights directly editable and kept note creation within the highlight workflow instead of exposing separate note-only actions.
- Made Smart Views individually configurable in Settings while preserving enabled views and library context across navigation.
- Updated the project site with an interactive library preview and direct links to stable installer assets.

### Fixed

- Corrected highlight-palette anchoring, dismissal behavior, and overlapping reader transient surfaces.
- Prevented notes from existing independently of highlights and tightened annotation persistence around the supported bookmark and highlight model.
- Preserved annotations across EPUB content changes, surfaced detached locations, and added recovery workflows for anchors that can no longer be resolved automatically.

### Testing

- Expanded regression coverage for annotation persistence and recovery, bookmark and highlight interaction, note editing, export workflows, panel navigation, reader lifecycle behavior, configurable Smart Views, shared controls, and bundled UI font assets.
- Strengthened release tooling and CI validation for packaged assets, stable Windows bundle names, and production builds.

## [0.3.0] - 2026-07-12

Archeion's organize-at-speed release for large archive maintenance, safe EPUB changes, and context-preserving reading.

### Added

- Added explicit multi-selection with Ctrl-click, Shift-click range selection, visible-result selection, and keyboard-friendly selection controls.
- Added safe bulk actions for moving books, changing favorites, deleting, re-extracting metadata, regenerating covers, exporting EPUBs, and editing shared metadata.
- Added per-item bulk results with success, failure, and skipped outcomes so partial failures remain actionable.
- Added external EPUB drag-and-drop import for the archive root, the current folder, and folder targets, with conflict handling and an accessible Add EPUB fallback.
- Added internal drag-and-drop book organization while preserving the existing dialog-based move workflow.
- Added bulk metadata editing for series, publisher, language, and subjects/tags with mixed-value previews and replace, add, and remove tag operations.
- Added transactional embedded cover replacement with image validation, crop/fit preview, EPUB 2 and EPUB 3 package support, rollback, and generated-cover refresh.
- Added Continuous reader mode with natural vertical scrolling, persisted canonical locations, mode switching, and bounded chapter retention alongside Paged mode.
- Added the Ctrl+Shift+P Quick Actions palette with contextual library and reader commands, keyboard navigation, recent-command ranking, and lazy loading.

### Changed

- Preserved the originating library surface, search state, and scroll position when returning from the reader, including reader-to-reader and next-volume navigation.
- Made selection, bulk operations, drag-and-drop, dialogs, cover writeback, reader controls, and Quick Actions keyboard accessible with predictable focus and layered Escape behavior.
- Made bulk operations use bounded, archive-safe workflows with one reconciliation pass where practical and clear confirmation copy for filesystem and EPUB effects.
- Kept generated covers as cache output while making the embedded EPUB cover the sole source of truth.
- Reduced repeated library derivation, bulk lookup, cover-cache invalidation, and reader document retention work for larger personal archives.
- Split cover writeback, library workspace orchestration, and storage operations into cohesive boundaries while keeping existing public behavior and safety contracts.
- Preserved compatibility with existing archives and retained the local-first, no-account, no-telemetry model.

### Fixed

- Prevented continuous scrolling from snapping backward, losing wheel input, or rendering blank gaps after scroll recovery.
- Prevented reader return from resetting users to the Library root or losing the active browsing context.
- Prevented one failed item from cancelling an otherwise independent bulk operation and kept failed or skipped items available for retry.
- Preserved EPUB metadata, package structure, transaction rollback, watcher suppression, and archive-generation checks during bulk and cover writeback operations.
- Made cover package rewrites deterministic and retained stale-preview and temporary-file validation before replacing an active EPUB.
- Prevented archive watcher races and redundant rescans during filesystem operations.
- Removed stale, non-actionable Quick Actions entries and kept palette labels concise without duplicate category or obsolete explanatory copy.

### Testing

- Expanded targeted regression coverage across selection, bulk actions, drag-and-drop, metadata editing, cover preview/writeback, reader return, continuous mode, Quick Actions, dialogs, storage operation boundaries, and cover package boundaries.
- Added performance and architecture checks for large-library derivation, stable collection rendering, bounded reader retention, lazy surfaces, storage ownership, and production payload changes.
- Verified formatting, linting, TypeScript type checking, focused frontend and Rust boundary tests, and production bundle generation during the 0.3.0 implementation work.

## [0.2.0] - 2026-07-11

Archeion's navigate-and-continue release for long EPUBs and multi-volume series.

### Added

- Added a searchable EPUB table of contents with nested chapter navigation, current-chapter highlighting, and direct chapter jumps.
- Added chapter-aware reader controls with the current chapter title, previous and next chapter actions, and chapter-relative progress.
- Added Series overview and detail views with representative covers, natural volume ordering, reading summaries, and conservative gap or duplicate-volume hints.
- Added Continue Series actions that resume the most recently opened incomplete volume or open the first unread volume.
- Added an explicit Next Volume action when the current volume is effectively complete and the next known volume is unambiguous.
- Added composable metadata filters for series, subjects, language, publisher, reading status, favorites, missing metadata, and missing covers.
- Added derived Smart Views for Unread, In Progress, Completed, Needs Metadata, and Needs Cover.
- Added progress-clearing controls that reset a saved reading position without changing unrelated book metadata.

### Changed

- Made series grouping and volume ordering derive from EPUB metadata without rewriting the source EPUB.
- Preserved raw series and volume values for display and editing while using normalized keys and sortable volume tokens internally.
- Made filters compose with the current folder, search query, sorting, and view mode.
- Made Smart Views collapsible by default so they remain accessible without permanently occupying sidebar space.
- Kept archive-specific filter selections only when their metadata values exist in the successfully loaded active archive.
- Lazy-loaded the table of contents and Series surfaces and reduced repeated series, filter, and library derivation work.
- Consolidated chapter navigation, series ordering, continuation, and reading-status logic into shared derived models.
- Kept existing `0.1.x` archives compatible without a destructive migration.

### Fixed

- Correctly tracked chapters that share one XHTML document by comparing EPUB CFIs instead of relying only on document hrefs.
- Resolved relative, encoded, fragmented, queried, and NCX-based table-of-contents targets against the correct spine document.
- Prevented table-of-contents loading, settings updates, callback changes, and chapter publication from recreating the active book or rendition.
- Avoided eagerly loading and retaining fragmented spine documents while preparing chapter navigation.
- Prevented ambiguous series ordering from exposing an unsafe Next Volume action.
- Allowed saved progress to be cleared when a book has a persisted CFI at zero percent.
- Prevented failed archive loads from pruning deliberate series, subject, language, or publisher filters.

### Testing

- Expanded regression coverage across EPUB navigation, reader lifecycle stability, table-of-contents interactions, chapter-aware controls, series derivation, natural volume ordering, continuation actions, metadata filters, Smart Views, archive switching, and progress clearing.
- Added performance-focused coverage for lazy reader and Series surfaces, stable reader sessions, memoized derivations, and filter changes that do not rescan the archive.

[Unreleased]: https://github.com/TommyMoonn/archeion/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/TommyMoonn/archeion/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/TommyMoonn/archeion/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/TommyMoonn/archeion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/TommyMoonn/archeion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TommyMoonn/archeion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TommyMoonn/archeion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TommyMoonn/archeion/releases/tag/v0.1.0
