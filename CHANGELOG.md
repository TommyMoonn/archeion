# Changelog

## [Unreleased]

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

[Unreleased]: https://github.com/TommyMoonn/archeion/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TommyMoonn/archeion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TommyMoonn/archeion/releases/tag/v0.1.0
