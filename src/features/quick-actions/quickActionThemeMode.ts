import type { AppThemeSelection } from "../../types/settings";
import type { AppearanceRuntime } from "../../themes/AppearanceRuntime";
import type { ThemeCatalog } from "../../themes/ThemeCatalog";
import { appearanceRuntime, themeCatalog } from "../../themes/appearanceRuntimeInstance";
import type {
  ThemeCatalogSnapshot,
  BuiltInThemeCatalogEntry,
  ValidCustomThemeCatalogEntry,
} from "../../themes/themeCatalogReadModel";
import type { ThemePreviewHandle, ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { themePreviewSession } from "../../themes/themePreviewSessionInstance";
import type {
  QuickActionChildMode,
  QuickActionModeOption,
  QuickActionModeSnapshot,
  QuickActionPaletteOutcome,
} from "./quickActionModes";

type ApplicationBuiltInThemeEntry = BuiltInThemeCatalogEntry &
  Readonly<{ appBase: "dark" | "light"; id: "dark" | "light" }>;
type ApplicationThemeEntry = ApplicationBuiltInThemeEntry | ValidCustomThemeCatalogEntry;

export type QuickActionThemeModeServices = Readonly<{
  catalog: Pick<ThemeCatalog, "getSnapshot" | "refreshPackages">;
  previewSession: Pick<
    ThemePreviewSession,
    | "acknowledgeWarnings"
    | "getApplicationContrastWarnings"
    | "getSnapshot"
    | "keep"
    | "startBuiltInPreview"
    | "startValidatedPreview"
  >;
  runtime: Pick<AppearanceRuntime, "getPreviewContext" | "getSnapshot">;
}>;

const defaultServices: QuickActionThemeModeServices = {
  catalog: themeCatalog,
  previewSession: themePreviewSession,
  runtime: appearanceRuntime,
};

export function createThemeQuickActionMode(
  services: QuickActionThemeModeServices = defaultServices,
): QuickActionPaletteOutcome {
  return { kind: "child-mode", mode: new ThemeQuickActionMode(services) };
}

class ThemeQuickActionMode implements QuickActionChildMode {
  readonly id = "app-theme";
  readonly placeholder = "Change theme…";
  readonly title = "Change theme";

  private actionFeedback: QuickActionModeSnapshot["feedback"];
  private activeEntry: ApplicationThemeEntry | undefined;
  private activeOptionId: string | undefined;
  private disposed = false;
  private entries = new Map<string, ApplicationThemeEntry>();
  private readonly listeners = new Set<() => void>();
  private previewHandle: ThemePreviewHandle | null = null;
  private previewRevision = 0;
  private refreshFeedback: QuickActionModeSnapshot["feedback"];
  private snapshot!: QuickActionModeSnapshot;
  private readonly warningCounts = new Map<string, number>();

  constructor(private readonly services: QuickActionThemeModeServices) {
    const catalogSnapshot = services.catalog.getSnapshot();
    this.entries = applicationEntries(catalogSnapshot);
    this.recordWarnings();
    const committedOptionId = committedThemeOptionId(services, this.entries);
    this.snapshot = this.createSnapshot(committedOptionId, committedOptionId);
    void this.refresh();
  }

  getSnapshot = (): QuickActionModeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  preview = (optionId: string | undefined): void => {
    if (this.disposed) return;
    const entry = optionId ? this.entries.get(optionId) : undefined;
    if (entry === this.activeEntry && optionId === this.activeOptionId) return;

    this.previewHandle?.dispose();
    this.previewHandle = null;
    this.activeEntry = entry;
    this.activeOptionId = optionId;
    this.actionFeedback = undefined;

    if (!entry || !optionId) {
      this.publish();
      return;
    }

    const started =
      entry.origin === "builtin"
        ? this.services.previewSession.startBuiltInPreview({ id: entry.id, name: entry.name })
        : this.services.previewSession.startValidatedPreview(entry.manifest);
    if (!started.ok) {
      this.activeEntry = undefined;
      if (started.reason !== "busy") {
        this.actionFeedback = {
          message: "This theme could not be previewed. Reopen Quick Actions to try again.",
          tone: "error",
        };
      }
      this.publish();
      return;
    }

    this.previewHandle = started.handle;
    const previewSnapshot = this.services.previewSession.getSnapshot();
    if (previewSnapshot.status !== "idle" && previewSnapshot.contrastWarnings.length > 0) {
      this.warningCounts.set(optionId, previewSnapshot.contrastWarnings.length);
    }
    this.publish();
  };

  confirm = async (option: QuickActionModeOption): Promise<QuickActionPaletteOutcome> => {
    if (this.disposed) return { kind: "keep-open" };
    const entry = this.entries.get(option.id);
    if (!entry) return { kind: "keep-open" };

    if (this.activeEntry !== entry || this.activeOptionId !== option.id) this.preview(option.id);
    const previewSnapshot = this.services.previewSession.getSnapshot();
    if (previewSnapshot.status === "idle") {
      this.actionFeedback = {
        message: "This theme could not be previewed. Reopen Quick Actions to try again.",
        tone: "error",
      };
      this.publish();
      return { kind: "keep-open" };
    }

    if (previewSnapshot.contrastWarnings.length > 0 && !previewSnapshot.warningsAcknowledged) {
      this.services.previewSession.acknowledgeWarnings(true);
      this.actionFeedback = {
        message: `This theme has ${warningCountText(previewSnapshot.contrastWarnings.length)}. Select it again to apply anyway.`,
        tone: "warning",
      };
      this.publish();
      return { kind: "keep-open" };
    }

    const kept = await this.services.previewSession.keep();
    if (kept) {
      this.previewHandle = null;
      return { kind: "close" };
    }

    const failedSnapshot = this.services.previewSession.getSnapshot();
    this.actionFeedback = {
      message:
        failedSnapshot.status === "error" && failedSnapshot.error
          ? failedSnapshot.error
          : "The theme could not be saved. The preview is still active.",
      tone: "error",
    };
    this.publish();
    return { kind: "keep-open" };
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.previewHandle?.dispose();
    this.previewHandle = null;
    this.listeners.clear();
  };

  private createSnapshot(
    committedOptionId: string | undefined = this.snapshot?.committedOptionId,
    initialActiveOptionId: string | undefined = this.snapshot?.initialActiveOptionId,
  ): QuickActionModeSnapshot {
    return Object.freeze({
      committedOptionId,
      feedback: this.actionFeedback ?? this.refreshFeedback,
      initialActiveOptionId,
      options: Object.freeze(
        [...this.entries.entries()].map(([id, entry]) => {
          const status = optionStatus(id, committedOptionId, this.warningCounts.get(id));
          return Object.freeze({
            id,
            keywords: Object.freeze(
              [entry.description, entry.origin === "custom" ? entry.author : undefined].filter(
                (value): value is string => Boolean(value),
              ),
            ),
            label: entry.name,
            previewRevision: this.previewRevision,
            status,
          });
        }),
      ),
      unavailableReason:
        this.entries.size === 0 ? "No application themes are available." : undefined,
    });
  }

  private publish(): void {
    if (this.disposed) return;
    this.snapshot = this.createSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private async refresh(): Promise<void> {
    try {
      const refreshed = await this.services.catalog.refreshPackages();
      if (this.disposed) return;
      this.entries = applicationEntries(refreshed);
      this.recordWarnings();
      this.previewRevision += 1;
      this.refreshFeedback = undefined;
      this.publish();
    } catch {
      if (this.disposed) return;
      this.refreshFeedback = {
        message: "Themes could not be refreshed. Previously loaded themes remain available.",
        tone: "status",
      };
      this.publish();
    }
  }

  private recordWarnings(): void {
    for (const [id, entry] of this.entries) {
      if (entry.origin === "builtin") continue;
      const count = this.services.previewSession.getApplicationContrastWarnings(
        entry.manifest,
      ).length;
      if (count > 0) this.warningCounts.set(id, count);
      else this.warningCounts.delete(id);
    }
    for (const id of this.warningCounts.keys()) {
      if (!this.entries.has(id)) this.warningCounts.delete(id);
    }
  }
}

function applicationEntries(snapshot: ThemeCatalogSnapshot): Map<string, ApplicationThemeEntry> {
  return new Map(
    snapshot.entries
      .filter(
        (entry): entry is ApplicationThemeEntry =>
          entry.applicable &&
          entry.capabilities.application &&
          (entry.origin === "custom" || entry.appBase !== undefined),
      )
      .map((entry) => [themeOptionId(entry), entry]),
  );
}

function themeOptionId(entry: ApplicationThemeEntry): string {
  return `${entry.origin}:${entry.id}`;
}

function committedThemeOptionId(
  services: QuickActionThemeModeServices,
  entries: ReadonlyMap<string, ApplicationThemeEntry>,
): string | undefined {
  const requested = services.runtime.getPreviewContext().settings.appTheme;
  const requestedId = selectionOptionId(requested);
  if (requestedId && entries.has(requestedId)) return requestedId;

  const resolvedId = `builtin:${services.runtime.getSnapshot().app.base}`;
  return entries.has(resolvedId) ? resolvedId : entries.keys().next().value;
}

function selectionOptionId(selection: AppThemeSelection): string | undefined {
  if (selection.kind === "builtin" || selection.kind === "custom") {
    return `${selection.kind}:${selection.id}`;
  }
  return undefined;
}

function optionStatus(
  id: string,
  committedId: string | undefined,
  warningCount: number | undefined,
): string | undefined {
  const statuses: string[] = [];
  if (id === committedId) statuses.push("Current theme");
  if (warningCount) statuses.push(warningCountText(warningCount));
  return statuses.length > 0 ? statuses.join(" · ") : undefined;
}

function warningCountText(count: number): string {
  return `${count} contrast ${count === 1 ? "warning" : "warnings"}`;
}
