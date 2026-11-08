# Performance measurement guide

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

Use these procedures when investigating a performance change. The measurements
are diagnostic evidence from development builds. They are not release targets or
cross-machine guarantees.

Use the same machine, archive fixture, appearance, window state, startup
settings, and filesystem cache conditions when comparing runs. Record the
environment and fixture details with any results you share.

The [performance architecture baseline](architecture-baseline.md) records the
retained structural contracts and the limits of the original measurements.

## Measure Library rendering and derivation

`libraryPerformanceEvidence.test.ts` retains structural measurements for a
1,000 by 800 CSS-pixel collection viewport. The grid fixture uses six 303-pixel
cards with a 28-pixel row gap. Both views use 600 pixels of overscan.

| Fixture | Results before windowing | Maximum mounted grid books and covers | Maximum mounted list books and covers | Reused index entries after one favorite change |
| ------- | -----------------------: | ------------------------------------: | ------------------------------------: | ---------------------------------------------: |
| Medium  |                      500 |                                    48 |                                    28 |                                     499 of 500 |
| Large   |                    2,000 |                                    48 |                                    28 |                                 1,999 of 2,000 |
| Stress  |                   10,000 |                                    48 |                                    28 |                                9,999 of 10,000 |

Before windowing, each view mounted every result and its cover owner. The
current fixtures mount only the calculated viewport and overscan range.
`coverUrlCache.test.ts` verifies that queued cover work released after leaving
that range does not start. The recorded stale queued-load count is zero.

The same evidence suite can emit opt-in, five-sample derivation measurements for
50, 500, 2,000, and 10,000-book fixtures. It records the fixture hash and
timings for index creation, unchanged invalidation, localized invalidation,
filter and sort, folders, and series.

```powershell
$env:ARCHEION_PERF_EVIDENCE = "1"
pnpm run test src/features/library/libraryPerformanceEvidence.test.ts --reporter=dot
Remove-Item Env:ARCHEION_PERF_EVIDENCE
```

These timings are diagnostic. The default test run uses structural assertions
and skips machine-dependent timing output.

## Measure archive scanning

The ignored `measures_representative_scanner_fixtures` Rust test generates
synthetic archives with 50, 500, and 2,000 EPUBs. It reports five-run medians
and ranges for cold, warm, targeted path-hit, and targeted signature-hit scans.
It also reports cache, metadata, cancellation, and bounded-parser diagnostics.
Fixture generation is excluded from the measured interval.

Run the measurement explicitly:

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml measures_representative_scanner_fixtures -- --ignored --nocapture
```

The Phase 0.7.0.2 finalization run produced these same-machine medians. The
baseline came from an isolated `HEAD` archive from before Phase 0.7.0.2. Each
value is the median of five runs.

| EPUBs | Baseline cold | Final cold | Baseline warm | Final warm |       Payload |
| ----: | ------------: | ---------: | ------------: | ---------: | ------------: |
|    50 |         53 ms |      40 ms |         12 ms |      13 ms |  21,637 bytes |
|   500 |        255 ms |     124 ms |         37 ms |      34 ms | 160,377 bytes |
| 2,000 |        912 ms |     432 ms |         70 ms |      82 ms | 590,975 bytes |

| EPUBs | Phase | Uncached jobs | Path hits | Signature hits | Max parse workers | Open EPUBs | Cache load | Signature index | Metadata resolution | Cache publication | Cancellation |
| ----: | :---- | ------------: | --------: | -------------: | ----------------: | ---------: | ---------: | --------------: | ------------------: | ----------------: | :----------- |
|    50 | Cold  |            50 |         0 |              0 |                 4 |          4 |       5 ms |            0 ms |                6 ms |             17 ms | Completed    |
|    50 | Warm  |             0 |        50 |              0 |                 0 |          0 |       1 ms |            0 ms |                0 ms |              0 ms | Completed    |
|   500 | Cold  |           500 |         0 |              0 |                 4 |          4 |       6 ms |            0 ms |               55 ms |             34 ms | Completed    |
|   500 | Warm  |             0 |       500 |              0 |                 0 |          0 |       3 ms |            0 ms |                0 ms |              0 ms | Completed    |
| 2,000 | Cold  |         2,000 |         0 |              0 |                 4 |          4 |       7 ms |            0 ms |              267 ms |            102 ms | Completed    |
| 2,000 | Warm  |             0 |     2,000 |              0 |                 0 |          0 |      16 ms |            3 ms |                2 ms |              1 ms | Completed    |

The pre-finalization 2,000-book warm median was 2,784 ms because publication
traversed the complete cache for every accepted path. Normalized map publication
and a revision-safe unchanged-snapshot fast path reduced that median to 82 ms.
The four-worker parser reduced the representative 2,000-book cold median from
912 ms to 432 ms. Parser-owned EPUB handles remained bounded at four.

These results describe one development run. Compare new measurements on the
same machine and fixture before drawing conclusions.

## Inspect startup timings

Development builds retain User Timing entries for the main startup path. The
trace starts before React mounts. It records appearance runtime startup,
preference initialization, archive resolution, window restoration, active
storage preparation, an optional startup scan, the first Library render, and
the first usable Library state.

The retained terminal measures are:

```text
archeion:startup-to-shell
archeion:startup-to-library-snapshot
archeion:startup-to-usable-library
```

`archeion:startup-to-library-snapshot` marks the first ready, archive-scoped
Library snapshot. Books and Folders at this boundary share the snapshot's
authoritative Library revision.

The Library revision advances when the active archive generation changes or a
successful model commit replaces Books or Folders. Loading, error, and
scan-status-only transitions publish updated snapshots without advancing that
model revision. A failed initial scan retains the empty loading model's
revision. The first successful commit, including an empty archive, establishes
the ready model revision.

`LibrarySnapshot` uses a type-enforced ownership boundary. Snapshot Books expose
read-only nested metadata and tag arrays. Snapshot Folders carry a
compile-time-only ownership discriminant. Neither entry type can widen back to
the mutable storage domain type without an explicit cast.

Publication shares storage-owned immutable-replacement entries. Status-only
snapshots do not clone, traverse, or refreeze the archive. Unchanged entry
identity remains stable.

Inspect the measures in the Tauri WebView2 developer tools after startup:

```js
performance
  .getEntriesByType("measure")
  .filter((entry) => entry.name.startsWith("archeion:startup-to-"))
  .map(({ name, duration }) => ({ name, duration }));
```

Compare repeated median runs with the same appearance, window state, startup
behavior, scan setting, archive fixture, and warm or cold filesystem state. Use
representative small, medium, and large archives. The existing 50, 500, and
2,000 EPUB scanner fixtures are suitable when copied into normal development
archives.

These timings are diagnostic and machine-specific. They are not release
guarantees.

## Inspect Reader lifecycle timings

Development builds also retain bounded Reader lifecycle entries for the
combined native and IPC file read, Blob creation, Blob-to-ArrayBuffer
conversion, EPUB.js book and rendition creation, first location display,
source-byte release, and session teardown.

Source-byte release is a mark. The other timed stages are measures. The
frontend cannot isolate transport time from the Tauri invocation, so the read
entry reports those stages together.

Inspect the entries in the Tauri WebView2 developer tools:

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
