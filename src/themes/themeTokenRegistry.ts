export const ARCHEION_THEME_SCHEMA_VERSION = 1 as const;
export const ARCHEION_THEME_SCHEMA_URL =
  "https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json" as const;

export const appThemeBases = ["dark", "light"] as const;
export const readerThemeBases = ["dark", "light", "sepia"] as const;

export type AppThemeBase = (typeof appThemeBases)[number];
export type ReaderThemeBase = (typeof readerThemeBases)[number];
export type ThemeColor = `#${string}`;

type ThemeTokenDefinition = Readonly<{
  cssVariable: `--${string}`;
  description: string;
}>;

function defineTokenRegistry<const Registry extends Record<string, ThemeTokenDefinition>>(
  registry: Registry,
): Readonly<Registry> {
  return Object.freeze(registry);
}

export const appThemePublicTokenRegistry = defineTokenRegistry({
  canvas: { cssVariable: "--canvas", description: "Application canvas behind primary surfaces." },
  canvasDeep: {
    cssVariable: "--canvas-deep",
    description: "Deeper canvas used to separate nested application regions.",
  },
  surface: { cssVariable: "--surface", description: "Default control and content surface." },
  surfaceRaised: {
    cssVariable: "--surface-raised",
    description: "Raised controls, cards, and secondary surfaces.",
  },
  surfaceHover: {
    cssVariable: "--surface-hover",
    description: "Hover treatment for ordinary raised surfaces.",
  },
  frame: { cssVariable: "--surface-app-frame", description: "Window frame and title bar." },
  sidebar: { cssVariable: "--surface-sidebar", description: "Library navigation sidebar." },
  main: { cssVariable: "--surface-main", description: "Primary application workspace." },
  mainRaised: {
    cssVariable: "--surface-main-raised",
    description: "Raised surface within the primary workspace.",
  },
  line: { cssVariable: "--line", description: "Default borders and separators." },
  lineStrong: {
    cssVariable: "--line-strong",
    description: "Emphasized borders and separators.",
  },
  text: { cssVariable: "--text", description: "Primary body text." },
  textStrong: { cssVariable: "--text-strong", description: "Headings and emphasized text." },
  muted: { cssVariable: "--muted", description: "Secondary labels and metadata." },
  mutedSoft: {
    cssVariable: "--muted-soft",
    description: "De-emphasized text and inactive affordances.",
  },
  accent: { cssVariable: "--accent", description: "Primary interactive accent." },
  accentStrong: {
    cssVariable: "--accent-strong",
    description: "Emphasized accent text and active controls.",
  },
  focus: { cssVariable: "--focus", description: "Keyboard focus indicators." },
  success: { cssVariable: "--success", description: "Successful outcomes." },
  warning: { cssVariable: "--warning", description: "Cautionary, non-fatal outcomes." },
  error: { cssVariable: "--error", description: "Errors and destructive outcomes." },
  info: { cssVariable: "--info", description: "Neutral informational outcomes." },
});

export type AppThemePublicToken = keyof typeof appThemePublicTokenRegistry;

export const appThemeDerivedTokenRegistry = defineTokenRegistry({
  lineSubtle: { cssVariable: "--line-subtle", description: "Low-emphasis separator." },
  accentSoft: { cssVariable: "--accent-soft", description: "Soft accent background." },
  accentBorder: { cssVariable: "--accent-border", description: "Accent-tinted border." },
  selected: { cssVariable: "--selected", description: "Selected-item background." },
  active: { cssVariable: "--active", description: "Pressed or active-item background." },
  disabled: { cssVariable: "--disabled", description: "Disabled control background." },
  disabledText: { cssVariable: "--disabled-text", description: "Disabled text and icons." },
  successSoft: { cssVariable: "--success-soft", description: "Soft success background." },
  successBorder: { cssVariable: "--success-border", description: "Success-tinted border." },
  warningSoft: { cssVariable: "--warning-soft", description: "Soft warning background." },
  warningBorder: { cssVariable: "--warning-border", description: "Warning-tinted border." },
  errorStrong: { cssVariable: "--error-strong", description: "Emphasized error color." },
  errorSoft: { cssVariable: "--error-soft", description: "Soft error background." },
  errorBorder: { cssVariable: "--error-border", description: "Error-tinted border." },
  infoSoft: { cssVariable: "--info-soft", description: "Soft information background." },
  infoBorder: { cssVariable: "--info-border", description: "Information-tinted border." },
  danger: { cssVariable: "--danger", description: "Destructive-action alias." },
  dangerStrong: {
    cssVariable: "--danger-strong",
    description: "Emphasized destructive-action alias.",
  },
  dangerSoft: {
    cssVariable: "--danger-soft",
    description: "Soft destructive-action background alias.",
  },
  dangerBorder: {
    cssVariable: "--danger-border",
    description: "Destructive-action border alias.",
  },
  shellHover: {
    cssVariable: "--surface-shell-hover",
    description: "Window frame and sidebar hover treatment.",
  },
  shellActive: {
    cssVariable: "--surface-shell-active",
    description: "Window frame and sidebar active treatment.",
  },
  cardShadow: { cssVariable: "--shadow-card", description: "Card elevation shadow." },
  popoverShadow: {
    cssVariable: "--shadow-popover",
    description: "Menu and popover elevation shadow.",
  },
  dialogShadow: { cssVariable: "--shadow-dialog", description: "Dialog elevation shadow." },
  drawerShadow: { cssVariable: "--shadow-drawer", description: "Drawer elevation shadow." },
});

export type AppThemeDerivedToken = keyof typeof appThemeDerivedTokenRegistry;
export const appThemeResolvedTokenRegistry = Object.freeze({
  ...appThemePublicTokenRegistry,
  ...appThemeDerivedTokenRegistry,
});
export type AppThemeResolvedToken = keyof typeof appThemeResolvedTokenRegistry;

export const readerThemePublicTokenRegistry = defineTokenRegistry({
  background: { cssVariable: "--reader-bg", description: "Reader page background." },
  surface: { cssVariable: "--reader-surface", description: "Reader controls and panels." },
  line: { cssVariable: "--reader-line", description: "Reader borders and separators." },
  text: { cssVariable: "--reader-text", description: "Reader body text." },
  strong: { cssVariable: "--reader-strong", description: "Reader headings and strong text." },
  muted: { cssVariable: "--reader-muted", description: "Reader metadata and secondary text." },
  focus: { cssVariable: "--reader-focus", description: "Reader focus indicators." },
  danger: { cssVariable: "--reader-danger", description: "Reader errors and destructive actions." },
  link: { cssVariable: "--reader-link", description: "Links inside EPUB content." },
  codeBackground: {
    cssVariable: "--reader-code-background",
    description: "Code and preformatted content background.",
  },
  selection: {
    cssVariable: "--reader-selection",
    description: "Text-selection background inside EPUB content.",
  },
});

export type ReaderThemePublicToken = keyof typeof readerThemePublicTokenRegistry;

export const readerThemeDerivedTokenRegistry = defineTokenRegistry({
  lineSubtle: { cssVariable: "--reader-line-subtle", description: "Low-emphasis reader line." },
  quotation: {
    cssVariable: "--reader-quotation",
    description: "Quotation border and emphasis treatment.",
  },
  visitedLink: {
    cssVariable: "--reader-link-visited",
    description: "Visited links inside EPUB content.",
  },
});

export type ReaderThemeDerivedToken = keyof typeof readerThemeDerivedTokenRegistry;
export const readerThemeResolvedTokenRegistry = Object.freeze({
  ...readerThemePublicTokenRegistry,
  ...readerThemeDerivedTokenRegistry,
});
export type ReaderThemeResolvedToken = keyof typeof readerThemeResolvedTokenRegistry;

export type AppThemeOverrides = Partial<Record<AppThemePublicToken, ThemeColor>>;
export type ReaderThemeOverrides = Partial<Record<ReaderThemePublicToken, ThemeColor>>;
export type ResolvedAppThemeTokens = Readonly<Record<AppThemeResolvedToken, string>>;
export type ResolvedReaderThemeTokens = Readonly<Record<ReaderThemeResolvedToken, string>>;
