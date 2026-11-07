# Maintainer documentation

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

This directory contains Archeion's engineering documentation and the source for
its public documentation site.

Use these guides for development, architecture, design, testing, and release work.
User-facing instructions are published in the
[Archeion documentation site](documentation/index.html).

## Core guides

- [Architecture](ARCHITECTURE.md) describes frontend and native responsibilities,
  state ownership, persistence, IPC, and dependency boundaries.
- [Design](DESIGN.md) defines the desktop application's visual language, tokens,
  components, themes, layout, and accessibility rules.
- [Development](DEVELOPMENT.md) covers Windows requirements, repository setup,
  running the app, and local installer builds.
- [Testing and validation](TESTING.md) lists the existing local and CI validation
  lanes, including browser and Windows smoke tests.
- [Public documentation](DOCUMENTATION.md) explains the page registry, navigation,
  search data, release history, and article maintenance.
- [Release operations](RELEASING.md) covers version changes, release notes,
  signing, installer staging, and publication.

## Technical references

- [Annotation export format](annotation-export-format.md) defines the versioned
  annotation export structure and its fields.
- [Custom themes](custom-themes.md) documents theme package layout, the manifest
  schema, supported overrides, and safety rules.
- [Font preferences validation](font-preferences-validation.md) describes
  installed-font behavior and Windows validation cases.
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

[Dictionary catalog maintenance](dictionaries/README.md) documents the published
catalog, source archives, conversion process, validation, and package publication.

## Repository and release references

- [Project scripts](../scripts/README.md) documents repository utility commands
  and their safety behavior.
- [Release-note authoring](../release-notes/README.md) defines the tracked
  release-note format.
- [Changelog](../CHANGELOG.md) records technical changes by application version.

## Public documentation site

The static public site lives under [`documentation/`](documentation/). Its page
registry is `documentation/page-registry.json`. The public landing page and
shared website assets live in `index.html`, `assets/`, `css/`, and `js/`.

Use [Public documentation](DOCUMENTATION.md) to edit pages or regenerate the
site's navigation, search index, and release history.
