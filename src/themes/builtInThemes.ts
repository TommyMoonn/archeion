import darkManifest from "../../themes/built-in/archeion-dark/theme.json" with { type: "json" };
import lightManifest from "../../themes/built-in/archeion-light/theme.json" with { type: "json" };
import { validateThemeManifest } from "./validateThemeManifest";
import {
  appThemePublicTokenRegistry,
  readerThemePublicTokenRegistry,
  type AppThemeBase,
  type AppThemePublicToken,
  type ReaderThemeBase,
  type ReaderThemePublicToken,
  type ThemeColor,
} from "./themeTokenRegistry";

function builtInManifest(value: unknown, base: AppThemeBase) {
  const result = validateThemeManifest(value, { expectedId: `archeion-${base}` });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const manifest = result.manifest;
  if (manifest.base !== base) throw new Error("Invalid built-in application base.");
  if (manifest.reader?.base !== base) throw new Error("Invalid built-in Reader base.");
  const tokens: Record<string, ThemeColor> = {};
  for (const key of Object.keys(appThemePublicTokenRegistry)) {
    const color = manifest.app[key as AppThemePublicToken];
    if (color === undefined || color.length !== 7) {
      throw new Error(`Built-in ${manifest.id} requires opaque application token ${key}.`);
    }
    tokens[key] = color;
  }
  const readerTokens: Record<string, ThemeColor> = {};
  for (const key of Object.keys(readerThemePublicTokenRegistry)) {
    const color = manifest.reader[key as ReaderThemePublicToken];
    if (color === undefined || color.length !== 7) {
      throw new Error(`Built-in ${manifest.id} requires opaque Reader token ${key}.`);
    }
    readerTokens[key] = color;
  }
  // Every public key was checked above; built-ins cannot inherit missing values.
  return {
    manifest,
    tokens: Object.freeze(tokens) as Readonly<Record<AppThemePublicToken, ThemeColor>>,
    // Every Reader public key was checked above, independently of the application palette.
    readerTokens: Object.freeze(readerTokens) as ReaderThemeBaseTokens,
  };
}

const dark = builtInManifest(darkManifest, "dark");
const light = builtInManifest(lightManifest, "light");
export const builtInThemeManifests = Object.freeze({ dark: dark.manifest, light: light.manifest });
const app = Object.freeze({ dark: dark.tokens, light: light.tokens });
export const builtInShellPalettes = Object.freeze({
  dark: Object.freeze({ background: app.dark.main, foreground: app.dark.text }),
  light: Object.freeze({ background: app.light.main, foreground: app.light.text }),
});

type ReaderThemeBaseTokens = Readonly<Record<ReaderThemePublicToken, ThemeColor>>;

const reader = Object.freeze({
  dark: dark.readerTokens,
  light: light.readerTokens,
  sepia: Object.freeze({
    background: "#eee5d2",
    surface: "#e4d8c0",
    line: "#d1c2a7",
    text: "#4b4033",
    strong: "#2e271f",
    muted: "#6d5a47",
    focus: "#765f43",
    danger: "#8f3f47",
    link: "#5a4024",
    codeBackground: "#e4d8c0",
    selection: "#ede0c8",
  }),
} satisfies Record<ReaderThemeBase, ReaderThemeBaseTokens>);

export const builtInThemeRegistry = Object.freeze({ app, reader });
