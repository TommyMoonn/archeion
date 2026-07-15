import type { ArchiveAppearanceSettings } from "../types/settings";
import type {
  ActiveAppearanceArchive,
  AppearancePreviewContext,
  AppearancePreviewPalette,
  AppearanceRuntimeSnapshot,
} from "./AppearanceRuntime";
import type { ThemeContrastWarning, ThemeDiagnostic, ThemeManifestV1 } from "./domain";
import { resolveTheme } from "./resolveTheme";
import { validateThemeManifest } from "./validateThemeManifest";

type Listener = () => void;

export type ThemePreviewChannels = Readonly<{
  application: boolean;
  reader: boolean;
}>;

type ActiveThemePreviewSnapshot = Readonly<{
  archive: ActiveAppearanceArchive;
  candidate: Readonly<{ id: string; name: string }>;
  channels: ThemePreviewChannels;
  contrastWarnings: readonly ThemeContrastWarning[];
  error?: string;
  status: "previewing" | "keeping" | "error";
  warningsAcknowledged: boolean;
}>;

export type ThemePreviewSessionSnapshot = Readonly<{ status: "idle" }> | ActiveThemePreviewSnapshot;

export type ThemePreviewHandle = Readonly<{
  dispose: () => boolean;
}>;

export type ThemePreviewStartResult =
  | Readonly<{ handle: ThemePreviewHandle; ok: true }>
  | Readonly<{
      diagnostics?: readonly ThemeDiagnostic[];
      ok: false;
      reason: "busy" | "invalid-theme" | "no-active-archive" | "no-channels" | "reader-unavailable";
    }>;

export type ThemePreviewRuntime = Readonly<{
  applyPreview: (archive: ActiveAppearanceArchive, palette: AppearancePreviewPalette) => boolean;
  clearPreview: (archive: ActiveAppearanceArchive) => boolean;
  getPreviewContext: () => AppearancePreviewContext | null;
  getSnapshot: () => AppearanceRuntimeSnapshot;
  keepPreview: (
    archive: ActiveAppearanceArchive,
    expectedSettings: Readonly<ArchiveAppearanceSettings>,
    settings: ArchiveAppearanceSettings,
  ) => Promise<void>;
  subscribe: (listener: Listener) => () => void;
}>;

type ActiveSession = Readonly<{
  archive: ActiveAppearanceArchive;
  id: number;
  nextSettings: ArchiveAppearanceSettings;
  rollbackSettings: Readonly<ArchiveAppearanceSettings>;
}>;

const IDLE_SNAPSHOT: ThemePreviewSessionSnapshot = Object.freeze({ status: "idle" });

export class ThemePreviewSession {
  private active: ActiveSession | null = null;
  private cleanupRequested = false;
  private readonly listeners = new Set<Listener>();
  private nextSessionId = 0;
  private snapshot: ThemePreviewSessionSnapshot = IDLE_SNAPSHOT;
  private stopRuntime: (() => void) | null = null;

  constructor(private readonly runtime: ThemePreviewRuntime) {}

  getSnapshot = (): ThemePreviewSessionSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  startPreview(input: {
    candidate: unknown;
    channels: ThemePreviewChannels;
  }): ThemePreviewStartResult {
    if (this.snapshot.status === "keeping") return Object.freeze({ ok: false, reason: "busy" });

    const validation = validateThemeManifest(input.candidate);
    if (!validation.ok) {
      return Object.freeze({
        diagnostics: validation.diagnostics,
        ok: false,
        reason: "invalid-theme",
      });
    }
    if (!input.channels.application && !input.channels.reader) {
      return Object.freeze({ ok: false, reason: "no-channels" });
    }

    const resolved = resolveTheme(validation.manifest);
    if (input.channels.reader && !resolved.reader) {
      return Object.freeze({ ok: false, reason: "reader-unavailable" });
    }

    const initialContext = this.runtime.getPreviewContext();
    if (!initialContext) return Object.freeze({ ok: false, reason: "no-active-archive" });

    if (this.active) this.revertSession(this.active.id);
    const context = this.runtime.getPreviewContext();
    if (!context || !sameArchive(context.archive, initialContext.archive)) {
      return Object.freeze({ ok: false, reason: "no-active-archive" });
    }

    const channels = Object.freeze({ ...input.channels });
    const contrastWarnings = Object.freeze(
      resolved.contrastWarnings.filter((warning) => warningAppliesToChannels(warning, channels)),
    );
    const rollbackSettings = freezeAppearanceSettings(context.settings);
    const nextSettings = previewSettings(rollbackSettings, validation.manifest, channels);
    const palette: AppearancePreviewPalette = Object.freeze({
      ...(channels.application ? { app: resolved.app } : {}),
      ...(channels.reader && resolved.reader ? { reader: resolved.reader } : {}),
    });
    const id = this.nextSessionId + 1;
    this.nextSessionId = id;
    this.active = Object.freeze({
      archive: context.archive,
      id,
      nextSettings,
      rollbackSettings,
    });
    this.cleanupRequested = false;
    this.publish(
      activeSnapshot({
        archive: context.archive,
        candidate: validation.manifest,
        channels,
        contrastWarnings,
        status: "previewing",
        warningsAcknowledged: false,
      }),
    );
    this.stopRuntime = this.runtime.subscribe(this.handleRuntimeChange);

    if (!this.runtime.applyPreview(context.archive, palette)) {
      this.finishSession(id);
      return Object.freeze({ ok: false, reason: "no-active-archive" });
    }

    return Object.freeze({
      handle: Object.freeze({ dispose: () => this.revertSession(id) }),
      ok: true,
    });
  }

  acknowledgeWarnings(acknowledged: boolean): void {
    if (this.snapshot.status === "idle" || this.snapshot.contrastWarnings.length === 0) return;
    if (this.snapshot.status === "keeping") return;
    this.publish(
      activeSnapshot({
        ...this.snapshot,
        status: this.snapshot.status,
        warningsAcknowledged: acknowledged,
      }),
    );
  }

  async keep(): Promise<boolean> {
    const active = this.active;
    if (!active || this.snapshot.status === "idle" || this.snapshot.status === "keeping") {
      return false;
    }
    if (this.snapshot.contrastWarnings.length > 0 && !this.snapshot.warningsAcknowledged) {
      return false;
    }

    this.publish(activeSnapshot({ ...this.snapshot, status: "keeping" }));
    try {
      await this.runtime.keepPreview(active.archive, active.rollbackSettings, active.nextSettings);
    } catch {
      const snapshot = this.getSnapshot();
      if (this.active?.id === active.id && snapshot.status !== "idle") {
        if (this.cleanupRequested) {
          this.runtime.clearPreview(active.archive);
          this.finishSession(active.id);
          return false;
        }
        this.publish(
          activeSnapshot({
            ...snapshot,
            error: "The theme could not be kept. The preview is still active.",
            status: "error",
          }),
        );
      }
      return false;
    }

    if (this.active?.id !== active.id) return false;
    this.finishSession(active.id);
    return true;
  }

  revert(): boolean {
    if (!this.active) return false;
    return this.revertSession(this.active.id);
  }

  dispose(): void {
    if (this.active) {
      this.revertSession(this.active.id);
      if (this.active) return;
    }
    this.stopRuntime?.();
    this.stopRuntime = null;
    this.active = null;
    this.publish(IDLE_SNAPSHOT);
  }

  private readonly handleRuntimeChange = () => {
    const active = this.active;
    if (!active) return;
    const archive = this.runtime.getSnapshot().archive;
    if (!archive || !sameArchive(archive, active.archive)) this.finishSession(active.id);
  };

  private revertSession(id: number): boolean {
    const active = this.active;
    if (!active || active.id !== id) return false;
    if (this.snapshot.status === "keeping") {
      this.cleanupRequested = true;
      return true;
    }
    this.runtime.clearPreview(active.archive);
    this.finishSession(id);
    return true;
  }

  private finishSession(id: number): void {
    if (this.active?.id !== id) return;
    this.stopRuntime?.();
    this.stopRuntime = null;
    this.active = null;
    this.cleanupRequested = false;
    this.publish(IDLE_SNAPSHOT);
  }

  private publish(snapshot: ThemePreviewSessionSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

function activeSnapshot(
  snapshot: Omit<ActiveThemePreviewSnapshot, "candidate"> & {
    candidate: Pick<ThemeManifestV1, "id" | "name">;
  },
): ActiveThemePreviewSnapshot {
  return Object.freeze({
    ...snapshot,
    candidate: Object.freeze({ id: snapshot.candidate.id, name: snapshot.candidate.name }),
  });
}

function previewSettings(
  rollbackSettings: Readonly<ArchiveAppearanceSettings>,
  manifest: ThemeManifestV1,
  channels: ThemePreviewChannels,
): ArchiveAppearanceSettings {
  return {
    appTheme: channels.application
      ? { kind: "custom", id: manifest.id }
      : { ...rollbackSettings.appTheme },
    readerTheme: channels.reader
      ? { kind: "custom", id: manifest.id }
      : { ...rollbackSettings.readerTheme },
  };
}

function freezeAppearanceSettings(
  settings: Readonly<ArchiveAppearanceSettings>,
): Readonly<ArchiveAppearanceSettings> {
  return Object.freeze({
    appTheme: Object.freeze({ ...settings.appTheme }),
    readerTheme: Object.freeze({ ...settings.readerTheme }),
  });
}

function warningAppliesToChannels(
  warning: ThemeContrastWarning,
  channels: ThemePreviewChannels,
): boolean {
  if (warning.foregroundPath.startsWith("$.reader")) return channels.reader;
  return channels.application;
}

function sameArchive(left: ActiveAppearanceArchive, right: ActiveAppearanceArchive): boolean {
  return (
    left.generation === right.generation && left.id === right.id && left.rootPath === right.rootPath
  );
}
