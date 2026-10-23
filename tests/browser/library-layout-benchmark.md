# Library layout-skipping comparison

Phase 1.8.0.10 evaluates audit UX-18. The inspected baseline is commit
`b678dbc885030ab182d49acb52ab112fc51a1ec3` on `fix/library-visual-stability`,
with a clean worktree. The second-pass audit described overlapping layout
estimates as a performance hypothesis. It did not establish a measured slowdown.

The current production code already disables `content-visibility` and intrinsic
estimates inside `[data-windowed]` collections, as part of the preceding return
anchor implementation. Windowing starts above 48 items. Small collections retain
their existing CSS optimization. This phase compares the existing windowed
baseline with the old 360px grid / 74px list estimates re-enabled only on retained
windowed items. It does not change virtualization or introduce a scroll writer.

## Reproduce

Use locked dependencies and the installed Chromium browser. Run the benchmark
alone, serially, without other tests, builds, profiling sessions or source edits.
The `.benchmark.ts` filename keeps this comparison outside the default
`*.pw.ts` browser contract suite. Its dedicated configuration selects all 18
benchmark cases explicitly.

```powershell
npm run test:browser:typecheck
node node_modules/@playwright/test/cli.js test --config tests/browser/library-layout-benchmark.config.ts
```

If the development fixture stalls, build and serve a disposable production
fixture. This avoids the known cold Vite module-graph stall, but does not measure
packaged native startup. In the first terminal:

```powershell
node node_modules/vite/bin/vite.js build --config tests/browser/library-layout-build.config.ts
node node_modules/vite/bin/vite.js preview --outDir .scratch/library-layout-build --host 127.0.0.1 --port 4175 --strictPort
```

In another terminal:

```powershell
$env:ARCHEION_UI_EXTERNAL_SERVER = '1'
$env:ARCHEION_BROWSER_PORT = '4175'
node node_modules/@playwright/test/cli.js test --config tests/browser/library-layout-benchmark.config.ts
node tests/browser/library-layout-summary.mjs test-results/library-layout-benchmark .project/v1.8.0/1.8.0.10/layout-summary.json
Remove-Item Env:ARCHEION_UI_EXTERNAL_SERVER
Remove-Item Env:ARCHEION_BROWSER_PORT
```

The summary's output directory must already exist. Preserve the raw results
before another run clears the output directory. Run the existing
`library-return-anchor.pw.ts` suite separately to verify Reader return and input
cancellation against the chosen production implementation.

## Measurement contract

- Matrix: grid/list; 50/500/3,000 synthetic books; raster scales 1/1.25/1.5;
  comfortable/compact density; small/medium/large grid cards; 1,280 x 800 and
  1,000 x 720 viewports. Three trials per variant, alternating variant order.
- Each trial loads fresh production owners with synthetic IPC so the candidate's
  intrinsic estimates cannot seed the baseline's measurement cache. The first
  trial includes cold cover work; subsequent trials benefit from the browser
  resource cache. These are instrumented browser trials, not disk benchmarks.
- The workload sends deterministic scroll writes with rapid reversals, jumps to
  the middle, focuses a visible book with `preventScroll`, and samples stationary
  anchor Y and focus. This is not physical wheel or touchpad latency evidence.
- Raw RAF intervals, DOM mounts during scrolling, retained count/range, selected
  book ID/Y, and reconstructed top/bottom spacer errors are stored in
  `layout-comparison.json`. Mount counts describe DOM additions, not React renders.
  Spacer reconstruction uses measured row height, columns and gap, independently
  of the virtualizer's cached estimate.
- CDP `LayoutDuration` and `RecalcStyleDuration` deltas cover the measured workload.
  They include ordinary and synchronous layout, and instrumentation can itself
  force layout. Do not label these totals as exclusively forced layout.
- `devtools-timeline.json` records Layout/style events and JS stacks for inspection
  in DevTools. The summary reports Layout events with JS stacks as a diagnostic
  subset, not a complete forced-layout attribution. The raw timeline also spans
  navigation and setup outside the individual metric windows.
- Summary values report min/median/max across trials, plus RAF counts over
  33.33ms and 50ms. These are observations, not universal acceptance budgets or
  compositor presentation times. Inspect per-workload results before comparing
  aggregate numbers across unlike collection sizes or card geometries.
- Production assertions cover retained range, bounded large-library DOM, spacer
  error, stable stationary anchor, and retained focus. Both variants also exercise
  Tab and export accessibility-tree snapshots. Browser accessibility trees do not
  establish screen-reader speech behavior.

Windows WebView2, physical input pacing, Windows 100/125/150% display scaling,
screen-reader speech and GPU performance require native checks. Browser
`deviceScaleFactor` is raster scaling, not OS scaling or browser text zoom.
Those checks remain part of integrated native verification in phase 1.8.0.20.
Toast geometry, dialog/motion work, and release changes remain deferred.

## Recorded decision, 22 October 2026

Retain the inspected production implementation. The existing windowed-item
override already assigns size ownership to JS windowing and actual row
measurement. Keep the small-collection CSS rules: they do not overlap JS windowing.
No production styles, virtualizer, scroll ownership, dependencies or version
metadata changed in this phase.

The serial production-fixture run passed all 18 cases in 18.9 minutes, recording
432 trials in 144 groups and 18 DevTools timelines. The current implementation had
lower median instrumented layout duration in all 72 matched groups. The following
numbers are medians of per-workload trial medians, pooled across different sizes,
densities, card geometries and raster scales. They describe this instrumented
workload, not a shipped speedup or native frame-rate result.

| View                 | Current windowed layout | Re-enabled layout skipping |
| -------------------- | ----------------------: | -------------------------: |
| Grid layout duration |                43.22 ms |                   84.32 ms |
| List layout duration |                57.05 ms |                  107.53 ms |

Across the full comparison, maximum spacer reconstruction error was below
0.35px; sampled stationary anchor drift was 0px; selected focus was retained.
Maximum sampled retained DOM was 56 grid cards and 24 list rows. The candidate
also met those sampled geometry properties, so this run does not establish an
intrinsic-estimate correctness failure. Its additional layout work supplies no
reason to restore the removed overlap.

Raw DevTools traces contained 33,511 Layout events, including 23,849 with JS
stacks. These counts span setup/navigation as well as trials and include geometry
probe work. Inspect the raw stacks for synchronous-layout attribution; do not
use the trace total as a product-only forced-layout measurement. Per-group
style durations, frame intervals, slow-frame counts, mounts and geometry are
preserved in the local summary and raw records under
`.project/v1.8.0/1.8.0.10/`.

Native performance and accessibility acceptance remain unverified. The measured
decision supports keeping the current browser implementation without claiming
full Windows signoff.
