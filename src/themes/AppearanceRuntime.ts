import type { AppPreferences } from "../types/appSettings";
import type { ArchiveAppearanceSettingsSource } from "../storage/archiveAppearanceSettingsSource";
import type {
  AppThemeSelection,
  ArchiveAppearanceSettings,
  ArchiveReaderThemeSelection,
  ReaderThemeSelection,
} from "../types/settings";
import {
  ThemeCatalog,
  ThemeCatalogChangedError,
  type AppThemeCatalogSelection,
  type ReaderThemeCatalogSelection,
  type ThemeSelectionResolution,
} from "./ThemeCatalog";
import type {
  ResolvedAppTheme,
  ResolvedReaderTheme,
  ResolvedTheme,
  ThemeManifestV1,
} from "./domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme, resolveTheme } from "./resolveTheme";
import { applyResolvedAppTheme } from "./themeCssVariables";
import type { AppThemeBase, ReaderThemeBase } from "./themeTokenRegistry";

type Listener = () => void;

export type GlobalAppearancePreferences = Pick<AppPreferences, "appTheme" | "readerTheme">;

export type GlobalAppearanceSource = Readonly<{
  getSnapshot: () => GlobalAppearancePreferences;
  subscribe: (listener: Listener) => () => void;
  update?: (changes: Partial<GlobalAppearancePreferences>) => Promise<AppPreferences>;
}>;

/** @deprecated Transitional compatibility for consumers migrated in the next commit. */
export type AppearanceArchive = Readonly<{ id: string; rootPath: string }>;

/** @deprecated Transitional compatibility for consumers migrated in the next commit. */
export type ActiveAppearanceArchive = AppearanceArchive & Readonly<{ generation: number }>;

export type AppearanceRuntimeSnapshot = Readonly<{
  app: ResolvedAppTheme;
  archive: ActiveAppearanceArchive | null;
  reader: ResolvedReaderTheme;
}>;

export type AppearancePreviewContext = Readonly<{
  archive: ActiveAppearanceArchive;
  settings: Readonly<ArchiveAppearanceSettings>;
}>;

export type GlobalAppearancePreviewContext = Readonly<{
  settings: Readonly<GlobalAppearancePreferences>;
}>;

export type AppearanceRuntimeOptions = Readonly<{
  catalog?: ThemeCatalog;
  getDocumentRoot?: () => HTMLElement | null;
  globalPreferences: GlobalAppearanceSource;
  matchMedia?: (query: string) => MediaQueryList;
  onError?: (error: unknown) => void;
}>;

const SYSTEM_SCHEME_QUERY = "(prefers-color-scheme: light)";
const GLOBAL_COMPATIBILITY_ARCHIVE = Object.freeze({
  generation: 0,
  id: "global-appearance",
  rootPath: "",
});

export class AppearanceRuntime {
  private readonly appThemes = new Map<AppThemeBase, ResolvedAppTheme>();
  private appliedAppTheme: ResolvedAppTheme | null = null;
  private appliedDocumentRoot: HTMLElement | null = null;
  private readonly catalog: ThemeCatalog;
  private committedContext: GlobalAppearancePreviewContext;
  private committedResolution: ThemeSelectionResolution | null = null;
  private readonly customThemes = new WeakMap<ThemeManifestV1, ResolvedTheme>();
  private readonly getDocumentRoot: () => HTMLElement | null;
  private readonly globalPreferences: GlobalAppearanceSource;
  private readonly listeners = new Set<Listener>();
  private readonly matchMedia: ((query: string) => MediaQueryList) | undefined;
  private mediaQuery: MediaQueryList | null = null;
  private readonly onError: (error: unknown) => void;
  private preferences: Readonly<GlobalAppearancePreferences>;
  private preview: ResolvedAppTheme | null = null;
  private readerPreview: ResolvedReaderTheme | null = null;
  private readonly readerThemes = new Map<ReaderThemeBase, ResolvedReaderTheme>();
  private resolutionRevision = 0;
  private snapshot: AppearanceRuntimeSnapshot;
  private stopPreferences: (() => void) | null = null;

  constructor(options: AppearanceRuntimeOptions) {
    this.catalog = options.catalog ?? new ThemeCatalog();
    this.getDocumentRoot =
      options.getDocumentRoot ??
      (() => (typeof document === "undefined" ? null : document.documentElement));
    this.globalPreferences = options.globalPreferences;
    this.matchMedia =
      options.matchMedia ??
      (typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? undefined
        : window.matchMedia.bind(window));
    this.onError =
      options.onError ?? ((error) => console.error("Appearance could not be loaded", error));
    this.preferences = freezePreferences(options.globalPreferences.getSnapshot());
    this.committedContext = freezeContext(this.preferences);
    this.snapshot = this.safeSnapshot(this.preferences);
  }

  getSnapshot = (): AppearanceRuntimeSnapshot => this.snapshot;
  getReaderSnapshot = (): ResolvedReaderTheme => this.snapshot.reader;
  getPreviewContext = (): AppearancePreviewContext | null =>
    Object.freeze({
      archive: GLOBAL_COMPATIBILITY_ARCHIVE,
      settings: this.committedContext.settings,
    });
  getGlobalPreviewContext = (): GlobalAppearancePreviewContext => this.committedContext;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (this.stopPreferences) return () => this.stop();
    this.mediaQuery = this.matchMedia?.(SYSTEM_SCHEME_QUERY) ?? null;
    this.addSystemSchemeListener();
    this.stopPreferences = this.globalPreferences.subscribe(this.handlePreferencesChange);
    this.adoptPreferences(this.globalPreferences.getSnapshot());
    return () => this.stop();
  }

  stop(): void {
    this.stopPreferences?.();
    this.stopPreferences = null;
    this.removeSystemSchemeListener();
    this.mediaQuery = null;
    this.preview = null;
    this.readerPreview = null;
    this.commitCurrentAppearance();
  }

  applyPreview(
    appThemeOrArchive: ResolvedAppTheme | ActiveAppearanceArchive,
    legacyAppTheme?: ResolvedAppTheme,
  ): boolean {
    const appTheme = legacyAppTheme ?? (appThemeOrArchive as ResolvedAppTheme);
    this.preview = appTheme;
    this.commitCurrentAppearance();
    return true;
  }

  clearPreview(_legacyArchive?: ActiveAppearanceArchive): boolean {
    void _legacyArchive;
    if (!this.preview) return false;
    this.preview = null;
    this.commitCurrentAppearance();
    return true;
  }

  async keepPreview(
    expectedSettingsOrArchive: Readonly<GlobalAppearancePreferences> | ActiveAppearanceArchive,
    selectionOrExpected: AppThemeSelection | Readonly<ArchiveAppearanceSettings>,
    legacySettings?: ArchiveAppearanceSettings,
  ): Promise<void> {
    const expectedSettings = legacySettings
      ? this.preferences
      : (expectedSettingsOrArchive as Readonly<GlobalAppearancePreferences>);
    const selection = legacySettings
      ? legacySettings.appTheme.kind === "inherit"
        ? this.preferences.appTheme
        : legacySettings.appTheme
      : (selectionOrExpected as AppThemeSelection);
    if (!this.preview) throw new Error("There is no active application theme preview.");
    if (!samePreferences(this.preferences, expectedSettings)) {
      throw new AppearanceRuntimeSettingsChangedError();
    }
    await this.updateGlobalPreferences({ appTheme: selection });
    this.adoptPreferences(this.globalPreferences.getSnapshot());
    this.preview = null;
    this.commitCurrentAppearance();
  }

  async applyReaderPreview(
    selectionOrArchive: ReaderThemeSelection | ActiveAppearanceArchive,
    legacySelection?: ArchiveReaderThemeSelection,
  ): Promise<boolean> {
    const selection = legacySelection ?? (selectionOrArchive as ReaderThemeSelection);
    if (selection.kind === "inherit") return false;
    const expected = this.preferences;
    let resolution: ThemeSelectionResolution;
    try {
      resolution = await this.catalog.loadSelected({ ...expected, readerTheme: selection });
    } catch (error) {
      if (error instanceof ThemeCatalogChangedError) return false;
      throw error;
    }
    if (!samePreferences(this.preferences, expected)) return false;
    this.readerPreview = this.resolveReaderSelection(resolution.reader);
    this.commitCurrentAppearance();
    return true;
  }

  clearReaderPreview(_legacyArchive?: ActiveAppearanceArchive): boolean {
    void _legacyArchive;
    if (!this.readerPreview) return false;
    this.readerPreview = null;
    this.commitCurrentAppearance();
    return true;
  }

  async keepReaderPreview(
    expectedSettingsOrArchive: Readonly<GlobalAppearancePreferences> | ActiveAppearanceArchive,
    selectionOrExpected: ReaderThemeSelection | Readonly<ArchiveAppearanceSettings>,
    legacySelection?: ArchiveReaderThemeSelection,
  ): Promise<void> {
    const expectedSettings = legacySelection
      ? this.preferences
      : (expectedSettingsOrArchive as Readonly<GlobalAppearancePreferences>);
    const selection = legacySelection ?? (selectionOrExpected as ReaderThemeSelection);
    if (selection.kind === "inherit") return;
    if (!this.readerPreview) throw new Error("There is no active Reader theme preview.");
    if (!samePreferences(this.preferences, expectedSettings)) {
      throw new AppearanceRuntimeSettingsChangedError();
    }
    await this.updateAppearanceSettings({ readerTheme: selection });
    this.readerPreview = null;
    this.commitCurrentAppearance();
  }

  async updateAppearanceSettings(
    changes: Partial<GlobalAppearancePreferences>,
  ): Promise<Readonly<GlobalAppearancePreferences>> {
    if (this.preview && changes.appTheme) {
      throw new Error("End the active theme preview before changing the application theme.");
    }
    await this.updateGlobalPreferences(changes);
    this.adoptPreferences(this.globalPreferences.getSnapshot());
    return this.preferences;
  }

  async refreshAppearance(): Promise<void> {
    await this.catalog.refreshPackages();
    await this.resolveCommittedAppearance();
  }

  /** @deprecated Transitional compatibility for consumers migrated in the next commit. */
  async activateArchive(
    _archive: AppearanceArchive,
    _settingsSource: ArchiveAppearanceSettingsSource,
  ): Promise<void> {
    void _archive;
    void _settingsSource;
  }

  /** @deprecated Transitional compatibility for consumers migrated in the next commit. */
  deactivateArchive(_archive?: AppearanceArchive): void {
    void _archive;
  }

  /** @deprecated Transitional compatibility for consumers migrated in the next commit. */
  async saveArchiveAppearanceSettings(
    _archive: ActiveAppearanceArchive,
    settings: ArchiveAppearanceSettings,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    void _archive;
    await this.updateAppearanceSettings(legacyChanges(settings));
    return settings;
  }

  /** @deprecated Transitional compatibility for consumers migrated in the next commit. */
  async updateArchiveAppearanceSettings(
    _archive: ActiveAppearanceArchive,
    changes: Partial<ArchiveAppearanceSettings>,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    void _archive;
    await this.updateAppearanceSettings(legacyChanges(changes));
    return legacyAppearanceSettings(this.preferences);
  }

  /** @deprecated Transitional compatibility for consumers migrated in the next commit. */
  async refreshArchiveAppearance(
    _archive: ActiveAppearanceArchive,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    void _archive;
    await this.refreshAppearance();
    return legacyAppearanceSettings(this.preferences);
  }

  private readonly handlePreferencesChange = () => {
    this.adoptPreferences(this.globalPreferences.getSnapshot());
  };

  private updateGlobalPreferences(
    changes: Partial<GlobalAppearancePreferences>,
  ): Promise<AppPreferences> {
    const update = this.globalPreferences.update;
    if (!update) throw new Error("Global appearance preferences cannot be updated.");
    return update(changes);
  }

  private adoptPreferences(preferences: GlobalAppearancePreferences): void {
    const next = freezePreferences(preferences);
    if (samePreferences(this.preferences, next) && this.committedResolution) return;
    const appChanged = !sameAppSelection(this.preferences.appTheme, next.appTheme);
    const readerChanged = !sameReaderSelection(this.preferences.readerTheme, next.readerTheme);
    this.preferences = next;
    this.committedContext = freezeContext(next);
    if (appChanged) this.preview = null;
    if (readerChanged) this.readerPreview = null;
    this.committedResolution = null;
    this.commitCurrentAppearance();
    void this.resolveCommittedAppearance();
  }

  private async resolveCommittedAppearance(): Promise<void> {
    const revision = this.resolutionRevision + 1;
    this.resolutionRevision = revision;
    const expected = this.preferences;
    try {
      const resolution = await this.catalog.loadSelected(expected);
      if (revision !== this.resolutionRevision || !samePreferences(this.preferences, expected)) {
        return;
      }
      this.committedResolution = resolution;
      this.commitCurrentAppearance();
    } catch (error) {
      if (revision !== this.resolutionRevision || error instanceof ThemeCatalogChangedError) return;
      this.onError(error);
    }
  }

  private readonly handleSystemSchemeChange = () => {
    if (this.preferences.appTheme.kind === "system") this.commitCurrentAppearance();
  };

  private commitCurrentAppearance(): void {
    const committed = this.committedResolution
      ? this.resolvedSnapshot(this.committedResolution)
      : this.safeSnapshot(this.preferences);
    const snapshot = Object.freeze({
      app: this.preview ?? committed.app,
      archive: GLOBAL_COMPATIBILITY_ARCHIVE,
      reader: this.readerPreview ?? committed.reader,
    });
    const root = this.getDocumentRoot();
    if (!root) {
      this.appliedDocumentRoot = null;
    } else if (root !== this.appliedDocumentRoot || snapshot.app !== this.appliedAppTheme) {
      applyResolvedAppTheme(root, snapshot.app);
      this.appliedDocumentRoot = root;
      this.appliedAppTheme = snapshot.app;
    }
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private safeSnapshot(preferences: GlobalAppearancePreferences): AppearanceRuntimeSnapshot {
    const appBase =
      preferences.appTheme.kind === "builtin"
        ? preferences.appTheme.id
        : preferences.appTheme.kind === "system"
          ? this.systemAppBase()
          : "dark";
    const readerBase =
      preferences.readerTheme.kind === "builtin" ? preferences.readerTheme.id : "dark";
    return Object.freeze({
      app: this.resolveBuiltInAppTheme(appBase),
      archive: GLOBAL_COMPATIBILITY_ARCHIVE,
      reader: this.resolveBuiltInReaderTheme(readerBase),
    });
  }

  private resolvedSnapshot(resolution: ThemeSelectionResolution): AppearanceRuntimeSnapshot {
    return Object.freeze({
      app: this.resolveAppSelection(resolution.app),
      archive: GLOBAL_COMPATIBILITY_ARCHIVE,
      reader: this.resolveReaderSelection(resolution.reader),
    });
  }

  private resolveAppSelection(selection: AppThemeCatalogSelection): ResolvedAppTheme {
    if (selection.effective.kind === "system") {
      return this.resolveBuiltInAppTheme(this.systemAppBase());
    }
    const entry = selection.effective.entry;
    if (entry.origin === "builtin") {
      if (!entry.appBase) throw new Error(`Built-in theme ${entry.id} has no application palette.`);
      return this.resolveBuiltInAppTheme(entry.appBase);
    }
    return this.resolveCustomTheme(entry.manifest).app;
  }

  private resolveReaderSelection(selection: ReaderThemeCatalogSelection): ResolvedReaderTheme {
    const entry = selection.effective.entry;
    if (entry.origin === "builtin") {
      if (!entry.readerBase) throw new Error(`Built-in theme ${entry.id} has no Reader palette.`);
      return this.resolveBuiltInReaderTheme(entry.readerBase);
    }
    const reader = this.resolveCustomTheme(entry.manifest).reader;
    if (!reader) throw new Error(`Custom theme ${entry.id} has no Reader palette.`);
    return reader;
  }

  private resolveBuiltInAppTheme(base: AppThemeBase): ResolvedAppTheme {
    const cached = this.appThemes.get(base);
    if (cached) return cached;
    const resolved = resolveBuiltInAppTheme(base);
    this.appThemes.set(base, resolved);
    return resolved;
  }

  private resolveBuiltInReaderTheme(base: ReaderThemeBase): ResolvedReaderTheme {
    const cached = this.readerThemes.get(base);
    if (cached) return cached;
    const resolved = resolveBuiltInReaderTheme(base);
    this.readerThemes.set(base, resolved);
    return resolved;
  }

  private resolveCustomTheme(manifest: ThemeManifestV1): ResolvedTheme {
    const cached = this.customThemes.get(manifest);
    if (cached) return cached;
    const resolved = resolveTheme(manifest);
    this.customThemes.set(manifest, resolved);
    return resolved;
  }

  private systemAppBase(): AppThemeBase {
    return this.mediaQuery?.matches ? "light" : "dark";
  }

  private addSystemSchemeListener(): void {
    this.mediaQuery?.addEventListener?.("change", this.handleSystemSchemeChange);
  }

  private removeSystemSchemeListener(): void {
    this.mediaQuery?.removeEventListener?.("change", this.handleSystemSchemeChange);
  }
}

export class AppearanceRuntimeSettingsChangedError extends Error {
  constructor() {
    super("Global appearance changed before the operation completed.");
    this.name = "AppearanceRuntimeSettingsChangedError";
  }
}

function freezePreferences(
  preferences: GlobalAppearancePreferences,
): Readonly<GlobalAppearancePreferences> {
  return Object.freeze({
    appTheme: Object.freeze({ ...preferences.appTheme }),
    readerTheme: Object.freeze({ ...preferences.readerTheme }),
  });
}

function freezeContext(preferences: GlobalAppearancePreferences): GlobalAppearancePreviewContext {
  return Object.freeze({ settings: freezePreferences(preferences) });
}

function samePreferences(
  left: Readonly<GlobalAppearancePreferences>,
  right: Readonly<GlobalAppearancePreferences>,
): boolean {
  return (
    sameAppSelection(left.appTheme, right.appTheme) &&
    sameReaderSelection(left.readerTheme, right.readerTheme)
  );
}

function sameAppSelection(left: AppThemeSelection, right: AppThemeSelection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "system") return true;
  return right.kind !== "system" && left.id === right.id;
}

function sameReaderSelection(left: ReaderThemeSelection, right: ReaderThemeSelection): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function legacyChanges(
  settings: Partial<ArchiveAppearanceSettings>,
): Partial<GlobalAppearancePreferences> {
  return {
    ...(settings.appTheme && settings.appTheme.kind !== "inherit"
      ? { appTheme: settings.appTheme }
      : {}),
    ...(settings.readerTheme && settings.readerTheme.kind !== "inherit"
      ? { readerTheme: settings.readerTheme }
      : {}),
  };
}

function legacyAppearanceSettings(
  preferences: Readonly<GlobalAppearancePreferences>,
): ArchiveAppearanceSettings {
  return {
    appTheme: { ...preferences.appTheme },
    readerTheme: { ...preferences.readerTheme },
  };
}
