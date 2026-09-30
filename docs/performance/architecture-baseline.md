# Performance architecture evidence

This is the durable maintainer-facing portion of the Phase 0.9.0.1 performance
baseline, recorded on 2026-07-24. It documents structural contracts and the
limits of the original measurements, not current wall-clock targets. The phase
used source revision `0160dc51dcb26b1355bb451928643c83deec21b2` before its
implementation overlay. Raw machine-specific timings and investigation notes
remain local; they are not required to interpret this record.

## Evidence boundaries

- Development User Timing covers startup through the first usable Library and
  Reader open/teardown stages. The frontend Reader read measure combines the
  native read, serialization, and Tauri IPC return; it cannot isolate transport
  cost.
- No packaged WebView2 startup, storage-hardware latency, or end-to-end Reader
  latency was established by the original baseline. Do not extrapolate its
  structural results into release performance guarantees.
- The [development guide](../DEVELOPMENT.md) gives the current opt-in commands
  and interpretation rules for repeating scanner, Library, startup, and Reader
  measurements on a representative machine.

## Retained structural contracts

| Area                | Baseline observation                                                                                                                                                                                                                                                                              | Reproducible owner                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Library publication | A changed full scan publishes one coherent Books/Folders model revision with `scanning`/`idle` status transitions. A Book-only mutation retains the Folder collection; a Folder-only mutation retains the Book collection.                                                                        | [Storage publication evidence test](../../src/storage/TauriArchiveLibraryStorage.publicationEvidence.test.ts) |
| Library derivation  | The 50, 500, 2,000, and 10,000-book fixtures avoid aggregate `JSON.stringify` identity work. An unchanged versioned snapshot retains its index; a single favorite/progress/metadata change at 2,000 books replaces one index entry.                                                               | [Library performance evidence test](../../src/features/library/libraryPerformanceEvidence.test.ts)            |
| Retained rendering  | With a 1,000 by 800 CSS-pixel viewport and 600 pixels of overscan, the baseline grid and list fixtures mount at most 48 and 28 books respectively, independent of whether the collection has 500, 2,000, or 10,000 entries.                                                                       | [Library performance evidence test](../../src/features/library/libraryPerformanceEvidence.test.ts)            |
| Native scanner      | Cold scans keep parser-owned EPUB handles bounded at four workers. Warm scans use path-cache hits, and targeted signature scans can reuse a signature hit without an uncached parse.                                                                                                              | [Scanner measurement test](../../src-tauri/src/commands/scanner.rs)                                           |
| Reader lifecycle    | The measured development stages include the combined native/IPC read, Blob conversion, EPUB.js book and rendition construction, first display, source-byte release, and teardown. The source handoff is released after `Book` construction while the active session remains owned until teardown. | [Reader session tests](../../src/features/reader/useEpubSession.test.tsx)                                     |

The original opt-in timing samples were five-run medians on one Windows machine.
They are deliberately not copied here: machine, filesystem cache, fixture, and
runtime differences make those values unsuitable as durable thresholds. Use the
structural tests as regression contracts and capture fresh local timings when
investigating a specific performance change.
