import type { AppPreferences } from "../types/appSettings";
import type { ArchiveAppearanceSettings } from "../types/settings";
import {
  ArchiveThemeCatalog,
  ArchiveThemeCatalogChangedError,
  type AppThemeCatalogSelection,
  type ArchiveThemeSelectionResolution,
  type ReaderThemeCatalogSelection,
} from "./ArchiveThemeCatalog";
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

export type GlobalAppearancePreferences = Pick<AppPreferences, "appThemePreset" | "reader">;

export type GlobalAppearanceSource = Readonly<{
  getSnapshot: () => GlobalAppearancePreferences;
  subscribe: (listener: Listener) => () => void;
}>;

export type ArchiveAppearanceSettingsSource = Readonly<{
  getArchiveAppearanceSettings: () => Promise<ArchiveAppearanceSettings>;
  saveArchiveAppearanceSettings?: (
    settings: ArchiveAppearanceSettings,
  ) => Promise<ArchiveAppearanceSettings>;
}>;

export type AppearanceArchive = Readonly<{
  id: string;
  rootPath: string;
}>;

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

export type AppearancePreviewPalette = Readonly<{
  app?: ResolvedAppTheme;
  reader?: ResolvedReaderTheme;
}>;

export type AppearanceRuntimeOptions = Readonly<{
  catalog?: ArchiveThemeCatalog;
  getDocumentRoot?: () => HTMLElement | null;
  globalPreferences: GlobalAppearanceSource;
  matchMedia?: (query: string) => MediaQueryList;
  onError?: (error: unknown) => void;
}>;

type AppearancePersistenceCoordinator = {
  lastPersistedSettings: Readonly<ArchiveAppearanceSettings> | null;
  latestOperation: number;
  tail: Promise<void>;
};

type ActiveArchiveContext = ActiveAppearanceArchive &
  Readonly<{
    persistence: AppearancePersistenceCoordinator;
    settingsSource: ArchiveAppearanceSettingsSource;
  }>;

type ActiveAppearancePreview = AppearancePreviewPalette &
  Readonly<{
    archiveGeneration: number;
  }>;

const SYSTEM_SCHEME_QUERY = "(prefers-color-scheme: light)";

export class AppearanceRuntime {
  private readonly catalog: ArchiveThemeCatalog;
  private readonly getDocumentRoot: () => HTMLElement | null;
  private readonly globalPreferences: GlobalAppearanceSource;
  private readonly listeners = new Set<Listener>();
  private readonly matchMedia: ((query: string) => MediaQueryList) | undefined;
  private readonly onError: (error: unknown) => void;
  private readonly appThemes = new Map<AppThemeBase, ResolvedAppTheme>();
  private readonly customThemes = new WeakMap<ThemeManifestV1, ResolvedTheme>();
  private readonly readerThemes = new Map<ReaderThemeBase, ResolvedReaderTheme>();
  private activeArchive: ActiveArchiveContext | null = null;
  private appearanceSettings: Readonly<ArchiveAppearanceSettings> | null = null;
  private appliedAppTheme: ResolvedAppTheme | null = null;
  private appliedDocumentRoot: HTMLElement | null = null;
  private committedContext: AppearancePreviewContext | null = null;
  private generation = 0;
  private mediaQuery: MediaQueryList | null = null;
  private preferences: GlobalAppearancePreferences;
  private preview: ActiveAppearancePreview | null = null;
  private resolution: ArchiveThemeSelectionResolution | null = null;
  private snapshot: AppearanceRuntimeSnapshot;
  private stopPreferences: (() => void) | null = null;

  constructor(options: AppearanceRuntimeOptions) {
    this.catalog = options.catalog ?? new ArchiveThemeCatalog();
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
    this.preferences = options.globalPreferences.getSnapshot();
    this.snapshot = this.globalSnapshot(null);
  }

  getSnapshot = (): AppearanceRuntimeSnapshot => this.snapshot;

  getReaderSnapshot = (): ResolvedReaderTheme => this.snapshot.reader;

  getPreviewContext = (): AppearancePreviewContext | null => this.committedContext;

  applyPreview(archive: ActiveAppearanceArchive, palette: AppearancePreviewPalette): boolean {
    if (!palette.app && !palette.reader) return false;
    if (!this.isArchiveCurrent(archive)) return false;
    this.preview = Object.freeze({
      ...(palette.app ? { app: palette.app } : {}),
      ...(palette.reader ? { reader: palette.reader } : {}),
      archiveGeneration: archive.generation,
    });
    this.commitCurrentAppearance();
    return true;
  }

  clearPreview(archive: ActiveAppearanceArchive): boolean {
    if (!this.preview || !this.isArchiveCurrent(archive)) return false;
    if (this.preview.archiveGeneration !== archive.generation) return false;
    this.preview = null;
    this.commitCurrentAppearance();
    return true;
  }

  async keepPreview(
    archive: ActiveAppearanceArchive,
    expectedSettings: Readonly<ArchiveAppearanceSettings>,
    settings: ArchiveAppearanceSettings,
  ): Promise<void> {
    const context = this.activeArchive;
    if (!context || !this.isArchiveCurrent(archive)) {
      throw new AppearanceRuntimeArchiveChangedError();
    }
    if (!this.preview || this.preview.archiveGeneration !== archive.generation) {
      throw new Error("There is no active theme preview for this archive.");
    }
    if (
      !this.appearanceSettings ||
      !sameAppearanceSettings(this.appearanceSettings, expectedSettings)
    ) {
      throw new AppearanceRuntimeSettingsChangedError();
    }
    if (!context.settingsSource.saveArchiveAppearanceSettings) {
      throw new Error("Archive appearance settings cannot be saved.");
    }

    await this.persistAppearance(context, settings, true);
  }

  async saveArchiveAppearanceSettings(
    archive: ActiveAppearanceArchive,
    settings: ArchiveAppearanceSettings,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    const context = this.activeArchive;
    if (!context || !this.isArchiveCurrent(archive)) {
      throw new AppearanceRuntimeArchiveChangedError();
    }
    if (this.preview) {
      throw new Error("End the active theme preview before changing archive appearance.");
    }
    if (!context.settingsSource.saveArchiveAppearanceSettings) {
      throw new Error("Archive appearance settings cannot be saved.");
    }

    return this.persistAppearance(context, settings, false);
  }

  async refreshArchiveAppearance(
    archive: ActiveAppearanceArchive,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    const context = this.activeArchive;
    if (!context || !this.appearanceSettings || !this.isArchiveCurrent(archive)) {
      throw new AppearanceRuntimeArchiveChangedError();
    }
    if (this.preview) {
      throw new Error("End the active theme preview before reloading archive appearance.");
    }

    const operation = this.nextPersistenceOperation(context);
    return this.enqueuePersistence(context, async () => {
      this.assertPersistenceOperationCurrent(context, operation);
      let settings: Readonly<ArchiveAppearanceSettings>;
      try {
        settings = freezeAppearanceSettings(
          await context.settingsSource.getArchiveAppearanceSettings(),
        );
      } catch (error) {
        this.assertPersistenceOperationCurrent(context, operation);
        const knownPersisted = context.persistence.lastPersistedSettings;
        if (knownPersisted) {
          await this.resolveAndPublishAppearance(context, knownPersisted, operation, false);
        }
        throw error;
      }
      context.persistence.lastPersistedSettings = settings;
      this.assertPersistenceOperationCurrent(context, operation);
      return this.resolveAndPublishAppearance(context, settings, operation, false);
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (this.stopPreferences) return () => this.stop();

    this.mediaQuery = this.matchMedia?.(SYSTEM_SCHEME_QUERY) ?? null;
    this.addSystemSchemeListener();
    this.stopPreferences = this.globalPreferences.subscribe(this.handlePreferencesChange);
    this.preferences = this.globalPreferences.getSnapshot();
    this.commitCurrentAppearance();
    return () => this.stop();
  }

  stop(): void {
    this.stopPreferences?.();
    this.stopPreferences = null;
    this.removeSystemSchemeListener();
    this.mediaQuery = null;
    this.deactivateArchive();
  }

  async activateArchive(
    archive: AppearanceArchive,
    settingsSource: ArchiveAppearanceSettingsSource,
  ): Promise<void> {
    const context: ActiveArchiveContext = Object.freeze({
      generation: this.generation + 1,
      id: archive.id,
      persistence: {
        lastPersistedSettings: null,
        latestOperation: 0,
        tail: Promise.resolve(),
      },
      rootPath: archive.rootPath,
      settingsSource,
    });
    this.generation = context.generation;
    this.activeArchive = context;
    this.appearanceSettings = null;
    this.committedContext = null;
    this.preview = null;
    this.resolution = null;
    this.commitCurrentAppearance();

    try {
      this.catalog.activateArchive({ generation: context.generation, rootPath: context.rootPath });
      const settings = await settingsSource.getArchiveAppearanceSettings();
      if (!this.isCurrent(context)) return;
      context.persistence.lastPersistedSettings = freezeAppearanceSettings(settings);
      const resolution = await this.catalog.loadSelected(settings);
      if (!this.isCurrent(context)) return;
      this.publishResolvedAppearance(context, resolution, false);
    } catch (error) {
      if (!this.isCurrent(context) || error instanceof ArchiveThemeCatalogChangedError) return;
      this.appearanceSettings = null;
      this.resolution = null;
      this.commitCurrentAppearance();
      this.onError(error);
    }
  }

  deactivateArchive(archive?: AppearanceArchive): void {
    if (
      archive &&
      this.activeArchive &&
      (archive.id !== this.activeArchive.id || archive.rootPath !== this.activeArchive.rootPath)
    ) {
      return;
    }
    if (!this.activeArchive && !this.resolution) return;

    this.generation += 1;
    this.activeArchive = null;
    this.appearanceSettings = null;
    this.committedContext = null;
    this.preview = null;
    this.resolution = null;
    this.catalog.deactivateArchive();
    this.commitCurrentAppearance();
  }

  private readonly handlePreferencesChange = () => {
    const next = this.globalPreferences.getSnapshot();
    const appChanged = next.appThemePreset !== this.preferences.appThemePreset;
    const readerChanged = next.reader.theme !== this.preferences.reader.theme;
    if (!appChanged && !readerChanged) return;
    this.preferences = next;
    if (
      !this.resolution ||
      (appChanged && this.resolution.app.effective.kind === "inherit") ||
      (readerChanged && this.resolution.reader.effective.kind === "inherit")
    ) {
      this.commitCurrentAppearance();
    }
  };

  private readonly handleSystemSchemeChange = () => {
    const appSelection = this.resolution?.app.effective;
    if (
      appSelection?.kind === "system" ||
      (appSelection?.kind !== "theme" && this.preferences.appThemePreset === "system")
    ) {
      this.commitCurrentAppearance();
    }
  };

  private commitCurrentAppearance(): void {
    const archive = this.activeArchive ? publicArchive(this.activeArchive) : null;
    const resolved = this.resolution
      ? this.resolvedSnapshot(this.resolution, archive)
      : this.globalSnapshot(archive);
    const snapshot =
      this.preview && archive?.generation === this.preview.archiveGeneration
        ? Object.freeze({
            app: this.preview.app ?? resolved.app,
            archive,
            reader: this.preview.reader ?? resolved.reader,
          })
        : resolved;

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

  private globalSnapshot(archive: ActiveAppearanceArchive | null): AppearanceRuntimeSnapshot {
    return Object.freeze({
      app: this.resolveBuiltInAppTheme(this.globalAppBase()),
      archive,
      reader: this.resolveBuiltInReaderTheme(this.preferences.reader.theme),
    });
  }

  private resolvedSnapshot(
    resolution: ArchiveThemeSelectionResolution,
    archive: ActiveAppearanceArchive | null,
  ): AppearanceRuntimeSnapshot {
    return Object.freeze({
      app: this.resolveAppSelection(resolution.app, this.globalAppBase(), this.systemAppBase()),
      archive,
      reader: this.resolveReaderSelection(resolution.reader, this.preferences.reader.theme),
    });
  }

  private resolveAppSelection(
    selection: AppThemeCatalogSelection,
    fallback: AppThemeBase,
    system: AppThemeBase,
  ): ResolvedAppTheme {
    if (selection.effective.kind === "inherit") return this.resolveBuiltInAppTheme(fallback);
    if (selection.effective.kind === "system") return this.resolveBuiltInAppTheme(system);
    const entry = selection.effective.entry;
    if (entry.origin === "builtin") {
      if (!entry.appBase) throw new Error(`Built-in theme ${entry.id} has no application palette.`);
      return this.resolveBuiltInAppTheme(entry.appBase);
    }
    return this.resolveCustomTheme(entry.manifest).app;
  }

  private resolveReaderSelection(
    selection: ReaderThemeCatalogSelection,
    fallback: ReaderThemeBase,
  ): ResolvedReaderTheme {
    if (selection.effective.kind === "inherit") return this.resolveBuiltInReaderTheme(fallback);
    const entry = selection.effective.entry;
    if (entry.origin === "builtin") {
      if (!entry.readerBase) throw new Error(`Built-in theme ${entry.id} has no reader palette.`);
      return this.resolveBuiltInReaderTheme(entry.readerBase);
    }
    const reader = this.resolveCustomTheme(entry.manifest).reader;
    if (!reader) throw new Error(`Custom theme ${entry.id} has no reader palette.`);
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

  private globalAppBase(): "dark" | "light" {
    if (this.preferences.appThemePreset !== "system") return this.preferences.appThemePreset;
    return this.systemAppBase();
  }

  private systemAppBase(): "dark" | "light" {
    return this.mediaQuery?.matches ? "light" : "dark";
  }

  private isCurrent(context: ActiveArchiveContext): boolean {
    return this.activeArchive === context;
  }

  private async persistAppearance(
    context: ActiveArchiveContext,
    settings: ArchiveAppearanceSettings,
    clearPreview: boolean,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    const save = context.settingsSource.saveArchiveAppearanceSettings;
    if (!save) throw new Error("Archive appearance settings cannot be saved.");
    const operation = this.nextPersistenceOperation(context);
    const requested = freezeAppearanceSettings(settings);
    return this.enqueuePersistence(context, async () => {
      this.assertPersistenceOperationCurrent(context, operation);
      let saved: Readonly<ArchiveAppearanceSettings>;
      try {
        saved = freezeAppearanceSettings(await save(requested));
        context.persistence.lastPersistedSettings = saved;
      } catch (error) {
        if (!this.isCurrent(context)) throw new AppearanceRuntimeArchiveChangedError();
        if (context.persistence.latestOperation !== operation) {
          throw new AppearanceRuntimeSettingsChangedError();
        }
        await this.reconcilePersistedAppearance(context, operation);
        throw error;
      }

      this.assertPersistenceOperationCurrent(context, operation);
      return this.resolveAndPublishAppearance(context, saved, operation, clearPreview);
    });
  }

  private nextPersistenceOperation(context: ActiveArchiveContext): number {
    context.persistence.latestOperation += 1;
    return context.persistence.latestOperation;
  }

  private enqueuePersistence<Result>(
    context: ActiveArchiveContext,
    task: () => Promise<Result>,
  ): Promise<Result> {
    const operation = context.persistence.tail.catch(() => undefined).then(task);
    context.persistence.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async reconcilePersistedAppearance(
    context: ActiveArchiveContext,
    operation: number,
  ): Promise<void> {
    this.assertPersistenceOperationCurrent(context, operation);
    let authoritative: Readonly<ArchiveAppearanceSettings>;
    try {
      authoritative = freezeAppearanceSettings(
        await context.settingsSource.getArchiveAppearanceSettings(),
      );
      context.persistence.lastPersistedSettings = authoritative;
    } catch (error) {
      const knownPersisted = context.persistence.lastPersistedSettings;
      if (!knownPersisted) throw error;
      authoritative = knownPersisted;
      this.onError(error);
    }
    this.assertPersistenceOperationCurrent(context, operation);
    await this.resolveAndPublishAppearance(context, authoritative, operation, false);
  }

  private async resolveAndPublishAppearance(
    context: ActiveArchiveContext,
    settings: Readonly<ArchiveAppearanceSettings>,
    operation: number,
    clearPreview: boolean,
  ): Promise<Readonly<ArchiveAppearanceSettings>> {
    let retriedCurrentCatalog = false;
    while (true) {
      this.assertPersistenceOperationCurrent(context, operation);
      this.assertCatalogScopeCurrent(context);
      try {
        const resolution = await this.catalog.loadSelected(settings);
        this.assertPersistenceOperationCurrent(context, operation);
        this.assertCatalogScopeCurrent(context);
        return this.publishResolvedAppearance(context, resolution, clearPreview);
      } catch (error) {
        if (!(error instanceof ArchiveThemeCatalogChangedError)) throw error;
        this.assertPersistenceOperationCurrent(context, operation);
        this.assertCatalogScopeCurrent(context);
        if (retriedCurrentCatalog) throw error;
        retriedCurrentCatalog = true;
      }
    }
  }

  private publishResolvedAppearance(
    context: ActiveArchiveContext,
    resolution: ArchiveThemeSelectionResolution,
    clearPreview: boolean,
  ): Readonly<ArchiveAppearanceSettings> {
    if (!this.isCurrent(context)) throw new AppearanceRuntimeArchiveChangedError();
    const settings = appearanceSettingsFromResolution(resolution);
    this.appearanceSettings = settings;
    this.resolution = resolution;
    if (clearPreview) this.preview = null;
    this.updateCommittedContext(context, settings);
    this.commitCurrentAppearance();
    return settings;
  }

  private updateCommittedContext(
    context: ActiveArchiveContext,
    settings: Readonly<ArchiveAppearanceSettings>,
  ): void {
    const current = this.committedContext;
    if (
      current &&
      current.archive.generation === context.generation &&
      current.archive.id === context.id &&
      current.archive.rootPath === context.rootPath &&
      sameAppearanceSettings(current.settings, settings)
    ) {
      return;
    }
    this.committedContext = Object.freeze({
      archive: publicArchive(context),
      settings,
    });
  }

  private assertPersistenceOperationCurrent(
    context: ActiveArchiveContext,
    operation: number,
  ): void {
    if (!this.isCurrent(context)) throw new AppearanceRuntimeArchiveChangedError();
    if (context.persistence.latestOperation !== operation) {
      throw new AppearanceRuntimeSettingsChangedError();
    }
  }

  private assertCatalogScopeCurrent(context: ActiveArchiveContext): void {
    const scope = this.catalog.getSnapshot().archive;
    if (!scope || scope.generation !== context.generation || scope.rootPath !== context.rootPath) {
      throw new AppearanceRuntimeArchiveChangedError();
    }
  }

  private isArchiveCurrent(archive: ActiveAppearanceArchive): boolean {
    return (
      this.activeArchive?.generation === archive.generation &&
      this.activeArchive.id === archive.id &&
      this.activeArchive.rootPath === archive.rootPath
    );
  }

  private addSystemSchemeListener(): void {
    if (typeof this.mediaQuery?.addEventListener === "function") {
      this.mediaQuery.addEventListener("change", this.handleSystemSchemeChange);
      return;
    }
    this.mediaQuery?.addListener(this.handleSystemSchemeChange);
  }

  private removeSystemSchemeListener(): void {
    if (typeof this.mediaQuery?.removeEventListener === "function") {
      this.mediaQuery.removeEventListener("change", this.handleSystemSchemeChange);
      return;
    }
    this.mediaQuery?.removeListener(this.handleSystemSchemeChange);
  }
}

export class AppearanceRuntimeArchiveChangedError extends Error {
  constructor() {
    super("The active archive changed before the theme preview operation completed.");
    this.name = "AppearanceRuntimeArchiveChangedError";
  }
}

export class AppearanceRuntimeSettingsChangedError extends Error {
  constructor() {
    super("Archive appearance settings changed after the theme preview started.");
    this.name = "AppearanceRuntimeSettingsChangedError";
  }
}

function publicArchive(archive: ActiveArchiveContext): ActiveAppearanceArchive {
  return Object.freeze({
    generation: archive.generation,
    id: archive.id,
    rootPath: archive.rootPath,
  });
}

function appearanceSettingsFromResolution(
  resolution: ArchiveThemeSelectionResolution,
): Readonly<ArchiveAppearanceSettings> {
  return freezeAppearanceSettings({
    appTheme: resolution.app.requested,
    readerTheme: resolution.reader.requested,
  });
}

function freezeAppearanceSettings(
  settings: Readonly<ArchiveAppearanceSettings>,
): Readonly<ArchiveAppearanceSettings> {
  return Object.freeze({
    appTheme: Object.freeze({ ...settings.appTheme }),
    readerTheme: Object.freeze({ ...settings.readerTheme }),
  });
}

function sameAppearanceSettings(
  left: Readonly<ArchiveAppearanceSettings>,
  right: Readonly<ArchiveAppearanceSettings>,
): boolean {
  return (
    sameSelection(left.appTheme, right.appTheme) &&
    sameSelection(left.readerTheme, right.readerTheme)
  );
}

function sameSelection(
  left: Readonly<{ id?: string; kind: string }>,
  right: Readonly<{ id?: string; kind: string }>,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
