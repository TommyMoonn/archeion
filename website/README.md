# Website foundations

This private Docusaurus workspace owns the public website presentation. It does
not load desktop theme packages or change the application's theme contracts.

## Local development

Use Node 22 (see the root `.node-version`) and pnpm 10.33.0. From the repository
root, run `pnpm install --frozen-lockfile` once, then:

```sh
pnpm --filter @archeion/website dev
pnpm --filter @archeion/website typecheck
pnpm --filter @archeion/website test
pnpm --filter @archeion/website lint
pnpm --filter @archeion/website fmt
pnpm --filter @archeion/website build
pnpm --filter @archeion/website serve
```

Inside `website/`, use `pnpm run dev`, `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test`, `pnpm run fmt`, `pnpm run fmt:fix`, `pnpm run build`, and
`pnpm run serve`.
Lint and formatting reuse the repository's installed tools and configuration.
The development server watches TSX, Tailwind class strings, and MDX. Open
`/archeion/` for the React landing page and
`/archeion/docs/getting-started/installing/` for the installation article.
Production output goes to `website/build/`;
`serve` previews that static output under the same project base path.

The dedicated CI website job installs only `@archeion/website...`, then runs
website tooling tests, strict typechecking, and the production build (including
MDX and broken-link validation). The existing application jobs keep their application-only installs.
Eligible isolated website changes select the existing frontend/docs validation
set described in B2.9 below. The B2.10 production workflow is prepared for main;
Pages publishes the validated `website/build/` artifact from `main`.

The root `package.json` scopes a tinypool 2.1.2 override to Docusaurus. Docusaurus
3.10.2 still requests 1.x, which is affected by GHSA-85c8-ppgw-ccpr and
GHSA-5gmw-xhrv-c9v3. Keep the override until Docusaurus requires a patched
version. Scoped overrides use serialize-javascript 7.1.3 for
copy-webpack-plugin and css-minimizer-webpack-plugin to fix
GHSA-5c6j-r48x-rmvq. These overrides do not change the desktop application's
dependency requirements. Website runtime tests live under
`website/tests/` and run in the website job; application-only tests do not import
website modules or require Docusaurus dependencies.

Root `pnpm run docs:sync` and `pnpm run docs:check` remain Node-only and do not
invoke Docusaurus. Sync writes canonical release-history JSON; check validates its freshness and
Node-only documentation sources. Neither invokes legacy generators. Run the
website build separately to compile MDX and validate framework links.

Production documentation and compatibility browser contracts run from the root
after a website build:

```sh
pnpm exec playwright test --config tests/browser/website-foundation.config.ts
```

Set `ARCHEION_WEBSITE_MODE=dev` to exercise the development server instead.
The config owns its server and shuts it down after the run. These contracts are
separate from the desktop browser suite.

## Design conventions

`src/css/custom.css` is the single source for website tokens. The approved docs
and landing mocks in `.project/experiments/` define the visual reference. Their
palette matches the finalized brand refresh; the light documentation sidebar
deliberately uses the website canvas. Dark is the default, and Docusaurus owns
the persisted dark/light selection through `data-theme`.

Use semantic utilities: `bg-surface`, `bg-surface-raised`, `text-content`,
`text-content-muted`, `border-border`, `text-accent`, and
`outline-focus-ring`. Strong text is for headings; subtle text is for inactive
or decorative content. Accent foreground pairs with a filled accent action.
Status roles are `success`, `warning`, `danger`, and `info`; add their
foreground/subtle variants centrally when a real component needs them. Do not
borrow a status color for decoration or invent opacity values in components.

Use `font-sans` for Inter UI/body text, `font-editorial` for the documentation's
Literata headings, `font-display` for the landing mock's system serif stack, and
`font-mono` for code. Inter Variable (100�900) and Literata 400 are embedded
in the generated render-blocking stylesheet with a blocking font-display period
for local decoding. This increases critical CSS size,
but removes separate font requests and fallback-to-webfont reflow on slow loads.
The generated head/body bootstrap reveals the server-rendered page after both
typefaces decode, independently of React's deferred bundle. Font-load rejection
reveals the fallback layout; with JavaScript disabled the page stays visible.
The website-owned Inter Variable asset comes from the existing inter-ui package;
public static font URLs remain unchanged. Code uses the declared system fallback
when Fira Code is unavailable. Copy page reserves its server-rendered space before
hydration so narrow breadcrumb rows do not move when it becomes available.
Use `text-caption`, `text-body`, `text-lead`, `text-article-title`, `text-hero`,
and `text-section` with their bundled line heights. Display headings pair with
`tracking-display` and normal weight. Use standard Tailwind sizes for ordinary
controls. Font files are unchanged copies of existing public assets, with their
licenses in `static/licenses/fonts/`.

Use Tailwind's standard quarter-rem spacing scale for local gaps/padding.
Repeated layout roles are `px-gutter`, `px-gutter-mobile`, `py-section`,
`h-header`, and `h-docs-header`. Width limits are `max-w-site` (1280px),
`max-w-docs` (1360px), `max-w-article` (768px), `max-w-hero-copy` (560px), and
`max-w-prose` (66ch). Combine maximum widths with fluid widths and `min-w-0`;
they do not impose fixed viewport widths. Page owners choose their grid and
responsive gutters from the mock rather than a shared shell wrapper.

Use `rounded-control` (7px), `rounded-button` (8px), `rounded-card` (10px),
and `rounded-preview` (16px). Layers are `z-header` (60), `z-backdrop` (80),
`z-drawer` (90), `z-dialog` (100), and `z-skip-link` (110).
The named content breakpoints are `narrow` (600px), `navigation` (800px),
`wide` (1080px), and `full` (1240px); Tailwind's standard breakpoints remain
available. Use a breakpoint for a demonstrated content constraint, not a
different arbitrary value in each component. Page-specific exceptions still
need evidence from the approved mock.

Keep all component styling in Tailwind. The global stylesheet contains only
Tailwind setup, tokens, and font-face rules. Preflight stays omitted; the docs
shell replaces Infima geometry at focused theme seams. Primitives supply borders,
font families, focus outlines, and reduced-motion-aware transitions.

## Shared components

`components/ui/button.tsx` and `input.tsx` are the small adapted shadcn foundation.
Button supports Slot composition for links and icon sizes for controls with an
accessible name. Keep native semantics and label every input/icon-only action.
No extra link or icon-button wrapper is needed yet.

`components/shared/Brand.tsx` selects the unchanged approved logo composition
for the active website theme, with decorative image alt text alongside the
visible product name. The wordmark PNGs remain README artwork as documented by
the brand owner; they are not approximated in this component. Consumers own
the destination link and may set the text's inherited font role for each site.

The one-off token gallery was removed after dark/light verification. Source
palette tests and browser checks of resolved tokens and shared controls retain
coverage. B2.8 removed the temporary root page and its exclusive component sample.
The React landing page owns `/archeion/`.

## Current publication ownership

`website/static/` is the sole public resource owner, including dictionaries.
Root `docs/` contains engineering guides. The old static runtime, generators and
legacy tests were retired in v1.9.0 Phase 1; compatibility redirects under
`static/documentation/` remain active. Dictionary publication writes to
`website/static/dictionaries/` and is documented in `docs/dictionaries.md`.
Use the current commands above and `docs/DOCUMENTATION.md` for maintenance.

## Historical migration notes

The following records describe B2/B3 implementation checkpoints before cutover
and retirement. Paths, pending actions and commands in these records describe
those historical checkpoints; they are not current maintenance instructions.

## Documentation migration map (B2.1)

This is the pre-implementation contract for the documentation port. It records
the approved mock's final cascade and the existing public behavior at foundation
commit `d629a358ac015ef339a00dc8d4100891778a6d6c`. The owners below are planned;
the foundation still serves only its temporary routes. B2.1 changes no runtime,
article, generator, route, public asset, or deployment behavior.

The visual reference is `.project/experiments/archeion-docs-site.html`, including
its later shell/header overrides. The factual source remains the 24 registered
articles in `docs/documentation/`, with `release-notes/` owning release history.
`docs/DESIGN.md` governs the desktop app, explicitly excluding website layout
and typography; the website uses the foundation conventions above. Local
inspection scripts, screenshots, measurements, review records, and phase status
belong in `.plans/website-migration/`, outside the published artifact.

### Visual and responsive contract

The mock uses a sticky translucent header, a flat scrollable sidebar with
collapsible uppercase groups, an editorial article column, and a sticky right
outline. There is no default Docusaurus navbar, floating card around the article,
desktop sidebar-collapse button, or back-to-top control in the approved design.
Its final header contains Brand, centered search, Home, theme, GitHub, and the
mobile menu. Earlier `.top-nav`, download-button, and rail-note CSS does not
correspond to rendered controls and must not create extra production UI.

| Region            | Effective mock dimensions and treatment                                                                                                         | Implementation direction                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frame             | Centered 1360px maximum; 28px horizontal gutters above 1240px                                                                                   | Reuse `max-w-docs`; keep header and content on the same rails                                                              |
| Header            | 68px high; three grid columns: flexible brand, search capped at 440px, flexible actions; 24px column gap                                        | Shell owns geometry; theme-aware Brand remains a shared primitive                                                          |
| Sidebar           | 230px column, sticky below header, viewport-height scroll region; right border; 28px top padding                                                | Render Docusaurus sidebar data with approved flat links and disclosure groups                                              |
| Article           | Flexible middle column, centered 700px maximum after final override; 42px top padding; 28px grid gaps                                           | Add/reconcile a named docs-article width when implementing; existing `max-w-article` is 768px and is not this measured cap |
| Outline           | 170px column; sticky below header; 42px top padding; h3 links indented 21px versus h2 10px                                                      | Same document heading data as article; accent text and left border for current section                                     |
| Topline           | Muted `Documentation / group / title` breadcrumb, then ghost Copy page; uppercase type label with dot except Overview                           | Route metadata supplies labels; keep full names available when visual breadcrumb truncates                                 |
| Typography        | Inter body/UI; Literata regular brand and h1/h2; body 16px/1.85, summary 17px/1.75, h1 clamp 44–56px/1.08, h2 31px/1.22, h3 19px/1.4            | Reuse bundled fonts and semantic type roles; reconcile differing role dimensions centrally rather than inheriting Infima   |
| Article structure | Heading spacing, underlined accent links, marked lists, quotes, notices, inline code, keyboard keys, horizontal rules, disclosures              | MDX element mappings use Tailwind; preserve semantic markup and authored content                                           |
| Notices           | Icon/label/body grid; 18px marker, 16px/18px padding, 8px corners, raised surface                                                               | One docs notice component preserves each existing label, advice, and note semantics                                        |
| Code and tables   | Code 14px/1.75 mono, 18px/20px padding, 8px corners, local overflow; table wrapper scrolls horizontally, 11px/13px cells                        | Local scrolling must not overflow the page; copy stays reachable with keyboard and touch                                   |
| Overview          | Getting-started cards in three columns, other groups in two; 9px gaps; bordered raised cards, arrow hover                                       | Derive destination metadata from docs data; own only the short authored overview copy                                      |
| Pager             | Bottom-aligned on short desktop articles; two bordered cards with Previous/Next labels, 80px minimum height; a sole neighbor spans both columns | Docusaurus neighbor metadata owns sequence; first has no Previous and last no Next                                         |
| Changelog         | Vertical rail and dots; 116px date/version column plus change body, 22px gap                                                                    | React timeline consumes generated release data in B2.7; no copied mock history                                             |
| Search            | Fixed overlay at z100; dim/blur backdrop, 680px maximum dialog, 12px corners; top inset min(16vh,130px); scrollable results max min(58vh,520px) | Preserve the approved surface using centralized tokens; semantic dialog behavior comes from the search owner               |

These are inclusive `max-width` boundaries in the mock. Tailwind variants must
preserve the effective boundary, including the exact boundary pixel; ordinary
minimum-width variants must not accidentally invert it.

| Width   | Changes from the wider layout                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≤1240px | 24px gutters; search cap 360px; header column gap 20px; content gap stays 28px                                                                                                                                                                             |
| ≤1080px | Right outline disappears, with no inline/mobile replacement; two content columns, 30px gap; search cap 330px; header gap 16px                                                                                                                              |
| ≤900px  | Brand's Documentation label/divider and Home text link disappear; search cap 260px; header gap 14px                                                                                                                                                        |
| ≤800px  | Content becomes one block; sidebar becomes a left drawer, width min(310px, viewport−52px), z90; backdrop z80 below header; 22px gutters; centered 240px search remains expanded; menu appears; article top padding 30px; desktop bottom-fill behavior ends |
| ≤690px  | Search becomes a 38px icon-only trigger, with accessible name retained; pager becomes one column and both directions align left                                                                                                                            |
| ≤600px  | Header/drawer offset becomes 62px; gutters 17px; article top padding 24px; h1 40px, h2 27px; overview cards and timeline become one column; search top inset 9vh                                                                                           |
| ≤400px  | Brand name 18px and mark 26px; GitHub header icon hidden; theme and menu remain                                                                                                                                                                            |

The 900px, 690px, and 400px exceptions come from the approved mock; the foundation
already names 1240/1080/800/600px. Centralize any repeated exception on
implementation. The mock's `html { overflow-x: clip }` is not proof that content
fits: check element containment and scrolling areas, including doubled text.
Retain the 320px minimum supported layout and test short viewports, coarse
pointer, forced colors, and reduced motion.

Dark is the initial theme. Light uses the canvas-colored sidebar already defined
by the foundation. Final ghost actions have transparent borders and hover fills;
do not port the earlier outlined icon styles. Keyboard focus is a 2px outline
with 3px offset. Link color transitions are generally 340ms, ordinary controls
160–240ms, and the drawer 260ms. Reduced motion removes smooth scrolling and
effectively removes transitions. Theme changes suppress palette transitions.

The mock requests remote variable Inter and Fira Code as well as embedded local
fonts. The foundation initially bundled Inter 400/600/700 and Literata 400;
the documentation refinement replaces the static Inter faces with the existing
local Inter Variable asset. Keep the local asset policy: do not introduce
Google Fonts, CDN Tailwind, base64 artwork, or a Fira dependency. Mock weights
such as 550/650 require comparison against the available local weights at B2.4;
do not claim pixel-identical typography before that comparison.

### Public behavior decisions

Preserve means retain the observable contract through the new implementation.
Adapt means retain the capability with the specific approved presentation or
interaction changes below. Explicit retirements identify the removed behavior
and its reason. Missing mock behavior alone does not authorize removing data,
accessibility, or released product guidance.

| Existing behavior and evidence owner                                                                                                                                    | Decision for the React port                                                                                                                                                                                                                                                                                                                    | Phase / replacement owner                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 24 pages, six groups, stable IDs/types, explicit group/page order (`page-registry.json`, navigation generator)                                                          | Preserve every page exactly once; adapt `/documentation/` to `/docs/`; no second manually maintained routing registry                                                                                                                                                                                                                          | B2.5 MDX metadata + `sidebars.ts`; B2.8 compatibility pages                                           |
| Native links and static article/sidebar/pager output before JavaScript                                                                                                  | Preserve static build output, direct navigation, hard refresh, back/forward, modified/new-tab activation, and no-JS article readability                                                                                                                                                                                                        | B2.2 route links; B2.5 content; B2.10 production route checks                                         |
| Brand returns to overview; separate Home link returns to landing                                                                                                        | Adapt Brand to mock's landing destination and decorative theme-selected artwork/visible name; retain Overview in sidebar and an accessible documentation breadcrumb link                                                                                                                                                                       | B2.2 DocsHeader / DocsBreadcrumbs                                                                     |
| Header Release notes utility                                                                                                                                            | Explicitly retire duplicate header link: mock's final header has Home and icon actions only. Preserve Changelog in sidebar, overview, pager, search, and release anchors, including mobile access                                                                                                                                              | B2.2 header; B2.5/B2.7 destinations; retarget header-specific tests                                   |
| Sidebar group collapse saved per group, current group forced open on load (`docs.js`)                                                                                   | Preserve collapse preference and current-page discoverability; adapt to uppercase mock disclosure rows and accent active text, without old selection rail                                                                                                                                                                                      | B2.2/B2.3 DocsSidebarGroup; derive active group from sidebar data                                     |
| Closed mobile drawer inert; modal focus capture/trap, background inert, Escape/close/backdrop dismissal, focus return, resize handoff                                   | Preserve all semantics at mock's 800px boundary. Mock only toggles transform/backdrop and expanded label; its missing focus/Escape behavior is a prototype defect                                                                                                                                                                              | B2.3 DocsMobileNavigation; one owner releases modal state on route change/unmount/desktop resize      |
| Drawer links close for ordinary same-window navigation; modified/download/prevented actions remain native                                                               | Preserve; same-page fragment activation focuses destination rather than the hidden opener                                                                                                                                                                                                                                                      | B2.3 navigation owner + Docusaurus routing                                                            |
| Search shortcut disabled while navigation owns modal surface                                                                                                            | Preserve exclusive modal ownership; do not stack a search modal over the drawer                                                                                                                                                                                                                                                                | B2.3 shell; B2.6 search                                                                               |
| Theme cycles system/light/dark and tolerates unavailable localStorage                                                                                                   | Adapt to persisted dark/light toggle, dark default; explicitly retire system selection because approved website offers two themes. Storage failures remain nonfatal; no desktop preference mutation                                                                                                                                            | B2.3 Docusaurus colorMode, no competing theme store                                                   |
| Existing theme storage key `archeion-docs-theme`                                                                                                                        | Adapt once through Docusaurus-owned preference initialization: retain explicit old light/dark when no new preference exists; old system/invalid values resolve to dark. Do not maintain two writable keys                                                                                                                                      | B2.3 theme initialization; prevent first-paint flash and update action label/logo/browser theme color |
| Skip link, semantic main/article landmarks, visible focus, accessible control names                                                                                     | Preserve; adapt position/appearance to mock. Keep navigation focus on article/heading after route or fragment activation; avoid live-announcing the entire article as the mock does                                                                                                                                                            | B2.2/B2.3 shell and article                                                                           |
| Stable h2/h3 IDs and separate named heading permalinks                                                                                                                  | Preserve all inbound IDs, including non-heading anchors; explicit MDX IDs where automatic slugs differ; retain keyboard-copyable heading links although mock omits permalink chrome                                                                                                                                                            | B2.3 fixtures, B2.5 authored MDX                                                                      |
| Desktop and mobile outline generated from article headings (`docs.js`)                                                                                                  | Adapt to mock's desktop-only outline; explicitly retire inline mobile disclosure at ≤1080px because approved layout removes the rail without replacement. Native section fragments and heading links remain                                                                                                                                    | B2.3 DocsTableOfContents; retarget mobile-outline presentation tests                                  |
| Outline tracks dense/sparse headings, reverse scroll, native fragment rounding, reflow, restored position, and final short section at bottom                            | Preserve section ownership and `aria-current=location`; adapt moving old indicator to mock's active-link border/text. Retire old indicator animation because approved rail uses per-link borders; do not copy mock's narrow observer-band gaps                                                                                                 | B2.3 outline owner; one active section, cleaned subscriptions                                         |
| Search input-first modal, Ctrl/Cmd+K, Escape/outside dismissal, focus restoration, keyboard/Tab/native links (`docs-search.js`)                                         | Preserve focus containment, first-Escape dismissal, safe outside gesture, rapid reopen, IME/modifier handling, and native result links. Adapt to mock's explicit close button and group/title/summary surface; repeated shortcut keeps open/input focused, preserving current behavior                                                         | B2.6 DocsSearchDialog; B2.2 surface fixture only                                                      |
| Search corpus has page introductions and h2/h3 section bodies, explicit aliases, normalized text, 240-character excerpts                                                | Preserve all fields and stable section destinations; derive from MDX/doc build data, excluding shell/hidden/control content; mock's page-only embedded dataset is not the new index                                                                                                                                                            | B2.6 build-time local search index                                                                    |
| Ranking: title before section heading, alias, body; canonical page/section order breaks ties                                                                            | Preserve tiers and tie order; support mock's useful normalized token matching/group/summary fields without demoting existing primary tiers. Retire mock-only alphabetical ties and numeric scoring, which conflict with released search                                                                                                        | B2.6 pure search matching/ranking logic                                                               |
| Empty query browses page introductions; no-results message; currently all matches render                                                                                | Preserve page-only browse and useful empty recovery; adapt to bounded results (mock shows first 10) with total/shown count. Ensure rank precedes bounding; no hidden section duplication for title hits                                                                                                                                        | B2.6 result presentation                                                                              |
| Show details reveals excerpts without node replacement, reordering, selection reset, or count announcement                                                              | Preserve toggle and stable result identity although absent from mock; fit a restrained control into approved dialog. Summary/context is not a substitute for body excerpts                                                                                                                                                                     | B2.6 search presentation                                                                              |
| Literal text highlighting, accessible result title/context names, excerpt descriptions, one stable polite count region                                                  | Preserve safe text-node/React-text rendering and input focus on query changes. Do not copy mock's whole-results live region or unsafe HTML highlighting                                                                                                                                                                                        | B2.6 search accessibility                                                                             |
| Copy page exports article-only portable Markdown (`docs-copy.js`)                                                                                                       | Preserve headings, emphasis, nested/numbered lists and starts/values, safe absolute links, tables, code fences/whitespace, notes/quotes, and escaping. Exclude outline, hidden helpers, permalinks, controls, pager/footer. Explicitly retire mock's `innerText` page export because it loses Markdown structure and includes generated chrome | B2.6 article serializer; B2.2/B2.3 visual action only                                                 |
| Copy code exports exact code text                                                                                                                                       | Preserve exact bytes as represented by rendered code; adapt mock hover/focus reveal, but keep controls discoverable on touch. Do not introduce mock's temporary textarea focus theft                                                                                                                                                           | B2.3 fixture code control; B2.6 shared copy lifecycle                                                 |
| Copy control names stay stable; one polite status; success/failure/retry, persistent feedback, dismiss/focus return, newest async operation wins, disposal invalidation | Preserve all states; adapt feedback visually without changing labels to transient Copied/Copy failed or using mock reset timers                                                                                                                                                                                                                | B2.6 article-local clipboard owner shared by page/code actions                                        |
| Footer Edit this page / Report a documentation issue, outside copied article                                                                                            | Preserve even though mock has no footer actions; use correct MDX source edit path and repository issue tracker. Changelog directs to `release-notes/README.md`, never generated data                                                                                                                                                           | B2.5 DocsArticleFooter, B2.7 changelog special case                                                   |
| Overview compact grouped links and ordered onboarding                                                                                                                   | Adapt to approved cards, preserving every destination and useful distinct summary. Preserve callout labels/advice and avoid duplicate introductions                                                                                                                                                                                            | B2.5 content + B2.6 DocsOverview                                                                      |
| Technical prose, ordered tasks, tables, notices, code, links, examples, images, safe recovery guidance                                                                  | Preserve current factual content and public-resource references; do not copy stale mock prose as authority                                                                                                                                                                                                                                     | B2.5 MDX mappings + existing factual coverage suites                                                  |
| Release history readable without JS; versions/dates/change bullets, safe Markdown links, GitHub Release links and anchors                                               | Preserve canonical notes, date/version ordering, LF-normalized schemaVersion 1 projection, parser API/exact release body, failure-before-write validation and drift checks; adapt timeline visuals                                                                                                                                             | B2.7 ReleaseTimeline + existing root parser/generator owner                                           |
| Root `docs:sync` / `docs:check`, navigation/search/timeline generators and imperative runtime                                                                           | Preserve Node-only entry points; retire HTML chrome/search/timeline generators and old runtime only after replacements/tests pass. B2.7 projects release JSON; B2.10 removes obsolete site implementation                                                                                                                                      | B2.7 tooling, B2.10 cleanup                                                                           |
| Public fonts/images/theme schema/examples and legacy deep links                                                                                                         | Preserve exact public resource URLs/bytes and old article paths via static fragment-preserving compatibility pages with visible fallback. No server rewrite assumption                                                                                                                                                                         | B2.8 static resources; B2.10 artifact checks                                                          |
| Page title/description, canonical/social/icon metadata and site navigation under project base URL                                                                       | Preserve production metadata and correct `/archeion/` paths; mock only updates title/theme-color and is not a complete SEO source                                                                                                                                                                                                              | B2.5 metadata; B2.8/B2.10 hosting integration                                                         |
| Reduced motion, forced colors, coarse-pointer targets, doubled text, narrow/short viewports                                                                             | Preserve accessible behavior; adapt approved visuals without hiding essential content or leaving offscreen focusable elements. Desktop custom application themes do not become website themes                                                                                                                                                  | B2.3/B2.4 shell checks; B2.5–B2.7 content checks                                                      |

No current public capability beyond the explicitly named presentation/theme
retirements is discarded. The mock's hash router, template cloning, embedded
`pageData`, global event wiring, and DOM `innerHTML` construction are prototype
mechanisms to replace, not compatibility APIs. Production routes remain ordinary
document paths with native fragments; old hash-TOC reload behavior is not copied.

### Content identity reconciliation

All six group names, page IDs, navigation titles, group order, and page order
agree between mock and registry. The sequence is Overview, Getting started,
Using Archeion, Customization, Reference, Changelog. Preserve the following
suffixes under `/archeion/docs/`; the same suffixes under
`/archeion/documentation/` need compatibility pages. This table is an audit
snapshot, not an input to routing or content generation.

| Group           | IDs in page order                                                                                                                                                                              | Route suffixes in the same order                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview        | `overview`                                                                                                                                                                                     | `/`                                                                                                                                                                                                                                                                                                        |
| Getting started | `installing`, `archives`, `adding-books`                                                                                                                                                       | `/getting-started/installing/`, `/getting-started/archives/`, `/getting-started/adding-books/`                                                                                                                                                                                                             |
| Using Archeion  | `library`, `archive-health`, `quick-actions`, `metadata-covers`, `series`, `reading`, `reader-navigation`, `reader-media`, `file-management`, `settings`, `dictionaries`, `keyboard-shortcuts` | `/guides/library/`, `/guides/archive-health/`, `/guides/quick-actions/`, `/guides/metadata-covers/`, `/guides/series/`, `/guides/reading/`, `/guides/reader-navigation/`, `/guides/reader-media/`, `/guides/file-management/`, `/guides/settings/`, `/guides/dictionaries/`, `/guides/keyboard-shortcuts/` |
| Customization   | `appearance`, `custom-themes`, `theme-manager`                                                                                                                                                 | `/customization/appearance/`, `/customization/custom-themes/`, `/customization/theme-manager/`                                                                                                                                                                                                             |
| Reference       | `archive-storage`, `troubleshooting`, `annotation-export`, `about-resources`                                                                                                                   | `/reference/archive-storage/`, `/reference/troubleshooting/`, `/reference/annotation-export/`, `/reference/about-resources/`                                                                                                                                                                               |
| Changelog       | `changelog`                                                                                                                                                                                    | `/changelog/`                                                                                                                                                                                                                                                                                              |

The mock has 24 templates and all current h2/h3 fragment identities except
`release-1-8-0`: its history stops at v1.7.0. B2.7 must include v1.8.0 and every
canonical note. Preserve other authored anchors such as `after-installing`,
which is on a paragraph rather than a heading. Type metadata remains explicit:
Customization articles are guides; Troubleshooting has its own type, rather than
inferring type from directory names. Large copied mock content/search text must
not become another source of product facts.

### Composition and interaction ownership

Installed Docusaurus 3.10.2 provides `DocRoot` with `DocsSidebarProvider`,
`DocRoot/Layout`, `DocItem/Layout`, and `useDoc()` metadata/TOC. Keep those data
providers and the router. Replace only presentation seams that conflict with the
mock. The default layouts import CSS Modules and Infima grid classes, so simply
wrapping them would leave competing geometry. Do not copy those styles into the
website or create one giant replacement Layout component.

| Planned boundary                                              | Inputs and responsibility                                                                                        | State and lifecycle owner                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Docusaurus docs plugin + `sidebars.ts`                        | Routes, metadata, static rendering, sidebar order, neighbors, heading IDs/TOC; MDX is article source             | Framework data owner; no manual parallel registry                                                                |
| `theme/DocRoot/Layout` → DocsShell composition                | Header, sidebar/drawer, main slot, search surface; docs-only custom shell with thin integration into site Layout | Only shell-wide modal coordination; no article/search datasets in layout                                         |
| DocsHeader / DocsSearchTrigger / shared Brand and ThemeToggle | Approved header and responsive utilities; links and accessible names                                             | ThemeToggle calls Docusaurus colorMode; trigger requests search open; neither owns independent global state      |
| DocsSidebar / DocsSidebarGroup                                | Framework sidebar items, active route, accessible disclosures                                                    | Group owns collapse preference; parent derives active group, no duplicate current-page state                     |
| DocsMobileNavigation                                          | Same sidebar data, drawer/backdrop at 800px                                                                      | Open state, focus/inert/scroll lock, close/resize/route cleanup; coordinate with search at shell boundary        |
| `theme/DocItem/Layout` → article composition                  | Breadcrumbs, article type/header, MDX slot, outline, footer and paginator from `useDoc()`                        | Route-scoped composition; title/summary rendered once, document change resets transient interactions             |
| DocsBreadcrumbs / DocsArticleHeader / DocsArticleFooter       | Metadata, Copy page trigger, correct edit/issue links                                                            | Presentation and callbacks only; do not serialize article in a header component                                  |
| DocsTableOfContents                                           | Framework h2/h3 TOC plus rendered heading geometry                                                               | One active-section owner, reflow/scroll/hash handling with cleanup; no independently scraped content registry    |
| DocsArticleNavigation                                         | Framework previous/next metadata                                                                                 | Stateless native links; responsive card layout                                                                   |
| DocsSearchDialog + local index/matching helpers               | One generated MDX-derived index, bounded ranked view, details control, result links/status                       | Dialog owns query, selection, details and opener; build owns index, not layout or release timeline               |
| Article-copy owner + MDX CodeBlock mapping                    | Article ref, rendered code text, pure Markdown serialization                                                     | Shared page/code request generation and status lifecycle, disposed on route change; no site-wide clipboard store |
| MDX element mappings / DocsNotice                             | Semantic prose, lists, links, tables, notes, disclosures and code; Tailwind classes                              | Native disclosure state where applicable; shared Button/Input reused when semantics fit                          |
| DocsOverview                                                  | Authored overview introduction plus framework category/doc metadata                                              | Data-derived links/cards; no duplicate authored page registry                                                    |
| ReleaseTimeline                                               | Typed adapter over generated release-history JSON                                                                | Stateless rendering; root release-note parser/projection retains validation ownership                            |

Names describe responsibilities, not a requirement for one file per row. Keep
page/layout files thin, local state local, and context limited to cross-shell
search/modal coordination when needed. Shared components remain independent of
desktop source and docs-specific routing. Reuse existing Button/Input/Brand and
Lucide; generate another primitive only for a demonstrated requirement.

### Verification handoff

B2.1 inspected the full mock source/cascade/runtime, rendered all 24 article
templates, compared their IDs/routes/headings and content vocabulary with all
24 current pages, and measured 17 widths: 1440, 1241/1240, 1081/1080, 901/900,
801/800, 691/690, 601/600, 401/400, 390, and 320px. Desktop dark/light, mobile,
drawer, search, code hover, theme reload, search keyboard/empty/no-result states,
copy payloads, drawer dismissal and reduced-motion behavior were inspected.
This is reference inspection, not acceptance of a React port. Network fonts in
the reference and its missing accessibility behavior remain comparison limits.

The existing test contracts to retain and adapt are:

- `tests/documentation{Articles,Navigation,Outline,Shell,MobileDrawer}.test.ts`
  and browser `documentation-{articles,navigation,outline,shell}.pw.ts`: routes,
  metadata, native links/pagers, sidebar, stable fragments, focus, responsive
  reflow and outline ownership. Replace assertions for the explicit retired
  header/mobile-outline/indicator presentations with the decisions above.
- `tests/documentationSearch{Index,Announcements}.test.ts` and browser
  `documentation-search{,-interaction}.pw.ts`: corpus extraction, ranking,
  aliases, safe highlighting, names/status, stable details mode, keyboard,
  native result navigation, dismissal and focus.
- `tests/documentationCopy.test.ts` and browser `documentation-copy.pw.ts`:
  Markdown vocabulary/escaping, exact code, feedback, focus and async ordering.
- `tests/documentationChangelog{Data,Timeline}.test.ts`,
  `tests/releaseNotes.test.ts`, and browser `documentation-changelog.pw.ts`:
  canonical notes/projection, safe rendering, timeline links and static content.
- `tests/{coreWorkflow,libraryReader,utility,archiveRecovery,releasedBehavior}DocumentationCoverage.test.ts`
  and browser `documentation-{workflows,recovery,behavior}.pw.ts`: released
  product claims, recovery guidance and task navigation. Keep these factual
  checks when retargeting HTML selectors to MDX/rendered React output.

B2.2 builds only the shell with representative temporary content and a search
surface fixture. B2.3 adds responsive/theme/TOC/navigation/code interaction;
B2.4 verifies visual and accessible behavior before real content. B2.5 migrates
articles; B2.6 implements real search/overview/article-copy behavior; B2.7
integrates history/tooling; B2.8 preserves public resources, redirects, and the
temporary static homepage (remove the foundation root and disable preset pages
first); B2.9 completes CI classification/browser integration; B2.10 deploys and
retires legacy implementation. Existing routes/generators stay active until
their replacements pass. No parent merge, rebase, stack flattening, or early
cutover is a prerequisite for these phases.

## Documentation shell fixtures (B2.2)

`theme/DocsRoot` keeps the framework version/routes and layout provider, while
`theme/DocRoot/Layout` composes `DocsShell` inside `DocsSidebarProvider`.
`theme/DocItem/Layout` composes the article using `useDoc()`. These overrides
replace default CSS Module/Infima geometry without changing the root tooling page.
The existing DocItem still owns metadata and the document provider. Sidebar,
breadcrumbs, outline, search fixture links, and neighbors consume framework data;
there is no copied public registry or second route list.

Temporary routes are `/docs/`, `/docs/foundation`,
`/docs/fixtures/sample-guide`, and `/docs/fixtures/sample-reference` under the
project base URL. Three fixture MDX files join the retained foundation document;
none is a migrated public article. The sidebar deliberately has only fixture
groups. B2.5 replaces these fixtures with the real corpus after B2.4 approval.

The shell implements the measured header, flat sidebar, 700px article cap,
170px outline, editorial typography, breadcrumbs, type, footer, pager, and search
surface. `max-w-docs-article` is distinct from foundation `max-w-article`.
Named docs type/width roles and inclusive `docs-*` variants live centrally in
custom.css. Arbitrary grid tracks express the measured flexible columns;
viewport calculations express sticky heights and the dialog's measured inset,
width, and result height. These are layout formulas rather than new palette or
spacing systems. The disclosure's `[open]` selector uses the native details
attribute because the broader generated `:open` selector is incompatible with
the current production PostCSS selector transform. The GitHub SVG retains the
mock's brand glyph because current Lucide excludes brand icons.

Copy page remains a disabled visual fixture. B2.3 adds the theme toggle,
mobile drawer, active outline, heading permalinks, and code copying described
below. B2.6 owns real search and portable Markdown copying. The native search dialog
can be opened, dismissed, and followed to fixture routes, with basic native
focus containment/restoration. Its read-only field and links are a surface
fixture, not a search index or matching implementation. No search shortcut is
registered yet. B2.4 owns full visual/accessibility acceptance; the B2.2 browser
checks establish geometry, static readability, native routing and fixture states.

Run the foundation browser config for both the retained foundation checks and
`website-docs-shell.pw.ts`. Production checks include no-JavaScript article and
neighbor output; dev mode checks the React routes. B2.9 owns CI integration of
the completed documentation interaction suite. The legacy site, content,
generators, release owners, public resource paths, and deployment remain active
and unchanged in this phase.

## Documentation shell interactions (B2.3)

Docusaurus colorMode owns dark/light preference. A head script migrates an
explicit `archeion-docs-theme` value only when the framework's `theme` key is
absent, before its pre-body initialization. Legacy system/invalid values resolve
to dark. The old key is never written. Storage failures are nonfatal. The toggle
uses the framework hook, suppresses descendant palette transitions through a
Tailwind ancestor variant, and updates browser theme color from the surface
token. The framework's early script remains the initial theme owner.

DocsShell coordinates one modal at a time. Both surfaces use native dialogs for
focus containment and background inertness, and release document scroll locking
on close or unmount. The mobile drawer uses the same framework sidebar data,
with the measured `min(310px, viewport - 52px)` width and header offset. Escape,
close, a complete backdrop gesture, route changes, and crossing 800px dismiss
it. Dismissal restores the opener; navigation focuses the destination article or
fragment; desktop resize hands focus to the current sidebar link. Modified links
retain browser behavior. Search remains a fixture with no keyboard shortcut or
index until B2.6.

Native sidebar disclosures persist collapse per framework category label;
the current category opens on route entry and reload. The outline consumes
framework h2/h3 identities, samples heading geometry at the native fragment
clearance, and tracks scroll, reverse scroll, hash changes, article reflow,
font completion, and the short final section at the bottom. It owns exactly one
`aria-current="location"` link, with the approved accent border rather than a
moving indicator. Heading permalinks retain native IDs and independent names.
No inline mobile outline is introduced.

Code copying reads the rendered code text exactly. An article-scoped clipboard
owner keeps one polite status region and persistent, dismissible feedback;
its fixed feedback surface uses a viewport-minus-gutters maximum width so it
stays visible without moving the article or overflowing a narrow screen.
control names stay stable, failures can be retried, newer requests supersede
older completions, and navigation invalidates pending results. Copy controls
appear on hover or focus and remain visible for coarse pointers. B2.6 will add
portable Markdown page copying to this owner. No public article corpus has been
migrated. The dedicated browser config includes the interaction fixture suite;
B2.4 still owns the complete visual and accessibility checkpoint.

## Fixture visual and accessibility checkpoint (B2.4)

The dedicated browser config also runs `website-docs-accessibility.pw.ts`.
It checks both themes at 1440, 1241/1240, 1081/1080, 901/900, 801/800,
691/690, 601/600, 401/400, 390, and 320px, including actual header target
containment and overlap rather than relying on the document's scroll width.
The default desktop config excludes every `website-*.pw.ts` file; website
checks require their own Docusaurus server. B2.9 still owns CI integration.

The checkpoint compares the production shell and approved HTML in the same
Chromium engine with remote fonts blocked and the same bundled Inter
400/600/700 and Literata 400 available in both. Wait for layout frames and font
completion after resizing before comparing computed typography. Inter 650 in
the mock selects the available 700 face; matching labels, strong text, table
headers, and subheadings use `font-bold`. Active sidebar links retain 600.
Code, sidebar, and outline line heights have named docs typography roles.
Keep custom typography roles intact when composing classes: the merge helper
does not recognize every named `text-docs-*` size and can mistake it for a text
color. Sidebar links compose their fixed/conditional classes directly; browser
checks assert both active and inactive links at 14px/23.1px in desktop and drawer.
Reference and fixture article text differ deliberately; this checkpoint does
not establish real-corpus coverage or pixel identity between whole articles.

Header width caps, icon/mark dimensions, and internal gaps use named pixel
tokens to preserve the approved chrome geometry when root text is doubled.
The brand name is treated as part of that fixed identity; article and control
labels remain resizable. The Documentation label can wrap, article breadcrumbs
can shrink, and the Copy page fixture can wrap onto another line when enlarged
text leaves insufficient space. The normal narrow topline retains truncated
breadcrumbs beside the action. Search's full-screen dialog can scroll in short
viewports; its input can shrink without pushing Close search out of reach.
No new sizing observer or inline visual style is needed.
Modal scroll locking is composed through Docusaurus's `HtmlClassNameProvider`
at DocsShell. Imperative root classes can be replaced by deferred route metadata
updates; the provider keeps the lock and framework route classes under the same
owner and removes the lock when the shell closes or unmounts.

Light `content-subtle` intentionally differs from the mock/desktop muted-soft
color: `#697279` keeps small breadcrumbs and labels readable against the light
canvas. All other existing palette mappings remain unchanged. Browser tests
measure rendered foreground/background text pairs in both themes at 4.5:1 or
better, and inspect Chromium's actual font use for Inter and Literata. Forced
colors adds an underline to the current sidebar link. Coarse-pointer header
actions retain separate 44px targets even with doubled text.

Additional checks exercise skip navigation, native disclosures and visible
keyboard focus, local scrolling for long code/table values, doubled root text
at desktop/mobile widths and 480px viewport height, reduced motion, forced
colors, and touch. Existing interaction tests retain theme prepaint/persistence,
drawer inertness/Tab/Escape/resize/route cleanup, native links, outline reflow,
and exact/stale clipboard behavior. Screenshots and comparison measurements live
under `.plans/website-migration/b2.4/`; Playwright also writes checkpoint captures
to its ignored test output. Browser evidence does not establish Windows display
scaling or screen-reader speech. Real content, search/indexing, overview, page
copy, releases, resource relocation, and deployment remain in B2.5–B2.10.

## Public MDX corpus (B2.5)

The 24 public documents now live in `website/docs/`, one file per stable page
ID. Front matter owns each ID, article title, navigation label, description,
route suffix, and explicit article type. `sidebars.ts` owns the six groups and
their sequence; Docusaurus derives routes, breadcrumbs, active links, TOC and
neighbors. There is no website registry. Navigation labels can differ from
article titles, for example Installation / Install Archeion. The factual current
article titles and summaries are retained; the mock supplies the matching
navigation model and shell presentation.

Every old route suffix is retained under `/archeion/docs/`, including trailing
slashes. All authored h2/h3 IDs are explicit. `DocsAnchor` preserves nonheading
fragments, including `after-installing`, and registers them with the same
Docusaurus broken-link collector used by `DocsHeading`. Both retain native
fragment links and the shell's scroll clearance. Article links use the new
base-aware routes. Links to repository-only format contracts use GitHub source
URLs; public schema/example resources retain their existing absolute published
URLs until B2.8 preserves them in the new artifact. No resource bytes moved.

MDX contains semantic Markdown lists, tables, code fences and native keyboard
markup, plus the existing `DocsNotice` and fragment components. The seven
notice labels and advice are preserved, with note semantics. Code copying still
copies rendered text exactly, including the MDX compiler's final newline.
Edit actions resolve to each `website/docs/<id>.mdx`; Changelog deliberately
uses `release-notes/README.md`. Issue actions retain the repository issue tracker.

The overview currently preserves its factual introduction and compact article
links. B2.6 owns its approved cards and real search/page copying. Changelog is a
static MDX snapshot of the current published history, including v1.8.0; B2.7
owns replacing that snapshot with the canonical release projection and React
timeline. Do not edit the snapshot as a second release-note source.

All four temporary docs fixtures were removed after tracing their consumers.
Tooling links now open Installation; the temporary React homepage and its
component sample remain until B2.8. Shell, interaction and accessibility tests
now use Custom themes (real nested headings, four code examples and three
tables), with actual neighbors and groups. The dedicated browser config also
runs `website-docs-articles.pw.ts`: all 24 direct routes, metadata, active links,
TOCs/fragments, neighbors, edit/issue targets and production no-JavaScript output.
The complete B2.4 boundary, text scaling, contrast, fonts, local overflow and
focus assertions remain in place.

Root documentation source/factual contracts read MDX without importing website
runtime modules or needing a website install/build. Keep front matter values as
single-line JSON strings so these Node-only checks can read them without another
parser dependency. Five `legacyDocumentation*` suites retain the old generator
and runtime regression contracts while the old public site is active; they do
not supply website routing. The old JSON registry remains exclusively an input
to that active legacy site. Its generators, generated output, search/copy tests,
legacy browser tests and existing landing links remain untouched until their
replacement/cutover phases. Retire them only after tracing those consumers at
B2.7/B2.8/B2.10. B2.9 owns CI/browser integration; no deployment changed here.

## Local search, overview and portable copying (B2.6)

`plugins/search.ts` consumes the docs plugin's loaded metadata and resolved
sidebar sequence. It publishes one typed global-data payload for search and
overview cards. `plugins/searchContent.ts` parses MDX without compiling or
executing its imports/components. Search and overview do not import the release
timeline or a release projection. The two direct build dependencies, MDX and
GFM parsers, already existed in the workspace lockfile. `mdxParser.cjs` keeps
their native ESM imports outside the framework's Jiti 1 configuration loader;
its declaration preserves the parser's public type.

The index contains one introduction and each explicit h2/h3 section, with
exclusive bodies and stable fragment destinations. It includes semantic prose,
code, table cells, notice labels/advice and metadata-derived overview text;
imports, anchors, controls and hidden helpers are excluded. Headings retain
their required explicit IDs; fenced examples are never interpreted as headings.
For explicit search aliases, put an empty static
`<span data-search-aliases="first alias|second alias" />` in the introduction or
immediately after the relevant section heading. Aliases must be nonempty and
unique. No manually duplicated index or page registry is maintained.

Matching folds case and whitespace and accepts all query tokens within a field.
Title/navigation-title hits precede section-heading, alias, and body hits;
metadata group/summary matches join the page-body tier. Canonical page/section
order breaks ties before the first ten results are selected. Empty queries
browse pages only. Total and shown counts remain distinct. Each result shows
two lines: its title or section heading, then its page/category context. Full
titles remain in accessible names and native tooltips when visually truncated.
Descriptions and excerpts remain indexed without adding visible result rows.
Highlighting renders escaped React text and marks only.

DocsShell remains the exclusive modal/shortcut owner. Ctrl/Cmd+K opens search
or refocuses/selects its input when already open; it does not steal the mobile
drawer. The input retains focus while typing. Arrows focus native result links,
ArrowUp from the first result returns to the input, and Enter activates the
selected result. IME/modifier input stays native. Escape, close and complete
outside gestures dismiss with focus restoration. Native modified links preserve
their browser behavior. The existing dialog and route owners retain Tab
containment, inertness, scroll locking and destination focus.

Overview MDX keeps its factual introduction, notices, prose and explicit section
IDs. `DocsOverview` derives each group's destinations/order from the same
framework metadata. The original compact-link labels and factual summaries now
live beside each destination's existing front matter as `overview_title` and
`overview_description`, still single-line JSON strings. All 23 other articles
remain reachable, with Overview itself in the breadcrumb/sidebar. Cards match
the mock's three onboarding columns, two other columns, 9px gaps, 7px corners,
13px/12px padding and 76px minimum height; all collapse at the inclusive 600px
boundary. Named card typography preserves the measured 12.5px/11.5px roles.

Copy page extends the existing article-local `DocsClipboard` owner, keyed by
the document permalink. It serializes the rendered article ref through
`serializeArticle.ts`. Breadcrumb/type/action chrome and heading permalinks have
explicit copy exclusions; footer, neighbors, outline and shell are outside the
article boundary. Markdown retains headings, emphasis, nested/numbered lists
and starts/item values, tables, notices/quotes, disclosures, inline code,
fences/language/whitespace and escaped authored syntax. Relative links resolve
against the document URL to safe absolute HTTP(S)/mailto destinations;
malformed/unsafe links keep their readable label. Image alternative text and
keyboard labels remain readable. No HTML-string or innerText export is used.

Code copy still writes rendered code text exactly. Both actions share one
stable polite status, success/error feedback that dismisses six seconds after
the latest completion, retry and manual dismissal,
focus retention/restoration, newest-request ownership and route disposal.
Copy controls are hidden before hydration and without JavaScript. Their names
never change to temporary success/error labels. CodeBlock retains its language
class so portable fences keep their language without modifying code bytes.

Root search/copy source tests remain Node-only. Their original legacy runtime
tests are preserved as `legacyDocumentation{SearchIndex,SearchAnnouncements,Copy}`
while the old public site is active. Website parser/ranking tests run in the
website package; production/development Playwright covers real MDX search,
overview and clipboard behavior, including all 24 article exports and the
supported serializer vocabulary. Legacy browser tests remain active for their
existing site. B2.7 still owns release projection/tooling; B2.8 resources and
compatibility; B2.9 CI integration; B2.10 final legacy removal/deployment.

## Canonical release history and root tooling (B2.7)

`release-notes/vX.Y.Z.md` remains the sole user-facing history source;
`CHANGELOG.md` remains technical. The unchanged root release parser still owns
metadata, date/version ordering, Changes extraction and exact metadata-free
publication/updater bodies. `docs:sync` atomically writes only
`website/src/generated/release-history.json` using that API. SchemaVersion 1
entries retain version, date, repository-relative sourcePath and LF-normalized
changes. There are no timestamps or checkout paths.

`scripts/release-history-markdown.mjs` is a small shared pure vocabulary for
Node validation and typed React rendering: flat dash/star bullets, indented
prose continuations, bold, single-backtick code and absolute HTTP(S) links.
Unsupported blocks, malformed inline syntax and unsafe links fail before any
write. React renders text nodes, strong/code and native links; no HTML injection.
The declaration beside the module keeps website consumers typed without adding
a dependency or coupling root commands to the website install.

`src/data/releaseHistory.ts` adapts the projection once outside React render.
`ReleaseTimeline` composes the measured rail/dots, 116px metadata column, 22px
gap and native headings/time/change lists/GitHub Release links. At inclusive
600px entries become one column with 8px gap and 25px bottom spacing. New named
release type/column tokens are centralized; metadata line heights retain the
measured 18.3px/19.8px roles and change bullets keep their 9px margins. It registers stable release anchors
with the existing framework collector. Changelog MDX only composes the component
and exports its framework TOC from the same typed headings; no authored history
snapshot remains. Static production HTML retains every release without JS.

`plugins/releaseSearch.ts` adapts canonical sections/fragments to the existing
search entry contract without executing the timeline component. The MDX parser
still does not evaluate imports/components. Framework metadata still owns the
Changelog page and introduction, sequence, routing and sidebar. Overview remains
independent; no additional route, clipboard or modal owner was added.

`docs:check` is read-only: Node-only source metadata/identity/sidebar/anchor/link
contracts plus canonical projection freshness. Website build separately owns
MDX compilation and framework routes/broken links. Root CI already runs docs:check
and rejects stale history. B2.9 owns classifier/browser integration. Release prep
uses pnpm 10.33.0: install frozen, version:set, finalize technical changelog and
canonical note, docs:sync, docs:check, release:check --tag vX.Y.Z, then verify.

Legacy HTML/registry/runtime/generated assets remain active until cutover.
The old changelog projection is preserved as
`scripts/legacy-sync-documentation-changelog.mjs`; the retained HTML timeline
script consumes that legacy owner only. Old navigation/search scripts and their
legacy tests likewise remain available, with explicit maintenance commands in
`docs/DOCUMENTATION.md`. Their root package aliases were retired; docs:sync/check
never invoke them. B2.10 must trace remaining consumers before removal. No
release automation, public-resource, compatibility or deployment change occurs
in B2.7. Root maintainer guides remain in docs/.

## Static landing, public resources and compatibility (B2.8)

B2.8 temporarily served the original landing from `static/index.html`, with only
its documentation destination changed. B3.2 replaces that temporary homepage with
`src/pages/index.tsx` and landing section components. Preset pages are enabled;
the static homepage plugin, copied index, and unused copied CSS/JS are removed.
Docusaurus owns the single root route and its sitemap entry. Shared Button/Brand
and the existing semantic token system remain the foundation.

The original `docs/index.html`, CSS/JS and their legacy tests remain active until
the separately authorized post-merge live publisher cutover. Permanent resources
and compatibility redirects retain their exact URLs and bytes. B3.3 extracts the
approved visible screenshot and completes measured visual/responsive styling;
B3.4 owns integrated parity and landing test migration.

The root README embeds `website/static/assets/archeion-preview.png` and links
to the new Changelog and Custom themes articles. Maintainer guide links remain
repository links. MDX article links already use `/archeion/docs/`; schema and
example URLs retain their original public destinations. Theme authoring source
links and physical-copy/font tests now include the static owner.

The full current `docs/` audit found four public resources beyond the plan's
22-file snapshot: `dictionaries/catalog-v1.json` and its three tracked versioned
packages. Their existing catalog URLs, sizes and SHA-256 values are authoritative.
They are copied unchanged to `static/dictionaries/`; its maintainer README is
excluded. No dictionary path or package was invented. The original 22-resource
baseline stays immutable. GitHub Release installers, signatures, checksums and
`latest.json` remain on GitHub Releases; none is copied into the site.

`static/documentation/` contains 24 compatibility HTML pages: Overview plus the
23 other registered articles. Their destinations preserve the route suffix under
`/archeion/docs/`. One small deferred script updates the visible fallback link and
uses `location.replace` with the original query and fragment. Without JavaScript,
the fallback remains visible and navigable. There is no timed meta refresh to
race fragment restoration. These frozen old paths are compatibility output,
not a second website route registry. New docs routes remain framework-owned.

The audit classifies every current `docs/` file as a public resource, legacy site
implementation/generated output, maintainer guide, or temporary file. Only
explicit static resources, landing runtime and compatibility pages enter
`static/`; no blanket copy of `docs/` occurs. Maintainer Markdown, registry,
legacy documentation runtime/generated data, project files, plans and test output
are excluded. Detailed per-file/reference and immutable-byte evidence lives in
`.plans/website-migration/b2.8/`. Desktop About/update links intentionally keep
old URLs to exercise compatibility; legacy tests/generators and historical
material retain their old paths until B2.10 traces and retires them.

All old site sources/assets remain under `docs/` until the B2.10 cutover. Before
that boundary, an explicitly authorized live-site resource update must keep the
static copy byte-identical; `websiteStatic.test.ts` checks those pairs, and the
browser suite checks every served static file. Dictionary publication still owns
the original catalog/package paths until that boundary; no publisher change is
part of B2.8. B2.9 owns CI/browser-lane integration; B2.10 owns deployment,
legacy removal and final artifact validation. B3 alone replaces the static landing.

## Optimized CI and production browser validation (B2.9)

The existing `docs-only` PR mode now includes additions/modifications to known
website source, plugins, tests, MDX, static resource formats and named framework
configuration files. It still requires frontend static checks, root tests, both
desktop browser shards, the Vite app build and the dedicated website job.
Only the five existing platform jobs may skip, under the unchanged exact job-set
guard. Pushes always run full validation.

Root manifests, workspace/lockfile, `website/package.json`, shared scripts,
release notes, workflows, unknown paths/formats, deletions, renames, copies,
type changes and malformed/duplicate path records select full validation. The
classifier uses exact event base/head revisions, including divergent-base
changes. The migration branches themselves therefore select full validation.
Known root maintainer Markdown remains eligible under the existing policy.

Browser shard 1 explicitly installs the website package in addition to its
existing app install, builds Docusaurus, then runs the complete dedicated
production docs/static/compatibility suite. Shard 2 keeps its app-only install.
The website build job retains its independent website-only frozen install,
unit tests, typecheck and MDX/framework-link/build validation. Root docs:check
remains Node-only. No new job or gate owner is needed.

Website browser failures have named steps and a separate
`website-browser-contract-failure` artifact containing
`test-results/website-foundation/` and `playwright-report/website/`. CI keeps one
diagnostic retry and fails on retry recovery; screenshots and traces retain
failure evidence. The dedicated config serves the production artifact by default;
CI explicitly sets `ARCHEION_WEBSITE_MODE=production`. Local development mode
remains available, and dev/build/browser modes must run sequentially.

No deployment, legacy retirement or React homepage work belongs to this phase.

## Production deployment preparation (B2.10)

`.github/workflows/website-deploy.yml` builds only the website package on main
pushes or a manual main dispatch. Existing CI validates pull requests, including
the dedicated production browser suite; PRs cannot deploy. Actions are pinned
to full SHAs. The build job has only contents-read permission and uploads only
`website/build/` after source/history checks, website tests, typecheck, build and
the Node-only artifact check. The separate deploy job has pages-write and
id-token-write, depends on that build, and uses the `github-pages` environment.
Production deployments serialize without cancelling a deployment in progress.
No release workflow, signing, updater, parser or publication-body owner changes.

Project-site canonical URLs use `https://tommymoonn.github.io/archeion/`, with
explicit trailing slashes. Docusaurus generates the sitemap; its callback adds
the temporary static homepage, which is absent from framework routes. The sitemap
contains the homepage and 24 docs only. Robots points to that production sitemap.
Docs retain individual titles/descriptions and receive absolute social image
URLs, the favicon, Apple icon and theme color. The static homepage retains its
exact existing SEO/social metadata and font preloads.

The focused NotFound override reuses Brand and semantic Tailwind tokens with
native Home/Documentation links. Production browser tests now serve the actual
artifact through `tests/browser/serve-website-build.mjs`, a local filesystem
host with custom 404 status/output, directory redirects and no SPA fallback.
They exercise unknown nested paths without intercepted responses, including
no-JavaScript output, direct routes, reloads and network failures. This proves
the artifact's local hosting contract; live GitHub Pages behavior remains a
separate post-merge check. `pnpm --filter @archeion/website serve` remains useful
for previews but normalizes missing URLs differently.

The user explicitly deferred live cutover and destructive legacy retirement
until after merge. Live Pages was verified as `main:/docs` with `build_type:
legacy`; it has not been changed. Original HTML, registry, runtime, generators,
their tests and duplicate public resources remain active for that publisher.
Dictionary publication still targets `docs/dictionaries/` for the same reason.
Do not describe this preparation PR as a completed production deployment.
The ordered [cutover and retirement procedure](../docs/DOCUMENTATION.md#production-cutover-and-legacy-retirement)
records prerequisites, rollback and every remaining consumer family. The
reference/file audit and verification evidence live under
`.plans/website-migration/b2.10/`. B3 retains its own homepage scope; it must
remove the temporary static-homepage plugin/index and the sitemap's manual root
entry when framework pages own the homepage.

## Landing migration map (B3.1)

This is the pre-implementation contract for B3.2–B3.4, inspected on
`feat/landing-page` at `caade9e038979fa41f895e8444a80df5fd6a4a59` with a clean tree.
B3.1 changes documentation only. It does not introduce React landing components,
extract production assets, remove the static homepage, or alter public behavior.
The authoritative plan is `.plans/archeion-website-react-migration-plan.md`
(SHA-256 `55445FDA898C0F642AA5003D9B32513E2FC9F6E05DFA6BCB5068AF4152FC5393`).
The complete approved reference is `.project/experiments/archeion-landing-page.html`
(SHA-256 `FEB4457958C46F0865E168C0BC4E7AE80D3EE5CFE9520D128BC534BA4A0FC1C7`).
Its final CSS cascade, body, embedded images and both interaction scripts were
inspected. Source-derived dimensions below are implementation targets, not a
claim of rendered screenshot parity. B3.4 owns that comparison.

`docs/index.html`, `docs/css/styles.css` and `docs/js/main.js` remain the legacy
publisher's active sources pending the separately documented live cutover.
`website/static/index.html` differs only by its `/archeion/docs/` link; the copied
CSS and JavaScript have identical bytes to those sources. Retained docs articles
and current MDX are factual references; the mock owns presentation, not new product
capabilities. `docs/DESIGN.md` explicitly excludes website layout and typography.

### Section and component ownership

The following are responsibility boundaries, not a requirement for one file per
row. `src/pages/index.tsx` stays a thin composition and metadata layer. Components
belong under `src/components/landing/`; typed feature copy and destinations can
live beside their owner. Do not import desktop application runtime or create a
second token, icon, button, theme-preference or routing system.

| Order / mock region  | Proposed owner                                 | Content and responsibility                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skip link, header    | `LandingHeader`, focused `MobileNavigation`    | First focusable skip link to `#main`; home to `#top`; centered Library / Reading / Your files links; quiet Download and GitHub links. Mobile menu owns its open state and focus lifecycle.                                 |
| `#top` centered hero | `HeroSection`, local decorative effects        | One h1: “The EPUB library for Windows.” Lead: “Open an existing folder of EPUBs to browse, search, organize, and read your books.” Stacked Windows download and View on GitHub actions, six noninteractive floating icons. |
| Application preview  | `ProductPreview`                               | One informative Library screenshot, eager/high-priority decoding with intrinsic dimensions, restrained pointer tilt. This is an image, not an interactive app or a link.                                                   |
| `#library`           | `LibrarySection`, shared landing `FeatureCard` | “Find and manage books in your collection.” Three cards: Folders and series; Search and filters; Batch actions. Preserve the mock's concrete search/filter fields and move/details/covers/annotation-export claims.        |
| `#reading`           | `ReaderSection`, local word-highlight effect   | “Read and annotate your books.” Five words progressively brighten; final “books.” uses accent. Three cards: Reader settings; Bookmarks and highlights; Offline dictionaries. No embedded Reader controls.                  |
| `#files`             | `ArchiveSection`                               | “Your EPUB files stay in their folders.” Two-column explanation and static accessible archive tree. A real `Series/` folder is an example filesystem folder, not the virtual Series view.                                  |
| `#download`          | `DownloadSection`                              | “Download Archeion for Windows.” Existing-folder lead, Windows installer action, View all releases text link.                                                                                                              |
| Footer               | `LandingFooter`                                | Compact mark / © 2026 Khoa Luong identity, Documentation / Source code / Releases links; mark returns to `#top`.                                                                                                           |

Reuse `components/ui/button.tsx` with `asChild` for download anchors and existing
`cn`, semantic tokens and named `lucide-react` imports. Extend the existing Button
only for a concrete missing variant/size; do not build a parallel button system.
Use native anchors for text links. Reuse Brand's finalized artwork and font-role
conventions; its current Literata wordmark styling needs the landing's display
serif role. Footer is a mark only, not a duplicate full wordmark component.
Feature cards are articles, never tab stops or fake buttons. Decorative SVGs are
hidden from assistive technology and cannot intercept pointers.

The mock's unused split hero, fact strip, feature rows, archive disclosure/popover,
large footer, earlier horizontal CTAs, and intermediate tree palettes are
superseded by later CSS/body markup. Do not port dead selectors or controls.

### Final visual and responsive contract

Values are CSS pixels at default browser text size. Use existing semantic tokens
and standard utilities first. Add named landing tokens/variants centrally in
`src/css/custom.css` only for measured differences; preserve docs tokens and
breakpoints. Do not copy mock CSS selectors, CDN configuration, raw JSX colors or
inline visual style objects. The mock uses inclusive max-width boundaries, which
must be tested on both sides rather than rounded to a nearby default breakpoint.

| Region            | Final desktop target                                                                                                                                                                      | Responsive target / final overrides                                                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main wrapper      | `min(1280px, 100% - 64px)`                                                                                                                                                                | At ≤900: `min(760px, 100% - 48px)` for normal content; ≤640: `100% - 40px`; ≤360: `100% - 32px`. Preview/footer have their own widths below.                                                                                                                                                         |
| Header            | Sticky, 68px; three grid tracks `1fr auto 1fr`, 24px gap; brand left, nav centered, actions right; nav gap 30px                                                                           | At ≤1020: two tracks, desktop nav/actions hidden, Menu visible. At ≤640: 64px. Open panel fills from header to viewport bottom. Mock's inherited 72px menu inset must adapt to actual 68px header; 64px on mobile.                                                                                   |
| Hero              | Centered, padding 76px top / 48px bottom; copy max 920px; h1 max 18ch, 72px / 1.02, normal display serif, tracking −.035em                                                                | At ≤640: padding 60px / 32px; h1 max 14ch, `clamp(42px, 10vw, 58px)` / 1.04. Earlier 39px tiny rule is overridden.                                                                                                                                                                                   |
| Hero lead/actions | Lead max 62ch, 17px / 1.65, margins 18px auto 24px. Actions vertical, 12px gap; primary and secondary hit areas share centered `min(224px, 100vw - 40px)` width                           | At ≤640: lead max 42ch, 16px. Primary min-height 48px, 8px corners; secondary min-height 40px, muted 14px semibold text with 12px diagonal arrow. No secondary outlined button.                                                                                                                      |
| Preview           | Direct image, `min(1280px, 100% - 64px)`, 12px corners, subtle outline/shadow; no extra frame                                                                                             | At ≤900: `min(820px, 100% - 48px)`; ≤640: `100% - 32px`, 10px corners. Bottom spacing 64px / 44px mobile. Preserve full image, no crop.                                                                                                                                                              |
| Sections/cards    | Section padding 112px; first Library section top 88px; heading margin-bottom 44px; max heading width 17ch. Three equal cards with 12px gaps, min-height 196px, padding 26px, corners 10px | At ≤900: sections 88px, two columns. At ≤640: sections 72px, Library top 56px, heading margin 32px, one column, card padding 22px and no fixed minimum height.                                                                                                                                       |
| Type/icons        | Section h2 `clamp(36px, 4.1vw, 56px)` / 1.08; normal display serif; card h3 18px / 1.3, weight 600, tracking −.015em; body 15px / 1.65; icon slot 38px, glyph 19px                        | At ≤640: h2 `clamp(34px, 9vw, 44px)`. Reading statement retains its own 1.12 line height and −.03em tracking; archive h2 1.06. Their final sizes share the section scale.                                                                                                                            |
| Archive           | Padding 104px; columns .9fr / 1.1fr, gap `clamp(44px, 6vw, 84px)`; explanation max 520px; heading max 16ch, 20px bottom margin. Tree padding 20px 22px, corners 10px, sunken surface      | At ≤1020: one column, 34px gap. At ≤640: padding 72px; tree padding 18px 14px. Tree text 13px / 1.5 mono, 11px mobile, locally scrollable if needed. No disclosure/popover.                                                                                                                          |
| Download          | Centered h2 72px, final padding 64px top / 88px bottom; paragraph max 58ch, 16px / 1.65, margins 18px auto 28px; same stacked actions as hero                                             | At ≤640: h2 `clamp(40px, 9vw, 52px)`, padding 48px / 64px. Earlier 120px padding is superseded.                                                                                                                                                                                                      |
| Footer            | Flex row, min-height 68px, wrapper `min(1280px, 100% - 64px)`; 22px mark, 12px copyright; links 13px with 22px gap                                                                        | At ≤900: wrapper `min(820px, 100% - 48px)`; ≤640: width `100% - 32px`, min-height 64px plus footer 10px vertical padding, nowrap identity and row links, 20px mark, 10.5px copyright / 11px links / 10px gap. At narrow/zoom widths preserve labels and allow reflow if exact nowrap would overflow. |
| Dividers          | Header 4%, sections/CTA 4%, footer 7%, preview 8% white-derived borders in the mock                                                                                                       | Define any needed semantic border roles centrally; use theme tokens, not per-component opacity/color literals.                                                                                                                                                                                       |

Required boundary samples: 359/360/361, 639/640/641, 899/900/901,
1019/1020/1021 and 1099/1100/1101, plus representative 320, 390, 768,
1280 and 1440 widths. The 1100 boundary hides hero decorations only.
Use the same Chromium engine, system serif availability and viewport for mock
and production captures. Load the reference with its intended Inter available;
record font fallback rather than treating it as a matching font. Source inspection
alone cannot prove clipping, contrast, zoom, focus visibility or screenshot parity.

### Public behavior and content migration matrix

Preserve means retain the public contract; adapt means retain its purpose through
the approved design; retire means deliberately remove that landing behavior,
with the replacement and test disposition specified. Retirement applies to the
new homepage only. It never removes desktop application functionality or coverage
for the still-published legacy page.

| Existing public behavior / source                                                                                                     | Decision                           | Replacement / reason / verification                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skip to `#main-content`, home `#top`                                                                                                  | Adapt                              | Skip to `#main`, retain `#top`. One main/h1; test keyboard destination focus and no-JS anchors.                                                                                                                                                                                                                                                                                                                                                                                    |
| Library / Reader / Local-first / Get Started navigation                                                                               | Adapt                              | Mock's Library `#library`, Reading `#reading`, Your files `#files`; Download is a direct installer link. Preserve old inbound `#reader`, `#local-first`, `#get-started`, and `#main-content` as unobtrusive aliases to new destinations. No second section/navigation model.                                                                                                                                                                                                       |
| Mobile menu at ≤900, toggle icon/expanded label, closed inert links                                                                   | Adapt                              | Approved Menu summary/full-height panel at ≤1020. Native details is suitable; expose real open state, hide closed links from Tab, keep a usable script-free menu. Do not silently retain the old 900px switch.                                                                                                                                                                                                                                                                     |
| First-link focus on open; Escape/outside/toggle dismissal; chosen-section focus; breakpoint cleanup                                   | Preserve/adapt                     | Keep the legacy keyboard contract with the approved menu: focus first destination on open, return to summary on Escape/outside/explicit close; same-page activation focuses destination, not opener. Close/reset on desktop transition; preserve native modified/external link behavior. Full-height overlay must prevent background focus/scroll while open and clean up on close/unmount. Mock supplies link-close and Escape; fill its outside/focus gaps from legacy behavior. |
| Active section tracking, `aria-current`, reflow/resize/font metrics                                                                   | Preserve/adapt                     | Track only the three approved section links, with no selected link outside those sections. Keep current-section semantics and restrained visual state. Recalculate after content/font/viewport changes; no polling or stale route listeners.                                                                                                                                                                                                                                       |
| Scrolled header after 12px                                                                                                            | Retire visual state                | Mock header is a constant opaque sticky bar; preserve sticky behavior and offsets, drop the old shadow/background state and its scroll work.                                                                                                                                                                                                                                                                                                                                       |
| Smooth anchors/header clearance                                                                                                       | Adapt                              | Mock scroll-padding 88px desktop / 72px ≤640; `#files` has −24px scroll-margin. Verify actual heading clearance with 68/64px header, use measured correction if the negative margin clips the heading. Keep direct fragments and reduced-motion instant scrolling.                                                                                                                                                                                                                 |
| Generic reveal observer (.14 threshold, −7% margin), H04 Library→cover→Reader hero animation                                          | Retire/adapt                       | Replace H04 illustration with the approved screenshot and hero rise/settle. Generic hidden-on-scroll reveals are absent from the mock; retain complete static content. Reading word effect replaces the section reveal.                                                                                                                                                                                                                                                            |
| Library destinations: Library, Series, Favorites, Folders; folder sidebar/card selection                                              | Retire demo controls               | Final mock has a noninteractive screenshot and Folders and series card. No fake clickable screenshot regions. Preserve factual view/folder distinction in claims/docs and test screenshot semantics rather than clicking raster controls.                                                                                                                                                                                                                                          |
| Library search (title/author, series/folder context), in-progress filter/disabled state, title/recent sort                            | Retire demo controls               | Static image plus Search and filters card describes released capabilities. No client demo state remains for query/filter/sort. Preserve claim accuracy and readable preview alternative text.                                                                                                                                                                                                                                                                                      |
| Library selected states, changing title/kicker/placeholders, singular/plural result counts, empty results and 160ms surface animation | Retire demo runtime                | These are outputs of removed controls; the screenshot is not a live result count/status. Test intrinsic image geometry, no pseudo-controls/live regions and responsive presentation instead.                                                                                                                                                                                                                                                                                       |
| Reader four sample pages, previous/next bounds, chapter/count/progress, 140ms guarded transitions                                     | Retire demo controls               | Approved Reading section is three static feature cards. Keep reading/progress capability factual in docs; no landing page-turn model or synthetic progress.                                                                                                                                                                                                                                                                                                                        |
| Reader paged/continuous mode, dark/sepia/light radios, arrows/Home/End roving selection, font-size slider/output                      | Retire demo controls; adapt claims | Reader settings card describes paged/continuous reading, typeface, line spacing, page width and colors. Test released copy and no phantom keyboard controls. The website theme remains separate from Reader settings.                                                                                                                                                                                                                                                              |
| Reader bookmark toggle, stable accessible identity/pressed state, page-specific bookmarks                                             | Retire demo controls; adapt claim  | Bookmarks and highlights card preserves saved-position capability; no landing bookmark store or fake state.                                                                                                                                                                                                                                                                                                                                                                        |
| Passage click/Enter/Space, palette positioning, four highlight colors and remove, selected-color focus                                | Retire demo controls; adapt claim  | Preserve four-color highlighting claim in the card. No passage buttons or palette are present in the approved markup.                                                                                                                                                                                                                                                                                                                                                              |
| Notes: create/edit, trimmed content, 420ms saving feedback, delete note keeping highlight, return to list                             | Retire demo controls; adapt claim  | Keep “add notes” copy; no demo notes, timers or persistence implication.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Annotation list/group/count/empty state, all/bookmark/highlight filters, jump/focus pulse                                             | Retire demo controls               | No annotation panel in the final mock. Keep annotation export claim in Batch actions, not an invented export control.                                                                                                                                                                                                                                                                                                                                                              |
| Passage accessible descriptions, polite annotation/note statuses, palette outside dismissal, nested Escape and focus restoration      | Retire demo-specific lifecycle     | Remove only with its controls. Keep generic focus/keyboard quality on actual navigation/actions. Preserve legacy tests while the legacy publisher still exposes those controls.                                                                                                                                                                                                                                                                                                    |
| Archive `.archeion/` ownership and normal files                                                                                       | Adapt                              | Static tree shows EPUBs, real Series folder, annotations/library/progress/scanner-cache JSON, covers and backups (annotations, epub-writeback, library, progress, scanner-cache). No Favorites/Filters virtual folders. Accessible textual equivalent; local overflow only.                                                                                                                                                                                                        |
| Separate application data card, No account/cloud sync/telemetry badges, Quick Actions and utility-window feature index                | Retire landing presentation        | Approved mock narrows this section to archive ownership. Keep factual guidance in docs; never relocate installed dictionaries/preferences/themes into `.archeion/` or imply encryption/security guarantees. Metadata retains existing local-first claim.                                                                                                                                                                                                                           |
| Installer CTA and documentation route                                                                                                 | Preserve/adapt                     | Same latest Windows installer URL in header/menu/hero/closing CTA; footer Documentation goes to `/archeion/docs/` (correct mock's outdated root link). Keep a visible docs entry despite the new secondary CTA choices.                                                                                                                                                                                                                                                            |
| Explore library hero secondary / closing docs button / developer disclosure with setup commands                                       | Adapt/retire                       | Mock uses View on GitHub and View all releases text links. Source setup disclosure retires from homepage; repository development guide and contributor workflow remain accessible through Source code.                                                                                                                                                                                                                                                                             |
| Footer GitHub link                                                                                                                    | Adapt                              | Source code and Releases retain destinations; add approved copyright/back-to-top and correct Documentation. Preserve safe new-tab rel values and native anchor behavior.                                                                                                                                                                                                                                                                                                           |
| Local fonts, intrinsic cover dimensions, no external dependencies                                                                     | Preserve/adapt                     | Local Inter Variable and shared font-ready bootstrap; full screenshot replaces synthetic covers. No Google Fonts/Tailwind CDN from mock, no font swapping or hidden SSR copy-control regression. Public font/cover URLs stay intact.                                                                                                                                                                                                                                               |

B3.1 item 6 permits deliberate mock-driven retirement. B3.4's instruction to keep
Library/Reader interaction tests therefore means retaining coverage for the still
active legacy publisher and adapting the new-homepage suite to the explicitly
approved static representation; it does not justify deleting tests or reintroducing
an interactive Reader absent from the approved design. Record every retired test
scenario against the rows above when migrating the suite.

### Approved hover, focus, pointer and motion behavior

- Native links/buttons/summary have visible 2px semantic focus outlines with
  offsets. Header section links gain a one-pixel accent underline on hover and
  keyboard focus. Quiet header/footer/text actions brighten over 340ms; secondary
  diagonal arrows move 2px right/up. Footer mark opacity changes .72 → 1.
- Primary downloads use accent fill/dark text, min-height 48px, subtle inset and
  outer shadow, 2px hover lift and .985 pressed scale. The mouse magnet moves at
  most ±2.5px horizontally and ±2px vertically, with a 170px pointer highlight.
  Keep the clickable area stable and the action a native installer anchor.
- Cards lift 4px, icon 2px, strengthen border/surface/shadow, and show a 300px
  cursor highlight on fine hover; decorative cards remain noninteractive.
- Preview uses perspective 1600px, mouse tilt ±.35deg on each axis, −2px lift and
  stronger shadow, resetting on leave. The page spotlight is a fixed 460px radial
  glow, 10% accent, screen blend, pointer-events none, hidden on blur/leave.
- Six hero glyphs (book, bookmark, page, folder, archive, search) are 40px with
  1.5 strokes; base opacity .34, active .5. They float on 7–8.5-second cycles.
  Pointer parallax uses normalized x/y × −18/−14 × per-icon depth
  (1.1, −.85, .7, −1.05, .9, −.75). Hide hero effects at ≤1100 or coarse/no-hover.
- Hero copy entry is a 650ms rise from 12px / .88 opacity. The earlier 850ms
  media-settle rule targets absent hero-art/preview-frame descendants, so it is
  dormant in the final direct-image markup; do not invent a preview entrance.
  Preserve complete readable SSR/no-JS base states.
- Reading words brighten by scroll progress between 84% and 42% viewport height,
  including statement height, rounded to the five-word count; all activate at
  page end. No-JS/reduced-motion shows full text with final word accented.
- Enable pointer decoration only for mouse/fine-hover and no reduced motion.
  Reduced motion removes floats/parallax/tilt/magnet, spotlight/card glow,
  transforms and animated scrolling; keep static copy and actions. Respond to
  preference changes and reset effects, beyond the mock's initial-only check.
- React owns interaction state and listener cleanup. Keep animation-frame work
  bounded and cancel it on unmount/disable; no repeated polling. For continuous
  decorative coordinates, use SVG presentation attributes and/or browser animation
  effects on scoped refs; do not port `style.setProperty`, `classList`, global
  template mutation or inline visual style objects. Implement static Tailwind
  states first; verify effect composition does not override focus/pressed states.

### Asset, typography and metadata decisions

Embedded data URIs were decoded for inspection only into `.scratch/landing-b31/`.
No production assets were written in B3.1. The mock contains three unique PNGs:

| Purpose                    | Verified bytes / identity                                                                                 | Production decision                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OG image                   | 915148 bytes, 1544×1012, SHA-256 `b92299461f51717bd4052d217b61b08051ae66b8aa888557dbc0e0614221c321`       | Identical to `static/assets/archeion-preview.png`; retain this public social image and URL, not the new visible screenshot.                                                                                  |
| Favicon/header/footer mark | 44272 bytes, 500×500, SHA-256 `89832875ec9f7ce1fe0ef821fef0f6c8e484450ee8c6b058879170ae94e6902d`          | Identical to `src/assets/brand/archeion-logo-dark.png`; reuse finalized artwork. Keep public icon URLs/bytes.                                                                                                |
| Visible Library screenshot | 893603 bytes, actual 1480×906, SHA-256 `a7f67d1464bd8412c148a7955fdd3071d940ca429530a0ea88662705ff021883` | B3.3 extracts a named static asset such as `assets/images/landing-library.png`. Preserve bytes/full image; correct mock's inaccurate 1544 width attribute to intrinsic 1480×906 to avoid aspect-ratio shift. |

The screenshot was visually inspected: actual Windows Library chrome, 14 books,
folders, search/filter/sort and collection controls. Preserve its descriptive alt,
not a claim that its raster controls work. Finalized brand source bytes already
exist in the website; no regeneration/rebranding or application asset changes.

Use `font-sans` (local Inter Variable) for UI/copy and `font-display` for the
mock's Iowan/Palatino/Georgia headings and brand text. Use existing `font-mono`
for the archive tree; the established system fallback is intentional when Fira
Code is unavailable. The mock's Google Inter/Fira requests and local-only Inter
face stubs are reference scaffolding, not a production font-loading contract.
Keep the prerequisite's embedded critical fonts and independent font-ready reveal.
Do not globally change docs typography. The landing is the mock's dark design;
implement a scoped centralized dark token boundary without overwriting the user's
persisted docs light/dark preference, and verify docs-light → landing → docs-light.
Do not expose app theme packages as website themes.

| Head contract from existing landing     | B3.2 migration decision                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                                   | Preserve `Archeion - Local-first EPUB Library and Reader` exactly; mock h1 may differ. Avoid Docusaurus appending another site title.                                                                                                                                                                                                                                                   |
| Description / OG / Twitter descriptions | Preserve `Archeion is a local-first Windows desktop app for organizing and reading EPUB libraries. Keep your books as normal files, with no account, cloud service, or telemetry.`                                                                                                                                                                                                      |
| Canonical / `og:url`                    | `https://tommymoonn.github.io/archeion/`, exactly once, absolute production URL.                                                                                                                                                                                                                                                                                                        |
| OG type/site/title                      | `website`, `Archeion`, same preserved page title; include matching Twitter title and `summary_large_image` card.                                                                                                                                                                                                                                                                        |
| OG/Twitter image                        | `https://tommymoonn.github.io/archeion/assets/archeion-preview.png`; OG dimensions 1544×1012. Never use data URIs or the 1480×906 visible image here.                                                                                                                                                                                                                                   |
| Favicon / Apple touch icon              | Preserve existing landing `assets/images/archeion-icon.png` destination, base-aware absolute production URLs for landing head output; reconcile global Apple head tag to prevent duplicates without changing docs artwork.                                                                                                                                                              |
| Theme color                             | Adapt legacy `#171717` to approved/foundation dark canvas `#0b0b0c`; single tag. This is intentional presentation metadata adaptation.                                                                                                                                                                                                                                                  |
| Font preloads                           | Preserve local font availability and migrate critical preload intent to the actually consumed local/embedded fonts. Existing preloads name Inter regular/semibold/bold and Literata regular under `assets/fonts/`; keep those public files byte-identical, avoid duplicate/unused requests when Inter Variable is embedded. Check generated head and network, not source strings alone. |

Installer destination everywhere:
`https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe`.
Source destination: `https://github.com/TommyMoonn/archeion`.
Releases destination: `https://github.com/TommyMoonn/archeion/releases`.
Documentation destination: `/archeion/docs/`.
External new-tab links retain `noopener noreferrer`; installer anchors stay native.

### Implementation seams, test migration and phase exits

B3.2 owns TSX composition, typed static content, React interactions and metadata.
Introducing `src/pages/index.tsx` requires re-enabling preset pages and removing
`plugins/staticHomepage.ts`, its registration and `static/index.html` atomically;
this satisfies B3.3's “same change” requirement at the earlier route-introduction
boundary. Remove the sitemap's manual static root entry so the framework emits
one root URL. Never leave two homepage owners between commits. B3.3 owns final
measured Tailwind visual/responsive implementation and production screenshot
extraction; B3.4 owns integrated screenshot/behavior/metadata/resource validation.
Keep each intermediate phase coherent with focused checks for its changed seams.

Before any static runtime removal, audit tracked consumers of `docs/index.html`,
`docs/css/styles.css`, `docs/js/main.js`, `website/static/index.html`, the static
homepage plugin, legacy selectors and asset paths. Preserve all public resources
(including fonts, cover SVGs, schema, example themes, dictionary catalog/packages,
compatibility redirects, robots and social preview) unchanged. Remove temporary
`static/css/styles.css` / `static/js/main.js` only once they have no active website
consumers; do not delete original `docs/` sources or their active legacy tests
before the separate post-merge live cutover in `docs/DOCUMENTATION.md`.

| Existing coverage / seam                                                                   | Required migration or retention                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/landingDownloadFlow.test.ts`                                                        | Rendered navigation/destinations, native installer, source/releases/docs links, preserved metadata and concise CTA; explicitly retire source-disclosure assumptions.                                                                                                         |
| `tests/landingHeroProduction.test.ts`                                                      | Approved centered copy/screenshot, local fonts, intrinsic dimensions, static/no-JS/reduced-motion base; retire H04 geometry only.                                                                                                                                            |
| `tests/landingLocalFirst.test.ts`                                                          | Archive ownership/tree, no virtual views as filesystem entries, no unsupported security claims, responsive local overflow; keep richer application-data guidance contracts with docs/legacy owner.                                                                           |
| `tests/landingMobileNavigation.test.ts`                                                    | Render actual React menu; closed focus exclusion, first link, Escape/outside/toggle restoration, destination focus, responsive transition and native modified links. No string/eval fixture.                                                                                 |
| `tests/landingProductStory.test.ts`                                                        | Assert approved six cards and released capabilities, preview alt and noninteractive raster; move legacy-only demo expectations intact to an explicitly named legacy suite while legacy page is active.                                                                       |
| `tests/landingReaderDemoKeyboard.test.ts`                                                  | Keep legacy demo keyboard regressions running against legacy publisher until cutover; new rendered landing coverage verifies static Reader claims and no phantom controls. Document retirement by matrix row, never weaken assertions to pass.                               |
| `tests/landingVisualSystem.test.ts`                                                        | Shared semantic tokens, typography, readable focus, pointer capabilities and reduced-motion; replace legacy selector/string assertions with rendered output where possible.                                                                                                  |
| `tests/browser/landing-{download,hero,local-first,product-story,visual-system}.pw.ts`      | Port all five to production Docusaurus host and approved sections/states; keep a scenario ledger for retired demo cases, preserve legacy cases separately while their owner is live. Include all five in the dedicated website config/CI lane, not the desktop Vite fixture. |
| `tests/websiteStatic.test.ts`, `tests/browser/website-static.pw.ts`                        | Split temporary homepage/runtime assumptions from permanent exact-resource/redirect/no-JS contracts; update home/docs round trips and menu selectors. Keep all resource-byte/404/fallback assertions.                                                                        |
| `scripts/check-website-build.mjs`, `tests/websiteDeployment.test.ts`, config/tooling tests | Framework-generated root metadata and sitemap exactly once; static resource bytes still exact; no dev shell/source/internal artifacts. Trace all `pages: false` / static plugin expectations.                                                                                |
| Prerequisite docs browser coverage                                                         | Retain search pointer-vs-keyboard focus, 14/13px Inter Variable results, copy SSR reserved space/toast expiry, and strict zero-CLS first paint. Add deferred F1 font-load rejection reveal test at B3.4.                                                                     |

Root tests must remain Node-only and independent of website installation; actual
website rendered-component tests belong in `website/tests/` with its existing
Vitest config. Retain meaningful root factual contracts without importing website
runtime into the desktop suite. Run production browser work sequentially with
other builds/dev servers and always pass `--trace off`.

B3.4 exit requires desktop/tablet/mobile and boundary screenshots compared with
the approved mock, keyboard/pointer/coarse/reduced-motion/zoom checks, no console
or missing-resource errors, correct head/base paths, no fallback-font shift or
page overflow, all 24 docs routes/search/themes/changelog and public resources
unaffected, migrated landing coverage and actual required CI gates. This map
records no completed visual/browser verification for the React landing.

The user explicitly authorizes phase commits and autonomous fresh top-level
GPT-6.1 Sol Medium threads for B3.2, then B3.3, then B3.4; each phase runs relevant
checks and up to three fresh read-only peer-review rounds, stopping on APPROVE.
No packaging/ZIPs. Final publication happens only after B3.4. The final PR targets
`main` per the user's follow-up, never the other branch. Refresh actual remote
`main` ancestry, apply the plan's parent-merged rebase rule, and inspect the diff
and commit list for duplicated parent changes before pushing/opening that ready
PR. Preserve the established branch ancestry; never flatten the stack. Link/watch
through T3 until current-head CI is green, unwatch at handback, and never merge.

## React landing composition (B3.2)

`src/pages/index.tsx` owns the homepage metadata and composes `LandingPage`.
Landing sections keep their markup and local effects; `content.ts` owns typed
feature copy and destinations. Header navigation tracks only Library, Reading
and Your files. The native mobile details menu adds focus cycling, Escape/outside
and toggle dismissal, destination focus, background inertness and framework-owned
scroll locking. It resets at the inclusive 1020px navigation boundary. Native
modified links and script-free content remain available.

Landing appearance scopes the existing dark semantic tokens without writing the
documentation theme preference. The framework Root owns icons once per route:
landing uses absolute production image-icon URLs, while docs retain their existing
favicon and Apple artwork URLs. Existing social metadata and public resources
are preserved. Critical fonts stay embedded in the shared stylesheet; no redundant
font preload requests are added for those same bytes.

Decorative effects use React events/state, SVG attributes and scoped Web Animations,
with bounded animation frames and lifecycle/preference cleanup. Reading words use
scroll progress, with readable static and reduced-motion fallback. Preview imagery
is noninteractive and cards describe released behavior; the legacy demo tests and
publisher sources remain intact.

This phase establishes composition and behavior, not final visual parity. The
existing 1544×1012 public preview is an explicit intermediate image. B3.3 must
replace it with the approved 1480×906 screenshot, finish measured geometry/type,
responsive boundary styling and decorative appearance. B3.4 must compare screenshots
and migrate the existing landing suite using the B3.1 retirement ledger.

B3.2 validation passed: website typecheck/lint/build, 6 website unit tests, 77 root
landing/resource/deployment/workspace/token tests, browser TypeScript and touched
ESLint, formatting, docs checks, exact artifact validation and all 71 production
website browser tests (`--trace off`). Independent review round one approved with
no Required or Recommended findings. Optional F2 carries to B3.3: clear spotlight
coordinates when pointer motion is disabled and verify the disable/re-enable cycle.
Final screenshot parity and full application/required CI gates remain B3.4 work.

## Measured landing presentation (B3.3)

B3.3 finishes the approved final cascade in the existing Tailwind foundation:
centered three-track header, 68/64px chrome, content/media widths, 72px primary
headings, responsive section typography and spacing, feature cards, archive tree,
stacked actions and compact footer. The landing retains its dark token boundary;
no documentation preference, font bootstrap, product copy or resource owner changes.
The root README already points its Changelog badge and Custom theme link to the
new public docs routes; its repository-local maintainer links remain intact.

The visible preview was originally `static/assets/images/landing-library.png`,
extracted without recompression from the approved mock (1480x906, 893603 bytes,
SHA-256 `a7f67d1464bd8412c148a7955fdd3071d940ca429530a0ea88662705ff021883`).
Website refinement Phase 4 replaces this with
`static/assets/images/landing-library.webp` (250388 bytes) after a full-size
and resized visual comparison. The intrinsic dimensions and alt text remain
unchanged. The separate 1544x1012 social preview and pre-existing public
resources retain their exact bytes and destinations.

Six positioned Lucide glyphs float/parallax at the approved depths and periods.
SVG radial gradients reproduce page/card/download glows through semantic colors;
scoped animation ownership, reduced motion and pointer capability remain intact.
The approved GitHub brand path is a small shared mark because the pinned Lucide
release has no brand export. No dependency or second icon library was added.
Optional review F2 is fixed: pointer preference changes cancel a pending spotlight
frame and clear stored coordinates; a production regression verifies re-enabling
motion without moving the pointer does not restore the old glow.

Central named landing roles cover repeated measured sizes, borders and shadows.
The few arbitrary utilities encode approved one-off grid ratios, glyph positions,
line heights, heading measures, rotation-free opacity states and pressed scale;
they introduce no JSX color values. The archive heading uses normal 88/72px anchor
clearance instead of the mock's negative margin, keeping the sticky header clear.
Footer identity and links may reflow at narrow/zoom widths to preserve full labels.

B3.3 checks and independent review are recorded in the branch handoff. Production
geometry coverage spans all 20 representative/boundary widths in the B3.1 map;
1440/768/390 captures were inspected for the implementation. B3.4 still owns the
integrated mock screenshot comparison, existing suite migration, deferred F1,
final acceptance/required gates and publication. Legacy demo tests stay active.

B3.3 validation passed: website typecheck/lint/build/formatting, 77 focused root tests,
6 website unit tests, browser TS/touched ESLint, docs checks and artifact checker.
Full production browser suite passed 72/72 (`--trace off`); final small glyph/CTA
refinements passed rebuild/artifact and affected browser 10/10. Independent round
one APPROVE, no Required/Recommended findings; stopped early per supplied skill.
F2 is Fixed. Prior Optional F1 remains deferred to B3.4. No push/PR at this boundary.

## Integrated landing verification (B3.4)

The production homepage is verified against the final approved HTML, including
the owner's B3.4 navigation corrections. The wordmark and footer home action
return to absolute scroll position zero. Your files aligns its content below
the header rather than showing the previous section's trailing space; at
1716×1045 the tree starts at 93px and the closing releases action is visible.
This supersedes B3.3's conservative files-section anchor offset. The section's
104/72px padding stays unchanged; its anchor margin is −12px desktop/tablet and
16px mobile. Hero anchor margins match the 68/64px header. Native history,
modified links and focus ownership remain unchanged.

The framework HTML class provider owns landing-only `motion-safe:scroll-smooth`.
Reduced motion uses immediate scrolling, and leaving the landing removes the
class. No global documentation scrolling rule or parallel JS animation is added.

### Regression migration and retirement ledger

The seven original root suites now run unchanged as `tests/legacyLanding*.test.ts`.
The five original browser suites run unchanged as `tests/browser/legacy-landing-*.pw.ts`
in the existing Vite lane. Keep them while `main:/docs` remains the live publisher.
Their renaming does not retire any assertion or desktop capability.

| Original scenario family | Production replacement                                                                                                                        | Legacy-only scenarios retained until live cutover                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Download flow            | `landing-download.pw.ts`: actual anchors/download event, safe external destinations, exact metadata, responsive section navigation            | Developer setup disclosure, old navigation labels and full-height closing scene                                                                  |
| Hero production          | `landing-hero.pw.ts`, `website/tests/landing.test.ts`: rendered centered copy, intrinsic static image, pre-hydration geometry and zero CLS    | H04 synthetic Library/Reader transition, cover carry and bridge geometry                                                                         |
| Local-first ownership    | `landing-local-first.pw.ts`, rendered archive test: real EPUB/sidecar tree, released ownership claims, responsive containment                 | Separate application-data panel, Quick Actions/utility index                                                                                     |
| Mobile navigation        | Existing `website-static.pw.ts` menu lifecycle plus responsive download/navigation tests                                                      | Imperative legacy menu fixture remains unchanged; production uses actual React focus/inertness/dismissal/breakpoint tests                        |
| Product story            | `landing-product-story.pw.ts`, rendered six-card test: released Library/Reader claims, descriptive raster alt and absence of phantom controls | Library destinations/folders/search/filter/sort/counts and Reader settings/page/mode/theme/annotation interactions                               |
| Reader keyboard          | Static Reader claim/control assertions plus real landing navigation keyboard tests                                                            | Passage identity/descriptions, Enter/Space highlight palette, note editing/deletion, bookmarks, theme radio keys, announcement/focus restoration |
| Visual system            | `landing-visual-system.pw.ts`, existing pointer/preference tests and 20-width geometry test                                                   | Legacy selectors, Reader theme/control appearance and old hero layout                                                                            |

Root tests remain Node-only; website SSR tests render the actual section components
in the website package. The production website config includes all five migrated
browser files plus `landing-navigation.pw.ts`; the Vite config excludes these new
files while retaining every explicitly named legacy file.

### Visual and runtime evidence

Same Chromium engine, 1000px height, dark appearance and reduced motion were used
for mock/production pairs at all 20 widths from the B3.1 matrix. The reference's
Google font requests were replaced with the exact local Inter Variable bytes
under its expected Inter family; both pages used the same Windows display-serif
and mono fallback availability. The unused Tailwind CDN script was suppressed;
the reference's authored CSS and inline SVG artwork remained intact. Production
made no external font requests.

Desktop 1440, tablet 768 and mobile 390 pairs were inspected in full; boundary
contact sheets cover 320, 359/360/361, 639/640/641, 899/900/901, 1019/1020/1021
and 1099/1100/1101. Hero line heights match throughout, Library/Reading section
positions match, and neither page overflows. Archive tree/pre formatting accounts
for a 2–4px lower-page offset (total height 3–5px); named Lucide glyphs replace
the mock's hand-drawn equivalents, and the accessible menu retains its Menu icon.
At 320px the footer deliberately reflows to preserve complete labels.
Comparison captures/measurements are disposable `.scratch/landing-b34/` evidence;
the navigation regression writes matching home/files destination screenshots.

Production tests verify keyboard/pointer/coarse input, menu focus/inertness and
cleanup, native downloads, section clearance, normal/reduced motion, zoomed
metrics with an equivalent narrowed CSS viewport, exact metadata, local fonts,
zero-CLS delayed hydration, and missing-resource/console checks. Optional F1 is
fixed: rejected `document.fonts.load` reveals both landing and docs SSR headings
with external React scripts blocked, and removes the loading attribute.
The complete documentation route/search/theme/copy/changelog/static-resource
suite remains active. Live Pages cutover remains a separate operation under
`docs/DOCUMENTATION.md`; local artifact validation does not establish a deployment.

B3.4 validation passed: website typecheck/lint/build/format, 10 rendered/unit tests,
77 focused root landing/resource contracts, 191 CI/resource/deployment tests,
documentation freshness and artifact checks, browser TypeScript/touched ESLint,
and the full production browser suite (93/93, traces off). Retained legacy landing
browser coverage passed 32/32. The full frontend gate passed 422 files / 4,626 tests
with one skip before the final navigation corrections; affected website and browser
checks passed again afterward. Full required CI is checked on the final PR head.
Independent integrated review round one returned APPROVE with no Required,
Recommended or Optional findings; stopped early per the supplied skill.
