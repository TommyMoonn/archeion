import { normalizeFontFamily } from "./fontFamily";

export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderProgressPlacement = "top" | "side";
export type ReaderMode = "paged" | "continuous";
export const readerReadingWidthOptions = [
  { label: "Narrow", value: "narrow" },
  { label: "Comfortable", value: "comfortable" },
  { label: "Wide", value: "wide" },
  { label: "Full", value: "full" },
] as const;
export type ReaderReadingWidth = (typeof readerReadingWidthOptions)[number]["value"];

export type ReaderBuiltinFontId = "serif" | "sans" | "system" | "literata" | "atkinson";
export type ReaderFontSelection =
  { kind: "builtin"; id: ReaderBuiltinFontId } | { kind: "system"; family: string };

export type ReaderNavigationPosition = {
  cfi?: string;
  spineIndex?: number;
};

export type ReaderNavigationItem = {
  id: string;
  label: string;
  href: string;
  target: string;
  position: ReaderNavigationPosition;
};

export type ReaderChapter = ReaderNavigationItem & {
  depth: number;
  parentId?: string;
};

export type ReaderLandmark = ReaderNavigationItem & {
  semanticType?: string;
};

export type ReaderPageReference = ReaderNavigationItem;

export type ReaderNavigationState = {
  chapterProgress?: number;
  chapters: readonly ReaderChapter[];
  currentChapterId?: string;
  landmarks: readonly ReaderLandmark[];
  pageReferences: readonly ReaderPageReference[];
  status: "loading" | "ready";
};

export type ReaderSettings = {
  fontSize: number;
  fontFamily: ReaderFontSelection;
  lineHeight: number;
  readingWidth: ReaderReadingWidth;
  theme: ReaderTheme;
  progressPlacement: ReaderProgressPlacement;
  mode: ReaderMode;
};

export const defaultReaderSettings: Readonly<ReaderSettings> = Object.freeze({
  fontSize: 18,
  fontFamily: Object.freeze({ kind: "builtin", id: "serif" }),
  lineHeight: 1.6,
  readingWidth: "comfortable",
  theme: "dark",
  progressPlacement: "top",
  mode: "paged",
});

type ReaderSettingsInput = Partial<Record<keyof ReaderSettings, unknown>>;

export function normalizeReaderSettings(settings?: ReaderSettingsInput): ReaderSettings {
  return {
    fontSize: numberInRangeOrDefault(settings?.fontSize, 14, 28, defaultReaderSettings.fontSize),
    fontFamily: normalizeReaderFontSelection(settings?.fontFamily),
    lineHeight: numberInRangeOrDefault(
      settings?.lineHeight,
      1.4,
      2,
      defaultReaderSettings.lineHeight,
    ),
    readingWidth: isReaderReadingWidth(settings?.readingWidth)
      ? settings.readingWidth
      : defaultReaderSettings.readingWidth,
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

function isReaderReadingWidth(value: unknown): value is ReaderReadingWidth {
  return readerReadingWidthOptions.some((option) => option.value === value);
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

export function isReaderBuiltinFontId(value: unknown): value is ReaderBuiltinFontId {
  return (
    value === "serif" ||
    value === "sans" ||
    value === "system" ||
    value === "literata" ||
    value === "atkinson"
  );
}

export function normalizeReaderFontSelection(value: unknown): ReaderFontSelection {
  if (isReaderBuiltinFontId(value)) return { kind: "builtin", id: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const selection = value as Record<string, unknown>;
    if (selection.kind === "builtin" && isReaderBuiltinFontId(selection.id)) {
      return { kind: "builtin", id: selection.id };
    }
    const family = selection.kind === "system" ? normalizeFontFamily(selection.family) : null;
    if (family) return { kind: "system", family };
  }
  return { kind: "builtin", id: "serif" };
}

export function readerFontSelectionsEqual(
  left: ReaderFontSelection,
  right: ReaderFontSelection,
): boolean {
  return left.kind === "builtin"
    ? right.kind === "builtin" && left.id === right.id
    : right.kind === "system" && left.family === right.family;
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return value === "light" || value === "dark" || value === "sepia";
}

function isReaderProgressPlacement(value: unknown): value is ReaderProgressPlacement {
  return value === "top" || value === "side";
}
