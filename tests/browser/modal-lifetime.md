# Phase 1.8.0.16: native surface exit lifetime

Implemented on `feat/interface-motion-consistency` from fetched `origin/main` at `1de5724e57115a6f6cf1a5e259ef8f563d4fd64a`. The starting worktree was clean. Changes are uncommitted.

## Scope and evidence

The local `.planning/ARCHEION_PLAN_1.8.0.md` owns this phase. Source inspection reproduced the mechanism in second-pass UX-21 and third-pass UX-28/UX-30: conditional React mounts and native cleanup removed the surface before an exit could run. The palette baseline fixture records the same immediate removal with presence disabled.

The supplied audits are under `.project/audits/2026-10-16-archeion-ui-ux-audit/`. The first-pass backdrop finding and third-pass motion tuning remain phase 1.8.0.17 work. This phase preserves existing distances, scale endpoints, durations, backdrop styling, and Quick Actions command invocation timing. No version metadata changes.

Quick Actions already calls the shared native modal lifecycle in this baseline. Its existing semantics are preserved, rather than introducing a second nonmodal implementation to match the plan's older description. Its initial 120ms downward entrance remains unchanged.

## Ownership

- `SurfacePresence` retains a conditional child only during dismissal. Its child identity and cancelled completion lease invalidate older finalizers. A replacement child or external owner teardown disposes the old surface immediately. A suspended child without a mounted native owner retires immediately.
- `useModalDialogLifecycle` retains native top-layer containment through exit, marks child panels inert, blocks click/submit events, suppresses duplicate dismissals, and owns native close and focus return on final disposal. Reopening restores usable focus only if the surface is still topmost.
- Exit completion uses browser animation promises plus a deadline measured from the active animation. Cancellation, absent CSS animations, app motion-off, system reduced motion, and preference changes cannot leave a hidden trap. No duration is copied into JavaScript.
- Interrupted entry and reopened exit sample the displayed transform/opacity. The next animation starts at that pose; later motion tuning can change CSS endpoints without changing lifecycle ownership.
- Async shells suppress loading-to-ready focus handoffs during exit. Quick Actions invalidates pending outcomes as soon as dismissal starts, while command invocation remains immediate.
- Library actions remain referentially stable. Async deletion and editor callbacks capture the owning dialog identity, so late completion cannot close its replacement. Existing mutation focus waits for actual modal release through the transient-surface owner.
- Native mount owners in Library, Settings, Themes, and Archive rescan use the same presence boundary. Nested bulk discard confirmation has its own lifetime. The unused old drawer entrance keyframe was removed.

## Validation

| Check                                                                            | Result                                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Focused component/Library/Quick Actions regression runs                          | Passed; 127 tests in the broad focused run, with two subsequent late-completion cases also passing                                |
| Full Vitest suite, host permissions, excluding historical `.scratch` test copies | 4,183 passed, 1 skipped, 2 failed across 396 files                                                                                |
| Isolated fetched-main comparison                                                 | Both Series failures reproduce on the clean baseline archive                                                                      |
| Production modal-lifetime fixture                                                | 19 Chromium tests passed, including real pointer sequences, containment, action guards, pose continuity, motion-off, and teardown |
| Existing production async-surface fixture                                        | 40 Chromium tests passed, including lazy import, retry, readiness geometry, pending-dismissal focus, and replacement focus        |
| ESLint over `src` and `tests`                                                    | Passed                                                                                                                            |
| Application and browser TypeScript checks                                        | Passed                                                                                                                            |
| Architecture check                                                               | Passed: 459 production modules, 1,669 production edges                                                                            |
| Application production build                                                     | Passed                                                                                                                            |
| Diff whitespace check                                                            | Passed                                                                                                                            |

The two full-suite failures are in `LibraryPage.stateIntegration.test.tsx`: “keeps the Series shell mounted while initial loading becomes ready empty” and “keeps existing Series entries mounted during a rescan”. They fail identically in an isolated `git archive HEAD` baseline. That test file also emits React `act(...)` warnings. Neither test nor Series implementation was changed.

Initial default Vitest discovery included old tests under `.scratch`; subsequent runs explicitly excluded that historical directory. Initial development-server browser runs hit navigation timeouts before assertions; the production-built fixture removed that dependency. Restricted browser teardown required host permissions. Temporary Git/installer tooling failures passed when rerun with host permissions, and the final full suite ran in that context. No test gate, production timeout, or baseline Series assertion was relaxed.

## Reproduce

```powershell
npx vitest run --exclude '**/.scratch/**' --maxWorkers=4
npx eslint src tests --ignore-pattern '**/.scratch/**'
npm run typecheck
npm run test:browser:typecheck
npm run architecture:check
npm run build
npx vite build --config tests/browser/modal-lifetime-build.config.ts
npx playwright test --config tests/browser/modal-lifetime.config.ts
npx vite build --config tests/browser/async-surfaces-build.config.ts
npx playwright test --config tests/browser/async-surfaces.config.ts
```

On this Windows environment, use host permissions for temporary Git/installer tests and Playwright server teardown. Browser videos and closing screenshots are written to `test-results/modal-lifetime/`; a delivery snapshot is retained with local phase evidence under `.project/v1.8.0/1.8.0.16/`.

## Limits and deferred work

Chromium fixtures prove the tested DOM, animation, focus, and input contracts. They do not establish packaged WebView2 pacing, Windows 100/125/150 percent scaling, physical input behavior, screen-reader announcements, GPU performance, or release acceptance. Those native/manual checks were not run. Full-distance opaque drawer travel, modal expansion tuning, calm no-blur backdrops, sidebar motion, radii, and release work remain in later phases.

## Phase file inventory

No files were deleted. The changed-files ZIP contains the following files plus the packaging helper's provenance manifest.

Modified:

- `src/components/AsyncDialogShell.test.tsx`
- `src/components/AsyncDialogShell.tsx`
- `src/components/Dialog.tsx`
- `src/components/useModalDialogLifecycle.ts`
- `src/features/archive/RescanArchiveButton.tsx`
- `src/features/library/BulkMetadataDialog.tsx`
- `src/features/library/LibraryWorkspaceDialogs.tsx`
- `src/features/library/useLibraryBookActions.test.tsx`
- `src/features/library/useLibraryBookActions.ts`
- `src/features/library/useLibraryBulkActions.ts`
- `src/features/library/useLibraryMutationFocus.ts`
- `src/features/library/useLibraryWorkspaceDialogs.ts`
- `src/features/quick-actions/QuickActionsPalette.test.tsx`
- `src/features/quick-actions/QuickActionsPalette.tsx`
- `src/features/quick-actions/QuickActionsProvider.tsx`
- `src/features/settings/KeyboardShortcutSettings.tsx`
- `src/features/settings/SettingsConfirmations.tsx`
- `src/features/settings/sections/DictionarySettingsSection.tsx`
- `src/features/themes/ThemeDetails.tsx`
- `src/features/themes/ThemeManagerSurface.tsx`
- `src/styles/base.css`
- `src/styles/components/dialogs.css`
- `src/styles/features/library.css`
- `src/styles/features/quick-actions.css`

Added:

- `src/components/SurfacePresence.test.tsx`
- `src/components/SurfacePresence.tsx`
- `src/components/modalExit.ts`
- `src/components/modalPresenceContext.ts`
- `src/features/library/useLibraryWorkspaceDialogs.test.tsx`
- `tests/browser/fixtures/modal-lifetime-main.tsx`
- `tests/browser/fixtures/modal-lifetime.html`
- `tests/browser/modal-lifetime-build.config.ts`
- `tests/browser/modal-lifetime.config.ts`
- `tests/browser/modal-lifetime.md`
- `tests/browser/modal-lifetime.pw.ts`
