# Theme color audit

This inventory records the 0.4.0 palette baseline used by the version 1 theme contract. It covers `src/styles/tokens.css`, the reader chrome variables in `src/styles/features/reader.css`, and EPUB-content colors in `src/features/reader/readerTheme.ts`.

## Classification

| Source colors                                                                                                                   | Classification | Contract ownership                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| App canvas, surfaces, frame, sidebar, main regions, lines, text, accent, focus, success, error                                  | Public         | `appThemePublicTokenRegistry` and the application `base`.                        |
| Warning and information roles                                                                                                   | Public         | Semantic public tokens available to feature-owned status treatments.             |
| Subtle lines, soft and border tints, selection/active/disabled states, danger aliases, shell states, darkening, and shadows     | Derived        | `appThemeDerivedTokenRegistry`; custom manifests cannot override these directly. |
| Reader background, surface, line, text, strong text, muted text, focus, danger, EPUB links, code background, and text selection | Public         | `readerThemePublicTokenRegistry` and `reader.base`.                              |
| Reader quotation, visited-link, and subtle-line treatments                                                                      | Derived        | `readerThemeDerivedTokenRegistry`.                                               |
| Window close white/red hover colors                                                                                             | Fixed          | Platform-significant identity; not themeable in version 1.                       |
| Yellow, green, blue, and rose annotation colors                                                                                 | Fixed          | Persisted annotation identities; not themeable in version 1.                     |
| Cover-image control white/black colors                                                                                          | Fixed          | Maintains contrast over arbitrary artwork; not themeable in version 1.           |
| Reader skeleton sheen                                                                                                           | Derived        | Derived from the resolved reader text color.                                     |
| `transparent` and `currentColor`                                                                                                | Contextual     | Continue to inherit from the semantic color owned by the surrounding component.  |

## Baseline decisions

- Dark remains the immediate `:root` application bootstrap.
- Light and System-light remain identical bootstrap palettes.
- Dark, Light, and Sepia reader chrome values remain unchanged.
- EPUB-content Dark, Light, and Sepia values remain unchanged and are inventoried beside the reader chrome values in `builtInThemeRegistry.reader`.
- Direct built-in palette literals in reader chrome are an intentional pre-runtime bootstrap; the runtime reader palette adapter replaces reader chrome variables and owns EPUB content colors.
- Feature-level application colors use public tokens, resolver-owned derived tokens, or contextual mixes. A focused contract test allowlists the remaining documented fixed and bootstrap literals so new unsupported literals fail validation.

The public schema intentionally excludes typography, geometry, motion, opacity recipes, selectors, component names, and asset references.
