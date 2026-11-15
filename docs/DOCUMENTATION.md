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
CI's root docs check rejects stale history. Website CI also runs typecheck,
production build, artifact checks and the dedicated browser suite. Live Pages
cutover remains pending under the procedure below.

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

## Public resources during migration

The replacement build generates the React landing at `/archeion/` from
`website/src/pages/index.tsx` and serves public fonts/images, schema/examples and
the existing dictionary catalog/packages from `website/static/`. Original
`docs/` sources remain active until cutover. Resource changes before cutover must
update both copies with identical bytes. Do not run formatters over preserved
resources or the still-active legacy landing/runtime. Compatibility HTML under `static/documentation/`
redirects the 24 old article URLs, retaining query/fragment and a visible fallback.
See [the preservation contract](../website/README.md#static-landing-public-resources-and-compatibility-b28).

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

## Production cutover and legacy retirement

B2 prepares deployment in a stacked PR targeting `build/website-foundation`.
The owner explicitly deferred live cutover and destructive retirement until
after merge. Pages currently publishes `main:/docs`; leave those files and
publisher paths operational until a tested deployment replaces them. Neither
PR approval nor local artifact tests establish a successful live deployment.

1. Merge through the authorized stack procedure separately. The production
   workflow runs only on main pushes or manual main dispatches. It validates
   sources/history, website tooling, types, MDX links and the output artifact,
   uploads only `website/build/`, then deploys via `github-pages`. PR validation
   remains in the existing CI lanes. This workflow does not enable Pages or
   mutate its settings.
2. Record the exact main SHA, workflow run, artifact and deployment ID. Confirm
   the v1.8.0 Release still has EXE/MSI, both signatures, SHA256SUMS.txt and
   latest.json. All were verified published during B2.10 preparation.
3. Obtain a successful deployed/tested artifact before changing Settings →
   Pages → Build and deployment to GitHub Actions. If GitHub rejects the first
   Actions deployment while the publishing source is legacy, stop and record
   that failure. Resolve the bootstrap ordering with the owner; do not silently
   enable Pages through `configure-pages` or the API to bypass this prerequisite.
4. Verify the live root, docs overview, all nested docs and hard refreshes;
   old compatibility URLs with queries/fragments; fonts, images, theme schema,
   examples and dictionary catalog/package hashes; sitemap, robots, canonical,
   social/icon metadata; and unknown nested paths returning HTTP 404 with the
   branded document. Local tests emulate filesystem hosting but do not prove
   GitHub's CDN behavior. Save network failures and actual response status.
5. After the deployed artifact passes, change the publishing source and verify
   it again. Keep the previous known-good deployment/run and Git revision for
   rollback. A failed deployment must not trigger legacy deletion. Revert to
   the known-good deployment or restore the original publishing source while
   the legacy tree is retained.
6. In a separately validated retirement change, use the inventory below. Preserve
   root maintainer guides, historical/audit files, compatibility redirects and
   the B3 temporary homepage until its React replacement passes. Run docs:check,
   the website build/artifact/browser gates, root verification and affected
   native dictionary/asset tests before removing consumers.

### Retirement inventory and consumer replacements

| Retained owner                                                                                                                                           | Replacement / retirement condition                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/documentation/` HTML, registry and runtime/generated assets                                                                                        | 24 MDX files, framework metadata/sidebar, React shell/search/copy/timeline; remove only after live replacement verification                                                                                                                                                                 |
| `sync-documentation-navigation.mjs`, `sync-documentation-search.mjs`, `sync-documentation-changelog-page.mjs`, `legacy-sync-documentation-changelog.mjs` | Framework build/search and the existing Node-only release projection; remove their legacy-only callers together                                                                                                                                                                             |
| Ten `legacyDocumentation*` unit suites and legacy documentation browser suites                                                                           | Named migrated source/website suites already protect routes, content, shell, TOC, search, copying and history; reconcile each assertion before retiring duplicates                                                                                                                          |
| `documentationLinkTestSupport.ts`, `documentationSearchTestSupport.ts`                                                                                   | Remove only after all retained legacy test imports move                                                                                                                                                                                                                                     |
| `public-pages.pw.ts`, `public-navigation.pw.ts`, `font-preferences-documentation.pw.ts`                                                                  | Mixed legacy consumers: retain landing assertions and port docs/font claims to the dedicated website suite; do not delete entire mixed suites                                                                                                                                               |
| `docs/index.html`, `docs/css/`, `docs/js/` and their landing suites                                                                                      | Verified B3 React landing and migrated production coverage; unchanged `legacyLanding*` unit and `legacy-landing-*` browser suites retain the old publisher and all demo/keyboard contracts until separately validated live cutover                                                          |
| `docs/assets/`, `docs/schemas/`, `docs/examples/`                                                                                                        | `website/static` exact-byte resources; retarget theme-contract/shared-parity tests, fixture cover imports, font manifest/verifier, brand commands, notices and maintainer source links before deleting copies                                                                               |
| `docs/dictionaries/catalog-v1.json` and packages                                                                                                         | Existing exact-byte `website/static/dictionaries/` copy; retarget Python `DEFAULT_CATALOG`/`DEFAULT_OUTPUT`, Rust catalog `include_bytes!`/package paths and publisher instructions together. Preserve package-before-catalog publication, immutable conflicts, receipt checks and rollback |
| Old paths in CI classifier tests                                                                                                                         | Retire obsolete root HTML/registry eligibility after source removal; keep unknown/shared/deleted paths selecting full and gate/job contracts unchanged                                                                                                                                      |
| Old public `/documentation/` URLs in desktop About/update links                                                                                          | Intentional compatibility destinations; static redirects retain those URLs, queries and fragments                                                                                                                                                                                           |
| Root `docs/*.md`, dictionary README, release notes, plans/audits                                                                                         | Intentional maintainer or historical sources; excluded from Pages output, not cleanup targets                                                                                                                                                                                               |

The B2.10 tracked-reference audit classifies source references by these families.
Historical references remain evidence, not runtime owners. Existing public
resource and nine release-owner Git blobs remain protected by the immutable
migration baseline. Do not edit release publication, signing, updater or exact
parser/body contracts during retirement.
