# Busy-action status contracts

Phase 1.8.0.14 covers UX-12 and UX-26. Operation state stays with each feature. The
shared Button owns only the reserved indicator slot, delayed reveal and activation
suppression. Pass `busy={false}` while idle to reserve the slot. Standalone actions
may supply `busyStatus`; omit it when a feature already owns a live region.

The reveal delay is 180 ms. Fake-timer tests verify its lifecycle; a browser frame
sample checks that an approximately 80 ms operation settles without revealing the
indicator. This is a bounded presentation check, not evidence that 180 ms is an
optimal threshold for every native operation. Both motion-off paths keep a static
indicator after the same delay.

## Reproduce

```powershell
node node_modules/vite/bin/vite.js build --config tests/browser/busy-actions-build.config.ts
node node_modules/@playwright/test/cli.js test --config tests/browser/busy-actions.config.ts
```

If managed preview-server cleanup stalls, start the preview in a separate terminal:

```powershell
node node_modules/vite/bin/vite.js preview --config tests/browser/busy-actions-build.config.ts --host 127.0.0.1 --port 4284 --strictPort
```

Then run the same tests with the external-server option:

```powershell
$env:ARCHEION_UI_EXTERNAL_SERVER = '1'
node node_modules/@playwright/test/cli.js test --config tests/browser/busy-actions.config.ts
Remove-Item Env:ARCHEION_UI_EXTERNAL_SERVER
```

The fixture build lives under `.scratch/busy-actions-build`. Results and screenshots
live under `test-results/busy-actions`. The suite covers all four shared variants,
all three sizes, short/long labels, stable geometry, keyboard activation, suppression,
brief work, success/failure, light/dark, app motion off, system reduced motion, updater
outcomes and the existing dialog geometry journeys with action rectangles included.
Font readiness is awaited for the isolated button geometry comparison.

## Evidence limits

The operation backends are synthetic. Tests exercise production React components
and CSS in Chromium, not real file writes, native pickers, an update download or
installation. DOM live-region assertions establish a single announcement owner;
they do not prove speech output in NVDA or Narrator.

Packaged Windows/WebView2, screen-reader speech, physical input and DPI checks remain
part of the integrated native gate. Check Add EPUB/replacement, Rename, Move, Delete,
single/bulk metadata, cover preparation/write/retry, archive opening/creation and
updater checking/download/ready outcomes. Confirm descriptive status, focus,
single-submit behavior and no clipped controls at supported window/text sizes.
