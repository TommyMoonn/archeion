# Release notes

This directory is the tracked source of Archeion's user-facing release notes.
Keep `CHANGELOG.md` as the technical developer changelog. Do not copy full note
bodies into `docs/` or the root README.

Each stable application release has one `vX.Y.Z.md` file. Its first line is
machine-readable metadata, followed by a blank line and the exact user-facing
GitHub Release body:

```md
<!-- release-note: vX.Y.Z; date: YYYY-MM-DD -->

## Downloads

- [Installer](https://github.com/TommyMoonn/archeion/releases/download/vX.Y.Z/Archeion-Setup-x64.exe)

## Changes

- Describe a change users can see or rely on.
```

The header version must match the filename and the application version. The date
is an ISO calendar date chosen when preparing the release; historical dates in
this directory reflect the published GitHub Releases in UTC. The date and body
are available to a documentation timeline without parsing `CHANGELOG.md`.
Download links must target the same version. Keep Changes concise and focused
on user-visible outcomes, not internal implementation or test counts.

Validate every historical note or the current application release note:

```sh
node scripts/release-notes.mjs validate --all
npm run release:check
```

`release:check` also validates the five application-version sources and the
dated technical changelog entry. To obtain the metadata-free GitHub Release
body, use `node scripts/release-notes.mjs read --version X.Y.Z --body`. The
plain `read --version X.Y.Z` and `read --all` forms emit JSON containing
`version`, `date`, `body`, and `changes` for automation. `changes` is the Markdown
inside `## Changes`, ending at the next level-two heading. `body` remains the
complete, unmodified metadata-free GitHub Release description. Do not publish
the metadata header as part of a release description.

`read --all` orders notes by descending release date, then descending numeric
version for same-day releases. Dates take precedence so a later maintenance
release appears above an earlier release with a higher version.

`npm run docs:changelog:sync` projects these validated notes into
`docs/documentation/assets/docs-changelog-data.json`. Its `schemaVersion: 1`
entries contain `version`, `date`, repository-relative `sourcePath`, and `changes`
with LF line endings. This committed file is generated documentation input, not
another prose source; edit the versioned note and regenerate it. `npm run
docs:changelog:check` reports missing/stale data without writing, and is included
in `docs:check`. `npm run docs:sync` then generates the static Changelog timeline,
navigation, and section search index. `docs:check` checks all generated output
without writing. Do not edit release prose in the generated HTML.

The timeline renderer supports flat `-` or `*` bullets with indented prose
continuations, inline bold, single-backtick code, and absolute HTTP(S) links.
Unsupported block structures fail generation explicitly. If a release needs a
richer format, extend the renderer and its tests before publishing the note.
