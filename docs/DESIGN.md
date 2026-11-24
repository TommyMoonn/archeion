# Archeion Design System

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

This guide records the visual rules for Archeion's desktop app. It covers the application frame, Library, Reader controls, settings, dialogs, menus, and utility windows. It does not cover the layout or typography of EPUB content, the public website, or the documentation site.

The guide describes the intended UI. Tailwind owns static desktop tokens in `src/styles/tokens.css`, imported by the desktop CSS entry. Built-in application and Reader colors come from `themes/built-in/`, and the runtime token contract lives in `src/themes/themeTokenRegistry.ts`. Update this guide when an accepted design decision changes these sources.

## Design principles

- Archeion is a library and reading app. Books, metadata, and the current task take priority over decoration.
- The default layout is compact. Related controls and information stay close without crowding labels, hit targets, or content.
- Typography, alignment, spacing, and surface contrast establish hierarchy.
- Neutral fills and subtle borders define most areas. Cards and shadows appear when they establish a content group or elevation.
- Loading, empty, ready, and error states stay within their owning area. A status change does not move the title, toolbar, actions, or nearby content.
- Interface copy stays concise and specific. It does not repeat headings or duplicate visible status messages.
- Colors, shapes, icons, and state treatments keep the same meaning throughout the application.

## Scope and implementation references

| Area                                                                          | Implementation source                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Shared color, typography, icon, control, radius, elevation, and motion tokens | `src/styles/tokens.css`                                                          |
| Shared component presentation                                                 | `src/styles/components/`                                                         |
| Feature-specific presentation                                                 | `src/styles/features/`                                                           |
| Application shell and window geometry                                         | `src/styles/layout/`                                                             |
| Forced-colors behavior                                                        | `src/styles/forced-colors.css`                                                   |
| Themeable token contract                                                      | `src/themes/themeTokenRegistry.ts`                                               |
| Custom theme authoring                                                        | [`custom-themes.md`](custom-themes.md)                                           |
| Installed-font behavior and Windows validation                                | [`font-preferences-validation.md`](font-preferences-validation.md)               |
| Historical built-in theme color audit                                         | [`design/theme-color-audit.md`](design/theme-color-audit.md)                     |
| Visual regression tests and current evidence                                  | [`../tests/browser/visual-refinement.md`](../tests/browser/visual-refinement.md) |

Feature code reuses shared components such as `Button`, `IconButton`, `AppSelect`, `SegmentedControl`, `Toggle`, `Dialog`, `MenuItem`, and `EmptyState`. Feature styles do not redefine a shared control's appearance. A shared component is extended only when multiple parts of the app need the same behavior and presentation.

`AppSelect` wraps the local shadcn Base UI Select. Keep its popup in the owning surface so native dialogs, nested filter popovers, and Reader theme scopes retain containment. Base UI handles positioning and option navigation; the shared transient-surface owner coordinates dismissal. `FontPicker` wraps the shadcn Base UI Combobox with a separate quiet search header, trigger-sized popup, and a scrolling option list. The font catalog and filtering remain shared across Appearance and Reader. Settings sizes its direct Select and FontPicker controls consistently; Reader-specific sizing hooks remain until Reader chrome migrates.

Archeion's desktop UI uses React, Tailwind CSS v4, existing shared tokens, and `lucide-react`. The Vite plugin compiles utilities from `src/` and desktop browser fixtures. Preflight is disabled: `src/styles/index.css` retains the existing reset and unlayered styles, which take precedence over utility layers during migration. The website has its own styling toolchain. Shared buttons, icon buttons, input shells, and busy indicators use the adapted shadcn Base UI source under `src/components/ui/`. The public controls retain their existing props and own their tooltip, native-label, and delayed-busy behavior. `cn` recognizes the semantic text, border, and control-size roles.

`components.json` configures the shadcn Base UI registry. Generated primitives belong in `src/components/ui/` and use the desktop `@/` alias. Use an explicitly versioned shadcn CLI when generating primitives. Adopt components through existing shared APIs as their consumers migrate; add registry dependencies and the class merge helper only when needed. Preserve Archeion's theme runtime and visual roles rather than adopting registry defaults.

## Desktop styling and token ownership

`tokens.css` defines the canonical Tailwind theme. `@theme static` emits shared static values even when only legacy CSS or JavaScript reads them. `@theme inline` exposes live application and Reader properties without resolving them at the document root. The default Tailwind palette and design scales are reset; shadcn components use Archeion roles instead of a second palette or theme provider.

| Role                  | Utility examples                                                                                             | Ownership                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| App colors            | `bg-surface-main`, `text-text`, `border-line`, `outline-focus`                                               | Runtime app palette, including local preview overrides                                   |
| Reader colors         | `bg-reader-bg`, `text-reader-text`, `border-reader-line`                                                     | Reader scope only; app controls in Reader still use their existing app roles             |
| Typography            | `font-interface`, `font-app-display`, `font-mono`, `text-body`, `text-control-label`                         | Static role sizes and companions; runtime Interface and Display stacks                   |
| Geometry              | `h-control-standard`, `size-icon-glyph-compact`, `size-icon-slot-standard`, `w-sidebar`, `max-w-popover`     | Shared pixel constraints; sidebar and collection density resolve through live properties |
| Borders and elevation | `border-solid border-standard border-line`, `rounded-control`, `shadow-app-popover`, `shadow-cover-progress` | Static border/radius and cover elevation; live theme-derived shadows                     |
| Motion                | `transition-colors duration-fast ease-standard`, `app-motion:motion-safe:animate-view-enter`                 | Shared easing and duration scales with runtime motion and OS reduced-motion gates        |
| Responsive layout     | `window-narrow:`, `shell-narrow:`, `max-w-dialog`                                                            | Existing viewport thresholds and surface constraints                                     |

Use standard utilities only when their value **and unit** match the baseline. The standard spacing scale is `0.25rem`; pixel-specific control, icon, sidebar, density, and overlay geometry use named spacing tokens. Reuse the same role when the meaning and value match. Add component-specific tokens only when their owning migration needs them. Tailwind `max-*` variants use an exclusive threshold, whereas legacy `max-width` media queries are inclusive; preserve the boundary when migrating a responsive selector. Named `--container-*` values above are surface width constraints, not a blanket set of container breakpoints.

Compose utilities in JSX and share component variants. `@apply`, arbitrary utility values and properties, static inline styles, and hardcoded palette colors are prohibited in migrated desktop code. Arbitrary state or selector variants are reserved for relationships that built-in variants cannot express. Use named token-backed utilities when a built-in utility cannot express a needed property or calculation. Keep runtime CSS properties and inline styles for measured coordinates, resized widths, progress, theme swatches, and other genuinely dynamic values. Keep complete class names discoverable by the desktop source scan.

Legacy `--type-*`, `--control-height-*`, `--icon-*`, and motion aliases remain only for their existing CSS consumers. Remove each alias when its last consumer migrates. The `.button`, `.icon-button`, `.input-shell`, size/variant and child-slot hooks remain for legacy feature selectors, including dialog and Settings sizing, Reader colors, Library action alignment, and forced-colors overrides. Their last owners are the corresponding feature phases and F.4 for global accessibility. Base button CSS has been removed; `forms.css` retains native field rules for B.3 and the shared input's nested keyboard-outline suppression until F.4. The native wrapping label is retained in the Input Group adaptation; standalone Field/Label and additional addons are deferred to B.3 where actual callers need them. `--font-ui` and `--font-display` are runtime outputs, not Tailwind theme names. Their static fallback stacks keep their existing names for the appearance runtime. The Reader UI and its status page override five canonical type sizes (caption, meta, body, body-large, and title-small) with their existing smaller values. Other roles, including control labels and supporting text, retain their application sizes. Theme Manager preview graphics retain their local `--theme-shell-*` properties rather than overriding the application palette. Prepaint, EPUB document styling, and forced-colors overrides retain their own established ownership.

### Stacking and native surfaces

Use ordinary numeric z-index utilities where they match the current role. Preserve local stacking contexts; equal numbers in unrelated contexts do not imply shared overlay ownership.

| Existing layer                                           | Level   |
| -------------------------------------------------------- | ------- |
| Local Library and Reader content, controls, and overlays | 1–12    |
| Update notice                                            | 15      |
| Window titlebar                                          | 20      |
| Open select container and menu                           | 40 / 60 |
| Context menus and Quick Actions overlay                  | 1000    |
| Tooltip                                                  | 1200    |
| Keyboard skip link                                       | 1300    |
| Appearance status                                        | 1500    |

Native dialogs and backdrops use the browser top layer. Increasing z-index cannot replace their containment, focus, or dismissal behavior. Portal content must inherit the scope of the owning surface.

## Appearance and color

### Themes

- The default application theme is dark.
- Light and system appearance are also available. Custom themes can change colors only.
- The application theme and Reader theme are independent. Changing one leaves the other unchanged.
- Reader supports dark, light, and sepia themes. Reader settings and publication styles control its typography. Application theme packages do not change it.
- Custom theme packages can override supported application and Reader color tokens. They cannot provide CSS, scripts, fonts, layout, spacing, radii, motion, assets, or behavior.
- System appearance follows the operating system's color preference only when that setting is selected.

### Color roles

Feature styles use semantic color tokens. They do not copy hex values.

| Role                | Tokens                                                                                | Use                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Application areas   | `--surface-app-frame`, `--surface-sidebar`, `--surface-main`, `--surface-main-raised` | Window chrome, navigation, workspace, and raised workspace surfaces                  |
| General surfaces    | `--canvas`, `--canvas-deep`, `--surface`, `--surface-raised`, `--surface-hover`       | Canvas, nested regions, controls, cards, and hover states                            |
| Text hierarchy      | `--text`, `--text-strong`, `--muted`, `--muted-soft`                                  | Primary copy, emphasis, readable secondary copy, and inactive decorative affordances |
| Borders             | `--line`, `--line-strong`, `--line-subtle`                                            | Default boundaries, emphasized boundaries, and quiet separators                      |
| Interaction         | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-border`, `--focus`          | Primary actions, selected states, accent treatments, and keyboard focus              |
| Status              | `--success`, `--warning`, `--info`, `--error` and their soft/border variants          | Success, caution, information, and error states                                      |
| Destructive actions | `--danger`, `--danger-strong`, `--danger-soft`, `--danger-border`                     | Destructive actions, aliased to the error palette                                    |

Use `--muted` for readable secondary text and `--muted-soft` for inactive or decorative elements. Text opacity does not replace the text hierarchy. Pair status colors with text, an icon, or another visible cue.

Cards, notices, callouts, and other content groups do not use thick accent-colored left borders. Their hierarchy comes from the surface color, a restrained outline, a heading, or a contextual icon.

## Typography

### Desktop identity

About and Archive Manager use `BrandLogo` with the owner's unchanged logo PNGs
in `src/assets/brand/`. The resolved application base selects the dark or light
artwork, including for custom themes. Keep the existing icon dimensions and
product-name headings. Library retains its text-only product name and existing
sidebar visibility gates. Settings retains its compact product eyebrow.

The in-app product name continues to use its existing typography, including the
configurable Display font. The supplied wordmark PNGs are for the root README;
do not substitute them for in-app text or recreate their lettering with a font.
This owner decision supersedes the rebrand plan's proposed fixed brand font role.

Regenerate platform icons from the approved 500 x 500 desktop composition:

```powershell
pnpm exec tauri icon src/assets/brand/archeion-logo-dark.png --output src-tauri/icons
Copy-Item src-tauri/icons/128x128.png website/static/assets/images/archeion-icon.png
Copy-Item src-tauri/icons/32x32.png public/favicon.png
```

Larger exports are upscaled derivatives. Keep the configured executable and
installer icon paths. `node scripts/generate-brand-assets.mjs --check` guards
the approved source bytes.

### Font families and ownership

- The application interface uses bundled Inter, followed by Segoe UI and the system sans-serif stack.
- The default display family is `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`.
- The code stack is `"Cascadia Mono", "Segoe UI Mono", Consolas, "Liberation Mono", monospace`.
- Interface and Display font preferences are independent. Display can use the effective Interface family or a separately selected installed family.
- Reader font selection is independent of both application font roles. Application fonts do not affect EPUB publication content.
- The installed-font catalog is cached for the session. Restart the app after installing or removing a Windows font.

The bundled Inter faces are declared in `src/styles/fonts.css` and tracked by `scripts/inter-font-manifest.json`. Update the asset manifest and the Inter license notice in `public/licenses/fonts/` whenever a font asset changes.

### Type scale

The Tailwind type scale uses the semantic `--text-*` roles in `tokens.css`. Sizes use `rem` so browser and system text scaling can enlarge the interface. Existing `--type-*` aliases reference the same values until their consumers migrate.

| Token                  | Size        | Line height | Weight | Typical use                               |
| ---------------------- | ----------- | ----------- | ------ | ----------------------------------------- |
| `--text-caption`       | `0.75rem`   | `1.4`       | `400`  | Secondary labels and compact metadata     |
| `--text-meta`          | `0.8125rem` | `1.4`       | `400`  | Supporting text and compact controls      |
| `--text-body`          | `0.875rem`  | `1.5`       | `400`  | Primary application copy and navigation   |
| `--text-body-large`    | `0.9375rem` | `1.55`      | `400`  | Emphasized body copy and descriptions     |
| `--text-title-small`   | `1rem`      | `1.3`       | `600`  | Local titles and compact headings         |
| `--text-title`         | `1.0625rem` | `1.2`       | `400`  | Application and surface titles            |
| `--text-heading`       | `1.25rem`   | `1.25`      | `600`  | Section headings                          |
| `--text-dialog-title`  | `1.5625rem` | `1.15`      | `400`  | Dialog headings; `-0.02em` tracking       |
| `--text-section-title` | `1.75rem`   | `1.15`      | `400`  | Large local headings; `-0.025em` tracking |
| `--text-page-title`    | `1.875rem`  | `1.1`       | `400`  | Page headings; `-0.03em` tracking         |

Display roles use `--leading-display` (`1.05`), `--font-weight-regular` (`400`), and `--tracking-display` (`-0.03em`):

| Token                    | Responsive size range            |
| ------------------------ | -------------------------------- |
| `--text-display-compact` | `clamp(1.875rem, 5vw, 2.375rem)` |
| `--text-display-medium`  | `clamp(2.125rem, 5vw, 3rem)`     |
| `--text-display-large`   | `clamp(2.375rem, 5vw, 3.5rem)`   |

Semantic aliases use this scale:

| Alias                      | Definition                                      | Use                                      |
| -------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `--text-application-title` | `--text-title` and its companions               | Mounted application wordmark             |
| `--text-control-label`     | `--text-body`, line height `1.25`, weight `500` | Actionable labels                        |
| `--text-body-supporting`   | `--text-meta`, line height `1.5`                | Explanatory copy                         |
| `--text-code`              | `--text-meta`, line height `1.45`               | Paths, identifiers, and code-like values |

Each type role uses its matching `--line-height`, `--font-weight`, and `--letter-spacing` companions. The supported UI weights are `400`, `500`, `600`, and `700`. Use regular for body copy, medium for routine controls, semibold for local headings, and bold for rare emphasis. The type system does not add intermediate weights or one-off font-size aliases. Caption is the smallest application text role. Interactive labels, navigation, important status text, and primary metadata use at least that size.

Font metric differences are handled through semantic layout roles. Styles do not target individual installed font names. Fonts and icons are preloaded only when a reproducible trace shows a loading problem. Current browser evidence did not justify a loading change. Native Windows verification remains separate.

## Layout, geometry, and surfaces

### Application shell

- The main Tauri window has a minimum size of `900 × 600`.
- The Library sidebar defaults to `248px` on wider desktop windows and `220px` at viewport widths up to `820px`. It can be resized between `200px` and `360px`, and a custom expanded width is saved locally for the next launch. The resize handle supports pointer and keyboard input; `Home` and `End` select the width limits.
- The sidebar collapse width remains `56px` and is independent of its saved expanded width. The titlebar and sidebar body share the same animated shell geometry.
- Resizing is unavailable in the constrained top-navigation layout.
- Hidden sidebar labels cannot receive keyboard focus. Accessible names, tooltips, and the archive switcher remain available.
- The Library workspace fills its area without an outer rounded card, border, shadow, or frame-colored gutter.
- Navigation and workspace sit side by side, separated by one subtle divider. Their colors may match because the layout and divider define the two areas.
- The Library workspace owns scrolling. The page does not add a second scroll region, and sidebar, titlebar, or status changes do not move the collection.

Comfortable density is the default. Compact density reduces spacing and selected control dimensions. Both modes use the same typography scale and text roles. The collection content offset is `20px` in comfortable density and `16px` in compact density.

`tokens.css` owns the shared spacing scale and existing fixed dimensions. Density changes `--collection-content-offset` through the canonical comfortable and compact values. Keep measured sidebar width separate from its fixed fallback geometry.

Fractional CSS lengths are allowed for optical alignment, interpolation, and responsive
layout. There is no whole-pixel rule across application styles. Preserve the documented
shared dimensions below and the sidebar endpoints above through their semantic tokens;
verify their rendered geometry rather than banning fractional values in unrelated styles. Rendered geometry may also be fractional under text scaling
or Windows display scaling.

### Shared dimensions

| Token                         | Value  | Use                            |
| ----------------------------- | ------ | ------------------------------ |
| `--spacing-control-compact`   | `32px` | Compact buttons and controls   |
| `--spacing-control-standard`  | `36px` | Standard buttons and controls  |
| `--spacing-control-prominent` | `40px` | Prominent buttons and controls |
| `--border-width`              | `1px`  | Standard structural border     |

Dialog buttons use the standard `36px` control height and meta text scale. This keeps modal
actions aligned with selectors and Settings actions without changing buttons elsewhere.

Settings uses a shared Tailwind section layout, with a container-sized row layout that stacks labels and controls when space is constrained. Sidebar search and navigation retain their full-row selected fill; the content region owns vertical scrolling. Text-only Empty and Alert components preserve compact search and error feedback. Utility window titlebars use `canvas-deep` and a subtle divider, matching the Settings sidebar plane and reducing contrast at the content boundary. Archive Manager uses this same uninterrupted titlebar above its two content planes, including during loading and recovery; the Library retains its route-owned split titlebar. Native window outlines remain compositor-owned. General and Library preferences use the shared row, Select, Switch, radio group and Button components. Named preference groups keep Books, Folders, Series and window behavior distinct; the same item renderers serve Settings search. Reader preferences use the same row layout, with the shared FontPicker, theme Select, segmented radio groups and Slider. Slider values remain beside their tracks at narrow widths; the preference registry owns the defaults independently of the EPUB Reader surface. Appearance preferences reuse the same controls and row layout. The application theme selector and Manage themes button form a single responsive action group; Interface and Display font pickers keep the standard Settings selector width and expand to the available row width in narrow layouts. No section-specific CSS is needed. Keyboard preferences use the shared Input, Button, IconButton and Kbd with the same responsive row layout. Fixed keycaps retain their compact height and wrap when space is constrained. Shortcut capture retains the native dialog, with a focusable capture region, inline validation and Tab navigation to the dialog actions.

Archives and Storage reuse the shared rows and controls, including the annotation export action group and cache and backup status notes. Maintenance confirmations use the native dialog frame; annotation import presents a definition list of counts and a shared Collapsible for unmatched IDs. These sections need no section-specific CSS.

Dictionary management uses shared Badge, Progress, Spinner, Input, segmented radio group, Button, Empty and Alert components. Catalog and installed cards use token-backed Tailwind layout, with container-based reflow for actions, search and progress. Download progress reflects the reported byte total or the catalog estimate; unknown totals remain indeterminate. Recovery actions retain the same download and installation owner. Removal confirmation retains the native dialog frame. The Settings-specific stylesheet is removed; shared legacy tooltip, menu and feedback styling remains until branch B.

### Corners

| Token              | Value   | Use                                                   |
| ------------------ | ------- | ----------------------------------------------------- |
| `--radius-small`   | `4px`   | Nested rows and small items                           |
| `--radius-control` | `6px`   | Ordinary buttons, fields, selectors, and icon buttons |
| `--radius-menu`    | `8px`   | Menus, popovers, and floating panels                  |
| `--radius-dialog`  | `8px`   | Dialogs                                               |
| `--radius-card`    | `12px`  | Established card and book surfaces                    |
| `--radius-pill`    | `999px` | Semantically capsule-shaped elements only             |

Buttons, fields, selectors, and action controls use the control radius, not pill-shaped corners. Capsule shapes are limited to tags, status markers, toggles, progress tracks, and the noninteractive drop hint. In grouped controls, inner options account for the group's inset and border.

Changes to visual radius or padding do not change pointer hit areas. Focus rings and touch targets keep their established geometry.

### Icons

Application icons use named imports from `lucide-react`. Application surfaces do not load icons dynamically or use another icon library.

| Role      | Glyph  | Layout slot |
| --------- | ------ | ----------- |
| Compact   | `14px` | `16px`      |
| Standard  | `16px` | `20px`      |
| Prominent | `20px` | `24px`      |

`.icon-slot` reserves a stable layout box independently of the glyph size. Icons inherit `currentColor`, and the standard Lucide outline stroke is `2`. Existing role-specific exceptions remain, including stronger selection markers, the primary Add EPUB action, and lighter `1.5` icons where appropriate. Glyph size does not compensate for missing layout space.

Every icon-only control has an accessible name. Controls with an unclear purpose also have a tooltip. Collapsed navigation keeps its accessible label when the visible text is hidden.

### Borders and elevation

Borders mark boundaries. Shadows show overlap and elevation. A quiet border and a small surface contrast come before a shadow. A surface uses both a strong border and a strong shadow only when there is a clear reason.

| Token              | Use                                             |
| ------------------ | ----------------------------------------------- |
| `--shadow-card`    | Book cards and established raised content       |
| `--shadow-tooltip` | Compact supplemental hints and floating actions |
| `--shadow-popover` | Menus, popovers, and transient floating panels  |
| `--shadow-dialog`  | Blocking dialogs                                |
| `--shadow-drawer`  | Edge-attached drawers and Reader side panels    |

Components use the matching elevation token. Flat workspace areas do not need an enclosing shadow.

## Shared components and states

### Controls

- Shared `Button` variants cover primary, secondary, ghost, and destructive actions. Each area has one clear primary action. Secondary actions have less visual weight.
- `IconButton` is used for compact icon actions. Its layout slot stays stable, and each instance has an accessible name.
- Shared `AppSelect`, `SegmentedControl`, `Toggle`, and menu components provide the common focus, selection, and disabled states. Feature components reuse them. Preference switches, segmented radio groups, and Settings sliders use Base UI primitives styled with semantic tokens. Reader progress seeking remains a separate control.
- Interactive controls show hover, pressed, selected, disabled, invalid, and keyboard-focus states. Selection remains visible without relying on a small color change.
- Busy actions keep their label and outer dimensions stable. A status message is not repeated in both visible and live-announced content. A spinner is used only when an operation lasts long enough for progress feedback to help.
- Forms stay compact and keep visible labels and useful validation text. Narrow areas reflow locally. Error states use a semantic color and another cue, such as an outline or message.

### Empty states

`EmptyState` controls presentation. Each destination decides whether it has no content or no search or filter matches, then provides the heading, guidance, and action.

- An empty destination can show one contextual monochrome glyph at `32px` in the muted foreground. The glyph appears only when it helps identify the destination.
- Search and filter results with no matches contain text only. Keep a clear or recovery action when it helps.
- Empty states do not use gradient orbs, glows, shadows, oversized illustrations, or entrance animations.
- Descriptions are short and specific. An action appears only when the user has a useful next step.

### Loading, feedback, and surfaces

- Each route and utility window keeps its themed shell visible while content loads. Progress and errors appear in the content area. They do not replace the whole window with a generic status page.
- Status and feedback areas reserve enough space to avoid moving the title, form, or footer. Loading, ready, and error states keep the same layout where possible.
- Loading placeholders do not look interactive. Skeleton fields are not exposed as controls, and focus does not move into unavailable content.
- Shared dialog components use native `<dialog>` with a shared Tailwind frame, token-based sizing, and native backdrop ownership. Hosted and standalone dialogs share the same panel, scroll regions, feedback reservation and action layout. Loading forms use the shared Skeleton with inert, content-shaped placeholders. Focus containment, Escape behavior, dismissal, and focus restoration remain native lifecycle responsibilities.
- Dialogs, details drawers, and Quick Actions share one restrained dim backdrop without blur. Nested surfaces do not add another backdrop.
- The Library details drawer is an opaque overlay that enters from the right. It does not move or resize the Library content. Both the drawer and pinned panel use `--surface-main`, with a single `--line-subtle` divider at the collection edge and no surface shadow.
- Book details use the slide-over by default. The header's pin action optionally docks the same details beside the collection in windows at least `75rem` wide; narrower windows use the slide-over. Both modes share a width that defaults to `336px` and can be resized from `280px` to `480px`. The resize edge supports pointer dragging, arrow keys, larger steps with Shift, and Home/End for the limits. Pin state and width are saved through application preferences and restored across navigation, archive switches, and restarts. A restored pinned panel starts with no inspected book. The pinned header has Favorite and Unpin actions; the slide-over also retains Close.
- A pinned panel follows explicit book activation without changing bulk selection or moving focus. Its header and width stay stable when no book is inspected. Independently of the Library's Show Continue Reading preference, an unselected panel offers the current archive's most recently opened resumable book, labeled “Last read”, with its cover, title, author, known progress, description excerpt, last-opened date, and a Continue reading action. View book details opens the normal panel explicitly. Up to three other resumable books appear below as compact Continue Reading rows, ordered by most recently opened. These suggestions do not inspect or select books. Missing and completed books are excluded. Without a suggestion, a small monochrome book icon and “Book details” guidance explain how to populate the panel; an empty archive explains that details appear after adding and selecting a book. Multiple selected books show their count and point to the selection bar. Metadata and cover editing remain modal, protecting drafts while the collection is unavailable.
- Frosted-glass panels, decorative blur, glow, and gradients are not general surface treatments. Existing image and Reader overlay blur remains limited to those features.
- Functional gradients are limited to local effects such as loading shimmer and transparency checkers. They remain subtle and respect reduced motion. Empty states do not use gradients or glowing artwork.

## Motion

Motion is disabled by default. Users can enable it when the operating system does not request reduced motion. When system reduced motion is active, motion durations are zero. Motion never delays dismissal, focus restoration, or user input.

Use the shared duration vocabulary. The `duration-*` utilities resolve the active `--motion-duration-*` property; `--duration-enabled-*` stores the corresponding static value. Apply animation utilities with `app-motion:motion-safe:` so disabling motion prevents even zero-duration animation events.

| Token                          | Duration | Typical role                                          |
| ------------------------------ | -------- | ----------------------------------------------------- |
| `--motion-duration-fast`       | `120ms`  | Quick Actions and fast control/surface transitions    |
| `--motion-duration-standard`   | `150ms`  | Controls and shared sidebar/titlebar geometry         |
| `--motion-duration-slow`       | `160ms`  | Directional Archive Manager content changes           |
| `--motion-duration-emphasized` | `180ms`  | Dialog entry, shared backdrop, and tooltips           |
| `--motion-duration-view`       | `200ms`  | Library collection entrance and details drawer travel |
| `--motion-duration-loop`       | `900ms`  | Indeterminate activity where motion is useful         |

The application uses these motion patterns:

- On intentional entry, the Library collection may rise by `8px` and fade in once. Data updates, filtering, sorting, and other state changes do not replay the entrance or remount the collection.
- The Library shell interpolates its sidebar grid track over `150ms` during collapse and expansion. The expanded track uses the saved width; the collapsed track remains `56px`. The Library subtree is not transformed.
- Dialogs expand from the center at approximately `0.97` scale with a small opacity change. The exit fades without additional movement.
- The backdrop follows the dialog or drawer lifecycle and fades once. It does not blur the application.
- The Library details drawer remains opaque and travels from the right edge. It overlays the collection without changing its layout.
- Settings section changes use a brief opacity transition. Quick Actions and tooltips keep their existing small transitions.

Empty states and routine data changes do not use entrance animations. Loading shimmer runs only when motion is enabled and reduced motion is off. Card entrances are not staggered, scroll positions are not animated, and generic `transition: all` is not used. Motion is never the only indication of a state change.

## Accessibility and text scaling

- Keyboard users see a clear focus indicator. Keyboard focus uses a `2px` outline with an offset. The outline remains visible when control radii or borders change.
- Pointer interaction does not leave keyboard focus styling visible. Focus styling follows the current input method, and keyboard navigation restores it.
- Changes to compact visual geometry do not reduce pointer or touch hit areas. Coarse-pointer targets may extend beyond the visible control without changing its appearance.
- Windows forced-colors mode uses system colors for boundaries, focus, selected states, errors, and disabled controls. Essential meaning does not depend on shadows or subtle color differences.
- Text remains resizable. The semantic `rem` scale supports larger text. Control heights are not tuned to one font's metrics.
- Truncated metadata keeps its full value available through an accessible detail, tooltip, or expanded view.
- Long error messages and form content stay inside their own scroll region. Long paths, identifiers, and user text do not cause horizontal overflow.

## Visual review

Check the application under conditions that affect layout or contrast:

- Dark, light, system-light, and custom application themes.
- Comfortable and compact density.
- Normal and enlarged text, including the `150%` browser text-size checks.
- Narrow and wide layouts, including the `560px` responsive boundary and the normal desktop workspace.
- Keyboard focus, pointer interaction, disabled and invalid states, and Windows forced colors.
- Packaged Tauri WebView on Windows at `100%`, `125%`, and `150%` display scaling. Test the `900 × 600` minimum main-window size and the maximized size.

Inspect the Library shell, expanded and collapsed sidebar, archive switcher, collection grid and list, Reader toolbar and panels, settings, dialogs, menus, popovers, Theme Manager, Archive Manager, and utility windows. State changes must not move unrelated content, hide actions, or leave hidden controls focusable.

The current automated and owner-run checks are documented in `tests/visualFoundations.test.ts`, `tests/uiIntegrationGate.test.ts`, `tests/formHitAreaContract.test.ts`, `tests/browser/visual-refinement.md`, and `font-preferences-validation.md`. Browser tests verify repeatable geometry and interactions. They do not establish physical Windows display scaling, first paint in packaged WebView2, native frame performance, or screen-reader output. Mark those checks as unverified until they have been tested.

## Built-in palette sources

`themes/built-in/archeion-dark/theme.json` and `archeion-light/theme.json` own the
built-in application and Reader palette values. `src/themes/themeTokenRegistry.ts`
owns the public and derived token contract. `builtInThemes.ts` validates the manifests,
requires complete opaque application palettes, and maps them to the existing `dark`
and `light` selections. Canonical manifest IDs are reserved against custom imports;
conflicting installed packages are reported as invalid without deleting their files.

Rust native appearance includes these manifests at compile time and reads `app.main`
and `app.text` for native backgrounds and prepaint snapshots. Frontend compositing
fallbacks use the same manifest-backed registry. No settings migration is required.

After editing a canonical palette, run `pnpm run themes:generate`. The generator uses
the production TypeScript resolver and token registry to write
`src/styles/built-in-palettes.css`, `src/styles/built-in-reader-palettes.css`, and the explicit dark fallback in
`public/appearance-startup.css`. Do not edit generated colors by hand.
`pnpm run themes:check`, included in frontend verification, rejects stale output.
Reader Dark and Light use the manifests' complete Reader sections through the same
resolver as custom Reader themes. Reader selection remains independent of application
appearance and keeps the existing `dark`, `light`, and `sepia` settings identifiers.
Sepia remains Reader-only with its unchanged palette in `builtInThemes.ts`; its CSS
fallback is generated from that registry too.
