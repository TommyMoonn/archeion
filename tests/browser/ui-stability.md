# UI stability baselines (phase 1.8.0.2)

These workloads observe the accepted 1.7.0 implementation before phases 1.8.0.3 through 1.8.0.19 alter it. A passing probe means the workload and instrumentation ran. It does not certify that the observed behavior meets those later phases' acceptance criteria.

## Browser commands

Use the installed, locked dependencies. The existing Playwright configuration starts Vite on port 4173:

```powershell
npm run test:browser:typecheck
npm run test:browser -- --config tests/browser/ui-stability.config.ts
```

Capture a timestamped filmstrip for route, main palette and Reader palette transitions:

```powershell
$env:ARCHEION_UI_FILMSTRIP = '1'
npm run test:browser -- --config tests/browser/ui-stability.config.ts --grep 'real app|first-paint|Reader entry'
Remove-Item Env:ARCHEION_UI_FILMSTRIP
```

Each scenario writes `ui-stability.json` into its Playwright output directory, also attached to the report. Filmstrip JPEGs are adjacent. Copy the output to the phase evidence directory before another Playwright invocation clears it. Artifacts are local and ignored, not production assets.

If the known cold Vite fixture acquisition stall occurs, prepare the existing server separately. In one terminal run `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort`, then open the synthetic fixture and confirm the Library appears. In a second terminal set `$env:ARCHEION_UI_EXTERNAL_SERVER = '1'` and run the same configuration. Remove that variable afterward. This records a prepared development server with fresh browser contexts, not a cold server or packaged startup. Preserve the failed startup artifacts and report this condition; do not increase scenario timeouts or compare it with untreated cold-server traces.

The App, production router, ArchiveGate, LibraryPage, Tauri storage reconciliation, cover cache, lazy details drawer, ReaderRoute and EpubViewer run with synthetic IPC. No user archive is opened. Unsupported commands fail rather than silently succeeding. The catalog has 0, 2, 48, 49, 50, 500 or 3,000 generated entries and one original deterministic EPUB from `readerFixtures.ts`. The browser 3,000-entry workload is always run, not conditionally skipped. Native high-volume coverage is separately explicit.

The browser fixture includes a fixed 80ms preference/scan response delay and 100ms EPUB/archive-activation delay to expose transitions. This is an observable controlled workload, not a measurement of disk or native IPC speed. Vite compilation, HMR, dev React, probes and screenshot capture affect timing. Discard runs interrupted by source edits, dependency optimization or server reloads.

## Trace contract

The probe installs before document parsing, tolerates a missing document root, and samples on requestAnimationFrame. It retains at most 2,400 frames, events, inputs and long tasks per stream, reporting overflow. Native capture uses 1,200. Geometry work is bounded to retained DOM and 24 sampled elements per group. The opt-in probe itself can force style/layout, so its timing is an instrumented baseline and cannot establish uninstrumented production cost.

| Field                  | Interpretation                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`, paint entries  | `performance.now()` timeline and buffered browser first-paint/FCP entries                                                                                |
| `state`                | Fixture archive, route, load status, content readiness and mocked window visibility; native has separately observed window metadata                      |
| `groups`               | Frame, stage, toolbar, collection, mounted book count, dialog, sidebar, titlebar and icon rectangles, opacity, transform, animation and transition state |
| `instance`, `bookKey`  | DOM instance identity and opaque logical book identity; book Y is viewport-relative. DOM mount counts are not React render/commit counts                 |
| `collection`           | Presentation state, list/grid identity, total, retained index range and windowing flag                                                                   |
| `scrollTop`, `focus`   | Main scroller offset and opaque focused DOM instance/tag, without titles, labels or text                                                                 |
| `fonts`, icon geometry | Font face readiness/status, computed font stack, icon slot bounds and explicit SVG dimensions                                                            |
| `covers`, Blob events  | Image completion/natural width plus create/revoke/live counts; no URL strings, image bytes or EPUB text                                                  |
| `motion`, `window`     | Effective app motion, system reduction, running animations, viewport, DPR and document visibility                                                        |
| `inputs`               | Input kind, trust flag and delay to next observed RAF. This is not a compositor presentation timestamp                                                   |
| summary                | RAF interval median/p95/p99/max, intervals above 33.34ms, long-task distribution and Chromium layout/style/task/heap counters                            |

No universal frame-time pass limit is introduced. Browser layout counters count layout operations, not exclusively forced layouts. GPU/layer counters and actual input-to-present latency are unavailable here. The CDP filmstrip requests every compositor frame, bounded to 1,200 images; timestamps and cap status are reported. Align a screenshot with the probe using `screenshot.time * 1000 - probe.timeOrigin`. Delivery is not guaranteed at 60fps. Do not interpolate missing screenshots into a claim of smoothness.

The probe has no production imports, telemetry, global event broadcasts or runtime dependency. `stop()` disconnects observers/listeners, cancels pending RAFs, restores URL wrappers only if still owned, and releases retained DOM/URL/book maps. Outputs contain numerical or allowlisted state metadata, not user document content. Only run screenshots against the synthetic fixture or disposable smoke archive.

## Coverage and later owners

| Workload                                                                             | Later claims supported                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Real Library to Reader to Library, archive A to B, populated/empty/populated         | Theme/shell handoffs (3 through 5), collection identity/entrance and return scroll/focus (7 and 9)                  |
| Threshold-adjacent catalogs, 50/500/3,000, forward/reverse scroll                    | Cover lifecycle, retained work and layout-skipping comparisons (8 and 10)                                           |
| First details open, close, reopen and sidebar collapse                               | Lazy mount, dialog geometry/lifetime, motion/scrim and shared sidebar width (12, 15 through 18)                     |
| Dark/light/system-light/custom, Reader light/dark/sepia                              | Browser first-paint and destination palette evidence for 3 through 5; native first-visible palette remains separate |
| Natural font/icon samples plus independent delayed-font and delayed-lazy experiments | UX-15 causal investigation (phase 2); correction or evidenced no-change closure remains phase 19                    |
| 560px viewport; app motion off; system reduced motion                                | Responsive and effective-motion regression evidence                                                                 |
| About/Settings/Archive Manager/Theme Manager frontend entry                          | Frontend shell readiness, without claiming native window visibility/placement (4 and 6)                             |

The suite also records pending metadata at 0/1/multiple edits, long description, busy write/failure feedback, updater available/downloading/ready/idle, trusted wheel input and grid/list reversal in the real app fixture. The reusable probe accepts existing `fixtures/?view=library-updates`, `about-updates`, confirmation and Reader drawer workloads. Use the existing `update-toast.pw.ts`, `about-updates.pw.ts`, `destructive-confirmations.pw.ts` and Reader drawer tests for their controls. Later owning phases must add operation-specific acceptance assertions, including nested-dialog and cover-writeback geometry. This phase does not claim those future fixes or integrated phase 20 signoff.

## UX-15 interpretation

Compare font loading events with icon mount identity, explicit size, bounds and computed animation. The natural first/reopen samples establish the untreated control. Independent delayed-font and delayed-module experiments intentionally hold the corresponding request for 20 observed frames with motion off, then release it. An artificially reproduced delay is not evidence that users naturally encounter that cause. A font fix, preload, new icon system or typography change is not authorized by these experiments. Record the natural result and limits in the phase report.

## Comparable runs

A fresh Playwright context means cold browser cache/storage for that scenario, not cold Windows filesystem, Vite optimizer or OS cache. Reopen means the same document and resolved lazy module; route return means a warm module/cache path. Compare only the same source/fixture/probe hashes, browser, machine, viewport, display scale, cache condition and filmstrip setting. Numeric conclusions require at least five comparable repetitions and disclosure of spread, as in the existing Reader collector. Never compare a browser DPR emulation with actual Windows display scaling.

## Windows/WebView2 procedure

The existing `scripts/run-windows-runtime-smoke.mjs` creates nonce-scoped app/config/WebView directories, disables updater endpoints, builds a disposable executable, installs a matching EdgeDriver, and cleans only its owned paths. It requires Windows/WebView2, the existing `.scratch/runtime-smoke-tools/bin/tauri-driver.exe`, build dependencies and driver download access. Read its normal prerequisites before execution.

At each **actual** Windows display scaling of 100%, 125% and 150%, run:

```powershell
$env:ARCHEION_UI_STABILITY_NATIVE = '1'
$env:ARCHEION_UI_NATIVE_SCALE = '100' # repeat with actual OS scale 125, then 150
$env:ARCHEION_UI_NATIVE_COUNTS = '50,500,3000'
npm run test:runtime:windows
Remove-Item Env:ARCHEION_UI_STABILITY_NATIVE, Env:ARCHEION_UI_NATIVE_SCALE, Env:ARCHEION_UI_NATIVE_COUNTS
```

The native workload validates actual DPR against the requested scale. It creates generated EPUB copies only in the runner's disposable archive, exercises bounded 50/500/3,000-book rendering at 1,280px and the supported 900px native minimum, and observes first details open/reopen. The default count list is `50,500`; 3,000 is explicitly opt-in for disk/scan practicality, and every unrun count is included in `capacityGaps`. It attaches the same probe after startup. It must not be described as a cold-start or first-visible capture. The browser handles narrower 560px layouts because the native main window minimum is 900px.

For first-visible native palette, monitor placement and auxiliary visibility, pair this workload with an external desktop recording at 60fps or better and WebView2/DevTools or WPR trace, starting **before process launch**. Record machine, OS/WebView2 build, GPU, display topology/scale, viewport, app SHA, fixture hash, preferences, cache state, recording cadence and timestamps. Exercise dark/light/system-light/custom and Reader light/dark/sepia, then first/reopened Archive Manager, About, Settings and Theme Manager from the invoking display. Repeat route/archive transitions, drawer/modal reversals, sidebar and update states. Record first native show, frontend shell readiness and the first interactive frame separately. Check filmstrip gaps against trace markers. Physical input, mixed-DPI placement, screen-reader speech and GPU timing remain native/manual obligations for their owning phases and phase 20.

No native run or external recording is implied by the existence of these commands.
