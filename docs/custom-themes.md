# Custom themes

Archeion theme manifests are strict, color-only JSON files. They can recolor the application and EPUB reader without changing layout, typography, motion, assets, or behavior. Themes are archive-local so they remain with the archive when its `.archeion` directory is copied or backed up.

## Package layout

Store each theme in one direct child directory of `.archeion/themes/`:

```text
My Archive/
└── .archeion/
    └── themes/
        └── moon-ink/
            └── theme.json
```

The directory name must exactly match the manifest `id`. Archeion reads only the exact `theme.json` file from each direct child directory. Hidden directories and nested packages are ignored. Additional package files are ignored and are never executed by schema version 1.

## Schema

The canonical version 1 schema is published at:

```text
https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json
```

Add that URL as `$schema` for completion and validation in JSON-aware editors:

```json
{
  "$schema": "https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json",
  "schemaVersion": 1,
  "id": "my-theme",
  "name": "My Theme",
  "base": "dark",
  "app": {
    "accent": "#8FC1E3"
  }
}
```

`$schema` is optional. When present, it must be the canonical URL above. Archeion never downloads the schema when loading a theme; runtime validation is offline.

See the complete [Moon Ink](../examples/themes/moon-ink/theme.json) and [Paper Light](../examples/themes/paper-light/theme.json) examples for dark- and light-based packages.

## Manifest fields

| Field           | Required | Rules                                                                                                                              |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`       | No       | If present, must equal the canonical version 1 schema URL.                                                                         |
| `schemaVersion` | Yes      | Integer `1`.                                                                                                                       |
| `id`            | Yes      | 3–64 characters; lowercase ASCII letters, digits, `.`, `_`, and `-`; starts with a letter or digit; matches the package directory. |
| `name`          | Yes      | 1–80 Unicode characters; single-line, control-free, and containing at least one non-whitespace character.                          |
| `author`        | No       | 1–80 Unicode characters with the same metadata restrictions when present; omit it instead of using an empty string.                |
| `description`   | No       | 1–240 Unicode characters with the same metadata restrictions when present; omit it instead of using an empty string.               |
| `base`          | Yes      | `dark` or `light`; supplies omitted application colors.                                                                            |
| `app`           | Yes      | Strict object containing at least one supported application color override.                                                        |
| `reader`        | No       | Strict object with a `dark`, `light`, or `sepia` base and at least one reader color override.                                      |

Every color must use `#RRGGBB` or `#RRGGBBAA`. CSS functions, variables, keywords, gradients, and URLs are invalid. Unknown fields and token names are rejected.

## Partial overrides

Themes do not need to repeat an entire palette. `base` supplies every omitted application token, while `reader.base` supplies every omitted reader token. A reader palette is optional and independent from the application palette.

This is a complete minimal theme:

```json
{
  "schemaVersion": 1,
  "id": "blue-accent",
  "name": "Blue Accent",
  "base": "light",
  "app": {
    "accent": "#285F88"
  }
}
```

Custom themes cannot inherit from other custom themes.

## Application tokens

| Token           | Meaning                                         |
| --------------- | ----------------------------------------------- |
| `canvas`        | Application canvas behind primary surfaces.     |
| `canvasDeep`    | Deeper canvas separating nested regions.        |
| `surface`       | Default control and content surface.            |
| `surfaceRaised` | Raised controls, cards, and secondary surfaces. |
| `surfaceHover`  | Hover treatment for ordinary raised surfaces.   |
| `frame`         | Window frame and title bar.                     |
| `sidebar`       | Library navigation sidebar.                     |
| `main`          | Primary application workspace.                  |
| `mainRaised`    | Raised surface within the primary workspace.    |
| `line`          | Default borders and separators.                 |
| `lineStrong`    | Emphasized borders and separators.              |
| `text`          | Primary body text.                              |
| `textStrong`    | Headings and emphasized text.                   |
| `muted`         | Secondary labels and metadata.                  |
| `mutedSoft`     | De-emphasized text and inactive affordances.    |
| `accent`        | Primary interactive accent.                     |
| `accentStrong`  | Emphasized accent text and active controls.     |
| `focus`         | Keyboard focus indicators.                      |
| `success`       | Successful outcomes.                            |
| `warning`       | Cautionary, non-fatal outcomes.                 |
| `error`         | Errors and destructive outcomes.                |
| `info`          | Neutral informational outcomes.                 |

Archeion derives subtle lines, tinted backgrounds and borders, selected and disabled states, destructive aliases, shell interaction states, and elevation shadows from these public colors. Component-specific values are not part of the authoring contract.

## Reader tokens

| Token            | Meaning                                        |
| ---------------- | ---------------------------------------------- |
| `background`     | Reader page and EPUB content background.       |
| `surface`        | Reader controls, panels, and code blocks.      |
| `line`           | Reader borders and separators.                 |
| `text`           | EPUB body text and primary reader text.        |
| `strong`         | EPUB headings and emphasized reader text.      |
| `muted`          | Reader metadata and secondary text.            |
| `focus`          | Reader focus indicators.                       |
| `danger`         | Reader errors and destructive actions.         |
| `link`           | Links inside EPUB content.                     |
| `codeBackground` | Code and preformatted content background.      |
| `selection`      | Text-selection background inside EPUB content. |

Archeion derives quotation and visited-link treatments. Reader typography remains controlled by Reader settings and cannot be changed by a theme.

## Fixed colors

Some colors communicate identities that must remain recognizable across themes:

- The Windows close button keeps its platform-style white-on-red hover treatment.
- Annotation highlight identities remain yellow, green, blue, and rose. Changing themes does not reinterpret a saved highlight color.
- Transparent values and `currentColor` continue to inherit from their owning semantic context.

These fixed colors are not manifest tokens.

## Safety and contrast

Version 1 accepts no CSS, selectors, scripts, URLs, fonts, images, layout values, or local assets. `$schema` is editor metadata only and is never fetched by Archeion.

Use enough contrast for body text, muted text, controls, borders, and focus indicators. Schema-valid colors may still produce poor contrast; validation warnings do not change the manifest or invent replacement colors.
