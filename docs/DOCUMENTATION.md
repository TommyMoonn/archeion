# Public documentation guide

The public documentation is authored in `website/docs/` and built
by the private `@archeion/website` Docusaurus workspace. Root `docs/` retains
maintainer guides. GitHub Pages publishes only `website/build/` through
`.github/workflows/website-deploy.yml`; the legacy static publisher is retired.

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
CI's root docs check rejects stale history. Website CI also runs typecheck,
production build, artifact checks and the dedicated browser suite. The production workflow publishes the validated build from `main`.

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

## Public resources and publication

`website/static/` owns public fonts, images, theme schemas/examples and dictionary
catalog/packages. Docusaurus copies these unchanged into `website/build/`.
The React landing owns `/archeion/`; MDX articles own `/archeion/docs/`.
`website/static/documentation/` contains active compatibility redirects with
query/fragment preservation and visible no-JavaScript fallback links.

Dictionary maintenance is documented in [the catalog guide](dictionaries.md).
Publish immutable packages before the catalog, validate receipts, and preserve
the stable `/archeion/dictionaries/` URLs. Workspace ZIP exclusions do not affect
the deployed website or Git tracking.

## Production cutover and legacy retirement

The website migration and React landing were merged before v1.9.0 Branch A.
The retirement preflight verified remote `main` at
`56d94bb5ba741d7edb4e7889ebe1bb8b6620b793`, live root/docs/catalog HTTP 200,
all three live dictionary package hashes, and exact local resource parity.
The retained deployment workflow uploads only the checked `website/build/`.
Keep a known-good deployment/revision for rollback; a publishing failure must
be repaired through the website workflow, without changing release/updater gates.

### Retirement inventory and consumer replacements

| Retired family                                                                                   | Current owner and coverage                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/index.html`, `docs/css`, `docs/js`, legacy landing suites                                  | React landing, `website/tests/landing*`, root `landing*` tests and production `landing-*.pw.ts`; interactive demo cases retired with the demo, while released feature claims remain in MDX coverage |
| `docs/documentation`, page registry, navigation/search/copy/history generators and legacy suites | MDX/front matter/sidebar, framework build, React documentation components, `website/tests`, root documentation/release tests and `website-docs-*.pw.ts`                                             |
| Mixed `public-pages`/`public-navigation` browser suites                                          | Production landing navigation/static tests and website documentation interaction/accessibility tests cover focus, modal dismissal, navigation and reduced motion                                    |
| Font documentation browser assertions                                                            | `website-docs-font-preferences.pw.ts` retains role/recovery/link and narrow/wide checks against the current site                                                                                    |
| `docs/assets`, `docs/schemas`, `docs/examples`                                                   | `website/static`, theme contract and canonical application-to-website shared asset parity tests; browser fixture imports use current resources                                                      |
| `docs/dictionaries`                                                                              | `website/static/dictionaries`, Python publisher defaults and Rust production fixtures; maintenance prose moved to `docs/dictionaries.md`                                                            |
| Legacy CI path eligibility                                                                       | Maintained Markdown and explicit website owners qualify; unknown/shared/deleted paths still require full CI                                                                                         |

Engineering guides, historical release notes, source contracts, public resource
bytes and compatibility redirects remain maintained. No legacy static generator
is supported. Root `docs:sync` remains the release-history projection only.

See [testing](TESTING.md) and [release operations](RELEASING.md) for full gates.
