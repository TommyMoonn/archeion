# Phase 1.8.0.17 motion verification

The modal-lifetime fixture uses production Dialog, BookDetailsDrawerFrame, QuickActionsPalette,
SurfacePresence and styles. Its static Library header/card provide background geometry probes;
it is not a large Library performance workload. The async-surfaces fixture exercises real
Add EPUB, Rename, Metadata, Cover and Details routes, including their lazy shells.

```powershell
npx vite build --config tests/browser/modal-lifetime-build.config.ts
npx playwright test --config tests/browser/modal-lifetime.config.ts --trace on
npx vite build --config tests/browser/async-surfaces-build.config.ts
npx playwright test --config tests/browser/async-surfaces.config.ts
```

Use host permissions on Windows if the restricted runner cannot terminate its preview server.
The modal config runs both lifecycle and motion suites. Evidence goes to
`test-results/modal-lifetime/` and `test-results/async-surfaces/`.

The motion cases record paused entry/exit bounds, opaque drawer travel at 1280px and 390px,
proportional modal/control bounds, native focus containment/return, one scrim through nesting,
same-commit replacement, backdrop interruption/reversal, and cold/warm input-to-paint frames.
JSON attachments are retained inside Playwright traces when tracing is enabled. Browser
device scale factors 1/1.25/1.5 and larger fixture text are emulations, not Windows DPI proof.
The lifecycle suite also covers app-off, system reduced motion, outside pointer sequences,
guarded closing actions and stale completion. Existing palette travel and timing are preserved.

Phase baseline: clean `7a0996828475bd14819e0ce516b571b187587194` on
`feat/interface-motion-consistency`. An isolated Git archive of that source, with the same
test fixture and installed font bytes, rejects the new drawer/modal geometry assertions.
Both baseline and candidate record cold/warm frames over a 300ms interval. These bounded
Chromium samples do not establish a speedup, GPU cost, packaged WebView2 pacing or capacity.

Native acceptance remains open: packaged WebView2 open/close and rapid-route recordings,
physical Windows 100/125/150 percent scaling and text scaling, keyboard/input pacing and
like-for-like native input-to-paint traces. Browser checks cannot close that acceptance gate.
Sidebar width ownership, radii, empty states, font settling and release preparation remain
outside this phase.

## Closing-only blocker follow-up

The closing regressions sample the real `dialog-exit` and backdrop at 0, 50 percent and end.
They require complete fade to zero in 120ms with fixed bounds, retained native containment
and inert content, then actual disposal and focus return. Interrupted entry and mid-exit
reopen retain their displayed pose. Separate desktop/narrow recordings attach
`closing-raf.json` and videos from actual Cancel dismissal; opening frame data is not closing evidence.
Dense Cover/Metadata forms also exercise complete workspace dismissal through the existing
workspace close action exposed by the fixture. Normal editor return-to-Details routes remain
replacement transitions and are tested separately by the existing async route cases.

The RED cases ran against the submitted phase ZIP before editing production CSS and failed
at opacity 0.92. The follow-up preserves the 180ms entry, 38 percent dim, full opaque drawer
slide and 120ms palette travel. No production JavaScript or lifecycle owner changes.
Packaged WebView2 user-perceived closing smoothness remains unverified and native acceptance
stays open for Phase 1.8.0.20.
