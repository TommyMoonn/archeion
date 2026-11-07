# Dictionary catalog

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

This directory contains the production dictionary catalog and its versioned
packages. GitHub Pages publishes `docs/`, so dictionary packages remain optional
downloads and are not included in the application bundle. The v1.3.0 production
catalog contains English monolingual dictionaries. Archeion also supports
language-direction metadata and manual StarDict imports independently of that
catalog.

## Source archives and conversion

The English package builder is
`scripts/dictionaries/build_english_catalog_packages.py`. It reads the pinned
source set from `scripts/dictionaries/english_catalog_sources.json`. That file
owns each source archive's URL, byte size, SHA-256, and license metadata.

The builder verifies each source archive's configured size and SHA-256 before
conversion. It creates deterministic StarDict 2.4.2 `tar.xz` candidate packages
and candidate catalog metadata. It does not write to the production package
directory or production catalog.

### Princeton WordNet 3.0

The converter reads the WordNet database `data.*` files and writes StarDict
headword and definition entries. Every lemma in a synset remains searchable.
An authoritative `*.exc` exception mapping becomes an alias only when its
target exists in the source database.

### Open English WordNet 2025+

The converter reads the release WNDB `data.*` files through the same WordNet
conversion path. It preserves headwords, synonyms, textual glosses, and
authoritative `*.exc` irregular-form mappings represented by OEWN's supported
StarDict release path.

The release archive does not contain its license notice. The source
configuration pins the official `WNDB_License.txt` from the same `2025-edition`
source tag by URL and SHA-256. The builder verifies the notice bytes before
packaging them. This keeps the license input tied to the release without
adding network access to the application runtime.

### GNU Collaborative International Dictionary of English 0.54

The GCIDE converter reads `CIDE.A` through `CIDE.Z` with explicit lexical
boundaries. In newer source files, each `<entry main-word="...">` wrapper owns
the canonical headword and the paragraphs and senses inside that entry.
Supported `<def>` and `<cd>` content supplies definitions. `<altname>` and
`<asp>` content supplies additional lexical forms.

The converter reads only the source-marked leading lexical list from `<syn>`.
It excludes comparative prose, delimiter remnants, and usage qualifications
from searchable aliases. Presentation-only `<hw>` and `<mhw>` text is not
indexed. Older `<p><ent>...</ent>` paragraph streams remain supported outside
entry wrappers.

The packaged StarDict data is a conversion of GPL-3.0-or-later source, not the
original source representation. The corresponding source is the exact
`gcide-0.54.tar.xz` archive pinned in the source configuration. Use its recorded
GNU source URL, byte size, and SHA-256 to verify the archive before using the
recorded Archeion converter and configuration revision. The complete GCIDE license notice remains in the GCIDE package as
`COPYING`.

## Build candidate packages

Download the three configured source archives, then run the builder with their
local paths:

```text
python scripts/dictionaries/build_english_catalog_packages.py build \
  --princeton /path/to/WordNet-3.0.tar.bz2 \
  --oewn /path/to/english-wordnet-2025-plus-index.sense-fixed.zip \
  --gcide /path/to/gcide-0.54.tar.xz
```

The default candidate directory is
`.project/dictionaries/english-catalog-candidate/`. A build invalidates any
older native-validation receipt before it replaces candidate files. The builder
stages each file beside its destination and replaces it atomically on the same
filesystem. It does not depend on the operating-system temporary directory
sharing a filesystem or Windows drive with the project.

Source verification or conversion failure leaves the production catalog
unchanged. A partial candidate set cannot be published without a new receipt
that matches its exact contents.

## Validate candidate packages

Run native validation against the exact candidate bytes:

```text
python scripts/dictionaries/build_english_catalog_packages.py validate
```

The native validation test checks catalog loading, archive handling, StarDict
installation, SQLite indexing, activation, and a representative text lookup.
It writes a receipt only after all three dictionaries install, become ready, and
return a representative lookup result.

The receipt records the candidate catalog SHA-256 and each package's size and
SHA-256. The Python maintenance script verifies that receipt. It does not repeat
the Rust archive or StarDict validation.

## Publish validated packages

Publish only a candidate set with a current native-validation receipt:

```text
python scripts/dictionaries/build_english_catalog_packages.py publish
```

The publisher copies the immutable package files to `docs/dictionaries/packages/`
first. It verifies their exact sizes and SHA-256 values at the publication paths,
then replaces `catalog-v1.json` last.

An existing package filename with different contents is a conflict. The
publisher fails without overwriting it. If the production catalog validator
fails after the catalog replacement, the publisher restores the previous
catalog. Package files left unreferenced by a failed catalog publication are
safe to remove after inspection.

## Verify dictionary fixtures

Small representative packages for native regression tests are generated
separately from the application runtime. Verify the current fixtures with:

```text
python scripts/dictionaries/build_english_catalog_packages.py verify-fixtures
```

Run `write-fixtures` only when you intend to change the deterministic
conversion contract. These fixtures are test data, not production dictionaries.

## Published catalog metadata

`catalog-v1.json` is the source of truth for published package metadata. It
records each package's immutable version, download URL, compressed size,
installed-size estimate, and SHA-256. Keep those values in the catalog instead
of copying them into this guide.

Each catalog URL names an immutable package version. Catalog entries contain
user-facing source and license metadata. They do not contain descriptive
marketing copy.

## Package provenance

Each package archive includes a short source and license notice beside the
StarDict resources. The production package README files record the authoritative source archive
filename, URL, byte size, and SHA-256. They also record the Archeion repository
and the SHA-256 values of the conversion script and source configuration.
Together, these records identify the exact inputs used to create the package.
