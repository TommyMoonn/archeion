# Real EPUB renderer browser harness

The harness renders the original synthetic ZIP inputs from `tests/fixtures/reader/` with the installed `epubjs@0.3.93`. It measures actual chapter iframes and the outer scroller. This is a test surface, not a full Reader app or a Windows WebView2 benchmark.

## Run

From the repository root with the locked dependencies and Playwright Chromium installed:

```powershell
npm run test:browser -- tests/browser/reader-epub-fixtures.pw.ts tests/browser/reader-runtime.pw.ts
```

The normal suite covers fixture integrity/loading, nonzero-spine resume, CFI navigation, mode switching, stale-open supersession, rejected EPUB open and recovery, iframe wheel input, PageDown/PageUp, native scrollbar drag, effective repeated reversal, true EOF, Paged centering/turning and fixed-layout composition/links. Historical defect tests are skipped by default.

Opt into diagnostic reproductions:

```powershell
$env:ARCHEION_READER_DIAGNOSTICS = "1"
npm run test:browser -- tests/browser/reader-runtime.pw.ts --grep "historical" --workers=1
Remove-Item Env:ARCHEION_READER_DIAGNOSTICS
```

On POSIX shells:

```sh
ARCHEION_READER_DIAGNOSTICS=1 npm run test:browser -- tests/browser/reader-runtime.pw.ts --grep historical --workers=1
```

Each opt-in test checks setup before declaring an expected failure on the intended correctness assertion. A broken setup fails normally. A contract that unexpectedly passes also fails, prompting removal of the expected-failure annotation in its owning fix. Existing defects are never asserted to be desired behavior or made permanent normal-suite expectations.

Select one diagnostic with `--grep "short-cover"`, `--grep "reverse-prepend"`, or `--grep "isolated illustration"`. JSON attachments in the Playwright report contain only authored fixture identifiers, CFI values, coordinates, dimensions and event times. Console output provides a compact measured summary.

For concurrent runs, set `ARCHEION_BROWSER_PORT` to an unused port, for example 4175. The default is 4173. Isolate artifacts with Playwright's `--output <directory>` and `PLAYWRIGHT_HTML_OUTPUT_DIR` when another test run uses the same workspace.

## Interactive control

Run Vite and open `/tests/browser/fixtures/reader-epub.html?fixture=reverse-prepend&flow=continuous&section=2&profile=archeion`. Query parameters select startup only. The same page accepts route-independent controls:

```js
await readerFixture.open({
  fixture: "reverse-prepend",
  mode: "continuous",
  profile: "archeion",
  target: 2,
  width: 1050,
  height: 750,
});
const cfi = readerFixture.cfi("current-p3");
await readerFixture.display(cfi);
await readerFixture.switchMode("paged");
await readerFixture.turn("next");
readerFixture.snapshot();
readerFixture.events();
readerFixture.clearEvents();
readerFixture.dispose();
```

`target` accepts a spine index, EPUB href/fragment or real CFI. `changeImageSize(height)` controls the fixture's authored delayed image when its section is mounted. Opening another fixture retires observers, content listeners, rendition and book; a newer pending open supersedes an older generation. Mode switching recreates the proper manager at the rendition's current CFI. Fixed-layout requests always resolve to Paged mode.

Each opening attempt establishes one idempotent release callback before awaiting Book initialization. A `finally` releases unsuccessful or superseded attempts, including metadata, `renderTo`, rendition startup and initial display failures. It removes the content hook, clears the document registry, disposes the runtime observer and destroys the Book, which owns rendition destruction. Successful attempts transfer that same release callback to the active session. Late older attempts cannot clear a newer active session. Metadata is published only after successful display. The failed-open regression uses the real renderer's `No Section Found` rejection for a missing EPUB href, verifies no active session or retained iframe/container, then opens fixed-layout and verifies only its expected `page-one` section and render event. This is not arbitrary fault injection or a failed auxiliary command. Earlier initialization exceptions share the same cleanup path but are not individually injected by this browser case.

The `stock` profile is the default and uses no Archeion overrides. `archeion` imports the production `ReaderContentDocumentRegistry`, reflowable layout, stabilization and Continuous wheel forwarder. It omits the app shell, theme/font selection, durable progress, annotations, popovers and Paged gesture arbitration. It supports scoped integration evidence, not complete app signoff. No vendor manager implementation is copied into this harness. The optional prepend probe described below instruments private methods only in this test entry point.

For manual scrollbar experiments use `scrollbar: "visible"` in `open()`. The runtime test file also removes Chromium's default `--hide-scrollbars` launch argument. The resulting drag operates the browser's native scrollbar with pointer input. PageDown/PageUp focus the outer scroller, which is made focusable in this test surface. Iframe keyboard command delegation in the complete app remains a separate check.

## Measurements and assertions

`reader-runtime-observer.ts` records `scrollTop`, `scrollHeight`, `clientHeight`, viewport geometry, mounted section identifiers, iframe count, authored anchor rectangles, preceding/following spine identifiers and true EOF. It also records retained vendor view placeholders separately from resident iframes, because an evicted iframe can leave a nonzero-height placeholder. Coordinates include the iframe's offset and observed scale and check actual visibility. No publication text or local filesystem paths are collected.

Public rendition `rendered`, `relocated` and stage `resized` events are timestamped. The render hook subscribes to each view's `resized` emitter without replacing it. Initial view resize can precede that hook; `mounted-geometry` is an explicitly labeled DOM/ResizeObserver surrogate for that gap. Wheel records include actual delta and cancellation state. Subscriptions and observed frames are released when disconnected and on session teardown. The event buffer retains at most 300 records.

The passive observer cannot attribute every numeric correction to `counter()`, trimming or Chromium anchoring through public events. It records the resulting offsets, heights and passage coordinates without claiming private-method call counts or exact correction-source attribution. The separate opt-in prepend probe records explicit manager corrections for the position-owner tests; it does not change the passive observer or performance measurements.

`reader-runtime-driver.ts` supplies reusable behavior assertions:

- `assertVisibleAnchorStable`: the same authored passage remains visible and its screen Y error is at most 2 CSS px. Numeric scroll offsets may increase by the height inserted above it.
- `assertNextSectionReachable`: an authored anchor in the requested next section actually enters the viewport.
- `assertImageCentered`: the visible image center matches the effective outer content center within 1 CSS px.
- `assertNoBlankReverse`: sampled frames contain a mounted chapter and visible authored content. Reversal coverage samples animation frames during real input as well as settled geometry.
- `assertSectionResidencyBounded`: actual resident iframe counts stay within the caller's explicit policy across different sections. Current passing use verifies Paged's one-frame behavior. No Continuous warm-window ceiling or 40-section bounded-residency success is claimed here.

Geometry settles when successive observed snapshots agree, not after a fixed layout sleep. Frame sampling is diagnostic observation, not an input animation or a performance claim.

The normal long-spine reversal test also compares a visible authored anchor before upward wheel input with the same anchor afterward. Its screen Y must increase, proving movement toward earlier reading without locking an exact pixel delta. A no-op input leaves Y unchanged and fails. This measures effective passage motion independently of outer offset compensation for prepended geometry; it does not impose the separate reverse-prepend anchor-stability contract on the known-unfixed resume diagnostic. No-blank-frame sampling and true-EOF checks remain in place.

## Historical scenarios

`short-cover` opens with stock epub.js, shrinks the authored image after display, and receives wheel deltas of 548px and 630px over the iframe. The trace distinguishes a false boundary with `following=short-first` from actual EOF. It never calls private `check()` to force a continuation.

`reverse-prepend` resumes at spine index 2. Stock epub.js prepends preceding sections during `display()` itself, before it resolves. The diagnostic captures the `current` rendered event at the known `current-p3` anchor before those insertions, then records prepend mount snapshots and the settled result. Required final compensation uses the net height retained above that anchor, including placeholders after stock eviction. The same screen Y comparison works even when the final resident frame list differs. This captures an unmodified resume/prepend overshoot; it is not an exact recreation of the audit's later manual `scrollTop≈40` experiment. Wheel/keyboard reversal is separately covered by the normal traversal case.

`image-only` compares the malformed publisher selector in Continuous under the current Archeion profile. Its good centering assertion remains an opt-in expected failure. The Paged companion checks the existing fallback against actual image geometry; fixed-layout checks deliberate placement and its page link.

The stock anchoring diagnostic remains opt-in. Archeion prepend stability is now a normal regression in `reader-prepend.pw.ts`. Windows WebView2, physical touchpad inertia, original private books, long-session memory, native performance budgets, boundary reconciliation and Continuous residency policy remain separate gates. Chromium evidence cannot substitute for those gates.

## Continuous prepend position ownership

Run the scoped regressions with `npm run test:browser -- tests/browser/reader-prepend.pw.ts tests/browser/reader-runtime.pw.ts`. These use the installed `epubjs@0.3.93` with real synthetic EPUB iframes. The retained private `update()` adapter has an exact-version unit guard. Production leaves `check()` and `counter()` unchanged. A vendor version change requires rerunning and reviewing these behavioral contracts.

The Continuous outer `.epub-container` sets `overflow-anchor: none` before first display, through the rendition's public `attached` event. epub.js owns deliberate prepend compensation through `counter()`. No second cumulative application correction is added. Its numeric offset increase is required to retain the same visible passage; restoring the old numeric offset would move reading backward. The removed `activeChecks` gate no longer suppresses subsequent vendor compensation. Publication `html`, `body`, iframe styles, Paged and fixed-layout surfaces receive no anchoring override. The session owns the attachment subscription and guards awaited view showing after retirement.

The A/B explicitly overrides anchoring to `auto` or `none` in the test surface, comparing stock and Archeion profiles. It measures initial resume and a controlled near-top offset of 40 CSS px, along with offsets 140 and 300, unequal previous-section heights and successive prepends. Normal regressions require passage Y error at most 2 CSS px at widths 900, 1050 and 1400. Input tests reverse through ten or more boundaries with iframe wheel, native scrollbar drag and rendition navigation, sample visible frames, preserve upward input during a held prepend request and retire pending work on book switch or abort.

`probePrepend: true` opts into `reader-prepend-probe.ts`. This wraps `counter`, `scrollBy`, `scrollTo` and `request` only for the experiment, restoring each method on disposal. Each explicit correction records its requested height/offset and before/after geometry. Nested `counter` → `scrollBy` calls are counted once. Residual offset movement is observable but is not an exact measurement of the browser's internal anchoring algorithm. `atOffset()` explicitly queues a vendor check to reproduce the audit's near-top experiment; it is not evidence that ordinary boundary wakeup is fixed. Request holding models in-flight prepend input and retirement without network or arbitrary layout delays. The probe is absent from production and the default performance harness. It retains synthetic IDs/CFIs and geometry, never book prose.

General late media/font height reconciliation, startup/edge wakeup, native wheel ownership and bounded view eviction remain owned by later work. Passing these prepend tests does not establish their acceptance or native Windows perceptual performance.
