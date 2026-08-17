# Archeion dictionary catalog

This directory is the static publication root for Archeion's production dictionary catalog and its versioned packages. GitHub Pages publishes `docs/`, so dictionary payloads remain optional downloads and are not included in the application bundle.

## English package maintenance

English catalog packages are maintained by `scripts/dictionaries/build_english_catalog_packages.py`. The builder accepts authoritative upstream archives, verifies the configured source byte size and SHA-256 before conversion, and emits deterministic StarDict 2.4.2 tar.xz candidate packages plus candidate catalog metadata. It never writes the production package directory or production catalog during generation.

The maintained source set is defined in `scripts/dictionaries/english_catalog_sources.json`:

| Dictionary                                                 | Authoritative input                                                      | Conversion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Princeton WordNet 3.0                                      | Princeton `WordNet-3.0.tar.bz2`                                          | WordNet database `data.*` synsets become StarDict headword/definition entries. Every lemma in a synset remains directly searchable.                                                                                                                                                                                                                                                                                                                                                        |
| Open English WordNet 2025+                                 | Official `english-wordnet-2025-plus-index.sense-fixed.zip` release asset | The release WNDB `data.*` files use the same deterministic WordNet conversion. This preserves the headwords, synonyms, and textual glosses represented by OEWN's supported StarDict release path.                                                                                                                                                                                                                                                                                          |
| GNU Collaborative International Dictionary of English 0.54 | GNU `gcide-0.54.tar.xz`                                                  | GCIDE `CIDE.A` through `CIDE.Z` are parsed with explicit lexical boundaries. Later `<entry main-word="...">` wrappers own the canonical headword and all paragraphs/senses inside that entry; supported `<def>`/`<cd>`, `<altname>`, `<asp>`, and `<syn>` content becomes deterministic StarDict definitions and searchable aliases. Presentation-only `<hw>`/`<mhw>` text is not indexed. Older `<p><ent>...</ent>` paragraph streams remain a compatibility path outside entry wrappers. |

Package archives retain a concise source/licence notice alongside the StarDict resources. Production package READMEs also record the exact authoritative source archive filename, URL, byte size, SHA-256, the Archeion repository, and SHA-256 values for the conversion script and source configuration. This identifies the exact conversion inputs without putting maintenance prose in the user-facing catalog `Source` field.

For GCIDE specifically, the packaged StarDict form is a conversion of GPL-3.0-or-later source, not the original source representation. Corresponding source is the exact `gcide-0.54.tar.xz` archive pinned in `scripts/dictionaries/english_catalog_sources.json`; recipients can obtain it from the recorded GNU source URL and verify its recorded byte size and SHA-256 before using the recorded Archeion converter/configuration revision. The complete GCIDE licence notice remains in the package as `COPYING`.

To build the complete English candidate set after downloading the three configured source archives:

```text
python scripts/dictionaries/build_english_catalog_packages.py build \
  --princeton /path/to/WordNet-3.0.tar.bz2 \
  --oewn /path/to/english-wordnet-2025-plus-index.sense-fixed.zip \
  --gcide /path/to/gcide-0.54.tar.xz
```

The default candidate location is `.project/dictionaries/english-catalog-candidate/`. A build invalidates any older native-validation receipt before replacing candidate files. Each candidate file is staged beside its destination and atomically replaced on the same filesystem, so the maintenance path does not depend on the operating-system temporary directory sharing a filesystem or Windows drive with the project. Source verification or conversion failure leaves the production catalog unchanged, and a partially replaced candidate set cannot be published without a fresh receipt bound to its exact bytes.

Validate the exact candidate package bytes through Archeion's native catalog, archive, StarDict, installation, SQLite indexing, activation, and lookup owners before publication:

```text
python scripts/dictionaries/build_english_catalog_packages.py validate
```

The native validation test writes a receipt bound to the exact candidate catalog SHA-256 and each candidate package size/SHA-256 only after all three dictionaries install, become ready, and return a textual representative lookup. The Python maintenance owner verifies that receipt but does not duplicate the Rust archive or StarDict validators.

Publish only a candidate set with a current native-validation receipt:

```text
python scripts/dictionaries/build_english_catalog_packages.py publish
```

Publication copies immutable package files to `docs/dictionaries/packages/` first, re-verifies their exact sizes and SHA-256 values at the publication paths, and replaces `catalog-v1.json` last. A conflicting existing package filename fails closed. When publishing to the production catalog path, the committed catalog validator is run after replacement and the previous catalog is restored if that validation fails. Package files left unreferenced by a failed manifest publication are safe and may be removed separately.

Small representative packages used by native regression tests are generated independently of the application runtime:

```text
python scripts/dictionaries/build_english_catalog_packages.py verify-fixtures
```

Use `write-fixtures` only when intentionally changing the deterministic conversion contract. These fixtures are test data, not production dictionaries.

## Current Princeton package

The currently published `princeton-wordnet-3.0-stardict-archeion-1.zip` predates the authoritative-source builder. It is derived from the StarDict package in the [Duet v0.1.0-alpha.9 release](https://github.com/lauren-alexandra/duet-xteink/releases/tag/v0.1.0-alpha.9).

- Source archive size: `8,857,151` bytes
- Source archive SHA-256: `19f6840ee91881cd303bcedc29c81777da1756ad73a09b114d3226fcf01ed80a`
- Published archive size: `8,906,973` bytes
- Published archive SHA-256: `4bf92ff3b3e436ab70941e7db72c9124fc71647f3425fc9acab5882cc73816f0`
- License: [Princeton WordNet License](https://wordnet.princeton.edu/license-and-commercial-use)

The legacy ZIP contains only the supported StarDict resources at its root. Its definition payload is unchanged, its index follows Archeion's supported StarDict comparison contract, and synonym target ordinals were remapped to that ordering. It remains documented here until the authoritative Princeton package produced by the maintenance builder is published and atomically replaces its catalog metadata.
