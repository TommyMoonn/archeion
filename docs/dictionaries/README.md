# Archeion dictionary catalog

This directory is the static publication root for Archeion's production dictionary catalog and its versioned packages. GitHub Pages publishes `docs/`, so these files are not included in the application bundle.

## Princeton WordNet 3.0

`princeton-wordnet-3.0-stardict-archeion-1.zip` is derived from the StarDict package in the [Duet v0.1.0-alpha.9 release](https://github.com/lauren-alexandra/duet-xteink/releases/tag/v0.1.0-alpha.9).

- Source archive size: `8,857,151` bytes
- Source archive SHA-256: `19f6840ee91881cd303bcedc29c81777da1756ad73a09b114d3226fcf01ed80a`
- Published archive size: `8,906,973` bytes
- Published archive SHA-256: `4bf92ff3b3e436ab70941e7db72c9124fc71647f3425fc9acab5882cc73816f0`
- License: [Princeton WordNet License](https://wordnet.princeton.edu/license-and-commercial-use)

The published ZIP contains only the supported StarDict resources at its root. The definition payload is unchanged. The index is ordered using Archeion's supported StarDict comparison contract, and synonym target ordinals are remapped to that order. The complete WordNet license notice and the source release URL are retained in the installed `.ifo` metadata.
