# Archeion brand assets

Use the supplied Archeion artwork. Do not redraw the logo, substitute a font for the wordmark, or introduce a different desktop icon composition.

The owner selected the experimental dark logo, light logo, wordmark, and application preview on 2026-11-14, then explicitly clarified that these existing designs must be used. This takes precedence over the implementation plan's preference for recreating the identity as vector artwork or live text.

| Asset                          | Ownership and use                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `archeion-logo-dark.png`       | Approved dark desktop icon composition, unchanged from the supplied 500 × 500 PNG                        |
| `archeion-logo-light.png`      | Approved light composition, unchanged from the supplied 500 × 500 PNG                                    |
| `archeion-wordmark.png`        | Approved 512 × 210 wordmark, unchanged; use the artwork rather than recreating the lettering with a font |
| `archeion-wordmark-light.png`  | Owner-supplied light-surface wordmark, unchanged; dark lettering and the light icon composition          |
| `archeion-symbol.svg`          | Editable, flat vector derivative of the page silhouette in the approved dark logo                        |
| `archeion-symbol-on-light.svg` | Generated dark transparent symbol for light surfaces                                                     |
| `archeion-symbol-on-dark.svg`  | Generated white transparent symbol for dark surfaces                                                     |

The four approved PNG files are byte-for-byte copies of the matching files in `.project/experiments/`. They are the authoritative artwork. Do not edit those production copies independently. The generation check pins their SHA-256 values so accidental replacements are detected without requiring the local experiments directory in CI.

The vector symbol traces the existing silhouette; it is not a new logo design. Its three paths were extracted from the dark logo's page shapes, excluding the surrounding tile and decorative shading. Its coordinates retain the original 500-pixel artwork grid. The generated transparent exports use a tighter square view box around the same paths, with clear padding. They do not reproduce the original gradients, glow, or tile.

Run `node scripts/generate-brand-assets.mjs` to regenerate the transparent SVG variants after editing the vector source. Run `node scripts/generate-brand-assets.mjs --check` to verify approved image hashes and detect stale variants. Do not edit generated SVGs independently. These commands require only Node, with no new dependencies.

## Desktop and wordmark integration

R.2 generates the configured Windows and Tauri icons from `archeion-logo-dark.png`, preserving the approved composition. The source is 500 × 500; larger raster outputs cannot gain additional detail. Do not replace it with a newly designed tile or claim that an upscaled export is a higher-resolution original.

The owner clarified during R.2 that both supplied wordmark PNGs are for the root README. Keep existing in-app Archeion text and its Display font behavior. Do not substitute the wordmark images for that text or add a fixed brand font role. About and Archive Manager use the unchanged logo PNGs in their existing icon placements, selected by the resolved application base. Do not approximate the README lettering with Georgia or another font.

Give a standalone logo or wordmark image meaningful alternative text. Use empty alternative text for a decorative symbol next to an already-visible product name.

## README references

R.3 uses the approved wordmarks here and the application preview at `.project/experiments/archeion-preview.png`. `archeion-wordmark.png` has light lettering for dark surfaces; the owner-supplied `archeion-wordmark-light.png` has dark lettering for light surfaces. Use both for GitHub's light and dark rendering. Promote the preview to a tracked production location before referencing it from the root README. Preserve its aspect ratio and the supplied composition. Do not reference `.project/experiments/` from production Markdown.

Recheck preview accuracy after the application and Reader palette phases. The experimental preview is a visual reference, not evidence that the final application matches it.
