# Public documentation guide

The public documentation replacement is authored in `website/docs/` and built
by the private `@archeion/website` Docusaurus workspace. Root `docs/` retains
maintainer guides. The existing static site under `docs/documentation/` remains
published during migration; deployment and legacy removal are separate steps.

## Add or update an article

1. Edit `website/docs/<stable-id>.mdx`. Front matter owns the ID, title,
   sidebar label, description, route slug, article type and optional overview
   label/summary. Keep values as single-line JSON strings for Node source checks.
2. Add a new ID to the appropriate group in `website/sidebars.ts`. The framework
   owns routing, navigation, group order, breadcrumbs, outline and neighbors.
   Do not add entries to the legacy registry for the replacement site.
3. Preserve published route suffixes and explicit h2/h3 fragment IDs:
   `## Section title {#stable-id}`. Use `DocsAnchor` for retained nonheading
   fragments. Heading and anchor components register with broken-link validation.
4. Use semantic Markdown, native `kbd`, `DocsNotice` labels/advice, code fences,
   tables and disclosures. Keep product claims limited to released behavior.
   Preserve technical examples and safe recovery guidance.
5. Run source checks and the separate website build:

   ```powershell
   pnpm run docs:check
   pnpm --filter @archeion/website typecheck
   pnpm --filter @archeion/website build
   pnpm exec playwright test --config tests/browser/website-foundation.config.ts
   ```

The footer edits the correct MDX source and retains the issue-reporting link.
Changelog's edit action targets `release-notes/README.md`. Native navigation,
article text, outlines and release history remain readable without JavaScript.

See [website conventions](../website/README.md) for the durable shell, design,
search, clipboard and release-history contracts. Use Node 22 and pnpm 10.33.0;
`pnpm install --frozen-lockfile` installs both workspace packages.

## Search and overview

The build-time search plugin derives sequence and metadata from the framework's
loaded docs and sidebar. It parses MDX without evaluating components. It indexes
one introduction plus explicit h2/h3 sections, excluding shell and hidden helpers.
Changelog sections come from a typed adapter over canonical generated history,
independent of React rendering. Overview cards use the same framework metadata.

Matching normalizes whitespace/case. Page titles precede section headings,
explicit aliases and body matches, with canonical order resolving ties before
the ten-result limit. Empty queries browse pages; excerpts are at most 240
characters. Show details preserves result identity, order and selection.
Highlighting uses escaped text and marks. The dialog retains polite counts,
typing focus, Ctrl/Cmd+K, arrows, Enter, Escape, outside dismissal and restoration.

Prefer natural prose. For a justified alternative term, use an empty static
`<span data-search-aliases="first alias|second alias" />` in the introduction or
immediately after a section heading. Aliases must be nonempty and unique.
There is no manually maintained search index or replacement page registry.

## Release history and release preparation

`release-notes/vX.Y.Z.md` is canonical user-facing prose. `CHANGELOG.md` remains
technical. The unchanged `scripts/release-notes.mjs` parser validates metadata,
dates and downloads and preserves the exact metadata-free publication body.
The history projection uses its `readAllReleaseNotes` API, ordered by descending
date then numeric version for same-day releases.

```powershell
pnpm run docs:sync
pnpm run docs:check
pnpm run release:check --tag vX.Y.Z
pnpm run verify
```

Run sync after the release note is final and again after any prose edit.
`docs:sync` writes only `website/src/generated/release-history.json` atomically.
Its schemaVersion 1 entries contain version, date, repository-relative sourcePath
and LF-normalized changes, without timestamps or checkout paths. Both write and
check modes validate the entire Changes vocabulary before any replacement.
Supported content is flat `-`/`*` bullets, indented prose continuations, inline
bold, single-backtick code and absolute HTTP(S) links. Unsupported blocks and
unsafe/malformed links fail explicitly. Extend the vocabulary and tests before
using a richer structure. Do not edit generated history or the Changelog MDX as
another release-note source.

`docs:check` is read-only: it checks projection drift and Node-only metadata,
identity, sidebar, stable-anchor and internal documentation-link contracts.
Neither root command invokes legacy generators, MDX compilation or Docusaurus.
Application-only installs can run them. Website typecheck/build separately own
MDX compilation, framework route/fragment validation and static rendering.
CI's existing root docs check rejects stale history; website CI/browser policy
integration and Pages cutover remain later migration work.

## Article copying

The route-scoped `DocsClipboard` owner shares one polite status for Copy page
and Copy code. Page copying serializes only the rendered article to portable
Markdown, preserving headings, emphasis, nested/numbered lists, links, tables,
notes/quotes, disclosures and code language/whitespace. Relative links become
safe absolute destinations; unsafe URLs keep their readable labels. Code copying
preserves exact rendered bytes. Shell, outline, footer, pager, permalinks and
controls are excluded. Actions retain stable names, focus, retry/dismissal and
newest-request ownership; route changes dispose pending results. Controls remain
hidden before hydration and without JavaScript.

## Legacy site during migration

The legacy HTML, registry, runtime and generated assets still serve the current
public site. Their retained `legacyDocumentation*` tests and legacy browser
contracts protect those consumers until cutover. They do not own replacement
routing. Legacy generators are no longer root package aliases or part of sync/check.
If a live-site maintenance task explicitly requires regeneration before cutover,
run the retained Node scripts in dependency order:

```powershell
node scripts/legacy-sync-documentation-changelog.mjs --write
node scripts/sync-documentation-changelog-page.mjs --write
node scripts/sync-documentation-navigation.mjs --write
node scripts/sync-documentation-search.mjs --write
```

Use `--check` for read-only legacy drift checks. Remove these files only after
tracing their remaining tests, runtime, landing and deployment consumers at the
planned cutover. Do not change release publication, signing, assets or updater
behavior as part of documentation generation.

See [testing](TESTING.md) and [release operations](RELEASING.md) for full gates.
