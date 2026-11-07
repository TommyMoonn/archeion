# Archeion Design System

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

This guide records the visual rules for Archeion's desktop app. It covers the application frame, Library, Reader controls, settings, dialogs, menus, and utility windows. It does not cover the layout or typography of EPUB content, the public website, or the documentation site.

The guide describes the intended UI. Implementation values are defined in `src/styles/tokens.css`, and theme colors are defined in `src/themes/themeTokenRegistry.ts`. Update this guide when an accepted design decision changes either source.

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

Archeion's application UI uses React components, CSS, shared tokens, and `lucide-react`. An isolated presentation change does not require another UI framework, styling framework, or icon library.

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

### Font families and ownership

- The application interface uses bundled Inter, followed by Segoe UI and the system sans-serif stack.
- The default display family is `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`.
- The code stack is `"Cascadia Mono", "Segoe UI Mono", Consolas, "Liberation Mono", monospace`.
- Interface and Display font preferences are independent. Display can use the effective Interface family or a separately selected installed family.
- Reader font selection is independent of both application font roles. Application fonts do not affect EPUB publication content.
- The installed-font catalog is cached for the session. Restart the app after installing or removing a Windows font.

The bundled Inter faces are declared in `src/styles/fonts.css` and tracked by `scripts/inter-font-manifest.json`. Update the asset manifest and the Inter license notice in `public/licenses/fonts/` whenever a font asset changes.

### Type scale

The type scale uses the semantic roles in `tokens.css`. Sizes use `rem` so browser and system text scaling can enlarge the interface.

| Token                  | Size        | Line height | Weight | Typical use                               |
| ---------------------- | ----------- | ----------- | ------ | ----------------------------------------- |
| `--type-caption`       | `0.75rem`   | `1.4`       | `400`  | Secondary labels and compact metadata     |
| `--type-meta`          | `0.8125rem` | `1.4`       | `400`  | Supporting text and compact controls      |
| `--type-body`          | `0.875rem`  | `1.5`       | `400`  | Primary application copy and navigation   |
| `--type-body-large`    | `0.9375rem` | `1.55`      | `400`  | Emphasized body copy and descriptions     |
| `--type-title-small`   | `1rem`      | `1.3`       | `600`  | Local titles and compact headings         |
| `--type-title`         | `1.0625rem` | `1.2`       | `400`  | Application and surface titles            |
| `--type-heading`       | `1.25rem`   | `1.25`      | `600`  | Section headings                          |
| `--type-dialog-title`  | `1.5625rem` | `1.15`      | `400`  | Dialog headings; `-0.02em` tracking       |
| `--type-section-title` | `1.75rem`   | `1.15`      | `400`  | Large local headings; `-0.025em` tracking |
| `--type-page-title`    | `1.875rem`  | `1.1`       | `400`  | Page headings; `-0.03em` tracking         |

Display roles use `--type-display-line-height` (`1.05`), `--type-display-weight` (`400`), and `--type-display-letter-spacing` (`-0.03em`):

| Token                    | Responsive size range            |
| ------------------------ | -------------------------------- |
| `--type-display-compact` | `clamp(1.875rem, 5vw, 2.375rem)` |
| `--type-display-medium`  | `clamp(2.125rem, 5vw, 3rem)`     |
| `--type-display-large`   | `clamp(2.375rem, 5vw, 3.5rem)`   |

Semantic aliases use this scale:

| Alias                      | Definition                                      | Use                                      |
| -------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `--type-application-title` | `--type-title` and its companions               | Mounted application wordmark             |
| `--type-control-label`     | `--type-body`, line height `1.25`, weight `500` | Actionable labels                        |
| `--type-body-supporting`   | `--type-meta`, line height `1.5`                | Explanatory copy                         |
| `--type-code`              | `--type-meta`, line height `1.45`               | Paths, identifiers, and code-like values |

Each type role uses its matching `-line-height`, `-weight`, and `-letter-spacing` companions. The supported UI weights are `400`, `500`, `600`, and `700`. Use regular for body copy, medium for routine controls, semibold for local headings, and bold for rare emphasis. The type system does not add intermediate weights or one-off font-size aliases. Caption is the smallest application text role. Interactive labels, navigation, important status text, and primary metadata use at least that size.

Font metric differences are handled through semantic layout roles. Styles do not target individual installed font names. Fonts and icons are preloaded only when a reproducible trace shows a loading problem. Current browser evidence did not justify a loading change. Native Windows verification remains separate.

## Layout, geometry, and surfaces

### Application shell

- The main Tauri window has a minimum size of `900 × 600`.
- The Library sidebar uses the shared `--sidebar-width` and `--sidebar-collapsed-width` values. The titlebar and sidebar body derive their collapse width from the same shared value.
- Hidden sidebar labels cannot receive keyboard focus. Accessible names, tooltips, and the archive switcher remain available.
- The Library workspace fills its area without an outer rounded card, border, shadow, or frame-colored gutter.
- Navigation and workspace sit side by side, separated by one subtle divider. Their colors may match because the layout and divider define the two areas.
- The Library workspace owns scrolling. The page does not add a second scroll region, and sidebar, titlebar, or status changes do not move the collection.

Comfortable density is the default. Compact density reduces spacing and selected control dimensions. Both modes use the same typography scale and text roles. The collection content offset is `20px` in comfortable density and `16px` in compact density.

`tokens.css` does not define a repository-wide spacing scale. Components use their established gaps and layout variables. A single area does not add a new global spacing scale.

### Shared dimensions

| Token                        | Value  | Use                            |
| ---------------------------- | ------ | ------------------------------ |
| `--control-height-compact`   | `32px` | Compact buttons and controls   |
| `--control-height-standard`  | `36px` | Standard buttons and controls  |
| `--control-height-prominent` | `40px` | Prominent buttons and controls |
| `--border-width`             | `1px`  | Standard structural border     |

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
- Shared `AppSelect`, `SegmentedControl`, `Toggle`, and menu components provide the common focus, selection, and disabled states. Feature components reuse them.
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
- Shared dialog components use native `<dialog>`. They preserve focus containment, Escape behavior, dismissal, and focus restoration.
- Dialogs, details drawers, and Quick Actions share one restrained dim backdrop without blur. Nested surfaces do not add another backdrop.
- The Library details drawer is an opaque overlay that enters from the right. It does not move or resize the Library content.
- Frosted-glass panels, decorative blur, glow, and gradients are not general surface treatments. Existing image and Reader overlay blur remains limited to those features.
- Functional gradients are limited to local effects such as loading shimmer and transparency checkers. They remain subtle and respect reduced motion. Empty states do not use gradients or glowing artwork.

## Motion

Motion is disabled by default. Users can enable it when the operating system does not request reduced motion. When system reduced motion is active, motion durations are zero. Motion never delays dismissal, focus restoration, or user input.

Use the shared duration vocabulary:

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
- The sidebar and titlebar use the same `150ms` width interpolation during collapse and expansion. Their widths do not animate independently, and the Library subtree is not transformed.
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
