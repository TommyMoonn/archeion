import { invoke, isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

import { normalizeKeyboardPreferences } from "../features/commands/commandBindings";
import { CoalescedWriteQueue } from "../storage/CoalescedWriteQueue";
import {
  defaultAppPreferences,
  type AppearanceSettings,
  type AppPreferences,
  type AppSettingsMutation,
  type AppSettingsSnapshot,
  type PersistedWindowState,
  type RememberedNavigationState,
} from "../types/appSettings";
import { normalizeReaderSettings, type ReaderSettings } from "../types/reader";
import {
  DEFAULT_BOOKS_COLLECTION_PREFERENCES,
  DEFAULT_FOLDERS_COLLECTION_PREFERENCES,
  DEFAULT_SERIES_COLLECTION_PREFERENCES,
  normalizeCollectionCardSize,
  normalizeFolderBrowserView,
  normalizeFolderSort,
  normalizeLibraryFilters,
  normalizeLibrarySort,
  normalizeLibraryView,
  normalizeSeriesSort,
  type LibraryCollectionPreferences,
  type LibrarySmartViewPreferences,
} from "../types/library";
import {
  DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES,
  isLibrarySmartView,
  LIBRARY_SMART_VIEWS,
} from "../types/librarySmartViews";
import type {
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
} from "../types/settings";

const LEGACY_STORAGE_KEY = "archeion:preferences";
const APP_PREFERENCES_WRITE_DELAY_MS = 250;
type Listener = () => void;

type LibraryDisplaySettingsUpdate = Partial<Omit<LibraryDisplaySettings, "collections">> & {
  collections?: Partial<LibraryCollectionPreferences>;
};

type LibraryCollectionKey = keyof LibraryCollectionPreferences;

export type AppPreferencesPersistenceStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; error: string };

type AppPreferencesPersistence = {
  isDesktop: () => boolean;
  loadDesktop: () => Promise<unknown>;
  mutateDesktop: (mutation: AppSettingsMutation) => Promise<unknown>;
  readLegacy: () => unknown;
  removeLegacy: () => void;
  saveBrowserFallback: (preferences: AppPreferences) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

const APP_SETTINGS_LOAD_ERROR = "App settings could not be loaded. Restart Archeion to try again.";
const APP_SETTINGS_SAVE_ERROR =
  "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.";

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

function createDefaultPersistence(): AppPreferencesPersistence {
  return {
    isDesktop: isTauri,
    loadDesktop: () => invoke("load_app_settings_snapshot"),
    mutateDesktop: (mutation) => invoke("update_app_settings", { mutation }),
    readLegacy: readLegacyPreferences,
    removeLegacy: removeLegacyPreferences,
    saveBrowserFallback,
  };
}

export function normalizeLibrarySmartViewPreferences(value: unknown): LibrarySmartViewPreferences {
  const settings = isRecord(value) ? value : {};
  const requested = Array.isArray(settings.visible)
    ? new Set(settings.visible.filter(isLibrarySmartView))
    : null;
  const visible = requested
    ? LIBRARY_SMART_VIEWS.filter((smartView) => requested.has(smartView))
    : [];

  return {
    enabled: settings.enabled === true,
    visible: visible.length > 0 ? visible : [...DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.visible],
  };
}

function normalizeLibrarySettings(
  value: unknown,
  legacyBookCardSize: unknown,
): LibraryDisplaySettings {
  const settings = isRecord(value) ? value : {};
  const collections = isRecord(settings.collections) ? settings.collections : {};
  const books = isRecord(collections.books) ? collections.books : {};
  const folders = isRecord(collections.folders) ? collections.folders : {};
  const series = isRecord(collections.series) ? collections.series : {};
  const legacyBookView = normalizeLibraryView(
    settings.viewMode,
    DEFAULT_BOOKS_COLLECTION_PREFERENCES.viewMode,
  );
  const legacyBookSort = normalizeLibrarySort(
    settings.sortBy,
    DEFAULT_BOOKS_COLLECTION_PREFERENCES.sortBy,
  );
  const legacyCardSize = normalizeCollectionCardSize(
    legacyBookCardSize,
    DEFAULT_BOOKS_COLLECTION_PREFERENCES.cardSize,
  );

  return {
    collections: {
      books: {
        cardSize: normalizeCollectionCardSize(books.cardSize, legacyCardSize),
        sortBy: normalizeLibrarySort(books.sortBy, legacyBookSort),
        viewMode: normalizeLibraryView(books.viewMode, legacyBookView),
      },
      folders: {
        cardSize: normalizeCollectionCardSize(
          folders.cardSize,
          DEFAULT_FOLDERS_COLLECTION_PREFERENCES.cardSize,
        ),
        sortBy: normalizeFolderSort(folders.sortBy, DEFAULT_FOLDERS_COLLECTION_PREFERENCES.sortBy),
        viewMode: normalizeFolderBrowserView(
          folders.viewMode,
          DEFAULT_FOLDERS_COLLECTION_PREFERENCES.viewMode,
        ),
      },
      series: {
        cardSize: normalizeCollectionCardSize(
          series.cardSize,
          DEFAULT_SERIES_COLLECTION_PREFERENCES.cardSize,
        ),
        sortBy: normalizeSeriesSort(series.sortBy, DEFAULT_SERIES_COLLECTION_PREFERENCES.sortBy),
        viewMode: normalizeLibraryView(
          series.viewMode,
          DEFAULT_SERIES_COLLECTION_PREFERENCES.viewMode,
        ),
      },
    },
    filters: normalizeLibraryFilters(settings.filters),
    smartViews: normalizeLibrarySmartViewPreferences(settings.smartViews),
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeRememberedNavigation(value: unknown): RememberedNavigationState | null {
  if (!isRecord(value)) {
    return null;
  }

  const archiveId = typeof value.archiveId === "string" ? value.archiveId.trim() : "";
  const bookId = typeof value.bookId === "string" ? value.bookId.trim() : "";
  const lastRoute = typeof value.lastRoute === "string" ? value.lastRoute.trim() : "";

  if (
    !archiveId ||
    !bookId ||
    !lastRoute.startsWith("/reader/") ||
    /[?&]start=beginning(?:&|$)/.test(lastRoute)
  ) {
    return null;
  }

  return { archiveId, bookId, lastRoute };
}

export function normalizePersistedWindowState(value: unknown): PersistedWindowState | null {
  if (!isRecord(value)) {
    return null;
  }

  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);

  if (
    width === null ||
    height === null ||
    x === null ||
    y === null ||
    width <= 0 ||
    height <= 0 ||
    width > 100_000 ||
    height > 100_000 ||
    Math.abs(x) > 1_000_000 ||
    Math.abs(y) > 1_000_000
  ) {
    return null;
  }

  return {
    height: Math.round(height),
    maximized: value.maximized === true,
    width: Math.round(width),
    x: Math.round(x),
    y: Math.round(y),
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
    confirmDestructiveFileActions: value.confirmDestructiveFileActions !== false,
    density: value.density === "compact" ? "compact" : defaultAppPreferences.density,
    filesAndMetadata: normalizeFilesAndMetadataSettings(value.filesAndMetadata),
    import: normalizeGlobalImportSettings(value.import),
    keyboard: normalizeKeyboardPreferences(value.keyboard),
    library: normalizeLibrarySettings(value.library, value.bookCardSize),
    navigation: normalizeRememberedNavigation(value.navigation),
    reader: normalizeReader(value.reader),
    rememberWindowState: value.rememberWindowState === true,
    restoreLastReader: value.restoreLastReader === true,
    showContinueReading: value.showContinueReading !== false,
    startupBehavior:
      value.startupBehavior === "show-archive-manager"
        ? "show-archive-manager"
        : defaultAppPreferences.startupBehavior,
    window: normalizePersistedWindowState(value.window),
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
    keyboard:
      changes.keyboard === undefined
        ? base.keyboard
        : {
            ...base.keyboard,
            ...changes.keyboard,
          },
    library:
      changes.library === undefined
        ? base.library
        : {
            ...base.library,
            ...changes.library,
            collections:
              changes.library.collections === undefined
                ? base.library.collections
                : {
                    ...base.library.collections,
                    ...changes.library.collections,
                  },
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
  if (changes.keyboard === undefined) {
    next.keyboard = base.keyboard;
  }
  if (changes.library === undefined) {
    next.library = base.library;
  }
  if (changes.reader === undefined) {
    next.reader = base.reader;
  }

  if (changes.rememberWindowState === false) {
    next.window = null;
  }

  return next;
}

function normalizeAppSettingsSnapshot(value: unknown): AppSettingsSnapshot {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error("Invalid native app settings snapshot.");
  }

  return {
    preferences: normalizeAppPreferences(value.preferences),
    revision: Number(value.revision),
  };
}

function preferenceAreaEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => preferenceAreaEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && preferenceAreaEqual(left[key], right[key]),
    )
  );
}

function createAppSettingsMutations(
  persisted: AppPreferences,
  target: AppPreferences,
): AppSettingsMutation[] {
  const mutations: AppSettingsMutation[] = [];

  if (persisted.appThemePreset !== target.appThemePreset) {
    mutations.push({ area: "appThemePreset", value: target.appThemePreset });
  }
  if (!preferenceAreaEqual(persisted.appearance, target.appearance)) {
    mutations.push({ area: "appearance", value: target.appearance });
  }
  if (persisted.confirmDestructiveFileActions !== target.confirmDestructiveFileActions) {
    mutations.push({
      area: "confirmDestructiveFileActions",
      value: target.confirmDestructiveFileActions,
    });
  }
  if (persisted.density !== target.density) {
    mutations.push({ area: "density", value: target.density });
  }
  if (!preferenceAreaEqual(persisted.filesAndMetadata, target.filesAndMetadata)) {
    mutations.push({ area: "filesAndMetadata", value: target.filesAndMetadata });
  }
  if (!preferenceAreaEqual(persisted.import, target.import)) {
    mutations.push({ area: "import", value: target.import });
  }
  if (!preferenceAreaEqual(persisted.keyboard, target.keyboard)) {
    mutations.push({ area: "keyboard", value: target.keyboard });
  }
  if (!preferenceAreaEqual(persisted.library, target.library)) {
    mutations.push({ area: "library", value: target.library });
  }
  if (!preferenceAreaEqual(persisted.navigation, target.navigation)) {
    mutations.push({ area: "navigation", value: target.navigation });
  }
  if (!preferenceAreaEqual(persisted.reader, target.reader)) {
    mutations.push({ area: "reader", value: target.reader });
  }
  if (persisted.rememberWindowState !== target.rememberWindowState) {
    mutations.push({ area: "rememberWindowState", value: target.rememberWindowState });
  }
  if (persisted.restoreLastReader !== target.restoreLastReader) {
    mutations.push({ area: "restoreLastReader", value: target.restoreLastReader });
  }
  if (persisted.showContinueReading !== target.showContinueReading) {
    mutations.push({ area: "showContinueReading", value: target.showContinueReading });
  }
  if (persisted.startupBehavior !== target.startupBehavior) {
    mutations.push({ area: "startupBehavior", value: target.startupBehavior });
  }
  if (!preferenceAreaEqual(persisted.window, target.window)) {
    mutations.push({ area: "window", value: target.window });
  }

  return mutations;
}

function preserveEquivalentPreferenceAreas(
  current: AppPreferences,
  native: AppPreferences,
): AppPreferences {
  return {
    ...native,
    appearance: preferenceAreaEqual(current.appearance, native.appearance)
      ? current.appearance
      : native.appearance,
    filesAndMetadata: preferenceAreaEqual(current.filesAndMetadata, native.filesAndMetadata)
      ? current.filesAndMetadata
      : native.filesAndMetadata,
    import: preferenceAreaEqual(current.import, native.import) ? current.import : native.import,
    keyboard: preferenceAreaEqual(current.keyboard, native.keyboard)
      ? current.keyboard
      : native.keyboard,
    library: preferenceAreaEqual(current.library, native.library)
      ? current.library
      : native.library,
    reader: preferenceAreaEqual(current.reader, native.reader) ? current.reader : native.reader,
  };
}

export class AppPreferencesStore {
  private readonly listeners = new Set<Listener>();
  private readonly persistence: AppPreferencesPersistence;
  private preferences = { ...defaultAppPreferences };
  private persistenceStatus: AppPreferencesPersistenceStatus = { status: "idle" };
  private loadPromise: Promise<void> | null = null;
  private mutationRevision = 0;
  private desktopRevision = 0;
  private desktopPersistedPreferences: AppPreferences | null = null;
  private completedDesktopSnapshot: AppSettingsSnapshot | null = null;
  private readonly desktopWrites: CoalescedWriteQueue<AppPreferences>;

  constructor(persistence = createDefaultPersistence()) {
    this.persistence = persistence;
    this.desktopWrites = new CoalescedWriteQueue({
      delayMs: APP_PREFERENCES_WRITE_DELAY_MS,
      onFailure: () => {
        this.completedDesktopSnapshot = null;
      },
      onSuccess: (attempt) => {
        const completed = this.completedDesktopSnapshot;
        this.completedDesktopSnapshot = null;
        if (!attempt.isSuperseded() && completed) {
          this.setPreferences(
            preserveEquivalentPreferenceAreas(this.preferences, completed.preferences),
          );
        }
      },
      write: async (preferences) => {
        this.completedDesktopSnapshot = null;
        this.completedDesktopSnapshot = await this.persistDesktopTarget(preferences);
      },
    });
    this.apply();
  }

  getSnapshot = () => this.preferences;

  getPersistenceSnapshot = () => this.persistenceStatus;

  getRevisionSnapshot = () => this.desktopRevision;

  getFilesAndMetadataSnapshot = () => this.preferences.filesAndMetadata;

  getImportSnapshot = () => this.preferences.import;

  getKeyboardSnapshot = () => this.preferences.keyboard;

  getLibrarySnapshot = () => this.preferences.library;

  getBooksCollectionSnapshot = () => this.preferences.library.collections.books;

  getFoldersCollectionSnapshot = () => this.preferences.library.collections.folders;

  getSeriesCollectionSnapshot = () => this.preferences.library.collections.series;

  getReaderSnapshot = () => this.preferences.reader;

  getConfirmDestructiveFileActionsSnapshot = () => this.preferences.confirmDestructiveFileActions;

  getShowContinueReadingSnapshot = () => this.preferences.showContinueReading;

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
    await this.initialize();

    const next = mergeAppPreferences(this.preferences, changes);
    this.mutationRevision += 1;
    this.setPreferences(next);
    return this.persist(next, this.mutationRevision);
  }

  async updateLibrary(changes: LibraryDisplaySettingsUpdate): Promise<AppPreferences> {
    await this.initialize();
    const current = this.preferences.library;
    return this.update({
      library: {
        ...current,
        ...changes,
        collections: {
          ...current.collections,
          ...changes.collections,
        },
      },
    });
  }

  async updateLibraryCollection<TKey extends LibraryCollectionKey>(
    collection: TKey,
    changes: Partial<LibraryCollectionPreferences[TKey]>,
  ): Promise<AppPreferences> {
    await this.initialize();
    const currentCollections = this.preferences.library.collections;
    return this.updateLibrary({
      collections: {
        ...currentCollections,
        [collection]: {
          ...currentCollections[collection],
          ...changes,
        },
      },
    });
  }

  async flushPendingWrites(): Promise<void> {
    if (!this.persistence.isDesktop()) return;
    await this.desktopWrites.flush();
    if (this.persistenceStatus.status !== "idle") {
      this.setPersistenceStatus({ status: "saved" });
    }
  }

  reset(changes: Partial<AppPreferences> = {}): Promise<AppPreferences> {
    return this.update(mergeAppPreferences(defaultAppPreferences, changes));
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
      const loaded = normalizeAppSettingsSnapshot(await this.persistence.loadDesktop());
      if (this.mutationRevision !== loadRevision) {
        this.setPersistenceStatus({ status: "idle" });
        return;
      }

      this.desktopRevision = loaded.revision;
      this.desktopPersistedPreferences = loaded.preferences;
      const next = legacyPreferences ?? loaded.preferences;
      this.setPreferences(next);

      if (legacyPreferences) {
        const migrated = await this.persistDesktopTarget(next);
        this.setPreferences(
          preserveEquivalentPreferenceAreas(this.preferences, migrated.preferences),
        );
        this.persistence.removeLegacy();
        this.setPersistenceStatus({ status: "saved" });
      } else {
        this.setPersistenceStatus({ status: "idle" });
      }
    } catch (error) {
      const message = APP_SETTINGS_LOAD_ERROR;
      if (this.mutationRevision === loadRevision && legacyPreferences) {
        this.setPreferences(legacyPreferences);
      }
      this.setPersistenceStatus({ status: "error", error: message });
      throw new Error(message, { cause: error });
    }
  }

  private persist(
    preferences: AppPreferences,
    persistenceRevision: number,
  ): Promise<AppPreferences> {
    this.setPersistenceStatus({ status: "saving" });

    if (!this.persistence.isDesktop()) {
      try {
        this.persistence.saveBrowserFallback(preferences);
        this.setPersistenceStatus({ status: "saved" });
        return Promise.resolve(preferences);
      } catch (error) {
        const message = APP_SETTINGS_SAVE_ERROR;
        this.setPersistenceStatus({ status: "error", error: message });
        return Promise.reject(new Error(message, { cause: error }));
      }
    }

    return this.desktopWrites
      .schedule(structuredClone(preferences))
      .then(() => {
        if (this.mutationRevision === persistenceRevision) {
          this.setPersistenceStatus({ status: "saved" });
        }
        return preferences;
      })
      .catch((error) => {
        const message = APP_SETTINGS_SAVE_ERROR;
        if (this.mutationRevision === persistenceRevision) {
          this.setPersistenceStatus({ status: "error", error: message });
        }
        throw new Error(message, { cause: error });
      });
  }

  private async persistDesktopTarget(target: AppPreferences): Promise<AppSettingsSnapshot> {
    const persisted = this.desktopPersistedPreferences;
    if (!persisted) {
      throw new Error("Native app settings were not initialized.");
    }

    let snapshot: AppSettingsSnapshot = {
      preferences: persisted,
      revision: this.desktopRevision,
    };
    const mutations = createAppSettingsMutations(persisted, target);

    for (const mutation of mutations) {
      const updated = normalizeAppSettingsSnapshot(
        await this.persistence.mutateDesktop(structuredClone(mutation)),
      );
      if (updated.revision <= snapshot.revision) {
        throw new Error("Native app settings revision did not advance.");
      }
      snapshot = updated;
      this.desktopRevision = updated.revision;
      this.desktopPersistedPreferences = updated.preferences;
    }

    return snapshot;
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

    document.documentElement.dataset.motion = getEffectiveMotionState(this.preferences);
    document.documentElement.dataset.density = this.preferences.density;
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

export function useKeyboardPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getKeyboardSnapshot,
  );
}

export function useLibraryPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getLibrarySnapshot,
  );
}

export function useBooksCollectionPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getBooksCollectionSnapshot,
  );
}

export function useFoldersCollectionPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getFoldersCollectionSnapshot,
  );
}

export function useSeriesCollectionPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getSeriesCollectionSnapshot,
  );
}

export function useReaderPreferences() {
  return useSyncExternalStore(appPreferencesStore.subscribe, appPreferencesStore.getReaderSnapshot);
}

export function useConfirmDestructiveFileActionsPreference() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getConfirmDestructiveFileActionsSnapshot,
  );
}

export function useShowContinueReadingPreference() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getShowContinueReadingSnapshot,
  );
}

export function useAppPreferencesPersistenceStatus() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getPersistenceSnapshot,
  );
}
