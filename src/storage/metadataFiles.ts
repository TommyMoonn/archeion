import type { EpubSourceMetadata } from "../types/book";
import type {
  ArchiveAppearanceSettings,
  ArchiveAppThemeSelection,
  ArchiveImportSettings,
  ArchiveReaderThemeSelection,
} from "../types/settings";

export type LibraryBookMetadata = {
  relativePath: string;
  isFavorite: boolean;
  coverPath?: string;
  sourceMetadata?: EpubSourceMetadata;
  fileSize?: number;
  fileModifiedAt?: number;
  addedAt: string;
  updatedAt: string;
};

export type LibraryMetadata = {
  version: 1;
  books: Record<string, LibraryBookMetadata>;
};

export type ReadingProgress = {
  cfi?: string;
  percent: number;
  lastOpenedAt?: string;
};

export type ProgressMetadata = {
  version: 1;
  progress: Record<string, ReadingProgress>;
};

export type SettingsMetadata = {
  version: 3;
  import: ArchiveImportSettings;
};

export type LegacySettingsMetadata = {
  version?: unknown;
  reader?: unknown;
  library?: unknown;
  filesAndMetadata?: unknown;
  import?: unknown;
  appearance?: unknown;
};

export type MetadataBundle = {
  library: LibraryMetadata;
  progress: ProgressMetadata;
  settings: SettingsMetadata;
};

export const defaultArchiveImportSettings: Readonly<ArchiveImportSettings> = Object.freeze({});
export const defaultArchiveAppearanceSettings: Readonly<ArchiveAppearanceSettings> = Object.freeze({
  appTheme: Object.freeze({ kind: "inherit" }),
  readerTheme: Object.freeze({ kind: "inherit" }),
});

export function createLibraryMetadata(): LibraryMetadata {
  return { version: 1, books: {} };
}

export function createProgressMetadata(): ProgressMetadata {
  return { version: 1, progress: {} };
}

export function createSettingsMetadata(): SettingsMetadata {
  return {
    version: 3,
    import: { ...defaultArchiveImportSettings },
  };
}

function normalizeOptionalFolderPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replaceAll("\\", "/");
  return trimmed ? trimmed : undefined;
}

export function normalizeArchiveImportSettings(
  settings?: Partial<ArchiveImportSettings>,
): ArchiveImportSettings {
  return {
    defaultDestinationFolderPath: normalizeOptionalFolderPath(
      settings?.defaultDestinationFolderPath,
    ),
  };
}

export function normalizeArchiveAppearanceSettings(settings?: unknown): ArchiveAppearanceSettings {
  const appearance = isRecord(settings) ? settings : undefined;
  return {
    appTheme: normalizeAppThemeSelection(appearance?.appTheme),
    readerTheme: normalizeReaderThemeSelection(appearance?.readerTheme),
  };
}

export function normalizeSettingsMetadata(metadata?: LegacySettingsMetadata): SettingsMetadata {
  return {
    version: 3,
    import: normalizeArchiveImportSettings(
      isRecord(metadata?.import) ? metadata.import : undefined,
    ),
  };
}

export function cloneArchiveAppearanceSettings(
  settings: Readonly<ArchiveAppearanceSettings>,
): ArchiveAppearanceSettings {
  return {
    appTheme: { ...settings.appTheme },
    readerTheme: { ...settings.readerTheme },
  };
}

function normalizeAppThemeSelection(value: unknown): ArchiveAppThemeSelection {
  if (!isRecord(value)) return { kind: "inherit" };
  if (value.kind === "inherit" || value.kind === "system") return { kind: value.kind };
  if (value.kind === "builtin" && (value.id === "dark" || value.id === "light")) {
    return { kind: "builtin", id: value.id };
  }
  if (value.kind === "custom" && typeof value.id === "string") {
    return { kind: "custom", id: value.id };
  }
  return { kind: "inherit" };
}

function normalizeReaderThemeSelection(value: unknown): ArchiveReaderThemeSelection {
  if (!isRecord(value)) return { kind: "inherit" };
  if (value.kind === "inherit") return { kind: "inherit" };
  if (
    value.kind === "builtin" &&
    (value.id === "dark" || value.id === "light" || value.id === "sepia")
  ) {
    return { kind: "builtin", id: value.id };
  }
  if (value.kind === "custom" && typeof value.id === "string") {
    return { kind: "custom", id: value.id };
  }
  return { kind: "inherit" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
