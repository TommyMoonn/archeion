import type { AppThemeSelection } from "../types/settings";
import type {
  AppearancePreviewContext,
  AppearanceRuntimeSnapshot,
  GlobalAppearancePreferences,
} from "./AppearanceRuntime";
import type {
  ResolvedAppTheme,
  ResolvedTheme,
  ThemeContrastWarning,
  ThemeDiagnostic,
  ThemeManifestV1,
} from "./domain";
import { resolveBuiltInAppTheme, resolveTheme } from "./resolveTheme";
import { validateThemeManifest } from "./validateThemeManifest";

type Listener = () => void;

type ActiveThemePreviewSnapshot = Readonly<{
  candidate: Readonly<{ id: string; name: string }>;
  contrastWarnings: readonly ThemeContrastWarning[];
  error?: string;
  status: "previewing" | "keeping" | "error";
  warningsAcknowledged: boolean;
}>;

export type ThemePreviewSessionSnapshot = Readonly<{ status: "idle" }> | ActiveThemePreviewSnapshot;

export type ThemePreviewHandle = Readonly<{ dispose: () => boolean }>;

export type ThemePreviewStartResult =
  | Readonly<{ handle: ThemePreviewHandle; ok: true }>
  | Readonly<{
      diagnostics?: readonly ThemeDiagnostic[];
      ok: false;
      reason: "busy" | "invalid-theme";
    }>;

export type BuiltInAppThemePreview = Readonly<{
  id: "dark" | "light";
  name: string;
}>;

export type ThemePreviewRuntime = Readonly<{
  applyPreview: (appTheme: ResolvedAppTheme) => boolean;
  clearPreview: () => boolean;
  getPreviewContext: () => AppearancePreviewContext;
  getSnapshot: () => AppearanceRuntimeSnapshot;
  keepPreview: (
    expectedSettings: Readonly<GlobalAppearancePreferences>,
    selection: AppThemeSelection,
  ) => Promise<void>;
  subscribe: (listener: Listener) => () => void;
}>;

type ActiveSession = Readonly<{
  id: number;
  rollbackSettings: Readonly<GlobalAppearancePreferences>;
  selection: AppThemeSelection;
}>;

const IDLE_SNAPSHOT: ThemePreviewSessionSnapshot = Object.freeze({ status: "idle" });

export class ThemePreviewSession {
  private active: ActiveSession | null = null;
  private cleanupRequested = false;
  private readonly listeners = new Set<Listener>();
  private nextSessionId = 0;
  private readonly resolvedCustomPreviews = new WeakMap<ThemeManifestV1, ResolvedTheme>();
  private snapshot: ThemePreviewSessionSnapshot = IDLE_SNAPSHOT;
  private stopRuntime: (() => void) | null = null;

  constructor(private readonly runtime: ThemePreviewRuntime) {}

  getSnapshot = (): ThemePreviewSessionSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  startPreview(input: { candidate: unknown }): ThemePreviewStartResult {
    if (this.snapshot.status === "keeping") return Object.freeze({ ok: false, reason: "busy" });
    const validation = validateThemeManifest(input.candidate);
    if (!validation.ok) {
      return Object.freeze({
        diagnostics: validation.diagnostics,
        ok: false,
        reason: "invalid-theme",
      });
    }
    return this.startValidatedPreview(validation.manifest);
  }

  getApplicationContrastWarnings(candidate: ThemeManifestV1): readonly ThemeContrastWarning[] {
    return Object.freeze(
      this.resolveCustomPreview(candidate).contrastWarnings.filter(
        (warning) => !warning.foregroundPath.startsWith("$.reader"),
      ),
    );
  }

  startValidatedPreview(candidate: ThemeManifestV1): ThemePreviewStartResult {
    const resolved = this.resolveCustomPreview(candidate);
    return this.startResolvedPreview({
      appTheme: resolved.app,
      candidate,
      contrastWarnings: this.getApplicationContrastWarnings(candidate),
      selection: { kind: "custom", id: candidate.id },
    });
  }

  startBuiltInPreview(candidate: BuiltInAppThemePreview): ThemePreviewStartResult {
    return this.startResolvedPreview({
      appTheme: resolveBuiltInAppTheme(candidate.id),
      candidate,
      contrastWarnings: [],
      selection: { kind: "builtin", id: candidate.id },
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
      await this.runtime.keepPreview(active.rollbackSettings, active.selection);
    } catch {
      const snapshot = this.getSnapshot();
      if (this.active?.id === active.id && snapshot.status !== "idle") {
        if (this.cleanupRequested) {
          this.runtime.clearPreview();
          this.finishSession(active.id);
          return false;
        }
        this.publish(
          activeSnapshot({
            ...snapshot,
            error: "The theme could not be saved. The preview is still active.",
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
    return this.active ? this.revertSession(this.active.id) : false;
  }

  dispose(): void {
    if (this.active) {
      this.revertSession(this.active.id);
      if (this.active) return;
    }
    this.stopRuntime?.();
    this.stopRuntime = null;
    this.publish(IDLE_SNAPSHOT);
  }

  private startResolvedPreview(input: {
    appTheme: ResolvedAppTheme;
    candidate: Readonly<{ id: string; name: string }>;
    contrastWarnings: readonly ThemeContrastWarning[];
    selection: AppThemeSelection;
  }): ThemePreviewStartResult {
    if (this.snapshot.status === "keeping") return Object.freeze({ ok: false, reason: "busy" });
    if (this.active) this.revertSession(this.active.id);
    const rollbackSettings = freezePreferences(this.runtime.getPreviewContext().settings);
    const id = this.nextSessionId + 1;
    this.nextSessionId = id;
    this.active = Object.freeze({
      id,
      rollbackSettings,
      selection: Object.freeze({ ...input.selection }),
    });
    this.cleanupRequested = false;
    this.publish(
      activeSnapshot({
        candidate: input.candidate,
        contrastWarnings: Object.freeze([...input.contrastWarnings]),
        status: "previewing",
        warningsAcknowledged: false,
      }),
    );
    this.stopRuntime = this.runtime.subscribe(this.handleRuntimeChange);
    this.runtime.applyPreview(input.appTheme);
    return Object.freeze({
      handle: Object.freeze({ dispose: () => this.revertSession(id) }),
      ok: true,
    });
  }

  private readonly handleRuntimeChange = () => {
    const active = this.active;
    if (!active || this.snapshot.status === "keeping") return;
    if (!samePreferences(this.runtime.getPreviewContext().settings, active.rollbackSettings)) {
      this.runtime.clearPreview();
      this.finishSession(active.id);
    }
  };

  private revertSession(id: number): boolean {
    const active = this.active;
    if (!active || active.id !== id) return false;
    if (this.snapshot.status === "keeping") {
      this.cleanupRequested = true;
      return true;
    }
    this.runtime.clearPreview();
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

  private resolveCustomPreview(candidate: ThemeManifestV1): ResolvedTheme {
    const cached = this.resolvedCustomPreviews.get(candidate);
    if (cached) return cached;
    const resolved = resolveTheme(candidate);
    this.resolvedCustomPreviews.set(candidate, resolved);
    return resolved;
  }
}

function activeSnapshot(
  snapshot: Omit<ActiveThemePreviewSnapshot, "candidate"> & {
    candidate: Readonly<{ id: string; name: string }>;
  },
): ActiveThemePreviewSnapshot {
  return Object.freeze({
    ...snapshot,
    candidate: Object.freeze({ id: snapshot.candidate.id, name: snapshot.candidate.name }),
  });
}

function freezePreferences(
  settings: Readonly<GlobalAppearancePreferences>,
): Readonly<GlobalAppearancePreferences> {
  return Object.freeze({
    appTheme: Object.freeze({ ...settings.appTheme }),
    readerTheme: Object.freeze({ ...settings.readerTheme }),
  });
}

function samePreferences(
  left: Readonly<GlobalAppearancePreferences>,
  right: Readonly<GlobalAppearancePreferences>,
): boolean {
  return (
    sameAppSelection(left.appTheme, right.appTheme) &&
    left.readerTheme.kind === right.readerTheme.kind &&
    left.readerTheme.id === right.readerTheme.id
  );
}

function sameAppSelection(
  left: GlobalAppearancePreferences["appTheme"],
  right: GlobalAppearancePreferences["appTheme"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "system") return true;
  return right.kind !== "system" && left.id === right.id;
}
