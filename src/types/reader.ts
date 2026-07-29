export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderProgressPlacement = "top" | "side";
export type ReaderMode = "paged" | "continuous";

export type ReaderFontFamily = "serif" | "sans" | "system" | "literata" | "atkinson";

export type ReaderChapter = {
  id: string;
  label: string;
  href: string;
  depth: number;
  parentId?: string;
};

export type ReaderNavigationState = {
  chapterProgress?: number;
  chapters: readonly ReaderChapter[];
  currentChapterId?: string;
  status: "loading" | "ready";
};

export type ReaderSettings = {
  fontSize: number;
  fontFamily: ReaderFontFamily;
  lineHeight: number;
  margin: number;
  theme: ReaderTheme;
  progressPlacement: ReaderProgressPlacement;
  mode: ReaderMode;
};

export const defaultReaderSettings: Readonly<ReaderSettings> = Object.freeze({
  fontSize: 18,
  fontFamily: "serif",
  lineHeight: 1.6,
  margin: 48,
  theme: "dark",
  progressPlacement: "top",
  mode: "paged",
});

type ReaderSettingsInput = Partial<Record<keyof ReaderSettings, unknown>>;

export function normalizeReaderSettings(settings?: ReaderSettingsInput): ReaderSettings {
  return {
    fontSize: numberInRangeOrDefault(settings?.fontSize, 14, 28, defaultReaderSettings.fontSize),
    fontFamily: normalizeReaderFontFamily(settings?.fontFamily),
    lineHeight: numberInRangeOrDefault(
      settings?.lineHeight,
      1.4,
      2,
      defaultReaderSettings.lineHeight,
    ),
    margin: numberInRangeOrDefault(settings?.margin, 24, 72, defaultReaderSettings.margin),
    theme: isReaderTheme(settings?.theme) ? settings.theme : defaultReaderSettings.theme,
    progressPlacement: isReaderProgressPlacement(settings?.progressPlacement)
      ? settings.progressPlacement
      : defaultReaderSettings.progressPlacement,
    mode: isReaderMode(settings?.mode) ? settings.mode : defaultReaderSettings.mode,
  };
}

function isReaderMode(value: unknown): value is ReaderMode {
  return value === "paged" || value === "continuous";
}

function numberInRangeOrDefault(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
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
