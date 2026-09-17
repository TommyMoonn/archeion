import type { ReaderSettings } from "../../types/reader";
import type { ResolvedReaderThemeTokens } from "../../themes/themeTokenRegistry";
import { readerFontFaceCssForId, readerFontFamilyForId } from "./readerFonts";

const READER_CONTENT_THEME_NAME = "archeion-reader";
const READER_FONT_FACE_STYLE_ID = "archeion-reader-font-faces";
const READER_CONTENT_BLOCK_INSET_PX = 64;
const READER_RUNNING_TEXT_SELECTOR =
  "article, aside, main, section, nav, header, footer, div, p, ol, ul, li, dl, dt, dd, blockquote, figcaption, address, td, th";
const READER_INLINE_TEXT_SELECTOR = "span, em, strong, b, i, u, s, mark, q, cite, abbr, time, font";
const READER_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

export type ReaderContentSettings = Pick<
  ReaderSettings,
  "fontFamily" | "fontSize" | "lineHeight" | "margin"
>;

type ReaderThemeRules = Record<string, Record<string, string>>;

type ReaderThemeTarget = {
  themes: {
    register: (name: string, rules: ReaderThemeRules) => void;
    select: (name: string) => void;
  };
};

export type ReaderContentTheme = {
  fontFaceCss: string | undefined;
  name: typeof READER_CONTENT_THEME_NAME;
  rules: ReaderThemeRules;
};

export function readerFontFaceCssForSettings(settings: ReaderContentSettings) {
  return readerFontFaceCssForId(settings.fontFamily);
}

export function readerThemeForSettings(
  settings: ReaderContentSettings,
  palette: ResolvedReaderThemeTokens,
): ReaderThemeRules {
  const fontFamily = readerFontFamilyForId(settings.fontFamily);
  return {
    html: {
      background: `${palette.background} !important`,
    },
    body: {
      color: `${palette.text} !important`,
      background: `${palette.background} !important`,
      "font-family": `${fontFamily} !important`,
      "font-size": `${settings.fontSize}px !important`,
      "line-height": `${settings.lineHeight} !important`,
      "padding-block": `${READER_CONTENT_BLOCK_INSET_PX}px !important`,
      "padding-inline": `${settings.margin}px !important`,
    },
    [READER_RUNNING_TEXT_SELECTOR]: {
      color: `${palette.text} !important`,
      "font-family": `${fontFamily} !important`,
      "font-size": `${settings.fontSize}px !important`,
      "line-height": `${settings.lineHeight} !important`,
    },
    [READER_HEADING_SELECTOR]: {
      color: `${palette.strong} !important`,
      "font-family": `${fontFamily} !important`,
      "line-height": `${settings.lineHeight} !important`,
    },
    [READER_INLINE_TEXT_SELECTOR]: {
      color: "inherit !important",
      "font-family": "inherit !important",
      "font-size": "inherit !important",
      "line-height": "inherit !important",
    },
    a: {
      color: `${palette.link} !important`,
      "font-family": "inherit !important",
      "font-size": "inherit !important",
      "line-height": "inherit !important",
    },
  };
}

export function createReaderContentTheme(
  settings: ReaderContentSettings,
  palette: ResolvedReaderThemeTokens,
): ReaderContentTheme {
  return {
    fontFaceCss: readerFontFaceCssForSettings(settings),
    name: READER_CONTENT_THEME_NAME,
    rules: readerThemeForSettings(settings, palette),
  };
}

export function readerContentSettingsEqual(
  left: ReaderContentSettings,
  right: ReaderContentSettings,
): boolean {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.margin === right.margin
  );
}

export function applyReaderContentTheme(
  target: ReaderThemeTarget | null | undefined,
  theme: ReaderContentTheme,
  documents: Array<Document | null | undefined> = [],
): void {
  target?.themes.register(theme.name, theme.rules);
  target?.themes.select(theme.name);

  const uniqueDocuments = new Set(
    documents.filter((document): document is Document => Boolean(document)),
  );

  for (const document of uniqueDocuments) {
    applyReaderFontFaces(document, theme.fontFaceCss);
  }
}

function applyReaderFontFaces(document: Document | null, fontFaceCss: string | undefined) {
  if (!document?.head) {
    return;
  }

  const existingStyle = document.getElementById(READER_FONT_FACE_STYLE_ID);

  if (!fontFaceCss) {
    existingStyle?.remove();
    return;
  }

  const style = existingStyle ?? document.createElement("style");
  style.id = READER_FONT_FACE_STYLE_ID;
  style.textContent = fontFaceCss;

  if (!existingStyle) {
    document.head.appendChild(style);
  }
}
