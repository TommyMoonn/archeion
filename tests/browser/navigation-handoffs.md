# Reader and archive handoff verification

Phase `1.8.0.5` owns `UX-01`, `UX-02` and `UX-03`. These tests use the real App, router, archive store, storage adapter and EPUB viewer with generated EPUBs and a synthetic native backend.

## Run

```powershell
npm run test:browser:typecheck
npx playwright test --config tests/browser/navigation-handoffs.config.ts
```

For the known cold Vite fixture-acquisition stall, follow the prepared-server procedure in [ui-stability.md](ui-stability.md). Keep that server running, confirm the synthetic Library loads, then run:

```powershell
$env:ARCHEION_UI_EXTERNAL_SERVER = '1'
npx playwright test --config tests/browser/navigation-handoffs.config.ts
Remove-Item Env:ARCHEION_UI_EXTERNAL_SERVER
```

Record server preparation separately from browser-context cache state. The phase run used a temporary Vite configuration with a separate cache directory and `optimizeDeps.entries` restricted to `tests/browser/fixtures/ui-stability.html`. It did not change the production Vite configuration.

## Contracts

| Journey                                                       | Assertion                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slow source, failure, retry, success                          | One Reader main, toolbar reserve and stage; identical background and stage rectangles in light, dark and sepia; at most one opening status per sampled frame                                                                |
| Return with independently held progress save and route commit | Rendition remains during settlement; retirement replaces all book controls with stable Reader-theme bounds and at most a subdued status. No heading, generic toolbar label, alert or recovery button in a successful trace. |
| Browser history Back                                          | Return completes with app motion off and system reduced motion; no sampled empty Reader stage                                                                                                                               |
| Archive A to empty/500-book B                                 | A sidebar DOM remains mounted while loading; retiring workspace is inert; shortcuts cannot open Quick Actions; B appears only after its snapshot is ready                                                                   |
| Failed scan or activation                                     | Same-frame alert and keyboard-reachable retry; no false attribution of A data to B                                                                                                                                          |
| Reader to another archive                                     | Gate stays blocked until the Library route commits; no exposed empty Reader stage                                                                                                                                           |

Artifacts are written under `test-results/navigation-handoffs/`: source-error screenshots and frame samples attached by Playwright. Frame samples contain stage bounds, Reader background, opening-status count and empty/retiring flags. They are browser observations, not compositor screenshots of every native frame.

The first blocker follow-up adds nine held-exit cases (light/dark/sepia by normal/app-off/system-reduced motion), double Back, history Back, hidden-toolbar geometry, delayed save failure and retry, rejected navigation recovery, superseded destination release and archive replacement during retirement. Frame records include lifecycle, iframe count/visibility, book versus exit toolbar, stage presentation and committed route; separate destination samples confirm Library reveal. Samples are bounded and contain no EPUB text, title, CFI or annotation data.

`holdReaderExit()` independently gates storage flush and the Library route loader inside the fixture only. Releasing the save cannot release the destination. Failed saves leave the usable Reader intact. Retirement does not retain interactive EPUB resources or defer required writes.

## Follow-up 2: quiet exit and explicit failure

Normal retirement has only `Returning to Library…` in a polite status, with no heading focus, decorative header, button or error inference from idle flags. The nine theme/motion cases assert zero unwanted page elements in every retired sample, plus stable stage and titlebar bounds.

`acknowledgeNextExit()` separately holds actual navigation after the returned promise resolves, exercising the idle/acknowledged-but-uncommitted gap. The Reader stays quiet until a real destination shell replaces it. Router state, not the address bar, supplies committed-route evidence; destination DOM samples confirm actual reveal.

Only an owned rejection, failed blocked settlement, committed router error or the 15-second post-retirement deadline supplies failure recovery. The deadline is an operational failure bound, not a visual delay. Timeout releases only the matching controlled attempt; retry uses the router's supersession and cached Reader leave settlement. Browser clock advancement and fake timers test the bound without production sleeps.

An explicit Library route error uses the last outgoing palette/toolbar-clearance metadata, with one keyboard-focused recovery action. That action reloads the destination document to recover cached module failures without reopening the retired EPUB. The presentation metadata is cleared when Library mounts; it owns no resources or navigation.

The suite retains previous coverage and adds early acknowledgement, genuine rejection, hidden-toolbar history exit into a committed loader error, timeout/retry without repeat flush, and obsolete destination release. RED/GREEN screenshots and classifications cover successful and failed exits without recording EPUB contents in logs.

Focused component tests also cover known-missing files, slow source errors and retry, stale archive-route completions, early `navigate()` resolution and cancellation of retirement by a newer Reader intent.

Native book dialogs and Quick Actions also retire during an archive handoff. Their top-layer controls must not remain active merely because the workspace ancestor is inert.

## Remaining native acceptance

Follow-up 2 also ran a disposable real-IPC Windows Back recording with a synthetic EPUB. It acquired 97 external client images with 21 foreground gaps. The inspected transition went directly from Reader to Library, and no retired waiting frame was sampled. This does not establish the native held-destination path or full theme/motion matrix.

The evidence ZIP retains the isolated runner, external recording, exact failed file-origin harness attempt and successful embedded-frontend logs. Native delayed-save/rapid-Back captures, mixed-DPI displays, physical keyboard input, screen-reader narration and performance signoff remain obligations. Do not infer them from Chromium geometry or a fast-path runtime recording. The broader disposable `npm run test:runtime:windows` covers other real IPC, EPUB and secondary-window regressions, not this phase's full native frame matrix.
