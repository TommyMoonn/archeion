# Reader performance baseline protocol

This opt-in local protocol uses the existing app and synthetic EPUB harness without changing Reader behavior. Reports belong in ignored `.project/reviews/reader-performance/1.7.0.3/`. Chromium and Windows WebView2 directories are separate. A recorded trace is evidence for review, not an automatic pass. Physical mouse and precision touchpad input must be measured separately. Playwright wheel events are automated browser input, even when `isTrusted` is true.

## Portable instrumentation checks and Chromium baseline

```powershell
npm run test:browser -- tests/browser/reader-performance.pw.ts --workers=1
$env:ARCHEION_READER_PERFORMANCE = '1'
npm run test:browser -- tests/browser/reader-performance.pw.ts --grep 'baseline repetitions' --workers=1
Remove-Item Env:ARCHEION_READER_PERFORMANCE
```

The opt-in experiment runs one warm-up followed by five measured synthetic `long-spine` openings, each with 12 forward and eight reverse 95px wheel events spaced by eight observed animation frames. It records the current Archeion integration profile, fixture and probe hashes, source revision, browser version, viewport/DPR, GC checkpoints and numeric distributions. It does not represent a physical touchpad, complete Reader app, 40-section traversal or sustained reading. Existing historical correctness diagnostics remain available through `reader-runtime.md`. If the project evidence junction is outside a sandbox's writable root, set `ARCHEION_READER_PERFORMANCE_OUTPUT` to an ignored writable evidence directory, then copy the verified report into the local review store.

## Windows WebView2 capture

Use a disposable test archive containing generated synthetic EPUBs, with an isolated app configuration/WebView2 user data folder using the existing Windows runtime smoke conventions. Do not open the personal archive for synthetic tests. For legitimately obtained audit books, keep files outside Git and use only the aliases below. Do not export screenshots, DOM, URLs, book prose or raw timeline traces. No fixture or profiling entry point is added to production assets.

1. Create ignored `.scratch/reader-profile.conf.json` with a unique `identifier` such as `com.archeion.readerprofile.r20261012`, a distinct `productName` and `mainBinaryName`, and `plugins.updater.endpoints: []`, following `scripts/run-windows-runtime-smoke.mjs`. Use that override with `npm run tauri:build -- --no-bundle --config .scratch/reader-profile.conf.json`, or `npm run tauri:dev -- --config .scratch/reader-profile.conf.json`. This isolates the test app identity and disables updater checks for profiling. Use only the disposable archive in that app. Record the app executable SHA-256, app version, collector Git SHA and exact EPUB SHA-256. Generate and validate synthetic ZIPs with `node --experimental-strip-types tests/fixtures/reader/generate.mjs`; they appear under `.scratch/reader-fixtures/`. Use `Get-FileHash -Algorithm SHA256` for the selected executable and EPUB. Do not copy private books into test fixtures.
2. Start only the selected test app with a session-scoped debugging port. [Microsoft documents this WebView2 debugging variable](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code). In a dedicated PowerShell terminal:

   ```powershell
   $previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
   try {
     $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
     npm run tauri:dev -- --config .scratch/reader-profile.conf.json
   } finally {
     $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
   }
   ```

   For a packaged executable, launch that selected executable in the same scope. Restart the test app after setting the variable; an already running WebView2 will not gain the port. Keep this local endpoint limited to the test session. Do not change registry settings or attach to unrelated WebView2 processes.

3. Create ignored `.project/reviews/reader-performance/1.7.0.3/native-input.json` with these fields, replacing placeholders with observed values. Model/OS/runtime/power/input metadata is owner-observed. Record runtime version from installed WebView2 or its process executable version, not the installed Edge browser. `runtimeProduct` from CDP is collected independently.

   ```json
   {
     "deviceModel": "observed model",
     "osBuild": "observed Windows build",
     "webView2Runtime": "observed WebView2 version",
     "inputDevice": "physical-mouse",
     "powerMode": "observed power mode and AC/battery state",
     "scalingPercent": 100,
     "appVersion": "1.6.0",
     "appArtifactSha256": "64 hexadecimal characters",
     "fixture": "long-spine",
     "fixtureSha256": "64 hexadecimal characters",
     "scenario": "traverse-40",
     "repetition": 1
   }
   ```

4. In another terminal run `node scripts/trace-reader-performance.mjs --metadata .project/reviews/reader-performance/1.7.0.3/native-input.json --seconds 120`. The runner requires exactly one Tauri page on the endpoint, attaches the probe, and saves only numeric/allowlisted reports. It does not navigate, claim physical input, change settings, launch or terminate the app. Start on the app shell for cold-open tests so mounting occurs inside the capture window. On Reader tests begin at the scenario's documented starting passage.
5. Repeat each scenario five times on the same machine, viewport, power mode, runtime, app/fixture bytes and physical input device. Keep warm and cold runs separate. Exclude the first warm-up run, then collect five measured repetitions. Close DevTools and background work, keep the app visible, and use the same input pacing. Preserve unsuccessful runs as failures or invalid samples with a reason; do not select only fast runs.
6. Stop/restart the test app without debugging arguments when finished. Change Windows scaling only with owner authorization. Record nearest supported settings if 100/200/300% is unavailable. Missing hardware or private books are `not run`, never `pass`.

## Required scenario matrix

| Scenario ID                                                                 | Starting point and sequence                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-volume-3-cold`, `audit-volume-10-cold`, `audit-volume-11-cold`       | Fresh app/book open from the shell, then normal forward/reverse reading. Use aliases only; record whether each independently obtained book is available.                                                                                                            |
| `short-cover`                                                               | Cold open synthetic cover; use the fixture's controlled image-height change in the browser diagnostic, and ordinary input in the app. Record first downward continuation or the existing false boundary. The native app cannot invoke the harness size-control API. |
| `reverse-prepend`                                                           | Resume at synthetic `current-p3` CFI, then scroll upward across preceding sections. Record mounted height/anchor correctness using the existing geometry harness separately; the native profile does not inspect publication text or IDs.                           |
| `traverse-40`                                                               | Continuous `long-spine`, move through all 40+ sections with physical input, reverse through at least ten boundaries. No programmatic CFI jumps as a substitute for scrolling.                                                                                       |
| `rapid-reverse`                                                             | Mid-book, alternate forward/reverse input at least 20 times, including while a neighbor mounts.                                                                                                                                                                     |
| `continuous-20m`                                                            | At least 1200 seconds of Continuous reading and periodic reversal. Capture GC checkpoints in separate idle windows at 0/5/10/15/20 minutes; see limitations below.                                                                                                  |
| `paged-turns`                                                               | Paged reflowable turns forward/backward; repeat with fixed-layout fixture.                                                                                                                                                                                          |
| `navigation-panel`, `annotations-panel`, `search-panel`, `appearance-panel` | Each drawer: cold first open/close, ten subsequent open/close cycles, wheel over panel and backdrop. Test the real app, not the synthetic overlay used by the instrumentation test.                                                                                 |
| `appearance-changes`                                                        | Mid-passage change font, size, width, theme, then restore; record reflow and mounted frame churn.                                                                                                                                                                   |
| `window-resize`                                                             | Resize 900 to 1200 to 900 CSS px while at a stable passage.                                                                                                                                                                                                         |
| `scale-100`, `scale-200`, `scale-300`                                       | Repeat boundary/reverse/panel cases at each owner-approved scaling, recording observed DPR, viewport and physical scale.                                                                                                                                            |

Run mouse and, where available, precision touchpad separately. Include keyboard and scrollbar controls; neither replaces touchpad inertia. For each native case retain the exact sequence/pacing in the ignored report alongside its numeric results. A machine without precision touchpad leaves that path blocked for final acceptance.

## What the collector measures

The passive probe observes wheel dispatch at the iframe window (so a document-level forwarder cannot hide it), raw delta/delta mode, final cancellation, actual outer-offset delta at rAF, frame intervals, long tasks, mount/unmount counts and sampled stage dimensions. It never patches vendor managers, event registration prototypes or scroll input. Document/scroller bindings retire on removal, replacement and stop. Numeric arrays are bounded; any dropped sample invalidates an unconditional performance claim.

The [CDP Performance API](https://chromedevtools.github.io/devtools-protocol/tot/Performance/) supplies JS heap and main-thread task duration. DOM counters report total renderer documents/nodes/listeners, including the app and observer. Keep these separate from the probe's own listener count; they are not the registry's exclusive listener count or total native/GPU memory. GC checkpoints are tagged explicitly and cannot be treated as natural memory samples. The runner takes start/end GC checkpoints outside the intended input window. For the 20-minute scenario, run `--seconds 1200 --gc-checkpoint-seconds 300` to collect idle checkpoints at 0/5/10/15/20 minutes within one continuous app/Reader session. Pause physical input five seconds before each announced checkpoint and resume only after completion. Each GC checkpoint flushes and restarts the bounded timeline, omitting forced GC work from dispatch/layout/paint aggregates. The reusable capture exposes the same `checkpoint(true)` operation. Do not force GC while timing input.

Timeline collection immediately discards all arguments after selecting numeric `EventDispatch(wheel)`, `Layout`, `UpdateLayoutTree`, and `Paint` durations. It aggregates counts in 100ms buckets without storing raw trace material. Long-task observation is marked unsupported when absent. Main-thread busy percentage is `TaskDuration / elapsed`, not whole-system CPU. Record process CPU/working set separately with owner-approved Windows performance tools if required; absent process CPU/image/GPU memory data remains unmeasured.

Event-to-observed-scroll uses the latest wheel's DOM event timestamp (converted from its iframe time origin) to the next rAF that observes an offset change against the previous sampled frame. It is an upper bound on main-thread observation, including dispatch delay. `offsetChangedBeforeObserver` flags movement already seen when the passive handler runs, whether from an earlier app handler or native scrolling. It does not prove the compositor presented a frame at that instant. Prepend compensation and coalesced wheel events can affect effective delta; retain the existing visible-anchor correctness tests. Estimated missed rAF slots use the measured median cadence, not an assumed 60Hz display. Hidden app intervals invalidate pacing comparisons. Mount detection-to-document-ready is a public DOM surrogate, not complete render duration. Scroller replacements and sampled stage resize are rebuild surrogates, not private `rendition.resize/clear` call counts. Published progress rate observes `.reader-progress` `aria-valuenow` changes, not every `relocated` event. The synthetic harness additionally exposes untruncated rendition event counts and render-hook-to-rendered tail durations; these tail durations omit earlier decode/render work and are not full app render timings.

## Regression contract established before behavior fixes

Correctness limits are fixed by the plan: visible anchor movement at most 2 CSS px, isolated media center error at most 1 CSS px, and symmetric prose gutters within 2 CSS px. Chromium correctness does not certify physical WebView2 input.

For each platform/scenario/input/scale independently, calculate the median of five per-run p95 and p99 frame intervals, p95 observed-scroll latency, p95 wheel dispatch duration, layout/style/paint durations and burst counts, long tasks per minute, and main-thread busy percentage. No baseline pooling across machines or platforms. For each metric with median `B`, measured repetition range `R`, define `N = max(R, 0.10 × B, 0.5 units)` and upper limit `B + N`. Block budget approval if `R > max(0.20 × B, 0.5 units)`; investigate and repeat. The 10% floor/0.5-unit resolution allowance is a declared noise policy, not a measured universal performance promise. Write the resulting numeric limits into the ignored baseline record and review them before any Reader behavior fix. `regressionBudget()` computes this policy and marks values provisional until reviewed.

Compare five final runs using the same method; the median and at least four of five individual runs must meet each approved limit. Retain min/median/p95/p99 and explain any remaining variance. Missing distributions, hidden intervals, truncated samples, changed hardware or instrumentation invalidate comparison. Counts and memory additionally require stable working sets after traversal/reversal, and no continuing positive post-GC slope over five checkpoints in the final bounded-lifecycle phase. Baseline residency growth is recorded as a defect, never accepted as the final policy. Do not set an arbitrary frame cap before the owning lifecycle work profiles section sizes.

After collecting five native repetitions of one exact scenario, run `node scripts/reader-performance-budgets.mjs <run1.json> <run2.json> <run3.json> <run4.json> <run5.json>` and save its numeric output beside the baseline. It refuses Chromium data, mixed metadata or collector/probe hashes, duplicate repetitions, hidden intervals, truncated data or a full trace buffer. Limits remain provisional until owner review. Review the recorded actions and hardware declarations as well as the numbers. A trace buffer near capacity or `traceDataLoss` invalidates the trace; use the idle checkpoint rotation to bound sustained-session timeline segments, then repeat if any segment lost data.

The native budget API sets `approvable: true` only when all eleven required metrics have valid five-run provisional envelopes. Missing, invalid or noisy required metrics produce an overall `blocked` result, `approvable: false` and a `blockedMetrics` list with reasons. The CLI prints diagnostic JSON but exits with code 1 for a blocked result; only a complete provisional result exits with code 0. Owner review cannot approve a blocked result or use its partial limits as an actionable baseline. Identity/integrity violations still reject the input and exit with code 1.

This tool derives a complete scrolling performance envelope: frame p95/p99, latency, wheel dispatch, layout/style/paint duration, layout/paint burst counts, long tasks and main-thread utilization are all required. Percentile distributions need positive integer sample counts; long-task observation must be supported, even when the measured task rate is zero. No scenario/input metric exemptions are supported. Keyboard, scrollbar or panel-only records without those measurements are supplementary diagnostics and cannot yield a complete budget. Missing values are never substituted with zero or silently omitted. Physical input and sustained-memory acceptance remain separate gates even for a complete provisional envelope.

Native numeric limits remain **blocked until the same-machine physical baseline runs**. Chromium limits cannot fill that gap. Carry unresolved mouse/touchpad, process CPU, sustained-session, scaling or native evidence explicitly to the integrated signoff gate. No final runtime signoff is permitted with those required paths missing.
