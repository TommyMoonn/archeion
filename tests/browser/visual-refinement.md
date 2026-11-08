# Shared visual refinement (phase 1.8.0.19)

The production components own corners and empty-state presentation. `--radius-control` is 6px; `--radius-dialog` and floating menus are 8px; smaller nested items are 4px. Segmented options subtract the group's 3px padding and 1px border; standalone icon-only options retain the control radius. No control-height, padding, hit-target, focus-ring or modal-lifetime changes are intended. Status badges, tags, toggles, progress tracks and the noninteractive drop hint retain their capsule semantics.

`EmptyState` reserves a 32px monochrome decorative glyph only when its caller supplies one. Omission selects compact text-only presentation. Destination owners continue to choose the heading, guidance and action. Library/Favorites/folders/Continue Reading use book/heart/folder/history glyphs; Series and integrity destinations retain their contextual glyphs. Library search/filter, Folder search and unmatched Series omit artwork. Existing empty-versus-filtered classification stays with its destination owner.

## Repeatable checks

```powershell
pnpm exec vite build --config tests/browser/visual-refinement-build.config.ts
pnpm exec playwright test --config tests/browser/visual-refinement.config.ts --grep 'restrained corners|production collection|contextual destinations|UX-15|first-paint palette|filter no-results'
```

The disposable production fixture build avoids development-server module acquisition stalls and exposes real lazy chunks. It does not change the application release build. For a persistent preview server, start the configured preview on port 4291 and set `ARCHEION_UI_EXTERNAL_SERVER=1`. Set `ARCHEION_UI_FILMSTRIP=1` to retain timestamped compositor frames. Copy results from `test-results/visual-refinement` into the local phase evidence directory before rerunning.

Coverage includes all four button variants at compact/standard/prominent sizes, grouped inner corners, Series return action, keyboard outline and modal focus return, light/dark/custom colors, 560/1280px widths, 150% text on the four collection destinations, Folder and Library no-results and filter recovery. The component regression also exercises unmatched Series and its Clear search action.

## UX-15 decision

The phase run reproduced neither late text nor icon settling in cold/warm Add EPUB modal observations. With motion disabled to isolate typography, each run retained 35 modal frames: fonts were loaded in every modal sample; heading, action-label text ranges and five SVG boxes each had one distinct rectangle across all samples. The phase-2 first-paint theme observations and independently delayed font/lazy-chunk experiments also ran. Artificially withholding a dependency diagnoses that dependency; it does not demonstrate a natural defect.

Retain current `font-display`, face selection, preload policy and SVG slots. No font or icon loading correction is justified by these measurements. `ui-stability.json`, `modal-font-bounds.json` and compositor filmstrips are local phase evidence. These Chromium results do not establish native Windows/WebView2 first-visible paint, GPU performance, physical DPI or screen-reader speech; integrated native verification remains phase 1.8.0.20.
