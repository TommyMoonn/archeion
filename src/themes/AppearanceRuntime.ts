import type {
  AppearanceSettings,
  AppPreferences,
  AppPreferencesPublication,
} from "../types/appSettings";
import { installedFontCatalog, type InstalledFontCatalog } from "../storage/installedFontCatalog";
import { applyApplicationFontStacks } from "./applicationFonts";
import type { AppThemeSelection, ReaderThemeSelection } from "../types/settings";
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
import { applicationPresentation, type AppearancePresentation } from "./appearancePresentation";

type Listener = () => void;

export type GlobalAppearancePreferences = Pick<AppPreferences, "appTheme" | "readerTheme">;

export type GlobalAppearanceSource = Readonly<{
  initialize?: () => Promise<void>;
  getInitializationGeneration?: () => number;
  getAppearancePublication?: () => AppPreferencesPublication;
  getRevisionSnapshot?: () => number;
  getSnapshot: () => GlobalAppearancePreferences & Pick<AppPreferences, "appearance">;
  subscribe: (listener: Listener) => () => void;
  update: (changes: Partial<GlobalAppearancePreferences>) => Promise<AppPreferences>;
}>;

export type AppearanceRuntimeSnapshot = Readonly<{
  app: ResolvedAppTheme;
  reader: ResolvedReaderTheme;
}>;

export type AppearancePreviewContext = Readonly<{
  settings: Readonly<GlobalAppearancePreferences>;
}>;

export type AppearanceRuntimeOptions = Readonly<{
  catalog?: ThemeCatalog;
  fontCatalog?: InstalledFontCatalog;
  getDocumentRoot?: () => HTMLElement | null;
  globalPreferences: GlobalAppearanceSource;
  matchMedia?: (query: string) => MediaQueryList;
  onError?: (error: unknown) => void;
  preparePresentation?: (presentation: AppearancePresentation) => Promise<void>;
}>;

const SYSTEM_SCHEME_QUERY = "(prefers-color-scheme: light)";
const APPEARANCE_LOAD_TIMEOUT_MS = 5_000;
const CUSTOM_THEME_ERROR =
  "The selected theme could not be loaded. The default theme is active. Choose a theme in Settings or retry in Theme Manager.";

export type AppearanceStartupSnapshot = Readonly<{ ready: boolean; error: string | null }>;

export class AppearanceRuntime {
  private readonly appThemes = new Map<AppThemeBase, ResolvedAppTheme>();
  private appliedAppTheme: ResolvedAppTheme | null = null;
  private appliedDocumentRoot: HTMLElement | null = null;
  private readonly catalog: ThemeCatalog;
  private readonly fontCatalog: InstalledFontCatalog;
  private fontCatalogRevision = 0;
  private fontFamilies: readonly string[] = [];
  private appearance: AppearanceSettings;
  private committedContext: AppearancePreviewContext;
  private committedResolution: ThemeSelectionResolution | null = null;
  private readonly customThemes = new WeakMap<ThemeManifestV1, ResolvedTheme>();
  private readonly getDocumentRoot: () => HTMLElement | null;
  private readonly globalPreferences: GlobalAppearanceSource;
  private readonly listeners = new Set<Listener>();
  private readonly matchMedia: ((query: string) => MediaQueryList) | undefined;
  private mediaQuery: MediaQueryList | null = null;
  private readonly onError: (error: unknown) => void;
  private readonly preparePresentation: AppearanceRuntimeOptions["preparePresentation"];
  private preferences: Readonly<GlobalAppearancePreferences>;
  private preview: ResolvedAppTheme | null = null;
  private readerPreview: ResolvedReaderTheme | null = null;
  private readonly readerThemes = new Map<ReaderThemeBase, ResolvedReaderTheme>();
  private resolutionRevision = 0;
  private snapshot: AppearanceRuntimeSnapshot;
  private stopCatalog: (() => void) | null = null;
  private stopCatalogSynchronization: (() => void) | null = null;
  private stopPreferences: (() => void) | null = null;
  private initialized = false;
  private lifecycleRevision = 0;
  private initializationAbort: AbortController | null = null;
  private retiredInitializationGeneration = -1;
  private unversionedHydrationRetired = false;
  private awaitingPreferenceRecovery = false;
  private lastPreferencePublication: AppPreferencesPublication | undefined;
  private resolutionAbort: AbortController | null = null;
  private failedSelection: Readonly<GlobalAppearancePreferences> | null = null;
  private failedCatalogRevision = -1;
  private startup: AppearanceStartupSnapshot = Object.freeze({ ready: false, error: null });

  constructor(options: AppearanceRuntimeOptions) {
    this.catalog = options.catalog ?? new ThemeCatalog();
    this.fontCatalog = options.fontCatalog ?? installedFontCatalog;
    this.appearance = options.globalPreferences.getSnapshot().appearance;
    this.getDocumentRoot =
      options.getDocumentRoot ??
      (() => (typeof document === "undefined" ? null : document.documentElement));
    this.globalPreferences = options.globalPreferences;
    this.preparePresentation = options.preparePresentation;
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
  getPreviewContext = (): AppearancePreviewContext => this.committedContext;
  getStartupSnapshot = (): AppearanceStartupSnapshot => this.startup;

  dismissStartupError = (): void => {
    this.setStartup(this.startup.ready, null);
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (this.stopPreferences) return () => this.stop();
    this.lifecycleRevision += 1;
    this.mediaQuery = this.matchMedia?.(SYSTEM_SCHEME_QUERY) ?? null;
    this.addSystemSchemeListener();
    this.stopCatalog = this.catalog.subscribe(this.handleCatalogChange);
    this.stopCatalogSynchronization = this.catalog.startSynchronization();
    this.stopPreferences = this.globalPreferences.subscribe(this.handlePreferencesChange);
    if (this.globalPreferences.initialize) {
      const controller = new AbortController();
      this.initializationAbort = controller;
      const initialization = this.globalPreferences.initialize();
      const generation = this.globalPreferences.getInitializationGeneration?.();
      void this.initializePreferences(controller, initialization, generation);
    } else {
      this.initialized = true;
      this.adoptPreferences(this.globalPreferences.getSnapshot());
    }
    const revision = ++this.fontCatalogRevision;
    void this.fontCatalog
      .load()
      .then((families) => {
        if (revision !== this.fontCatalogRevision || !this.stopPreferences) return;
        this.fontFamilies = families;
        // Resolve the latest settings, not those captured before enumeration.
        this.applyFonts();
      })
      .catch((error: unknown) => {
        if (revision === this.fontCatalogRevision && this.stopPreferences) this.onError(error);
      });
    return () => this.stop();
  }

  stop(): void {
    this.lifecycleRevision += 1;
    this.initializationAbort?.abort();
    this.resolutionAbort?.abort();
    this.resolutionRevision += 1;
    this.initialized = false;
    this.fontCatalogRevision += 1;
    this.stopPreferences?.();
    this.stopPreferences = null;
    this.stopCatalog?.();
    this.stopCatalog = null;
    this.stopCatalogSynchronization?.();
    this.stopCatalogSynchronization = null;
    this.preview = null;
    this.readerPreview = null;
    if (this.startup.ready) this.commitCurrentAppearance();
    this.removeSystemSchemeListener();
    this.mediaQuery = null;
  }

  applyPreview(appTheme: ResolvedAppTheme): boolean {
    this.preview = appTheme;
    this.commitCurrentAppearance();
    return true;
  }

  clearPreview(): boolean {
    if (!this.preview) return false;
    this.preview = null;
    this.commitCurrentAppearance();
    return true;
  }

  async keepPreview(
    expectedSettings: Readonly<GlobalAppearancePreferences>,
    selection: AppThemeSelection,
  ): Promise<void> {
    if (!this.preview) throw new Error("There is no active application theme preview.");
    if (!samePreferences(this.preferences, expectedSettings)) {
      throw new AppearanceRuntimeSettingsChangedError();
    }
    await this.globalPreferences.update({ appTheme: selection });
    this.adoptPreferences(this.globalPreferences.getSnapshot());
    this.preview = null;
    this.commitCurrentAppearance();
  }

  async applyReaderPreview(selection: ReaderThemeSelection): Promise<boolean> {
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

  clearReaderPreview(): boolean {
    if (!this.readerPreview) return false;
    this.readerPreview = null;
    this.commitCurrentAppearance();
    return true;
  }

  async keepReaderPreview(
    expectedSettings: Readonly<GlobalAppearancePreferences>,
    selection: ReaderThemeSelection,
  ): Promise<void> {
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
    await this.globalPreferences.update(changes);
    if (changes.appTheme !== undefined) {
      this.unversionedHydrationRetired = false;
      this.awaitingPreferenceRecovery = false;
      this.setStartup(this.startup.ready, null);
    }
    this.adoptCurrentPreferences();
    this.commitCurrentAppearance();
    return this.preferences;
  }

  async refreshAppearance(): Promise<void> {
    const lifecycle = this.lifecycleRevision;
    if (this.globalPreferences.initialize) {
      await appearanceDeadline(this.globalPreferences.initialize(), new AbortController().signal);
      if (lifecycle !== this.lifecycleRevision || !this.stopPreferences) return;
      // Explicit recovery authorizes the current canonical snapshot, not the
      // observation belonging to a retired initialization generation.
      this.unversionedHydrationRetired = false;
      this.awaitingPreferenceRecovery = false;
      this.setStartup(this.startup.ready, null);
      this.adoptPreferences(this.globalPreferences.getSnapshot());
    }
    this.failedSelection = null;
    await appearanceDeadline(this.catalog.reload(), new AbortController().signal);
    if (lifecycle !== this.lifecycleRevision || !this.stopPreferences) return;
    await this.resolveCommittedAppearance();
  }

  private async initializePreferences(
    controller: AbortController,
    initialization: Promise<void>,
    generation: number | undefined,
  ): Promise<void> {
    try {
      await appearanceDeadline(initialization, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AppearanceLoadTimeoutError) {
        this.awaitingPreferenceRecovery = true;
        if (generation !== undefined)
          this.retiredInitializationGeneration = Math.max(
            this.retiredInitializationGeneration,
            generation,
          );
        else this.unversionedHydrationRetired = true;
      }
      this.onError(error);
      this.setStartup(
        false,
        "Appearance settings could not be loaded. The available settings are active. Restart Archeion to try again.",
      );
    }
    if (controller.signal.aborted) return;
    this.initialized = true;
    if (this.isRetiredHydration()) {
      this.setStartup(true, this.startup.error);
      this.commitCurrentAppearance();
      return;
    }
    this.lastPreferencePublication = this.globalPreferences.getAppearancePublication?.();
    this.adoptPreferences(this.globalPreferences.getSnapshot());
  }

  private isRetiredHydration(): boolean {
    const publication = this.globalPreferences.getAppearancePublication?.();
    return publication
      ? publication.kind === "initialization" &&
          publication.generation <= this.retiredInitializationGeneration
      : this.unversionedHydrationRetired;
  }

  private readonly handlePreferencesChange = () => {
    if (!this.initialized || this.isRetiredHydration()) return;
    const publication = this.globalPreferences.getAppearancePublication?.();
    const newAuthority =
      publication !== undefined &&
      publication !== this.lastPreferencePublication &&
      (publication.kind === "initialization"
        ? publication.generation > this.retiredInitializationGeneration
        : publication.appThemeChanged);
    this.lastPreferencePublication = publication;
    if (newAuthority) {
      this.awaitingPreferenceRecovery = false;
      this.setStartup(this.startup.ready, null);
    }
    this.adoptCurrentPreferences();
    if (newAuthority) this.commitCurrentAppearance();
  };

  private adoptCurrentPreferences(): void {
    const current = this.globalPreferences.getSnapshot();
    // Reader/font changes remain usable, but cannot authorize replacement of an
    // application fallback by the value belonging to a retired native read.
    this.adoptPreferences(
      this.awaitingPreferenceRecovery
        ? { ...current, appTheme: this.preferences.appTheme }
        : current,
      this.awaitingPreferenceRecovery,
    );
  }

  private readonly handleCatalogChange = () => {
    if (!this.initialized) return;
    // Completing the same timed-out read is not a new catalog selection. An actual
    // catalog revision (for example replacement in another window) may recover it.
    if (this.failedSelection && this.catalog.getSnapshot().revision <= this.failedCatalogRevision)
      return;
    this.failedSelection = null;
    void this.resolveCommittedAppearance();
  };

  private adoptPreferences(
    preferences: GlobalAppearancePreferences & Pick<AppPreferences, "appearance">,
    preserveStartupError = false,
  ): void {
    this.appearance = preferences.appearance;
    this.applyFonts();
    const next = freezePreferences(preferences);
    if (
      samePreferences(this.preferences, next) &&
      (this.committedResolution || this.failedSelection)
    )
      return;
    const appChanged = !sameAppSelection(this.preferences.appTheme, next.appTheme);
    const readerChanged = !sameReaderSelection(this.preferences.readerTheme, next.readerTheme);
    if (appChanged || readerChanged) {
      this.failedSelection = null;
      if (this.startup.ready && !preserveStartupError) this.setStartup(true, null);
    }
    this.preferences = next;
    this.committedContext = freezeContext(next);
    if (appChanged) this.preview = null;
    if (readerChanged) this.readerPreview = null;
    this.committedResolution = null;
    if (next.appTheme.kind !== "custom" && !this.preparePresentation)
      this.setStartup(true, this.startup.error);
    if (this.startup.ready) this.commitCurrentAppearance();
    void this.resolveCommittedAppearance();
  }

  private async resolveCommittedAppearance(): Promise<void> {
    const revision = this.resolutionRevision + 1;
    this.resolutionRevision = revision;
    this.resolutionAbort?.abort();
    const controller = new AbortController();
    this.resolutionAbort = controller;
    const expected = this.preferences;
    try {
      if (expected.appTheme.kind !== "custom" && this.preparePresentation) {
        await this.prepareCommittedPresentation(
          this.safeSnapshot(expected).app,
          null,
          controller.signal,
        );
        if (revision !== this.resolutionRevision) return;
        this.setStartup(true, this.startup.error);
        this.commitCurrentAppearance();
      }
      const resolution = await appearanceDeadline(
        this.catalog.loadSelected(expected),
        controller.signal,
      );
      if (revision !== this.resolutionRevision || !samePreferences(this.preferences, expected)) {
        return;
      }
      await this.prepareCommittedPresentation(
        this.resolveAppSelection(resolution.app),
        resolution,
        controller.signal,
      );
      if (revision !== this.resolutionRevision || !samePreferences(this.preferences, expected))
        return;
      this.committedResolution = resolution;
      this.setStartup(
        true,
        resolution.app.fellBack
          ? CUSTOM_THEME_ERROR
          : this.startup.error === CUSTOM_THEME_ERROR
            ? null
            : this.startup.error,
      );
      this.commitCurrentAppearance();
    } catch (error) {
      if (revision !== this.resolutionRevision || error instanceof ThemeCatalogChangedError) return;
      this.onError(error);
      this.failedSelection = expected;
      this.failedCatalogRevision = this.catalog.getSnapshot().revision;
      // Fence a timed-out catalog read, including its eventual catalog notification.
      this.resolutionRevision += 1;
      this.setStartup(true, CUSTOM_THEME_ERROR);
      this.commitCurrentAppearance(true);
    }
  }

  private readonly handleSystemSchemeChange = () => {
    if (this.preferences.appTheme.kind === "system") {
      this.commitCurrentAppearance();
      void this.resolveCommittedAppearance();
    }
  };

  private async prepareCommittedPresentation(
    app: ResolvedAppTheme,
    resolution: ThemeSelectionResolution | null,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.preparePresentation || this.awaitingPreferenceRecovery) return;
    const effective = resolution?.app.effective;
    const manifestSource =
      effective?.kind === "theme" && effective.entry.origin === "custom"
        ? (this.catalog.getManifestSource(effective.entry.manifest) ?? null)
        : null;
    await appearanceDeadline(
      this.preparePresentation(
        applicationPresentation(
          this.preferences.appTheme,
          this.globalPreferences.getRevisionSnapshot?.() ?? 0,
          app,
          manifestSource,
        ),
      ),
      signal,
    );
  }

  private commitCurrentAppearance(useFallback = false): void {
    if (!this.startup.ready) return;
    const committed = this.committedResolution
      ? this.resolvedSnapshot(this.committedResolution)
      : this.safeSnapshot(this.preferences);
    const snapshot = Object.freeze({
      app:
        this.preview ??
        (!this.committedResolution &&
        this.preferences.appTheme.kind === "custom" &&
        this.appliedAppTheme &&
        !useFallback
          ? this.snapshot.app
          : committed.app),
      reader: this.readerPreview ?? committed.reader,
    });
    const root = this.getDocumentRoot();
    if (root) applyApplicationFontStacks(root, this.appearance, this.fontFamilies);
    if (!root) {
      this.appliedDocumentRoot = null;
    } else if (root !== this.appliedDocumentRoot || snapshot.app !== this.appliedAppTheme) {
      applyResolvedAppTheme(root, snapshot.app);
      this.appliedDocumentRoot = root;
      this.appliedAppTheme = snapshot.app;
    }
    if (root) {
      // Token writes and reveal happen in the same task, before the browser can paint.
      delete root.dataset.appearancePending;
      root.ownerDocument.getElementById("root")?.removeAttribute("inert");
    }
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private setStartup(ready: boolean, error: string | null): void {
    if (this.startup.ready === ready && this.startup.error === error) return;
    this.startup = Object.freeze({ ready, error });
  }

  private applyFonts(): void {
    const root = this.getDocumentRoot();
    if (root) applyApplicationFontStacks(root, this.appearance, this.fontFamilies);
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
      reader: this.resolveBuiltInReaderTheme(readerBase),
    });
  }

  private resolvedSnapshot(resolution: ThemeSelectionResolution): AppearanceRuntimeSnapshot {
    return Object.freeze({
      app: this.resolveAppSelection(resolution.app),
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

function freezeContext(preferences: GlobalAppearancePreferences): AppearancePreviewContext {
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

class AppearanceLoadTimeoutError extends Error {
  constructor() {
    super("Appearance load timed out.");
  }
}

function appearanceDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new Error("Appearance load cancelled.")));
    const timer = setTimeout(
      () => finish(() => reject(new AppearanceLoadTimeoutError())),
      APPEARANCE_LOAD_TIMEOUT_MS,
    );
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      settle();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
