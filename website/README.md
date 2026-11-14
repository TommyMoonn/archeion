# Website foundations

This private Docusaurus workspace owns the public website presentation. It does
not load desktop theme packages or change the application's theme contracts.

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

The root foundation page and its component sample are temporary validation
scaffolding. Neither is a landing-page implementation. B1.5 owns fixture
cleanup; B2.8 still owns removing the temporary root route before the static
homepage cutover.
