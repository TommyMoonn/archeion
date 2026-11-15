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
`/archeion/` for the component tooling sample and `/archeion/docs/foundation`
for the temporary document. Production output goes to `website/build/`;
`serve` previews that static output under the same project base path.

The dedicated CI website job installs only `@archeion/website...`, then runs
website tooling tests, strict typechecking, and the production build (including
MDX and broken-link validation). The existing application jobs keep their application-only installs.
Website changes still select full CI validation until the Branch 2 classifier
integration. No Pages deployment is configured by this foundation.

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
invoke Docusaurus. They continue to own the current public site's generated
content until B2.7 moves the release-history projection. Run the website build
separately to compile MDX.

Foundation browser contracts run from the root after a website build:

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
`font-mono` for code. Inter 400/600/700 and Literata 400 are served locally with
swap; code uses the declared system fallback when Fira Code is unavailable.
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
Tailwind setup, tokens, and font-face rules. Preflight stays omitted while
Infima owns the temporary document shell; primitives explicitly supply borders,
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
coverage. The root page and component tooling sample remain temporary route and
tooling fixtures, not a landing-page implementation. B2.8 owns removing the
temporary root route before the static homepage cutover.
