import darkManifest from "../../themes/built-in/archeion-dark/theme.json" with { type: "json" };
import lightManifest from "../../themes/built-in/archeion-light/theme.json" with { type: "json" };
import { validateThemeManifest } from "./validateThemeManifest";
import {
  appThemePublicTokenRegistry,
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
  const tokens: Record<string, ThemeColor> = {};
  for (const key of Object.keys(appThemePublicTokenRegistry)) {
    const color = manifest.app[key as AppThemePublicToken];
    if (color === undefined || color.length !== 7) {
      throw new Error(`Built-in ${manifest.id} requires opaque application token ${key}.`);
    }
    tokens[key] = color;
  }
  // Every public key was checked above; built-ins cannot inherit missing values.
  return {
    manifest,
    tokens: Object.freeze(tokens) as Readonly<Record<AppThemePublicToken, ThemeColor>>,
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

// R.5 activates the canonical Reader sections; keep existing reading surfaces until then.
const reader = Object.freeze({
  dark: Object.freeze({
    background: "#171717",
    surface: "#1d1d1f",
    line: "#303034",
    text: "#d6d3d9",
    strong: "#ebe8ef",
    muted: "#bab7bd",
    focus: "#c9c4ef",
    danger: "#e77f8c",
    link: "#b8d9ef",
    codeBackground: "#1d1d1f",
    selection: "#243240",
  }),
  light: Object.freeze({
    background: "#f5f4f1",
    surface: "#ebe9e4",
    line: "#d8d5ce",
    text: "#353331",
    strong: "#171615",
    muted: "#6c6863",
    focus: "#386f99",
    danger: "#972f3f",
    link: "#22577c",
    codeBackground: "#ebe9e4",
    selection: "#c4dbea",
  }),
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
