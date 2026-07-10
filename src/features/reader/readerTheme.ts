import type { ReaderSettings } from "../../types/reader";
import { readerFontFaceCssForId, readerFontFamilyForId } from "./readerFonts";

const READER_CONTENT_THEME_NAME = "archeion-reader";
const READER_FONT_FACE_STYLE_ID = "archeion-reader-font-faces";

export type ReaderContentSettings = Pick<
  ReaderSettings,
  "fontFamily" | "fontSize" | "lineHeight" | "margin" | "theme"
>;

const themeColors = {
  dark: {
    background: "#171717",
    text: "#d6d3d9",
    strong: "#ebe8ef",
    link: "#8fc1e3",
  },
  light: {
    background: "#f5f4f1",
    text: "#353331",
    strong: "#171615",
    link: "#356f96",
  },
  sepia: {
    background: "#eee5d2",
    text: "#4b4033",
    strong: "#2e271f",
    link: "#765b34",
  },
};

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

export function readerThemeForSettings(settings: ReaderContentSettings) {
  const colors = themeColors[settings.theme];
  const fontFamily = readerFontFamilyForId(settings.fontFamily);
  return {
    html: {
      background: `${colors.background} !important`,
      "overscroll-behavior": "contain !important",
      "scrollbar-width": "none !important",
    },
    body: {
      color: `${colors.text} !important`,
      background: `${colors.background} !important`,
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
      color: `${colors.text} !important`,
    },
    "h1, h2, h3, h4, h5, h6": {
      color: `${colors.strong} !important`,
      "font-weight": "500 !important",
      "line-height": "1.3 !important",
    },
    a: {
      color: `${colors.link} !important`,
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

export function createReaderContentTheme(settings: ReaderContentSettings): ReaderContentTheme {
  return {
    fontFaceCss: readerFontFaceCssForSettings(settings),
    name: READER_CONTENT_THEME_NAME,
    rules: readerThemeForSettings(settings),
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
    left.margin === right.margin &&
    left.theme === right.theme
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
