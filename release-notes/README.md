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
pnpm run release:check
```

`release:check` also validates the four application-version sources and the
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

`pnpm run docs:sync` projects these validated notes into
`website/src/generated/release-history.json`. Its `schemaVersion: 1` entries
contain `version`, `date`, repository-relative `sourcePath`, and LF-normalized
`changes`, with no timestamp or checkout-specific paths. Edit the versioned
note and regenerate; do not edit generated JSON or Changelog MDX prose.
`pnpm run docs:check` checks freshness and Node-only documentation sources
without writing. Neither command invokes legacy HTML/search generators or
Docusaurus. The separate website build renders the React timeline and validates
MDX, routes and fragments. Docusaurus is the public site; see
[documentation maintenance](../docs/DOCUMENTATION.md#production-cutover-and-legacy-retirement).

The shared timeline vocabulary supports flat `-` or `*` bullets with indented
prose continuations, inline bold, single-backtick code, and absolute HTTP(S) links.
Unsupported block structures and unsafe or malformed links fail before writing.
If a release needs a richer format, extend the vocabulary and its tests first.
React renders text safely, never raw HTML.

Use Node 22 and pnpm 10.33.0. Prepare a release with
`pnpm install --frozen-lockfile`, `pnpm run version:set X.Y.Z`, then author the
technical changelog and tracked release note. After prose is final, run:

```powershell
pnpm run docs:sync
pnpm run docs:check
pnpm run release:check --tag vX.Y.Z
pnpm run verify
```

Publication and Windows updater automation keep consuming the shared parser's
exact metadata-free `body`; the documentation vocabulary does not rewrite it.
