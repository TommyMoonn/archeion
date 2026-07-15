# Theme color audit

This inventory records the 0.4.0 palette baseline used by the version 1 theme contract. It covers `src/styles/tokens.css`, the reader chrome variables in `src/styles/features/reader.css`, and EPUB-content colors in `src/features/reader/readerTheme.ts`.

## Classification

| Source colors                                                                                                                   | Classification | Contract ownership                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| App canvas, surfaces, frame, sidebar, main regions, lines, text, accent, focus, success, error                                  | Public         | `appThemePublicTokenRegistry` and the application `base`.                                         |
| Warning and information roles                                                                                                   | Public         | Semantic public tokens added to the baseline; feature migration occurs in the themeable-UI phase. |
| Subtle lines, soft and border tints, selection/active/disabled states, danger aliases, shell states, and shadows                | Derived        | `appThemeDerivedTokenRegistry`; custom manifests cannot override these directly.                  |
| Reader background, surface, line, text, strong text, muted text, focus, danger, EPUB links, code background, and text selection | Public         | `readerThemePublicTokenRegistry` and `reader.base`.                                               |
| Reader quotation, visited-link, and subtle-line treatments                                                                      | Derived        | `readerThemeDerivedTokenRegistry`.                                                                |
| Window close white/red hover colors                                                                                             | Fixed          | Platform-significant identity; not themeable in version 1.                                        |
| Yellow, green, blue, and rose annotation colors                                                                                 | Fixed          | Persisted annotation identities; not themeable in version 1.                                      |
| Reader-theme swatches                                                                                                           | Fixed preview  | Code-owned previews of the built-in reader bases, not independent authoring tokens.               |
| Reader skeleton sheen                                                                                                           | Derived        | Must be derived from the resolved reader palette during the themeable-UI phase.                   |
| `transparent` and `currentColor`                                                                                                | Contextual     | Continue to inherit from the semantic color owned by the surrounding component.                   |

## Baseline decisions

- Dark remains the immediate `:root` application bootstrap.
- Light and System-light remain identical bootstrap palettes.
- Dark, Light, and Sepia reader chrome values remain unchanged.
- EPUB-content Dark, Light, and Sepia values remain unchanged and are inventoried beside the reader chrome values in `builtInReaderThemeBaselines`.
- Direct palette duplication between reader chrome, EPUB content, and built-in swatches is intentional until the runtime resolver and reader palette adapter own those paths.
- No core palette literal in the audited sources is obsolete in this phase. Unsupported feature-level literals outside these owners are migration inputs for Phase 0.5.0.7, not part of this contract-only change.

The public schema intentionally excludes typography, geometry, motion, opacity recipes, selectors, component names, and asset references.
