# Changelog

## [Unreleased]

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

[Unreleased]: https://github.com/TommyMoonn/archeion/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/TommyMoonn/archeion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/TommyMoonn/archeion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TommyMoonn/archeion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TommyMoonn/archeion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TommyMoonn/archeion/releases/tag/v0.1.0
