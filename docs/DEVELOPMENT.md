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

Before windowing, each view mounted every result and its cover owner. The retained fixtures now
mount only the calculated viewport and overscan range. `coverUrlCache.test.ts` also verifies that
queued cover work released after leaving that range does not start; the recorded stale queued-load
count is zero.

Rust tests use the committed Cargo lockfile:

```powershell
npm run rust:test
```

### Scanner measurements

The ignored `measures_representative_scanner_fixtures` Rust test generates synthetic archives of
50, 500, and 2,000 EPUBs. It reports five-run medians and ranges plus cache, metadata, cancellation,
and bounded-parser diagnostics. Fixture generation is excluded from the measured interval. Run it
explicitly with:

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
npm run changes:package -- -Name "task-name"
npm run changes:restore
npm run clean
npm run clean:all -- -DryRun
npm run zip
```

See [scripts/README.md](../scripts/README.md) for complete flags and safety
behavior.
