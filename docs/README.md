# Maintainer documentation

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

This directory contains Archeion's engineering documentation. Public MDX source
lives in `website/docs/`; the old static site remains here until cutover.

Use these guides for development, architecture, design, testing, and release work.
User-facing instructions are published in the
[Archeion documentation site](https://tommymoonn.github.io/archeion/docs/).

## Core guides

- [Architecture](ARCHITECTURE.md) describes frontend and native responsibilities,
  state ownership, persistence, IPC, and dependency boundaries.
- [Design](DESIGN.md) defines the desktop application's visual language, tokens,
  components, themes, layout, and accessibility rules.
- [Development](DEVELOPMENT.md) covers Windows requirements, repository setup,
  running the app, and local installer builds.
- [Testing and validation](TESTING.md) lists the existing local and CI validation
  lanes, including browser and Windows smoke tests.
- [Public documentation](DOCUMENTATION.md) explains MDX authoring, framework navigation,
  local search, canonical release history, and legacy maintenance.
- [Release operations](RELEASING.md) covers version changes, release notes,
  signing, installer staging, and publication.

## Technical references

- [Annotation export format](annotation-export-format.md) defines the versioned
  annotation export structure and its fields.
- [Custom themes](custom-themes.md) documents theme package layout, the manifest
  schema, supported overrides, and safety rules.
- [Font preferences validation](font-preferences-validation.md) describes
  installed-font behavior and Windows validation cases.
- [Theme color audit](design/theme-color-audit.md) records historical palette
  measurements and split-shell diagnostics. Use [Design](DESIGN.md) for
  current UI rules.
- [Theme manifest schema](schemas/archeion-theme-v1.schema.json) defines the
  machine-readable custom theme contract.
- [Theme examples](examples/themes/) contains example custom theme packages.

## Performance

- [Performance measurement guide](performance/measuring.md) describes diagnostic
  procedures for Library, scanner, startup, and Reader measurements.
- [Performance architecture baseline](performance/architecture-baseline.md)
  records retained structural contracts and the limits of the original
  measurements.

Performance timings are development evidence. They are not release guarantees.

## Dictionary maintenance

[Dictionary catalog maintenance](dictionaries/README.md) documents the build,
validation, and publication workflow. `dictionaries/catalog-v1.json` owns
published package metadata. `scripts/dictionaries/english_catalog_sources.json`
owns the pinned source archives and license inputs.

## Repository and release references

- [Project scripts](../scripts/README.md) documents repository utility commands
  and their safety behavior.
- [Release-note authoring](../release-notes/README.md) defines the tracked
  release-note format.
- [Changelog](../CHANGELOG.md) records technical changes by application version.

## Public documentation site

The replacement site lives in [`website/`](../website/), with articles in
`website/docs/` and sidebar ordering in `website/sidebars.ts`. The legacy
[`documentation/`](documentation/) site, landing page and public assets remain
active until their planned migration/cutover boundaries.

Use [Public documentation](DOCUMENTATION.md) to edit articles, regenerate the
canonical release-history JSON, and run Node-only source/drift checks. Root
maintainer guides stay here and are excluded from the replacement site artifact.
