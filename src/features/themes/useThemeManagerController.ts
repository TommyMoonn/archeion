import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { AppThemeSelection } from "../../types/settings";
import type { AppearancePreviewContext } from "../../themes/AppearanceRuntime";
import type { ThemeCatalogSnapshot, ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import type { ThemeCatalog } from "../../themes/ThemeCatalog";
import type { ThemeRepository } from "../../themes/ThemeRepository";
import type { ThemeManifestV1 } from "../../themes/domain";
import { parseThemeJson } from "../../themes/parseThemeJson";
import type { ThemePreviewHandle, ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { validateThemeManifest } from "../../themes/validateThemeManifest";

export type ThemeManagerRepository = Pick<
  ThemeRepository,
  "deletePackage" | "replaceManifest" | "revealThemesRoot" | "storeManifest"
>;

export type ThemeManagerAppearanceRuntime = Readonly<{
  getPreviewContext: () => AppearancePreviewContext;
  refreshAppearance: () => Promise<void>;
  updateAppearanceSettings: (
    changes: Readonly<{ appTheme: AppThemeSelection }>,
  ) => Promise<AppearancePreviewContext["settings"]>;
}>;

export type PendingThemeReplacement = Readonly<{
  manifest: ThemeManifestV1;
}>;

export type ThemeManagerBusyAction =
  "apply" | "delete" | "import" | "load" | "reload" | "replace" | "reveal";

export type ThemeManagerControllerOptions = Readonly<{
  catalog: ThemeCatalog;
  previewSession: ThemePreviewSession;
  repository: ThemeManagerRepository;
  runtime: ThemeManagerAppearanceRuntime;
}>;

export function useThemeManagerController({
  catalog,
  previewSession,
  repository,
  runtime,
}: ThemeManagerControllerOptions) {
  const snapshot = useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  );
  const [selectedKey, setSelectedKey] = useState(() =>
    initialSelectedKey(runtime.getPreviewContext(), catalog.getSnapshot()),
  );
  const [busyAction, setBusyAction] = useState<ThemeManagerBusyAction | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingThemeReplacement | null>(
    null,
  );
  const mountedRef = useRef(false);
  const operationRevisionRef = useRef(0);
  const previewHandleRef = useRef<ThemePreviewHandle | null>(null);
  const previousPreviewStatusRef = useRef(previewSession.getSnapshot().status);
  const previewSnapshot = useSyncExternalStore(
    previewSession.subscribe,
    previewSession.getSnapshot,
    previewSession.getSnapshot,
  );
  useEffect(() => {
    mountedRef.current = true;
    const revision = beginOperation("load");
    void runtime
      .refreshAppearance()
      .then(() => catalog.getSnapshot())
      .then(
        (next) =>
          finishOperation(revision, () => {
            setMessage(
              next.entries.some((entry) => entry.origin === "custom")
                ? null
                : "No custom themes are installed yet.",
            );
          }),
        (reason) =>
          finishOperation(revision, () =>
            setError(
              themeOperationError(
                reason,
                "Theme Manager is unavailable. Reload themes to try again.",
              ),
            ),
          ),
      );

    return () => {
      mountedRef.current = false;
      operationRevisionRef.current += 1;
      previewHandleRef.current?.dispose();
      previewHandleRef.current = null;
    };
  }, [catalog, runtime]);

  useEffect(() => {
    const previous = previousPreviewStatusRef.current;
    previousPreviewStatusRef.current = previewSnapshot.status;
    if (previous === "idle" || previewSnapshot.status !== "idle") return;
    previewHandleRef.current = null;
  }, [previewSnapshot.status]);

  const entries = snapshot.entries.filter(
    (entry) => entry.origin === "custom" || entry.capabilities.application,
  );
  const selectedEntry =
    entries.find((entry) => entryKey(entry) === selectedKey) ?? entries[0] ?? null;
  const effectiveSelectedKey = selectedEntry ? entryKey(selectedEntry) : selectedKey;
  const activeAppThemeKey = appThemeEntryKey(runtime.getPreviewContext().settings.appTheme);
  const previewActive = previewSnapshot.status !== "idle";

  function beginOperation(action: ThemeManagerBusyAction): number {
    const revision = operationRevisionRef.current + 1;
    operationRevisionRef.current = revision;
    setBusyAction(action);
    setError(null);
    setMessage(null);
    return revision;
  }

  function finishOperation(revision: number, publish: () => void): void {
    if (!mountedRef.current || operationRevisionRef.current !== revision) return;
    publish();
    setBusyAction(null);
  }

  async function reload(): Promise<boolean> {
    if (busyAction || previewActive) return false;
    const revision = beginOperation("reload");
    try {
      await runtime.refreshAppearance();
      finishOperation(revision, () => {
        setMessage("Theme packages reloaded.");
      });
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(themeOperationError(reason, "Themes could not be reloaded. Try again.")),
      );
      return false;
    }
  }

  async function importFile(file: File): Promise<boolean> {
    if (busyAction || previewActive) return false;
    const revision = beginOperation("import");
    let imported = false;
    try {
      const manifest = await validatedFile(file);
      const builtInConflict = snapshot.entries.some(
        (entry) => entry.origin === "builtin" && entry.id === manifest.id,
      );
      if (builtInConflict) {
        throw new ThemeManagerUserError(
          `Theme ID "${manifest.id}" is reserved by a built-in theme.`,
        );
      }
      const existing = snapshot.entries.find(
        (entry) => entry.origin === "custom" && entry.packageId === manifest.id,
      );
      if (existing) {
        finishOperation(revision, () => {
          setPendingReplacement(Object.freeze({ manifest }));
          setMessage("A theme with this ID already exists.");
        });
        return false;
      }
      await repository.storeManifest(manifest);
      imported = true;
      await reloadAfterMutation();
      finishOperation(revision, () => {
        setSelectedKey(customEntryKey(manifest.id));
        setMessage(`Imported ${manifest.name}.`);
      });
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(
          themeOperationError(
            reason,
            imported
              ? "Theme was imported, but Theme Manager could not refresh. Reload themes to update the list."
              : "Theme could not be imported. Check the file and try again.",
          ),
        ),
      );
      return false;
    }
  }

  async function confirmReplacement(): Promise<boolean> {
    const pending = pendingReplacement;
    if (!pending || busyAction || previewActive) return false;
    const revision = beginOperation("replace");
    let updated = false;
    try {
      await repository.replaceManifest(pending.manifest);
      updated = true;
      await reloadAfterMutation();
      finishOperation(revision, () => {
        setPendingReplacement(null);
        setSelectedKey(customEntryKey(pending.manifest.id));
        setMessage(`Updated ${pending.manifest.name}.`);
      });
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(
          themeOperationError(
            reason,
            updated
              ? "Theme was updated, but Theme Manager could not refresh. Reload themes to update the list."
              : "Theme could not be updated. The existing theme remains available. Try again.",
          ),
        ),
      );
      return false;
    }
  }

  async function confirmDelete(): Promise<boolean> {
    const key = pendingDeleteKey;
    const entry = snapshot.entries.find((candidate) => entryKey(candidate) === key);
    if (!entry || entry.origin !== "custom" || busyAction || previewActive) return false;
    const revision = beginOperation("delete");
    let removed = false;
    try {
      await repository.deletePackage(entry.packageId);
      removed = true;
      await reloadAfterMutation();
      finishOperation(revision, () => {
        setPendingDeleteKey(null);
        setMessage(`Removed ${entry.name ?? entry.packageId}.`);
      });
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(
          themeOperationError(
            reason,
            removed
              ? "Theme was removed, but Theme Manager could not refresh. Reload themes to update the list."
              : "Theme could not be removed. It remains available. Try again.",
          ),
        ),
      );
      return false;
    }
  }

  async function useSelectedTheme(): Promise<boolean> {
    const entry = selectedEntry;
    if (!entry?.applicable || !entry.capabilities.application || busyAction || previewActive) {
      return false;
    }
    const appTheme =
      entry.origin === "custom"
        ? ({ kind: "custom", id: entry.id } as const)
        : entry.appBase
          ? ({ kind: "builtin", id: entry.appBase } as const)
          : null;
    if (!appTheme) return false;
    const revision = beginOperation("apply");
    try {
      await runtime.updateAppearanceSettings({ appTheme });
      finishOperation(revision, () => {
        setMessage(`${entry.name} is now selected.`);
      });
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(
          themeOperationError(
            reason,
            "Theme could not be selected. The previous appearance remains active. Try again.",
          ),
        ),
      );
      return false;
    }
  }

  function preview(): boolean {
    if (
      busyAction ||
      selectedEntry?.origin !== "custom" ||
      !selectedEntry.applicable ||
      !selectedEntry.capabilities.application
    ) {
      return false;
    }
    previewHandleRef.current?.dispose();
    previewHandleRef.current = null;
    const started = previewSession.startPreview({ candidate: selectedEntry.manifest });
    if (!started.ok) {
      setError("This theme could not be previewed.");
      return false;
    }
    previewHandleRef.current = started.handle;
    setError(null);
    setMessage(null);
    return true;
  }

  async function openThemesFolder(): Promise<boolean> {
    if (busyAction) return false;
    const revision = beginOperation("reveal");
    try {
      await repository.revealThemesRoot();
      finishOperation(revision, () => undefined);
      return operationRevisionRef.current === revision;
    } catch (reason) {
      finishOperation(revision, () =>
        setError(themeOperationError(reason, "The themes folder could not be opened. Try again.")),
      );
      return false;
    }
  }

  async function reloadAfterMutation(): Promise<void> {
    await runtime.refreshAppearance();
  }

  function disposePreview(): void {
    previewHandleRef.current?.dispose();
    previewHandleRef.current = null;
  }

  return {
    activeAppThemeKey,
    busyAction,
    cancelDelete: () => setPendingDeleteKey(null),
    cancelReplacement: () => setPendingReplacement(null),
    confirmDelete,
    confirmReplacement,
    disposePreview,
    entries,
    error,
    importFile,
    message,
    pendingDeleteKey,
    pendingReplacement,
    preview,
    previewActive,
    reload,
    requestDelete: () => {
      if (selectedEntry?.origin === "custom") setPendingDeleteKey(entryKey(selectedEntry));
    },
    openThemesFolder,
    select: (key: string) => {
      setPendingDeleteKey(null);
      setPendingReplacement(null);
      setSelectedKey(key);
    },
    selectedEntry,
    selectedKey: effectiveSelectedKey,
    useSelectedTheme,
  };
}

export type ThemeManagerController = ReturnType<typeof useThemeManagerController>;

export function entryKey(entry: ThemeCatalogEntry): string {
  return entry.origin === "builtin" ? `builtin:${entry.id}` : customEntryKey(entry.packageId);
}

function customEntryKey(id: string): string {
  return `custom:${id}`;
}

function appThemeEntryKey(selection: AppThemeSelection | undefined): string | null {
  if (selection?.kind === "custom") return customEntryKey(selection.id);
  if (selection?.kind === "builtin") return `builtin:${selection.id}`;
  return null;
}

function initialSelectedKey(
  context: AppearancePreviewContext,
  snapshot: ThemeCatalogSnapshot,
): string {
  const app = context.settings.appTheme;
  if (app?.kind === "custom") return customEntryKey(app.id);
  if (app?.kind === "builtin") return `builtin:${app.id}`;
  return entryKey(snapshot.entries[0]!);
}

async function validatedFile(file: File): Promise<ThemeManifestV1> {
  const parsed = parseThemeJson(await file.text());
  if (!parsed.ok) {
    throw new ThemeManagerUserError(parsed.diagnostics.map(formatDiagnostic).join(" "));
  }
  const validated = validateThemeManifest(parsed.value);
  if (!validated.ok) {
    throw new ThemeManagerUserError(validated.diagnostics.map(formatDiagnostic).join(" "));
  }
  return validated.manifest;
}

function formatDiagnostic(diagnostic: Readonly<{ message: string; path: string }>): string {
  return `${diagnostic.path}: ${diagnostic.message}`;
}

class ThemeManagerUserError extends Error {}

function themeOperationError(reason: unknown, fallback: string): string {
  return reason instanceof ThemeManagerUserError && reason.message.trim()
    ? reason.message
    : fallback;
}
