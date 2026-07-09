export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderProgressPlacement = "top" | "side";

export type ReaderFontFamily = "serif" | "sans" | "system" | "literata" | "atkinson";

export type ReaderSettings = {
  fontSize: number;
  fontFamily: ReaderFontFamily;
  lineHeight: number;
  margin: number;
  theme: ReaderTheme;
  progressPlacement: ReaderProgressPlacement;
};

export const defaultReaderSettings: Readonly<ReaderSettings> = Object.freeze({
  fontSize: 18,
  fontFamily: "serif",
  lineHeight: 1.6,
  margin: 48,
  theme: "dark",
  progressPlacement: "top",
});

type ReaderSettingsInput = Partial<Record<keyof ReaderSettings, unknown>>;

export function normalizeReaderSettings(settings?: ReaderSettingsInput): ReaderSettings {
  return {
    fontSize: numberOrDefault(settings?.fontSize, defaultReaderSettings.fontSize),
    fontFamily: normalizeReaderFontFamily(settings?.fontFamily),
    lineHeight: numberOrDefault(settings?.lineHeight, defaultReaderSettings.lineHeight),
    margin: numberOrDefault(settings?.margin, defaultReaderSettings.margin),
    theme: isReaderTheme(settings?.theme) ? settings.theme : defaultReaderSettings.theme,
    progressPlacement: isReaderProgressPlacement(settings?.progressPlacement)
      ? settings.progressPlacement
      : defaultReaderSettings.progressPlacement,
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isReaderFontFamily(value: unknown): value is ReaderFontFamily {
  return (
    value === "serif" ||
    value === "sans" ||
    value === "system" ||
    value === "literata" ||
    value === "atkinson"
  );
}

export function normalizeReaderFontFamily(value: unknown): ReaderFontFamily {
  return isReaderFontFamily(value) ? value : defaultReaderSettings.fontFamily;
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return value === "light" || value === "dark" || value === "sepia";
}

function isReaderProgressPlacement(value: unknown): value is ReaderProgressPlacement {
  return value === "top" || value === "side";
}
