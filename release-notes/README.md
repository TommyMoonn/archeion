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
`version`, `date`, and `body` for automation. Do not publish the metadata header
as part of a release description.
