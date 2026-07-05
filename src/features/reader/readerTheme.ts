import type { ReaderSettings } from "../../types/reader";

const fontFamilies: Record<string, string> = {
  serif:
    '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: '"Segoe UI", Arial, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

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

export function readerThemeForSettings(settings: ReaderSettings) {
  const colors = themeColors[settings.theme];
  const fontFamily = fontFamilies[settings.fontFamily] ?? fontFamilies.serif;

  return {
    body: {
      color: `${colors.text} !important`,
      background: `${colors.background} !important`,
      "font-family": `${fontFamily} !important`,
      "font-size": `${settings.fontSize}px !important`,
      "line-height": `${settings.lineHeight} !important`,
      padding: `0 ${settings.margin}px !important`,
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
    img: {
      "max-width": "100% !important",
      "object-fit": "contain !important",
    },
  };
}
