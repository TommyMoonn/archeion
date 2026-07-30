# Theme color audit

This inventory records the Phase 0.9.0.30 built-in palette and the version 1 theme
contract. Built-in and custom theme manifests continue to use hexadecimal sRGB colors.
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

The audit covers application body and strong text, muted labels, accent, focus on every
owned surface, status colors, Reader text, muted text, links, focus, danger, selection,
and code surfaces. Translucent pairs are composited over their actual built-in canvas
before measurement.

| Appearance        | Lowest audited WCAG ratio | Lowest audited absolute APCA Lc | Result                                             |
| ----------------- | ------------------------: | ------------------------------: | -------------------------------------------------- |
| Application Dark  |                      5.26 |                           41.25 | Every pair meets its assigned text or UI threshold |
| Application Light |                      4.42 |                           63.37 | Every pair meets its assigned text or UI threshold |
| Reader Dark       |                      6.67 |                           49.02 | Every pair meets its assigned text or UI threshold |
| Reader Light      |                      4.28 |                           63.65 | Every pair meets its assigned text or UI threshold |
| Reader Sepia      |                      4.27 |                           57.85 | Every pair meets its assigned text or UI threshold |

The lowest values above can belong to UI roles with 3:1 WCAG and Lc 30 thresholds, so
they must not be compared to the body-text thresholds in isolation. The executable
diagnostics retain each pair's assigned threshold.

The audit initially found pairs that passed the established WCAG requirement but missed
the phase's additional APCA diagnostic target. Dark muted text was raised, Reader links
were strengthened, and Reader selection backgrounds were adjusted. The resulting
built-ins have no WCAG/APCA disagreement for the audited pairs. A regression fixture
retains a deliberate custom-theme disagreement to prove that APCA remains diagnostic
while WCAG continues to own compatibility warnings.

## Semantic decisions

- Accent remains the primary interactive hue. Information uses a distinct blue-cyan role
  rather than aliasing the accent.
- Success, warning, information, and error retain separate hue families.
- Selected and active surfaces derive from accent at different opacity levels. Ordinary
  hover remains a neutral surface role.
- Danger remains an error-family alias and is not used decoratively.
- Disabled colors remain muted-derived and do not borrow accent.
- Reader Dark, Light, and Sepia preserve independent surface hierarchies while sharing
  the same semantic role contract.
- Forced-colors styling remains in `src/styles/forced-colors.css` and does not depend on
  authored palette calculations.

The public schema continues to exclude typography, geometry, motion, opacity recipes,
selectors, component names, and asset references.
