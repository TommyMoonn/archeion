import { invoke, isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

import {
  defaultAppPreferences,
  type AppearanceSettings,
  type AppPreferences,
} from "../types/appSettings";
import { normalizeReaderSettings, type ReaderSettings } from "../types/reader";
import { DEFAULT_LIBRARY_SORT, normalizeLibrarySort } from "../types/library";
import type {
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
} from "../types/settings";

const LEGACY_STORAGE_KEY = "archeion:preferences";
type Listener = () => void;

type AppPreferencesCommand = "load_app_settings" | "save_app_settings";

export type AppPreferencesPersistenceStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; error: string };

type AppPreferencesPersistence = {
  isDesktop: () => boolean;
  loadDesktop: () => Promise<unknown>;
  readLegacy: () => unknown;
  removeLegacy: () => void;
  saveBrowserFallback: (preferences: AppPreferences) => void;
  saveDesktop: (preferences: AppPreferences) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "App settings could not be saved.";
}

function readLegacyPreferences(): unknown {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function removeLegacyPreferences(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function saveBrowserFallback(preferences: AppPreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(preferences));
}

async function invokeAppSettings<T>(
  command: AppPreferencesCommand,
  preferences?: AppPreferences,
): Promise<T> {
  return invoke<T>(command, preferences ? { preferences } : undefined);
}

function createDefaultPersistence(): AppPreferencesPersistence {
  return {
    isDesktop: isTauri,
    loadDesktop: () => invokeAppSettings("load_app_settings"),
    readLegacy: readLegacyPreferences,
    removeLegacy: removeLegacyPreferences,
    saveBrowserFallback,
    saveDesktop: (preferences) => invokeAppSettings<void>("save_app_settings", preferences),
  };
}

function normalizeLibraryViewMode(value: unknown): LibraryDisplaySettings["viewMode"] {
  return value === "list" ? "list" : defaultAppPreferences.library.viewMode;
}

function normalizeLibrarySettings(value: unknown): LibraryDisplaySettings {
  const settings = isRecord(value) ? value : {};
  return {
    sortBy: normalizeLibrarySort(settings.sortBy),
    viewMode: normalizeLibraryViewMode(settings.viewMode),
  };
}

function normalizeFilesAndMetadataSettings(value: unknown): FilesAndMetadataSettings {
  const settings = isRecord(value) ? value : {};
  return {
    keepEpubWritebackBackup: settings.keepEpubWritebackBackup === true,
    liveWatcherEnabled: settings.liveWatcherEnabled !== false,
    scanOnStartup: settings.scanOnStartup !== false,
  };
}

function normalizeImportConflictAction(
  value: unknown,
): GlobalImportSettings["defaultConflictAction"] {
  return value === "skip" || value === "replace" || value === "keepBoth"
    ? value
    : defaultAppPreferences.import.defaultConflictAction;
}

function normalizeImportMode(value: unknown): GlobalImportSettings["defaultMode"] {
  return value === "move" ? "move" : defaultAppPreferences.import.defaultMode;
}

function normalizeGlobalImportSettings(value: unknown): GlobalImportSettings {
  const settings = isRecord(value) ? value : {};
  return {
    defaultConflictAction: normalizeImportConflictAction(settings.defaultConflictAction),
    defaultMode: normalizeImportMode(settings.defaultMode),
  };
}

function normalizeReader(value: unknown): ReaderSettings {
  return normalizeReaderSettings(isRecord(value) ? value : undefined);
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const settings = isRecord(value) ? value : {};
  return {
    animationsEnabled: settings.animationsEnabled === true,
  };
}

function getEffectiveMotionState(preferences: AppPreferences): "off" | "on" {
  if (!preferences.appearance.animationsEnabled) {
    return "off";
  }

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "on";
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "off" : "on";
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) {
    return { ...defaultAppPreferences };
  }

  return {
    appThemePreset:
      value.appThemePreset === "system" ||
      value.appThemePreset === "dark" ||
      value.appThemePreset === "light"
        ? value.appThemePreset
        : defaultAppPreferences.appThemePreset,
    appearance: normalizeAppearanceSettings(value.appearance),
    bookCardSize:
      value.bookCardSize === "small" || value.bookCardSize === "large"
        ? value.bookCardSize
        : defaultAppPreferences.bookCardSize,
    confirmDestructiveFileActions: value.confirmDestructiveFileActions !== false,
    density: value.density === "compact" ? "compact" : defaultAppPreferences.density,
    filesAndMetadata: normalizeFilesAndMetadataSettings(value.filesAndMetadata),
    import: normalizeGlobalImportSettings(value.import),
    library: normalizeLibrarySettings(value.library),
    reader: normalizeReader(value.reader),
    rememberWindowState: value.rememberWindowState === true,
    restoreLastReader: value.restoreLastReader === true,
    showContinueReading: value.showContinueReading !== false,
    startupBehavior:
      value.startupBehavior === "show-archive-manager"
        ? "show-archive-manager"
        : defaultAppPreferences.startupBehavior,
    windowFrameStyle:
      value.windowFrameStyle === "archeion" || value.windowFrameStyle === "native"
        ? value.windowFrameStyle
        : defaultAppPreferences.windowFrameStyle,
  };
}

function mergeAppPreferences(
  base: AppPreferences,
  changes: Partial<AppPreferences>,
): AppPreferences {
  const next = normalizeAppPreferences({
    ...base,
    ...changes,
    appearance:
      changes.appearance === undefined
        ? base.appearance
        : {
            ...base.appearance,
            ...changes.appearance,
          },
    filesAndMetadata:
      changes.filesAndMetadata === undefined
        ? base.filesAndMetadata
        : {
            ...base.filesAndMetadata,
            ...changes.filesAndMetadata,
          },
    import:
      changes.import === undefined
        ? base.import
        : {
            ...base.import,
            ...changes.import,
          },
    library:
      changes.library === undefined
        ? base.library
        : {
            ...base.library,
            ...changes.library,
          },
    reader:
      changes.reader === undefined
        ? base.reader
        : {
            ...base.reader,
            ...changes.reader,
          },
  });

  if (changes.appearance === undefined) {
    next.appearance = base.appearance;
  }
  if (changes.filesAndMetadata === undefined) {
    next.filesAndMetadata = base.filesAndMetadata;
  }
  if (changes.import === undefined) {
    next.import = base.import;
  }
  if (changes.library === undefined) {
    next.library = base.library;
  }
  if (changes.reader === undefined) {
    next.reader = base.reader;
  }

  return next;
}

export class AppPreferencesStore {
  private readonly listeners = new Set<Listener>();
  private readonly persistence: AppPreferencesPersistence;
  private preferences = { ...defaultAppPreferences };
  private persistenceStatus: AppPreferencesPersistenceStatus = { status: "idle" };
  private loadPromise: Promise<void> | null = null;
  private mutationRevision = 0;
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(persistence = createDefaultPersistence()) {
    this.persistence = persistence;
    this.apply();
    void this.initialize().catch(() => undefined);
  }

  getSnapshot = () => this.preferences;

  getPersistenceSnapshot = () => this.persistenceStatus;

  getFilesAndMetadataSnapshot = () => this.preferences.filesAndMetadata;

  getImportSnapshot = () => this.preferences.import;

  getLibrarySnapshot = () => this.preferences.library;

  getReaderSnapshot = () => this.preferences.reader;

  getShowContinueReadingSnapshot = () => this.preferences.showContinueReading;

  getWindowFrameStyleSnapshot = () => this.preferences.windowFrameStyle;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadPreferences();
    return this.loadPromise;
  }

  async update(changes: Partial<AppPreferences>): Promise<AppPreferences> {
    await this.waitForPendingLoad();

    const next = mergeAppPreferences(this.preferences, changes);
    this.mutationRevision += 1;
    this.setPreferences(next);
    return this.persist(next);
  }

  reset(changes: Partial<AppPreferences> = {}): Promise<AppPreferences> {
    return this.update(mergeAppPreferences(defaultAppPreferences, changes));
  }

  private async waitForPendingLoad(): Promise<void> {
    if (this.loadPromise && this.persistenceStatus.status === "loading") {
      await this.loadPromise;
    }
  }

  private async loadPreferences() {
    const loadRevision = this.mutationRevision;
    this.setPersistenceStatus({ status: "loading" });
    const legacy = this.persistence.readLegacy();
    const legacyPreferences = isRecord(legacy) ? normalizeAppPreferences(legacy) : null;

    if (!this.persistence.isDesktop()) {
      if (this.mutationRevision === loadRevision && legacyPreferences) {
        this.setPreferences(legacyPreferences);
      }
      this.setPersistenceStatus({ status: "idle" });
      return;
    }

    try {
      const loaded = normalizeAppPreferences(await this.persistence.loadDesktop());
      if (this.mutationRevision !== loadRevision) {
        this.setPersistenceStatus({ status: "idle" });
        return;
      }

      const next = legacyPreferences ?? loaded;
      this.setPreferences(next);

      if (legacyPreferences) {
        await this.persistence.saveDesktop(next);
        this.persistence.removeLegacy();
        this.setPersistenceStatus({ status: "saved" });
      } else {
        this.setPersistenceStatus({ status: "idle" });
      }
    } catch (error) {
      const message = `App settings could not be loaded: ${errorMessage(error)}`;
      if (this.mutationRevision === loadRevision && legacyPreferences) {
        this.setPreferences(legacyPreferences);
      }
      this.setPersistenceStatus({ status: "error", error: message });
      throw new Error(message, { cause: error });
    }
  }

  private persist(preferences: AppPreferences): Promise<AppPreferences> {
    this.setPersistenceStatus({ status: "saving" });

    if (!this.persistence.isDesktop()) {
      try {
        this.persistence.saveBrowserFallback(preferences);
        this.setPersistenceStatus({ status: "saved" });
        return Promise.resolve(preferences);
      } catch (error) {
        const message = `App settings could not be saved: ${errorMessage(error)}`;
        this.setPersistenceStatus({ status: "error", error: message });
        return Promise.reject(new Error(message));
      }
    }

    const saveTask = this.saveQueue
      .catch(() => undefined)
      .then(() => this.persistence.saveDesktop(preferences))
      .then(() => {
        this.setPersistenceStatus({ status: "saved" });
        return preferences;
      })
      .catch((error) => {
        const message = `App settings could not be saved: ${errorMessage(error)}`;
        this.setPersistenceStatus({ status: "error", error: message });
        throw new Error(message, { cause: error });
      });

    this.saveQueue = saveTask;
    return saveTask;
  }

  private setPreferences(preferences: AppPreferences) {
    this.preferences = preferences;
    this.apply();
    this.emit();
  }

  private setPersistenceStatus(status: AppPreferencesPersistenceStatus) {
    this.persistenceStatus = status;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private apply() {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.appTheme = this.preferences.appThemePreset;
    document.documentElement.dataset.motion = getEffectiveMotionState(this.preferences);
    document.documentElement.dataset.density = this.preferences.density;
    document.documentElement.dataset.cardSize = this.preferences.bookCardSize;
    document.documentElement.dataset.windowFrame = this.preferences.windowFrameStyle;
    document.documentElement.dataset.librarySort =
      this.preferences.library.sortBy ?? DEFAULT_LIBRARY_SORT;
  }
}

export const appPreferencesStore = new AppPreferencesStore();

export function useAppPreferences() {
  return useSyncExternalStore(appPreferencesStore.subscribe, appPreferencesStore.getSnapshot);
}

export function useFilesAndMetadataPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getFilesAndMetadataSnapshot,
  );
}

export function useImportPreferences() {
  return useSyncExternalStore(appPreferencesStore.subscribe, appPreferencesStore.getImportSnapshot);
}

export function useLibraryPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getLibrarySnapshot,
  );
}

export function useReaderPreferences() {
  return useSyncExternalStore(appPreferencesStore.subscribe, appPreferencesStore.getReaderSnapshot);
}

export function useShowContinueReadingPreference() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getShowContinueReadingSnapshot,
  );
}

export function useWindowFrameStylePreference() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getWindowFrameStyleSnapshot,
  );
}

export function useAppPreferencesPersistenceStatus() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getPersistenceSnapshot,
  );
}
