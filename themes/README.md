# Official Archeion themes

Archeion Dark and Archeion Light are bundled with the app. Their canonical color
manifests live in [`built-in/`](built-in/); application, Reader, native window, and
startup colors derive from those manifests. Edit built-in colors there and run
`pnpm run themes:generate`, then `pnpm run themes:check`.

The five optional packages below are repository downloads. They are not bundled,
installed automatically, or listed in the app before import. Each includes both
application colors and Reader overrides.

| Theme                  | Appearance                                             | Manifest                                        |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Archeion Nocturne      | Deep graphite with icy-blue accents                    | [theme.json](archeion-nocturne/theme.json)      |
| Archeion Mono          | Dark neutrals with grayscale accents                   | [theme.json](archeion-mono/theme.json)          |
| Archeion Chalk         | Near-white neutrals with grayscale accents             | [theme.json](archeion-chalk/theme.json)         |
| Archeion Classic Dark  | Previous built-in dark application and Reader palette  | [theme.json](archeion-classic-dark/theme.json)  |
| Archeion Classic Light | Previous built-in light application and Reader palette | [theme.json](archeion-classic-light/theme.json) |

## Install an optional theme

1. Open the manifest link above and save its raw JSON as `theme.json`.
2. In Archeion, open **Settings → Appearance → Manage themes** and choose
   **Import**. Select the downloaded JSON file.
3. Select the imported theme and choose **Use theme** to apply its application
   colors. You can also preview it first; acknowledge any contrast warnings before
   keeping a preview.
4. To use its Reader colors, select it separately in **Settings → Reader → Reader
   theme** or the Reader settings panel.

Imports are stored in Archeion's application-data `themes/<id>/theme.json`, outside
your archives. They persist across restarts and archive switches. Repository edits
do not update installed copies: import the updated manifest and confirm replacement,
or edit the installed copy via **Open themes folder**, then choose **Reload themes**.
Use Theme Manager's **Remove** action to delete an installed package.

See [Custom themes](../docs/custom-themes.md) for the schema, storage rules, contrast
diagnostics, and the Moon Ink and Paper Light examples.
