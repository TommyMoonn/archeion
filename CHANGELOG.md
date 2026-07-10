# Changelog

## Unreleased

### Added

- Added the Tauri desktop archive model for local EPUB folders.
- Added the Archive Manager for opening, switching, creating, renaming, revealing, and forgetting archives.
- Added recursive EPUB scanning with preserved folder structure.
- Added library browsing, search, sort, favorites, folder navigation, details drawer, and Continue Reading.
- Added a paged EPUB reader with reading progress persistence and reader settings.
- Added EPUB metadata editing with writeback backups and validation.
- Added app-level and archive-level settings separation.
- Added an app shell error boundary for recoverable render failures.
- Added Windows NSIS and MSI packaging with deterministic release artifact names and SHA-256 checksums.
- Added a manually triggered Windows installer workflow that verifies the project before bundling.

### Changed

- Moved the product model to real local archive folders with `.archeion/` sidecar metadata.
- Reworked archive creation into a guided name and location flow.
- Simplified library derived state and cached search/filter behavior.
- Hardened reader session mounting so parent progress updates do not reset the active reader.

### Fixed

- Prevented delete actions from permanently deleting files when Trash or Recycle Bin fails.
- Made Add EPUB replacement transaction-safe so an existing archive EPUB is restored if replacement fails.
- Made archive metadata JSON writes restore the previous active file if replacement fails.
- Preserved corrupted metadata files as recovery backups.
- Surfaced scanner-cache save failures as scan warnings while allowing scans to complete.
- Improved missing archive, missing EPUB, unreadable EPUB, and metadata recovery states.

### Performance

- Improved library render behavior through derived-state extraction and search-index caching.
- Reduced reader and dialog churn around active sessions, settings application, and metadata editor state.
- Kept watcher-driven and import-driven rescans quieter to reduce unnecessary UI churn.

### Testing

- Added regression coverage for archive data safety paths, reader session stability, metadata editor stability, library derived-state caching, settings recovery, and app error-boundary fallback behavior.
