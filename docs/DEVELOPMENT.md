# Archeion development guide

This guide covers local development, validation, and packaging. The root
[README](../README.md) remains focused on users and the product itself.

## Requirements

Archeion development currently targets Windows and requires:

- Node.js 22 (at least 22.13). The shared `.node-version` selects the major
  version for development and CI; `package.json` records the minimum supported
  version.
- npm with the committed `package-lock.json`.
- Rust and Cargo. `rust-toolchain.toml` pins the development and normal CI
  toolchain to Rust 1.97.1. `src-tauri/Cargo.toml` declares Rust 1.88 as the
  minimum supported Rust version (MSRV), which CI checks separately; it is not
  the development toolchain pin.
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

## Archive lifecycle ownership

`ArchiveStore` owns active-archive transitions through native activation, path validation,
metadata initialization, and final state publication. It also owns the long-lived archive registry
event subscription for each application window, including retry after a failed subscription and
cleanup when the window closes. Keep archive initialization separate from that connection lifecycle.

`ArchiveScanSession` supplies a stable Library scan consumer to the native full-scan coordinator.
Native cancellation applies only to a scan for the same archive and consumer. Settings rescan and
metadata repair request reconciliation from the active Library rather than opening a competing
full-scan path. Manual Rescan and watcher follow-up work use that Library scan owner.

Check rapid archive switches, overlapping Library scans, Settings maintenance, and cross-window
archive changes with the focused store, scan-session, scanner, and maintenance tests before running
the broader release gates.

## Validation commands

Run the full local verification suite before preparing a pull request or release:

```powershell
npm run verify
```

`verify` runs formatting, linting, TypeScript checks, frontend tests, Rust
formatting, Clippy, Rust tests, the production frontend build, and bundled Inter
asset verification.

For release preparation and the post-merge publication procedure, follow the
[release operator guide](RELEASING.md). The local installer commands below do
not create a tag or publish a GitHub Release.

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

### Diagnostic coverage

Coverage is an execution map, not a merge threshold. The normal `CI Gate` does
not depend on coverage percentages. Run the frontend report after `npm ci`:

```powershell
npm run test:coverage:frontend
```

This writes a browsable report to `coverage/frontend/index.html` and LCOV data
to `coverage/frontend/lcov.info`. For Rust, install the coverage tool and the
LLVM tools component for the pinned development toolchain, then run:

```powershell
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --version 0.9.0 --locked
npm run test:coverage:rust
```

The Rust command runs the normal Cargo tests with instrumentation and writes
`coverage/rust/html/index.html` and `coverage/rust/lcov.info`. Both report trees
are Git-ignored. The separate Coverage diagnostics workflow runs weekly, on
manual request, and when coverage tooling changes in a pull request. It uploads
the reports as short-lived Actions artifacts. Neither report covers the real
browser or Windows runtime smoke lanes.

### CodeQL diagnostic scanning and future promotion

The separate CodeQL workflow scans JavaScript/TypeScript and Rust with the default
query suite every Tuesday at 06:17 UTC and can also be started manually from
the Actions tab. Scheduled scans run on the default branch; a manual dispatch
can select a ref after the workflow exists on the default branch. CodeQL does
not run on ordinary pull requests or `main` pushes. Rust analysis runs on
Windows with the pinned project toolchain. Its two language scans remain
informational and outside `CI Gate`. `CI Gate` remains a required status check,
while CodeQL must not be selected under `Require code scanning results` in the
`Protect main` ruleset on this cadence.

After the workflow is published on the default branch, verify a scheduled or
manually dispatched run uploads results for both languages. Review every alert,
fixing it or recording a justified dismissal in GitHub. A green analysis job
only means the scan completed; it does not establish an empty alert list. If a
language is missing, extraction is incomplete, or the results are too noisy to
act on, correct the scan and repeat this review before promotion.

If CodeQL is later considered for merge protection, first restore pull-request
scanning and verify both language results on representative pull requests. Only
after that and a clean or intentionally dispositioned baseline should the
repository owner add CodeQL through `Require code scanning results`, choosing
alert and security-alert thresholds based on the observed baseline. Keep
`CI Gate` under required status checks. Requiring the CodeQL job names as status
checks is not a substitute for code-scanning merge protection because a
successful job can still report alerts. Dependency Review remains the separate
pull-request gate for newly introduced dependency vulnerabilities.

## Testing

Frontend tests use Vitest:

```powershell
npm run test
npm run test:watch
```

### Real-browser contracts

The small Chromium suite checks rendered navigation, focus, ARIA values, and
responsive presentation that the `happy-dom` tests cannot verify. It uses the
real public pages and a Vite fixture mounting production Reader, Library, and
dialog components. It does not launch Tauri or replace the lower-level tests.

Install the pinned browser once, then run the suite locally:

```powershell
npm ci
npm run test:browser:install
npm run test:browser
```

CI runs the same suite as a separate `CI Gate` dependency. On failure, its
`browser-contract-failure` artifact contains the HTML report, screenshot, and
retry trace where available. Browser outputs are ignored by Git.

### Windows Tauri runtime smoke

The separate Windows smoke lane builds an unbundled release-profile test executable
from the current sources and drives its real WebView2 instance through Tauri's
WebDriver bridge. It covers archive creation/opening, EPUB import/read, settings
after restart, annotation metadata/export, a disposable EPUB replacement, and a
secondary window. The test build uses a unique application identifier and a
temporary archive, so it does not use the normal Archeion settings or archives.
It does not install an MSI or NSIS package; the separate installer smoke below
covers packaging without duplicating these runtime flows.

On Windows, install the Tauri WebDriver bridge and run the smoke:

```powershell
cargo install tauri-driver --version 2.0.6 --locked --root .scratch/runtime-smoke-tools
npm run test:runtime:windows
```

The runner downloads the Microsoft Edge WebDriver version matching the installed
**WebView2 Runtime**, which can differ from the Edge browser version. It removes
its temporary archive, roaming settings, and local WebView2 test-identity state
on success or failure. If a
step fails, inspect `test-results/runtime-smoke/failure.txt`, the driver log,
and any captured page or screenshot. CI uploads those files as the
`windows-runtime-smoke-failure` artifact. Build and test outputs are ignored by Git.

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

The manual Windows installer workflow and automatic release-candidate build both
verify staged checksums, then use `scripts/smoke-windows-installer.ps1` to silently
install and uninstall the per-user NSIS bundle before upload. The smoke requires
a clean Windows runner: it refuses any existing Archeion installation or default
data directory. It verifies the installed executable and its product metadata,
the uninstaller and registration, then checks that uninstall removes the
installed state. The MSI remains staged and checksum-verified, but is not the
format exercised by this bounded install/uninstall smoke.

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
