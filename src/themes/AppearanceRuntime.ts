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

export type AppearanceRuntimeOptions = Readonly<{
  catalog?: ArchiveThemeCatalog;
  getDocumentRoot?: () => HTMLElement | null;
  globalPreferences: GlobalAppearanceSource;
  matchMedia?: (query: string) => MediaQueryList;
  onError?: (error: unknown) => void;
}>;

type ActiveArchiveContext = ActiveAppearanceArchive &
  Readonly<{
    settingsSource: ArchiveAppearanceSettingsSource;
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
  private appliedAppTheme: ResolvedAppTheme | null = null;
  private appliedDocumentRoot: HTMLElement | null = null;
  private generation = 0;
  private mediaQuery: MediaQueryList | null = null;
  private preferences: GlobalAppearancePreferences;
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
      rootPath: archive.rootPath,
      settingsSource,
    });
    this.generation = context.generation;
    this.activeArchive = context;
    this.resolution = null;
    this.commitCurrentAppearance();

    try {
      this.catalog.activateArchive({ generation: context.generation, rootPath: context.rootPath });
      const settings = await settingsSource.getArchiveAppearanceSettings();
      if (!this.isCurrent(context)) return;
      const resolution = await this.catalog.loadSelected(settings);
      if (!this.isCurrent(context)) return;
      this.resolution = resolution;
      this.commitCurrentAppearance();
    } catch (error) {
      if (!this.isCurrent(context) || error instanceof ArchiveThemeCatalogChangedError) return;
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
    const archive = this.activeArchive
      ? Object.freeze({
          generation: this.activeArchive.generation,
          id: this.activeArchive.id,
          rootPath: this.activeArchive.rootPath,
        })
      : null;
    const snapshot = this.resolution
      ? this.resolvedSnapshot(this.resolution, archive)
      : this.globalSnapshot(archive);

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
