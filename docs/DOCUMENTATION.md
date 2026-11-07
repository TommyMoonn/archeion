# Public documentation guide

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

The public documentation site is static HTML under `docs/documentation/`.
GitHub Pages publishes the `docs/` directory. The site uses
`docs/documentation/page-registry.json` as the source of truth for routes,
navigation, and page metadata.

Use this guide when you add or edit a public documentation page. For maintainer
documentation, start with the [documentation index](README.md).

## Add or update a page

Each page has a stable ID, a route relative to the documentation root, a title,
a navigation group and order, a page type, and a project-relative source path.
The article's `h1` and prose remain in its HTML file.

1. Create or edit the page's `index.html`. Keep the shared shell and article
   header.
2. Add or update its entry in `page-registry.json`. Routes start and end with
   `/`. The `/` route is the overview. Source paths must match
   `docs/documentation<route>index.html`.
3. Choose the page type by its content: `overview`, `getting-started`, `guide`,
   `reference`, `troubleshooting`, or `changelog`. The `changelog` type does not
   create a route until its content exists.
4. Set a unique order within the navigation group. Group order followed by page
   order controls the sidebar and previous or next links. Update the `first`
   and `last` IDs when a sequence endpoint changes.
5. Regenerate the site data and check for drift:

   ```powershell
   npm run docs:sync
   npm run docs:check
   ```

Commit the registry, authored HTML, and generated assets together. Run the
existing focused page checks after changing routes or article structure:

```powershell
npm run test -- tests/documentationNavigation.test.ts tests/documentationArticles.test.ts tests/libraryReaderDocumentationCoverage.test.ts
```

The sync command generates the marked `docs-header`, `docs-navigation`,
`docs-pager`, and `docs-footer` regions. It also generates the shared search
dialog, the article's `data-page-type`, heading permalinks, and the search
index. Keep generated chrome changes in the scripts that render them, not in
individual pages.

The header's `Archeion Docs` link returns to the overview. `Home ↗` returns to
the public landing page. Keep one article introduction. Omit a lead paragraph
when it repeats the header summary. Use `.notice` for callouts and retain their
labels and advice. The first page has no Previous link, and the last page has
no Next link. Every interior page links to its adjacent pages.

`docs:check` validates registry coverage and reports drift without writing
files. It runs in the frontend quality checks and CI. Every documentation
`index.html` must appear in the registry exactly once. Navigation uses ordinary
links and remains usable before JavaScript runs.

The site shell and runtime focus behavior live in
`docs/documentation/assets/docs.css` and `docs/documentation/assets/docs.js`.
The search dialog lifecycle lives in
`docs/documentation/assets/docs-search.js`.

## Maintain the search index

`scripts/sync-documentation-search.mjs` reads the page registry and each
semantic `[data-doc-article]` element. It generates
`docs/documentation/assets/docs-search-index.js`, which each page loads before
`docs.js`. The deferred `docs-search.js` module reads that index. GitHub Pages
does not need a fetch service or a build-time deployment step.

The index contains one introduction entry per page and one entry for each
`h2` and `h3`, in page and document order. Each section body ends at the next
heading. Entries include the page title, heading, route, group, page type,
section heading and fragment, normalized body text, aliases, and an excerpt of
at most 240 characters. The generator excludes navigation, outlines,
permalinks, footer content, hidden helpers, scripts, styles, and copy controls.

Search normalizes whitespace and ignores case. Page-title matches rank first,
followed by section headings, explicit aliases, and body text. Page and section
order break ties. A title match opens the page. A section match opens its
fragment. An empty query lists pages without listing every section.

Prefer natural article wording. Add
`data-search-aliases="term|other term"` to an article or heading only when
readers may use a justified term that does not appear in the content, such as
an alternative spelling. Do not repeat headings or body text as aliases.
Explain each alias in the review.

To regenerate or check the index directly:

```powershell
npm run docs:search:sync
npm run docs:search:check
```

`docs:sync` and `docs:check` already include these commands. The focused
existing tests are:

```powershell
npm run test -- tests/documentationSearchIndex.test.ts tests/documentationSearchAnnouncements.test.ts
```

The search dialog is generated from the navigation script's template. Its
accessible name remains "Search documentation". "Show details" reveals the
existing excerpts without rebuilding or reordering results. Result links retain
their accessible title and context names in both modes. Excerpts become
descriptions. Search highlighting uses text nodes and marks, never HTML.

Arrow keys move focus among results. Enter opens the focused result or the
active result from the input. Tab retains access to the input, toggle, and
links. Escape or a pointer gesture wholly outside the dialog closes it and
restores focus to the opener. Same-page navigation focuses the destination
heading. Query updates retain input focus and use the existing polite
result-count region.

## Maintain release-history content

The tracked `release-notes/vX.Y.Z.md` files are the authored release-history
source. `scripts/release-notes.mjs` validates their metadata and download
links, preserves the metadata-free GitHub Release body, and exposes the
Changes Markdown. It orders history by date, then by descending numeric
version for releases on the same date. Do not extract user-facing release
history from `CHANGELOG.md`.

`scripts/sync-documentation-changelog.mjs` projects the shared parser output
into `docs/documentation/assets/docs-changelog-data.json`. Each entry contains
`version`, `date`, `sourcePath`, and LF-normalized `changes`. The generated
data has no timestamp or checkout-specific paths. Edit the canonical release
notes, then regenerate the data. Do not edit generated prose.

Generation validates the full history before replacing the output. Check mode
does not write files. It reports missing or stale data, including added or
removed releases.

```powershell
npm run docs:changelog:sync
npm run docs:changelog:check
npm run test -- tests/releaseNotes.test.ts tests/documentationChangelogData.test.ts
```

`scripts/sync-documentation-changelog-page.mjs` renders the validated data into
the marked timeline region in `docs/documentation/changelog/index.html`. It
checks data freshness before rendering and rejects unsupported Markdown
blocks instead of dropping prose. The committed page remains readable without
JavaScript or the decorative timeline rail. Edit the canonical release notes,
not the generated timeline.

`docs:sync` runs changelog data, the timeline, navigation, and search generation
in dependency order. `docs:check` checks the same outputs without writing. The
registry controls the Changelog route, sidebar, pager, and search integration.
Header generation adds "Release notes" only when the route is registered and
validated.

See [release-note authoring](../release-notes/README.md) for the supported
release-note format.

## Write and structure articles

Choose the page type by the page's purpose:

| Type              | Use it for                                                                         |
| ----------------- | ---------------------------------------------------------------------------------- |
| `overview`        | A short entry point with grouped links.                                            |
| `getting-started` | Ordered onboarding steps, prerequisites, expected results, and the next step.      |
| `guide`           | Instructions for a task, including relevant limits and recovery steps.             |
| `reference`       | Precise behavior, formats, ownership, limits, and terminology.                     |
| `troubleshooting` | A symptom, its context, safe corrections, data-safety notes, and escalation steps. |
| `changelog`       | Historical releases sourced from tracked release notes.                            |

Use headings, paragraphs, lists, links, tables, code, and `.notice` callouts
with `role="note"`. Keep diagrams and comparison tables when they help explain
the task. Add related links when they help readers continue. Merge sections that repeat
nearby content or contain only a next-step link. Keep claims limited to released
behavior. Put feature-depth expansion in a separate task. Do not apply the same
article template to every page.

Every article `h2` and `h3` needs a unique, stable slug ID. The sync command
places a permalink beside the heading. It does not place the permalink inside
the heading. Write the heading and its inline markup only. The generator
creates `.article-heading` wrappers and `.heading-permalink` links.

Preserve published fragment IDs when merging sections. Move the ID to the
content that remains.

The footer's `Edit this page` link comes from the registry's `sourcePath`. The
issue-reporting link remains beside it. Both work without JavaScript.

## Keep article copying in sync

`docs:sync` installs the route-relative `assets/docs-copy.js` module on every
registered page. The module adds `Copy page` beside the article title and
`Copy code` to fenced examples. Without JavaScript, the article and its native
links remain usable. Inactive copy controls do not appear.

The module owns article serialization and the shared clipboard and status
lifecycle. It copies the article DOM, not the page shell or a second article
corpus. It preserves headings, emphasis, lists, links, simple tables, code,
and note or quote structure. It resolves links against the current page URL
so copied Markdown remains portable. Update the existing serialization tests
when the article gains a new content type or inline element.

The serializer excludes hidden helpers, outlines, permalinks, copy controls,
and footer or pager chrome. Clipboard actions retain their names and focus.
A polite status region reports the newest request and keeps its result until
dismissal or the next copy. Dismissal restores focus to the originating
control and invalidates pending feedback. Leaving the page also clears it.

Run the existing focused checks after changing article serialization:

```powershell
npm run test -- tests/documentationCopy.test.ts
npm run test:browser -- tests/browser/documentation-copy.pw.ts
```

See [the testing guide](TESTING.md) for the other validation commands.
