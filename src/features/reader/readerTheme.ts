import type { ReaderSettings } from "../../types/reader";
import type { ResolvedReaderThemeTokens } from "../../themes/themeTokenRegistry";
import { readerFontFaceCssForId, readerFontFamilyForId } from "./readerFonts";

const READER_CONTENT_THEME_NAME = "archeion-reader";
const READER_FONT_FACE_STYLE_ID = "archeion-reader-font-faces";

export type ReaderContentSettings = Pick<
  ReaderSettings,
  "fontFamily" | "fontSize" | "lineHeight" | "margin"
>;

type ReaderThemeRules = ReturnType<typeof readerThemeForSettings>;

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
) {
  const fontFamily = readerFontFamilyForId(settings.fontFamily);
  return {
    html: {
      background: `${palette.background} !important`,
      "overscroll-behavior": "contain !important",
      "scrollbar-width": "none !important",
    },
    body: {
      color: `${palette.text} !important`,
      background: `${palette.background} !important`,
      "font-size": `${settings.fontSize}px !important`,
      "line-height": `${settings.lineHeight} !important`,
      padding: `0 ${settings.margin}px !important`,
      "box-sizing": "border-box !important",
      "overflow-x": "hidden !important",
      "overscroll-behavior": "contain !important",
      "scrollbar-width": "none !important",
    },
    "body, body *": {
      "font-family": `${fontFamily} !important`,
    },
    "body::-webkit-scrollbar": {
      display: "none !important",
    },
    "*, *::before, *::after": {
      "box-sizing": "border-box !important",
    },
    "p, li": {
      color: `${palette.text} !important`,
    },
    "h1, h2, h3, h4, h5, h6": {
      color: `${palette.strong} !important`,
      "font-weight": "500 !important",
      "line-height": "1.3 !important",
    },
    a: {
      color: `${palette.link} !important`,
    },
    "img, svg, video, canvas": {
      "max-width": "100% !important",
      height: "auto !important",
      "object-fit": "contain !important",
    },
    "table, pre": {
      "max-width": "100% !important",
      "overflow-wrap": "anywhere !important",
      "white-space": "pre-wrap !important",
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
