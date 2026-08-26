# Changelog

## [Unreleased]

## [1.4.1] - 2026-08-26

Archeion 1.4.1 refines dictionary discovery and definition reading, and makes search controls more consistent across the application.

### Added

- Added local shortcut search to **Keyboard** settings, including configurable shortcuts and fixed interaction-key documentation.

### Changed

- Unified **Dictionaries** into **All**, **Installed**, and **Not installed** views with one shared search and clearer discovery controls.
- Reduced repeated headwords in Reader definitions, separated results by dictionary source, and moved source attribution below each definition group.
- Aligned search-field corners with Archeion's standard controls across supported application surfaces.

## [1.4.0] - 2026-08-24

Archeion 1.4.0 moves Settings and Theme Manager into independent application windows, makes preferences and themes consistent across archives, and clarifies which controls apply globally or only to the active archive.

### Added

- Added a standalone **Settings** window that can remain open beside the main application, focuses its existing instance when reopened, and keeps global preferences available even when no archive is active.
- Added a standalone **Theme Manager** window for browsing, importing, previewing, applying, updating, deleting, and reloading application-wide themes without depending on the active archive.
- Added live preference and theme-package synchronization so open Archeion windows reflect current global settings and custom-theme changes.

### Changed

- Made application and Reader theme selections application-wide so the same committed appearance carries across archives, Archive Manager, Settings, Theme Manager, and other open windows.
- Moved custom theme packages into Archeion's application data. Compatible packages from registered archives are copied into global storage without modifying or deleting their original archive copies.
- Reorganized Settings into **General**, **Appearance**, **Library**, **Reader**, **Archives**, **Storage**, **Dictionaries**, and **Keyboard**, with more compact shortcut rows and clearer preference, action, and maintenance controls.
- Consolidated import controls under **Archives** while keeping import mode and conflict defaults global and the destination folder specific to the active archive.
- Refined **Storage** around separate global policies and active-archive maintenance, with concise actions and current cache or backup status where available.
- Kept Theme Manager previews temporary until **Use theme** is selected, while committed selections and package changes propagate to other open windows.

### Fixed

- Prevented older preference saves, theme refreshes, and cross-window events from replacing newer application-wide settings or theme state.
- Prevented archive-specific destinations, folders, cache sizes, backup counts, and maintenance results from appearing under a different archive after switching.
- Made archive rescans and metadata repair wait for the active Library state to finish reconciling before Settings reports success.
- Corrected standalone Settings sizing and scrolling so long sections remain usable across supported window sizes, and allowed Dictionary import to open its native file picker from Settings.
- Corrected the standalone Theme Manager startup path and simplified its list-and-detail workspace so it no longer depends on a modal surface.

## [1.3.0] - 2026-08-22

Archeion 1.3.0 adds optional offline English dictionaries, including definitions for selected Reader text and application-wide controls for installing and managing dictionary sources.

### Added

- Added **Dictionaries** settings with separate **Available** and **Installed** views for discovering, installing, and managing local dictionary resources.
- Added a curated downloadable catalog containing Princeton WordNet 3.0, Open English WordNet 2025+, and the GNU Collaborative International Dictionary of English.
- Added manual import for compatible local StarDict dictionaries without depending on the original import location after installation.
- Added **Define** to the Reader text-selection actions, with an anchored definition popover for loading, results, no-result, retryable error, and multiple-dictionary states.
- Added offline English inflection handling so common forms such as plurals, past-tense verbs, progressive verbs, comparatives, and superlatives can resolve to installed dictionary entries when supported.
- Added local filtering for the Available dictionary catalog by name, source, and language information.

### Changed

- Made installed dictionaries application-wide so the same enabled sources and ordering remain available when switching EPUB archives.
- Added controls to enable or disable dictionaries, change result order, remove installed copies, rebuild recoverable indexes, and reinstall catalog dictionaries when needed.
- Kept dictionary acquisition explicit and optional. Dictionary packages are downloaded only from user-initiated catalog actions and are not included in the Archeion application bundle.
- Simplified dictionary cards around source, language, licence, size, status, and relevant actions, with direct source and licence links when available.
- Preserved compatible StarDict ZIP and tar.xz catalog packages, explicit source and target language metadata, and safe bounded local definition lookup.

### Fixed

- Kept missing or damaged dictionary resources isolated from archives, EPUB files, reading progress, annotations, and other installed dictionaries.
- Rebuilt recoverable dictionary database and index state from valid installed resources, while keeping unavailable dictionaries visible for removal or reinstall guidance.
- Prevented older catalog, download, install, lookup, or recovery results from replacing newer dictionary state.
- Corrected the Installed count so an unknown registry state is not shown as a real zero count.
- Prevented explanatory GCIDE synonym commentary and usage qualifications from appearing as searchable dictionary headwords.

### Testing

- Expanded native and frontend regression coverage for catalog refresh, verified downloads, safe archive extraction, StarDict validation, installation, indexing, lookup, Reader definition interaction, Settings management, recovery, inflection handling, and production catalog packages.

## [1.2.0] - 2026-08-13

Archeion 1.2.0 adds optional archive health tools for reviewing duplicate EPUBs and book problems that can affect reading, without changing files automatically.

### Added

- Added an opt-in **Duplicates** Smart View for reviewing exact copies and probable matches across the active archive.
- Added clear **Exact duplicate** and **Probable duplicate** labels, with matching file information for exact copies and the EPUB identifier for probable matches.
- Added an opt-in **EPUB Issues** Smart View for finding books with structural problems, broken local links, unreadable content, or other issues that can affect Reader.
- Added concise error and warning counts for affected books, expandable issue details, and the location of the problem inside the EPUB when available.
- Added **Reader unavailable** status when a reported problem prevents the book from opening in Reader.

### Changed

- Added **Duplicates** and **EPUB Issues** to **Settings > Library > Smart Views**. Both are hidden by default and appear in the Library sidebar only after they are selected and Smart Views are enabled.
- Added matching Quick Actions for enabled archive health views.
- Kept archive health checks on demand so opening an archive does not wait for duplicate or issue review.
- Kept duplicate and issue review read-only. Archeion does not automatically delete, merge, move, repair, or rewrite EPUB files.
- Kept existing Library actions available from review results, including Read when supported, Book Details, Reveal, Move, and Delete where applicable.

### Fixed

- Prevented old duplicate or issue results from remaining current after an EPUB is changed, replaced, moved, renamed, deleted, or imported.
- Prevented results from an earlier archive, request, or file version from replacing newer archive health results.
- Kept archive health review accurate when returning from Reader or when files change while a review is in progress.

### Testing

- Expanded regression coverage for exact and probable duplicate review, EPUB issue details, archive changes, refresh and retry behavior, optional Smart View navigation, Reader return, and accessibility of review actions.

## [1.1.0] - 2026-08-11

Archeion 1.1.0 expands Reader search and navigation, adds seekable reading progress, and simplifies the Reader toolbar and page presentation.

### Added

- Added **Find in Book** for the current EPUB, with `Ctrl+F`, highlighted match text in result excerpts and the book, next/previous traversal, active match position, and clear feedback when more matches are available.
- Added Reader Back and Forward history for jumps from publication navigation, annotations, supported internal links, footnotes, search results, and progress seeking.
- Added EPUB **Landmarks** and **Pages** alongside Contents, including direct page-label search for longer publisher Page Lists.
- Added an interactive reading-progress scrubber with click, drag, keyboard seeking, pointer hover preview, chapter context when available, and a transient seek marker.

### Changed

- Simplified the Reader toolbar by removing redundant Previous/Next page buttons while keeping page turns through the existing page zones, wheel behavior, and keyboard controls.
- Replaced automatic toolbar hiding with a persistent top-right **Show/Hide Reader toolbar** control. A new Reader session starts with the toolbar visible, and the selected state remains until explicitly changed.
- Kept Reader side surfaces and their focus return coherent with toolbar visibility so Find in Book, Book navigation, Annotations, and Reader settings remain directly reachable.
- Made toolbar visibility an overlay-only change so showing or hiding it does not resize the reading viewport or move the current location. Top and side progress placement follows the toolbar state without changing seek behavior.
- Added equal top and bottom reading insets while keeping the Page width setting responsible only for horizontal spacing.
- Reduced distracting book-defined motion during Reader navigation by disabling transitions, animations, and smooth scrolling inside displayed book content.
- Improved Find in Book orientation so the active match changes only after a successful jump and result rows stay aligned with the current match.

### Fixed

- Prevented results from an older search or navigation action from replacing the current state after the query or open book changes.
- Kept failed Find in Book result jumps from replacing the current active match or its highlight.
- Kept showing or hiding the toolbar from restarting the open book, changing saved progress, or unnecessarily shifting the page layout.

### Testing

- Expanded Reader regression coverage for book search, navigation history, Contents/Landmarks/Page List navigation, page-label lookup, progress seeking and previews, toolbar visibility, side-surface focus behavior, Reader layout stability, and static book presentation.

## [1.0.2] - 2026-08-10

Archeion 1.0.2 improves Reader reliability around book sessions, reading progress, notes and annotations, temporary Reader surfaces, and exports.

### Changed

- Reworked Reader session handling so opening, replacing, retrying, and closing books use one consistent lifecycle.
- Centralized book loading and EPUB startup so old or replaced Reader work is retired before newer state is shown.
- Unified reading-progress restoration and saving so rapid navigation, book changes, and Reader exit settle through the same path.
- Unified Reader appearance handling so saved appearance, temporary previews, and book replacement stay in sync.
- Unified Reader exit handling so pending reading progress and authored changes settle before navigation continues.
- Consolidated annotation editing, recovery, note drafts, note saves, and Undo around shared Reader state instead of separate competing paths.
- Unified Reader panel and popup dismissal so Contents, Annotations, notes, highlight controls, footnotes, illustrations, and external-link dialogs follow one Escape and focus-return order.
- Routed annotation and illustration exports through a shared save flow with consistent cancellation and failure handling.

### Fixed

- Prevented late work from an older, failed, or replaced Reader session from overwriting the current book state.
- Prevented older location updates from replacing a newer reading position after rapid navigation or book replacement.
- Prevented stale annotation recovery and note-save results from overwriting newer Reader changes.
- Prevented failed annotation changes from entering Undo history and kept rapid Undo requests ordered.
- Prevented overlapping Reader surfaces from dismissing in the wrong order or restoring focus to the wrong control.
- Prevented cancelled Reader exports from being reported as failures.

### Testing

- Expanded regression coverage for Reader session replacement, EPUB startup and teardown, progress settlement, appearance restoration, Reader exit, annotations, note drafts and saves, Undo, surface dismissal and focus return, and export cancellation and failure handling.
- Added frontend dependency-boundary checks to the normal verification path.

## [1.0.1] - 2026-08-04

Archeion 1.0.1 restores normal application shutdown when using the custom titlebar or another native close request.

### Fixed

- Restored the titlebar **Close** button and native window-close requests so Archeion exits after pending archive metadata and application preferences finish writing.
- Allowed the final desktop-window shutdown step required by Archeion's existing save-before-close lifecycle.

### Testing

- Added regression coverage tying the shared desktop capability to the flush-then-destroy close lifecycle.

## [1.0.0] - 2026-08-03

Archeion's first stable release, with a redesigned Quick Actions workflow, more predictable keyboard and Reader interactions, safer note editing, and a simpler annotation experience.

### Added

- Added staged Quick Actions choices for switching archives, previewing and selecting application themes, changing display density, and turning interface animations on or off.
- Added contextual Quick Actions for changing the active Books, Folders, or Series view, sorting, and card size without leaving the current collection.
- Added a configurable **Toggle sidebar** command, with `Ctrl+B` as its default shortcut in Library and Folder views.
- Added temporary Reader-session note draft protection so interrupted edits can be restored and failed saves remain available to retry.

### Changed

- Redesigned Quick Actions as a compact, input-focused command palette with clearer keyboard navigation, active-result feedback, and focused child choices for multi-step commands.
- Made focus restoration more predictable after closing Quick Actions, Settings, dialogs, menus, and Reader surfaces, without leaving unrelated controls or complete page regions visibly focused.
- Unified Reader Contents, Annotations, and Appearance into one side-panel composition with consistent geometry, Escape behavior, and one-level outside-click dismissal.
- Kept the Reader viewport and reading position stable when opening Contents, and removed the redundant Quick Actions button from the Reader toolbar.
- Simplified Annotations into one complete searchable and sortable collection instead of separate All, Bookmarks, and Highlights views.
- Made bookmark toggling immediate and quiet while retaining visible, dismissible feedback for bookmark failures.
- Limited annotation Undo to meaningful authored content, including complete highlights, highlights with attached notes, and saved-note-only deletion that preserves the owning highlight.
- Removed **Focus search** from Quick Actions results while preserving its configurable direct shortcut.

### Fixed

- Prevented Escape, command execution, and programmatic focus restoration from producing sticky keyboard styling or restoring focus to an unrelated page container.
- Prevented stale Quick Actions child-mode, archive-switch, theme-preview, and preference results from replacing newer choices after the palette changes mode or closes.
- Prevented Reader panel opening and table-of-contents positioning from shifting the EPUB viewport, toolbar, reading location, or page-turn zones.
- Prevented temporary note-editor remounts or ordinary panel dismissal from discarding an unsaved draft before settlement completes.
- Prevented stale note-deletion Undo from overwriting a newer replacement note, including pending Undo operations for the same highlight.
- Kept successful highlight and note restoration synchronized with the active Reader collection even when the original feedback was dismissed or superseded.

### Testing

- Expanded focused regression coverage for focus return, Quick Actions keyboard and child-mode behavior, theme preview, collection commands, sidebar shortcuts, Reader panel geometry and dismissal, note draft settlement, annotation Undo ownership, and bookmark feedback.

## [0.9.0] - 2026-08-01

Archeion's integrated-workspace release for a more coherent shell, faster large-library interactions, clearer accessible feedback, safer archive operations, and easier archive-local theme management.

### Added

- Added a collapsible sidebar and sidebar-aligned titlebar with direct access to Quick Actions, the active archive folder, and native window controls.
- Added application-owned tooltips for icon controls and unavailable actions, with consistent timing, positioning, dismissal, and reduced-motion behavior.
- Added input-modality-aware focus presentation so keyboard navigation remains prominent without leaving unnecessary keyboard-style rings after pointer interaction.
- Added skip links, clearer window landmarks, stronger form relationships, visible required guidance, and more reliable focus entry for the main app, Reader, Settings, and Archive Manager.

### Changed

- Redesigned the frameless application shell, Archive Manager, shared surfaces, controls, icons, spacing, typography, elevation, and motion around one calmer visual hierarchy.
- Improved Library performance with versioned snapshots, structural index invalidation, and bounded collection derivation so unchanged books and views avoid repeated work.
- Tightened Reader source-file and session ownership so EPUB bytes, active sessions, and stale results are released or ignored at the correct lifecycle boundary.
- Coordinated full and targeted scans, maintenance rescans, imports, and archive mutations so shared work is serialized and older results cannot replace current archive state.
- Aligned browser and native settings normalization, including keyboard overrides, numeric ranges, legacy values, unknown fields, and current-schema persistence.
- Improved constrained-window reflow, long-content wrapping, logical layout geometry, control hit areas, forced-colors states, and reduced-motion behavior across Library, Reader, Settings, dialogs, and Archive Manager.
- Reworked interface copy for clearer actions, empty and unavailable states, safe operation feedback, destructive confirmations, and practical recovery guidance without exposing internal paths or identifiers.
- Organized metadata recovery files under `.archeion/backups/<category>/` and EPUB writeback backups under `.archeion/backups/epub-writeback/`, with automatic migration of recognized legacy backup files.
- Refreshed archive theme packages when Theme Manager or a theme selector is intentionally opened, while keeping the existing manual **Reload themes** action available.
- Updated built-in theme color derivation and contrast handling while preserving the public custom-theme format and Windows forced-colors behavior.

### Fixed

- Prevented stale scan, maintenance, watcher, import, metadata, and persistence work from publishing into a replaced archive generation.
- Prevented valid keyboard overrides from being discarded because a later command was disabled or moved, and made malformed persisted shortcuts non-fatal and deterministic across TypeScript and Rust.
- Corrected successful EPUB imports that were reported as contradictory rename failures and kept the import dialog from remaining open after success.
- Separated field-validation feedback from save and filesystem failures so valid values are not incorrectly announced as invalid.
- Prevented raw storage errors, complete filesystem paths, and internal book identifiers from appearing in Library import, warning, and bulk-action feedback.
- Prevented stale or duplicated theme-refresh errors when selectors and Theme Manager share catalog and appearance work or a newer theme selection supersedes an older refresh.
- Corrected pressed, selected, focus, surface, typography, and responsive-layout states that could become unclear or misordered in forced-colors mode or constrained windows.

### Testing

- Expanded frontend and native regression coverage for shell composition, focus and tooltips, responsive layout, typography, colors, settings parity, scanning and mutation concurrency, archive backup migration, theme refresh coordination, forms, landmarks, and safe feedback.

## [0.8.0] - 2026-07-24

Archeion's accessible desktop interaction release for configurable shortcuts, persistent collection layouts, contextual actions, clearer feedback, and more resilient keyboard, scaling, and non-hover use.

### Added

- Added a searchable **Keyboard** section in Settings where supported shortcuts for Quick Actions, Settings, search, reader panels, and bookmarks can be changed, cleared, or reset with conflict and reserved-key feedback.
- Added independent view, sort, and card-size preferences for Books, Folders, and Series, including persistent Folder and Series controls and matching defaults in Settings.
- Added contextual action menus for books, folders, folder-tree entries, and archives through right-click, Shift+F10, the Context Menu key, and the existing visible overflow controls.
- Added Windows forced-colors treatment for focus, selection, current items, disabled and unavailable actions, danger states, and visible errors.

### Changed

- Made Escape and outside-click dismissal close only the menu, dialog, drawer, or panel currently in front, including nested Quick Actions, Settings, and Reader surfaces.
- Improved focus return after closing surfaces, changing routes, and completing or failing book and folder actions, while avoiding stale focus after an item or view disappears.
- Made selected, current, favorite, busy, invalid, missing-file, and unavailable states clearer to assistive technology, with discoverable explanations when an action cannot run.
- Kept persistent errors available until dismissed or superseded, paused temporary feedback while it is hovered or focused, and prevented independent operations from replacing one another's messages.
- Coordinated archive rescans and scan-producing maintenance actions so every entry point shows the same busy state and each scan produces one result message.
- Completed reduced-motion behavior for existing transitions and loading effects, and improved Settings, menus, feedback, collection controls, and Reader controls at constrained window sizes and increased display scaling.
- Kept folder overflow actions visually quiet for precise mouse input while exposing them on focus, while their menu is open, and on touch-style or non-hover devices.

### Fixed

- Prevented stale or competing transient surfaces from handling the same dismissal event or restoring focus into an obsolete route.
- Prevented duplicate import, rescan, maintenance, save, and mutation feedback, including older completions overwriting newer errors.
- Kept unavailable menu actions and missing Series volumes keyboard reachable so their explanations can be read, without allowing the action to run.
- Prevented long action labels, Settings values, feedback stacks, context menus, and dense Reader toolbar controls from becoming clipped or unreachable in constrained layouts.

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

[Unreleased]: https://github.com/TommyMoonn/archeion/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/TommyMoonn/archeion/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/TommyMoonn/archeion/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/TommyMoonn/archeion/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/TommyMoonn/archeion/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/TommyMoonn/archeion/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/TommyMoonn/archeion/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/TommyMoonn/archeion/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/TommyMoonn/archeion/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/TommyMoonn/archeion/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/TommyMoonn/archeion/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/TommyMoonn/archeion/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/TommyMoonn/archeion/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/TommyMoonn/archeion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/TommyMoonn/archeion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TommyMoonn/archeion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TommyMoonn/archeion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TommyMoonn/archeion/releases/tag/v0.1.0
