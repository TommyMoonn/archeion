# Archeion development guide

This guide covers local development, validation, and packaging. The root
[README](../README.md) remains focused on users and the product itself.

## Requirements

Archeion development currently targets Windows and requires:

- Node.js 22.13 or newer.
- npm with the committed `package-lock.json`.
- Rust and Cargo.
- Rust 1.88 or newer.
- PowerShell 7.
- The Windows prerequisites required by Tauri 2.

## Set up the repository

```powershell
git clone https://github.com/TommyMoonn/archeion.git
cd archeion
npm ci
```

Use `npm ci` rather than `npm install` for a clean checkout so the dependency
versions remain aligned with `package-lock.json`.

## Run Archeion

Start the Tauri development application:

```powershell
npm run tauri:dev
```

Run only the Vite frontend when desktop APIs are not needed:

```powershell
npm run dev
```

## Validation commands

Run the full local verification suite before preparing a pull request or release:

```powershell
npm run verify
```

`verify` runs formatting, linting, TypeScript checks, frontend tests, Rust
formatting, Clippy, Rust tests, the production frontend build, and bundled Inter
asset verification.

Focused commands:

```powershell
npm run fmt
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:inter-assets
npm run check:rust
```

Commands that apply automatic formatting or lint fixes:

```powershell
npm run fmt:fix
npm run lint:fix
npm run rust:fmt:fix
```

## Testing

Frontend tests use Vitest:

```powershell
npm run test
npm run test:watch
```

### Library windowing evidence

`libraryPerformanceEvidence.test.ts` retains deterministic structural measurements for a
1,000 × 800 CSS-pixel collection viewport. The grid fixture uses six 303-pixel cards with a
28-pixel row gap; both views use 600 pixels of overscan. These figures are development evidence,
not hardware-dependent product guarantees.

| Fixture | Results before windowing | Maximum mounted grid books and covers | Maximum mounted list books and covers | Reused index entries after one favorite change |
| ------- | -----------------------: | ------------------------------------: | ------------------------------------: | ---------------------------------------------: |
| Medium  |                      500 |                                    48 |                                    28 |                                      499 / 500 |
| Large   |                    2,000 |                                    48 |                                    28 |                                  1,999 / 2,000 |
| Stress  |                   10,000 |                                    48 |                                    28 |                                 9,999 / 10,000 |

Before windowing, each view mounted every result and its cover owner. The retained fixtures now
mount only the calculated viewport and overscan range. `coverUrlCache.test.ts` also verifies that
queued cover work released after leaving that range does not start; the recorded stale queued-load
count is zero.

The same evidence suite can emit opt-in, five-sample derivation measurements for the 50, 500, 2,000,
and 10,000-book fixtures. It records the fixture hash with index creation, unchanged invalidation,
localized invalidation, filter/sort, folder, and series timings:

```powershell
$env:ARCHEION_PERF_EVIDENCE = "1"
npm test -- src/features/library/libraryPerformanceEvidence.test.ts --reporter=dot
Remove-Item Env:ARCHEION_PERF_EVIDENCE
```

The measurements are diagnostic only. The default test run uses structural assertions and skips
the machine-dependent timing output.

Rust tests use the committed Cargo lockfile:

```powershell
npm run rust:test
```

### Scanner measurements

The ignored `measures_representative_scanner_fixtures` Rust test generates synthetic archives of
50, 500, and 2,000 EPUBs. It reports five-run medians and ranges for cold, warm, targeted path-hit,
and targeted signature-hit scans, plus cache, metadata, cancellation, and bounded-parser
diagnostics. Fixture generation is excluded from the measured interval. Run it explicitly with:

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml measures_representative_scanner_fixtures -- --ignored --nocapture
```

The Phase 0.7.0.2 finalization run produced the following same-machine medians. The baseline was an
isolated `HEAD` archive from before Phase 0.7.0.2; each value is the median of five runs.

| EPUBs | Baseline cold | Final cold | Baseline warm | Final warm |       Payload |
| ----: | ------------: | ---------: | ------------: | ---------: | ------------: |
|    50 |         53 ms |      40 ms |         12 ms |      13 ms |  21,637 bytes |
|   500 |        255 ms |     124 ms |         37 ms |      34 ms | 160,377 bytes |
| 2,000 |        912 ms |     432 ms |         70 ms |      82 ms | 590,975 bytes |

| EPUBs | Phase | Uncached jobs | Path hits | Signature hits | Max parse workers / open EPUBs | Cache load | Signature index | Metadata resolution | Cache publication | Cancellation |
| ----: | :---- | ------------: | --------: | -------------: | -----------------------------: | ---------: | --------------: | ------------------: | ----------------: | :----------- |
|    50 | Cold  |            50 |         0 |              0 |                          4 / 4 |       5 ms |            0 ms |                6 ms |             17 ms | Completed    |
|    50 | Warm  |             0 |        50 |              0 |                          0 / 0 |       1 ms |            0 ms |                0 ms |              0 ms | Completed    |
|   500 | Cold  |           500 |         0 |              0 |                          4 / 4 |       6 ms |            0 ms |               55 ms |             34 ms | Completed    |
|   500 | Warm  |             0 |       500 |              0 |                          0 / 0 |       3 ms |            0 ms |                0 ms |              0 ms | Completed    |
| 2,000 | Cold  |         2,000 |         0 |              0 |                          4 / 4 |       7 ms |            0 ms |              267 ms |            102 ms | Completed    |
| 2,000 | Warm  |             0 |     2,000 |              0 |                          0 / 0 |      16 ms |            3 ms |                2 ms |              1 ms | Completed    |

The pre-finalization 2,000-book warm median was 2,784 ms because publication repeatedly traversed
the complete cache for every accepted path. Normalized map publication and a revision-safe unchanged
snapshot fast path reduced that median to 82 ms. The four-worker parser reduced the representative
2,000-book cold median from 912 ms to 432 ms while keeping parser-owned EPUB handles bounded at four.

These measurements are diagnostic development evidence for comparing implementations on the same
machine. They are not release guarantees or cross-hardware benchmarks.

### Startup measurements

Development builds retain User Timing entries for the main startup critical path. The trace starts
before React mounts and records appearance runtime startup, preference initialization, archive
resolution, window restoration, active storage preparation, optional startup scan, the first
Library render, and the first usable Library state.

The three retained terminal measures are:

```text
archeion:startup-to-shell
archeion:startup-to-library-snapshot
archeion:startup-to-usable-library
```

`archeion:startup-to-library-snapshot` marks the first ready, archive-scoped Library snapshot.
Books and Folders at this boundary share the snapshot's authoritative Library revision.

The Library revision advances when the active archive generation changes or a successful model
commit replaces Books or Folders. Loading, error, and scan-status-only transitions publish updated
snapshots without advancing that model revision. A failed initial scan therefore retains the empty
loading model's revision; the first successful commit, including an empty archive, establishes the
ready model revision.

`LibrarySnapshot` uses a type-enforced ownership boundary. Snapshot Books expose read-only nested
metadata and tag arrays, and snapshot Folders carry a compile-time-only ownership discriminant.
Neither entry type can widen back to the mutable storage domain type without an explicit cast.
Publication still shares storage-owned immutable-replacement entries, so status-only snapshots do
not clone, traverse, or refreeze the archive and unchanged entry identity remains stable.

Inspect them in the Tauri WebView2 developer tools after startup:

```js
performance
  .getEntriesByType("measure")
  .filter((entry) => entry.name.startsWith("archeion:startup-to-"))
  .map(({ name, duration }) => ({ name, duration }));
```

Compare repeated median runs with the same appearance, window state, startup behavior, scan
setting, archive fixture, and warm/cold filesystem state. Use representative small, medium, and
large archives; the existing 50, 500, and 2,000 EPUB scanner fixtures are suitable when copied into
normal development archives. These timings are diagnostic and machine-specific, not release
guarantees.

Development builds also retain bounded Reader lifecycle entries for the combined native/IPC file
read, Blob creation, Blob-to-ArrayBuffer conversion, EPUB.js book and rendition creation, first
location display, source-byte release, and session teardown. Source-byte release is a mark; the
other timed stages are measures. The frontend cannot isolate transport time from the Tauri
invocation, so the read entry intentionally reports those stages together:

```js
performance
  .getEntries()
  .filter((entry) => entry.name.startsWith("archeion:reader-"))
  .map(({ name, entryType, startTime, duration }) => ({
    name,
    entryType,
    startTime,
    duration,
  }));
```

The full Phase 0.9.0.1 structural and machine-specific baseline is recorded in
`.project/v0.9.0/0.9.0.1/PERFORMANCE_ARCHITECTURE_BASELINE.md`.

Release-tool integration tests invoke PowerShell, npm, and Cargo against temporary
fixtures. They never modify the real project version files.

## Build installers locally

Build both supported Windows installer formats:

```powershell
npm run tauri:build:windows
```

Stage validated installers and generate `SHA256SUMS.txt`:

```powershell
npm run release:stage
```

The staging step keeps Tauri's versioned build outputs for validation, then copies
the public release assets to stable names:

```text
Archeion-Setup-x64.exe
Archeion-x64.msi
SHA256SUMS.txt
```

Generated build output and staged artifacts are ignored by Git.

## Project utilities

Common repository utilities are exposed through npm aliases:

```powershell
npm run changes:peek
npm run changes:apply
npm run changes:review
npm run changes:package -- --name "task-name"
npm run changes:restore
npm run clean
npm run clean:all -- --dry-run
npm run zip
```

See [scripts/README.md](../scripts/README.md) for complete flags and safety
behavior.
