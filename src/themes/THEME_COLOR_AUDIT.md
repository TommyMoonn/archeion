# Theme color audit

This inventory records the Phase 1.4.3.1 built-in palette and the version 1 theme
contract, including the Phase 1.5.6.4 split-shell ownership and diagnostic update.
Built-in and custom theme manifests continue to use hexadecimal sRGB colors.
Derived application and Reader colors are calculated through the internal OKLCH utility.

## Classification

| Source colors                                                                                                              | Classification | Contract ownership                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| App canvas, surfaces, frame, sidebar, main regions, lines, text, accent, focus, success, warning, error, and information   | Public         | `appThemePublicTokenRegistry` and the application `base`                        |
| Subtle lines, soft and border tints, selection, active, disabled, danger aliases, shell states, darkening, and shadows     | Derived        | `appThemeDerivedTokenRegistry`; custom manifests cannot override these directly |
| Reader background, surface, line, text, strong text, muted text, focus, danger, links, code background, and text selection | Public         | `readerThemePublicTokenRegistry` and `reader.base`                              |
| Reader quotation, visited-link, and subtle-line treatments                                                                 | Derived        | `readerThemeDerivedTokenRegistry`                                               |
| Window-close colors                                                                                                        | Fixed          | Platform-significant identity; not themeable in version 1                       |
| Annotation yellow, green, blue, and rose                                                                                   | Fixed          | Persisted annotation identity; not themeable in version 1                       |
| Cover-image control white and black                                                                                        | Fixed          | Contrast over arbitrary artwork; not themeable in version 1                     |
| Reader skeleton sheen                                                                                                      | Derived        | Derived from the resolved Reader text color                                     |
| `transparent` and `currentColor`                                                                                           | Contextual     | Inherit from the semantic role owned by the surrounding component               |

## Perceptual derivation

- Hexadecimal sRGB is converted to OKLCH before interpolation or lightness adjustment.
- Hue interpolation takes the shortest path and borrows the chromatic endpoint hue when
  the other endpoint is achromatic or substantially less chromatic.
- Output remains hexadecimal sRGB. Out-of-gamut colors retain lightness and hue while a
  deterministic binary search reduces chroma.
- Alpha remains independent from color-space conversion and is interpolated linearly.
- WCAG contrast uses its required relative-luminance coefficients. APCA is an additional
  diagnostic and does not replace the version 1 WCAG warning contract.

## Built-in audit

The audit covers application body and strong text on workspace and navigation planes,
readable muted labels on every owned surface, accent on workspace and navigation,
focus on every owned surface, status colors, Reader text, readable muted
text, links, focus, danger, selection, and code surfaces. Translucent pairs are composited
over their actual built-in canvas before measurement.

| Appearance        | Lowest audited WCAG ratio | Lowest audited absolute APCA Lc | Result                                             |
| ----------------- | ------------------------: | ------------------------------: | -------------------------------------------------- |
| Application Dark  |                      5.26 |                           41.25 | Every pair meets its assigned text or UI threshold |
| Application Light |                      4.42 |                           63.37 | Every pair meets its assigned text or UI threshold |
| Reader Dark       |                      6.67 |                           49.02 | Every pair meets its assigned text or UI threshold |
| Reader Light      |                      4.44 |                           63.65 | Every pair meets its assigned text or UI threshold |
| Reader Sepia      |                      4.27 |                           57.85 | Every pair meets its assigned text or UI threshold |

The lowest values above can belong to UI roles with 3:1 WCAG and Lc 30 thresholds, so
they must not be compared to the body-text thresholds in isolation. The executable
diagnostics retain each pair's assigned threshold.

Phase 1.5.6.4 remeasurement covers 28 application pairs per appearance and 10 Reader
pairs per appearance. The additional navigation pairs do not change the minima above.
Every built-in pair passes both its assigned WCAG and supplementary APCA threshold;
all built-in application/Reader combinations remain compatibility-warning-free.

The Phase 1.4.3.1 audit raised readable secondary text from the graphical 3:1 WCAG
threshold to the normal-text 4.5:1 threshold while retaining the APCA Lc 60 target for
compact labels and captions. Application muted text is checked against every owned
application surface. Reader muted text is checked against both the Reader page background
and the control and panel surface where readable search, navigation, and annotation copy
appears. Reader Light now reaches 4.56:1 and Lc 64.67 on its surface; Reader Sepia reaches
4.65:1 and Lc 60.25. Inactive icons, placeholder artwork, and scrollbar thumbs remain on
the separate `mutedSoft` non-text role. A regression fixture retains a deliberate
custom-theme WCAG/APCA disagreement to prove that APCA remains diagnostic while WCAG
continues to own compatibility warnings.

## Semantic decisions

- Accent remains the primary interactive hue. Information uses a distinct blue-cyan role
  rather than aliasing the accent.
- Success, warning, information, and error retain separate hue families.
- Selected and active surfaces derive from accent at different opacity levels. Ordinary
  hover remains a neutral surface role.
- Danger remains an error-family alias and is not used decoratively.
- Readable secondary copy uses `muted`; `mutedSoft` is limited to inactive and decorative
  non-text affordances.
- Disabled colors remain muted-derived and do not borrow accent.
- Reader Dark, Light, and Sepia preserve independent surface hierarchies while sharing
  the same semantic role contract.
- Forced-colors styling remains in `src/styles/forced-colors.css` and does not depend on
  authored palette calculations.

The public schema continues to exclude typography, geometry, motion, opacity recipes,
selectors, component names, and asset references.

## Split-shell ownership and diagnostics

| Role                         | Finalized ownership                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `frame`                      | Ordinary window chrome and frame, including titlebars outside split presentation.                 |
| `sidebar`                    | Navigation plane shared by Library and Archive Manager, including its split titlebar segment.     |
| `main`                       | Primary workspace plane, including the workspace portion of a split titlebar.                     |
| `lineSubtle`                 | Derived quiet separator between adjacent planes, continuous through a split titlebar and sidebar. |
| `lineStrong`                 | Public color retained for boundaries that require genuine emphasis, not the major split divider.  |
| `shellHover` / `shellActive` | Derived chrome and navigation interaction treatments, independent of any single surface owner.    |

Stacked shells use ordinary `frame` chrome above flat navigation and workspace regions.
The split boundary becomes a horizontal `lineSubtle` separator. Forced-colors mode
continues to use system colors for the boundary and focus styling.

The existing diagnostic owner checks `text` on `sidebar` at WCAG 4.5:1 / APCA Lc 75,
`textStrong` on `sidebar` at WCAG 4.5:1 / APCA Lc 60, and the graphical `accent` role
on `sidebar` at WCAG 3:1 / APCA Lc 60. These mirror the corresponding workspace-role
thresholds. Reader pairs, alpha compositing, and the WCAG-only warning policy are
unchanged. New application warnings enter the existing preview acknowledgment flow.

The major divider is a structural separator, not a readable foreground or control.
No contrast target or warning is added for it. Equal frame/navigation/workspace colors
remain valid schema-v1 choices. Shared synthetic equal-plane and deliberately distinct
fixtures exercise offline validation, unchanged authored colors, the existing resolver
and CSS-variable application, and rendered split/stacked geometry in both shells.
The equal-plane fixture retains a visible but below-3:1 quiet divider without warnings.

No schema fields, compatibility aliases, palette correction, or parallel theme runtime
are introduced. The canonical schema and shipped example manifests remain unchanged.
