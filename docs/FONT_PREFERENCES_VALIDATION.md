# Font preferences validation

## Automated evidence

Use injected catalogs for component and browser tests. `tests/browser/fixtures/font-catalog.ts`
provides proportional-sans, wide-serif, and monospace selection roles plus 1,200 searchable labels.
These synthetic labels prove selection behavior, not the glyph metrics of fonts installed on a CI
host. The Windows review below covers actual rendering.

- `src/stores/appPreferencesStore.test.ts`: existing desktop snapshot/event harness, independent
  Interface/Display roots, Display following Interface, Reader publication isolation in both
  directions, and missing choices resuming only with a fresh session catalog.
- `src/storage/installedFontCatalog.test.ts`: unchanged availability within a session and refresh
  in a new session, including browser execution without native enumeration.
- `tests/browser/font-preferences.pw.ts`: all three pickers with the large catalog, keyboard active
  row visibility, case-insensitive search, application reset, Reader persistence and missing-family
  fallback through reload. Existing font picker suites cover pending catalogs, empty matches,
  unavailable rows, RTL, forced colors, and enlarged text.
- `npm run test:runtime:windows`: disposable application identity/profile and archive, real native
  catalog, installed-family Library screenshots at 900×600 and maximized window sizes, real
  secondary-WebView propagation, and missing application/Reader selections through application
  restart. Evidence is written to `test-results/runtime-smoke/`. Unavailable sample categories are
  reported, not passed.

The smoke runs at the machine's current Windows display scale and records `devicePixelRatio` and
actual WebView dimensions. Browser text enlargement and a resized WebView do not certify Windows
display scaling, visual glyph quality, or an installation/removal event. Linux CI can validate
injected catalogs and the non-Windows empty-catalog contract without Windows font enumeration.

## Owner Windows/Tauri matrix

Run against the candidate build with a disposable profile/archive. Record build SHA, Windows and
WebView2 versions, installed family names, scale, window size, screenshots, and each result. Do not
mark a family category passed when the required family is absent.

| Metric category          | Suggested installed family                                       |
| ------------------------ | ---------------------------------------------------------------- |
| Default baseline         | Inter (Default), Archeion Default, Book serif (Default)          |
| Normal proportional sans | Segoe UI or Aptos                                                |
| Serif / wide             | Georgia or Palatino Linotype                                     |
| Narrow proportional      | Arial Narrow or another installed narrow face                    |
| Monospace                | Cascadia Code, Maple Mono, or Consolas                           |
| Vietnamese               | A family supporting `Tiếng Việt: Trường, Nguyễn, ắ, ệ, ỡ`        |
| CJK                      | A family supporting `日本語 中文 한국어` for the relevant script |

At **100%, 125%, and 150% Windows display scaling**, test the 900×600 minimum main window and
the maximized main window after font changes. Repeat normal/compact density and dark/light
appearance where geometry changes. Use independent Interface/Display/Reader families, then test
Display's **Use interface font** choice.

Review these surfaces for clipped glyphs, overlapping controls, hidden actions, and inaccessible
full labels. Ellipsized metadata is acceptable only when the full value remains reachable.

- Library expanded and collapsed sidebar, archive switcher and its popup.
- Library toolbar, book grid, list metadata, and book details.
- Settings rows, settings search, all three font pickers and their search/selection states.
- Archive Manager, Theme Manager, and About.
- Dialogs, selects, popovers, keyboard focus and dismissal.
- Reader toolbar, settings, and live publication text, including Vietnamese/CJK examples.

## Availability and recovery

1. Save distinct Interface, Display, and Reader families. Restart and verify all three labels,
   rendered selections, and cross-window propagation.
2. In the disposable profile, save a valid family name that is not installed. Restart and verify
   Library, Settings, and Reader all open. Each picker shows **Unavailable**; role-specific fallback
   renders, and the saved choice remains unchanged.
3. With owner approval, install a licensed test font using Windows while Archeion stays open.
   Confirm the cached picker list does not change, including a newly opened secondary window.
   Restart Archeion and confirm the family appears and a previously missing saved choice resumes.
4. If removal is approved, remove only that test font. Restart and confirm fallback without losing
   the saved choice. Restore the owner's environment when finished.
5. Reset Appearance. Verify both application font roles return to their defaults and Reader's
   selection remains unchanged.

Keep owner results with the phase/build evidence. Automated smoke screenshots are supporting
evidence, not a substitute for the complete owner matrix. Fix metric failures in semantic layout
roles, never with a selector or branch tied to an individual font name.
