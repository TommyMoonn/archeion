# Changelog

## [Unreleased]

## [0.1.0] - 2026-07-10

Archeion's first packaged Windows release.

### Added

- Added local-first EPUB archives backed by real folders on disk.
- Added a standalone Archive Manager for creating, opening, switching, renaming, revealing, and forgetting archives.
- Added recursive EPUB scanning with preserved folder hierarchy and live filesystem refresh.
- Added library browsing, search, sorting, favorites, folder navigation, book details, and Continue Reading.
- Added a paged EPUB reader with persistent reading progress, configurable navigation, and reader appearance settings.
- Added bundled Literata and Atkinson Hyperlegible reader fonts that do not require system installation.
- Added EPUB metadata editing with validation, writeback backups, and targeted post-write refresh.
- Added real file and folder actions for adding, creating, renaming, moving, revealing, and deleting archive items.
- Added app-level and archive-level settings, including startup behavior, reader-route restoration, window geometry, and destructive-action confirmations.
- Added recovery states for missing archives, missing or unreadable EPUBs, corrupted sidecar metadata, and render failures.
- Added Windows x64 installers in NSIS and MSI formats with deterministic artifact names and SHA-256 checksums.

### Changed

- Made the filesystem the source of truth while keeping app metadata in each archive's `.archeion/` sidecar directory.
- Made the standalone Archive Manager the only archive-selection surface during empty or unusable startup states.
- Moved Windows deletion to the native Recycle Bin API without a permanent-delete fallback.
- Reduced unnecessary library renders, cover work, rescans, reader remounting, and dialog churn.
- Reworked archive creation into a guided name-and-location flow.

### Fixed

- Prevented Trash or Recycle Bin failures from permanently deleting EPUB files or folders.
- Made EPUB replacement transaction-safe so the previous file is restored when replacement fails.
- Made metadata JSON replacement restore the previous active file when final replacement fails.
- Preserved corrupted metadata files as recovery backups and allowed scanner-cache failures to remain non-fatal.
- Fixed packaged EPUB loading by allowing the local blob-backed resources required by the reader.
- Fixed Archive Manager close behavior after forgetting the active archive so Archeion never returns to a blank main window.
- Improved handling for missing archives, missing books, unreadable EPUBs, and damaged metadata.

### Testing

- Added regression coverage for archive safety, startup lifecycle, reader sessions, metadata writeback, settings behavior, recovery states, release configuration, and packaged-reader compatibility.

[Unreleased]: https://github.com/TommyMoonn/archeion/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TommyMoonn/archeion/releases/tag/v0.1.0
