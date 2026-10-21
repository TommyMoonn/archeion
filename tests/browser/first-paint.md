# First-paint appearance checks

Run `npm run test:browser -- --config tests/browser/first-paint.config.ts`.
Set `ARCHEION_UI_FILMSTRIP=1` to retain timestamped Chromium compositor samples.

The suite uses real `App`, `AppPreferencesStore`, `ThemeCatalog`, and `AppearanceRuntime`, with synthetic native IPC and a synthetic read-only native prepaint response. It does not seed a second persisted theme choice. The tests hold the app module to inspect pre-JavaScript document paint, then observe through deliberately delayed settings/catalog hydration. They assert the selected canvas, not gray or eventual correctness alone.

Coverage includes true `page.reload()` journeys in dark, light, system-light, system-dark and valid custom modes; all four utility entry points; missing/corrupt/timed-out custom palettes; late preference publication after timeout; explicit recovery; newer selections; system changes during startup; and keyboard notice dismissal. The fixture's router changes the address to `/`, so reload cases restore the fixture entry URL with `history.replaceState` before reloading the same page. Otherwise reload would test the unmocked production index instead of this workload.

The fixture accepts `settingsDelay` and `themeDelay` from 0 through 10,000 milliseconds, `settingsFailure=unavailable`, and `themeFailure=missing|corrupt`. Production preference, catalog and native-presentation acknowledgement waits retain their five-second deadlines. Optional fonts and Reader palettes do not gate a built-in application's presentation.

## Native presentation contract

The native process retains one derived presentation, not another saved preference. `AppearanceRuntime` publishes resolved committed colors and the exact validated custom manifest source. Native admission checks canonical selection/revision and current manifest identity. Every prepaint read checks current canonical selection, catalog revision and manifest digest. Deletion, corruption, replacement or a changed selection invalidates reuse. System palettes follow native scheme events and the document's current media query. An unrelated settings revision does not discard a still-valid custom canvas.

The blocking document bootstrap reads the local `archeion-appearance` protocol before startup CSS paints. It writes only pending-document presentation properties, never application tokens or settings, and retires its system listener when the runtime hands off. The native WebView background is updated when committed appearance is prepared and persists across reload. No navigation callback, window hide/show cycle, animation or opacity transition is introduced.

On cold process launch the custom presentation cache is empty. The existing hidden main-window lifecycle waits for appearance resolution and native background acknowledgement before its normal reveal. An immediately shown utility with no validated process-local custom presentation uses the explicit built-in dark fallback while validation runs. Missing or corrupt packages also use that fallback with an accessible runtime notice. This is a precise cold-cache limitation, not a claim that Phase 1.8.0.4's utility shell-ready reveal has been implemented. Unavailable native bootstrap also leaves the explicit dark CSS fallback; it never defaults to white or the rejected fixed gray.

## Prepared development server

If automatic Vite readiness fails:

1. Start `npx vite --host 127.0.0.1 --port 4184 --strictPort` separately.
2. Open `/tests/browser/fixtures/ui-stability.html?theme=light&count=0` and wait for Library. This prepares module compilation, not subsequent browser-context state.
3. Set `$env:ARCHEION_BROWSER_PORT='4184'`, `$env:ARCHEION_UI_EXTERNAL_SERVER='1'`, and optionally `$env:ARCHEION_UI_FILMSTRIP='1'`, then run the suite.

Record preparation conditions. Chromium samples and a prepared server do not prove the packaged native interval or a guaranteed capture rate.

## Windows Ctrl+R recording

Use a separately built smoke identity and synthetic archive, not a personal archive. Select dark, light and a validated custom theme through canonical settings. Verify resolved tokens, foreground the owned window, then run:

```powershell
pwsh -NoProfile -File tests/runtime/recordAppearanceWindow.ps1 `
  -BinaryPath <absolute-owned-smoke-exe> -OutputDirectory <new-capture-directory> -Reload -FocusOwnedWindow
```

The optional `-FocusOwnedWindow` activates only the verified test process before capture, without synthesizing keyboard input to acquire focus. The external recorder captures the physical client rectangle before sending foreground-guarded Windows `SendInput` Ctrl+R. It saves full PNGs and sampled canvas pixels, timestamps, input time and foreground gaps. Independently verify a document marker disappears and appearance readiness returns. Preserve before/after frames and inspect the opening status as well as background samples. It never captures another foreground window or sends input to an unverified target.

Report actual intervals, missing samples and focus changes. The requested 33 ms cadence is not a frame-perfect guarantee. A Selenium attachment after navigation, a DOM screenshot, or Chromium's initial blank tab cannot substitute for this native recording. Cold process first-visible, utility shell-ready, physical focus/accessibility, monitor placement, Reader/archive handoffs and integrated signoff remain separate observed gates.
