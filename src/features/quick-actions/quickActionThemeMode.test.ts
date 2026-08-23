import { describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import type { ThemeManifestV1 } from "../../themes/domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import type {
  ThemeCatalogSnapshot,
  InvalidCustomThemeCatalogEntry,
  ValidCustomThemeCatalogEntry,
} from "../../themes/themeCatalogReadModel";
import { builtInThemeCatalogEntries } from "../../themes/themeCatalogReadModel";
import { ThemePreviewSession, type ThemePreviewRuntime } from "../../themes/ThemePreviewSession";
import { createThemeQuickActionMode } from "./quickActionThemeMode";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function manifest(id: string, overrides: Partial<ThemeManifestV1> = {}): ThemeManifestV1 {
  return {
    schemaVersion: 1,
    id,
    name: id,
    base: "light",
    app: { accent: "#336699" },
    ...overrides,
  };
}

function validEntry(theme: ThemeManifestV1): ValidCustomThemeCatalogEntry {
  return Object.freeze({
    applicable: true,
    capabilities: Object.freeze({ application: true, reader: Boolean(theme.reader) }),
    diagnostics: Object.freeze([]),
    id: theme.id,
    manifest: theme,
    name: theme.name,
    origin: "custom",
    packageId: theme.id,
    status: "valid",
  });
}

function invalidEntry(id: string): InvalidCustomThemeCatalogEntry {
  return Object.freeze({
    applicable: false,
    capabilities: Object.freeze({ application: false, reader: false }),
    diagnostics: Object.freeze([
      { code: "invalid-value" as const, message: "Invalid package", path: "$.app" },
    ]),
    id,
    origin: "custom",
    packageId: id,
    status: "invalid",
  });
}

function catalogSnapshot(
  customEntries: ThemeCatalogSnapshot["entries"] = [],
): ThemeCatalogSnapshot {
  return Object.freeze({
    entries: Object.freeze([...builtInThemeCatalogEntries, ...customEntries]),
    fullyEnumerated: true,
    revision: 1,
  });
}

function createHarness(
  initial: ThemeCatalogSnapshot,
  refresh: Promise<ThemeCatalogSnapshot>,
  options: { failKeep?: boolean; settings?: GlobalAppearancePreferences } = {},
) {
  const listeners = new Set<() => void>();
  const settings =
    options.settings ??
    ({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    } satisfies GlobalAppearancePreferences);
  const applyPreview = vi.fn<ThemePreviewRuntime["applyPreview"]>(() => true);
  const clearPreview = vi.fn<ThemePreviewRuntime["clearPreview"]>(() => true);
  const keepPreview = vi.fn<ThemePreviewRuntime["keepPreview"]>(async () => {
    if (options.failKeep) throw new Error("disk unavailable");
  });
  const runtime: ThemePreviewRuntime = {
    applyPreview,
    clearPreview,
    getPreviewContext: () => ({ settings }),
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("light"),
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const previewSession = new ThemePreviewSession(runtime);
  const catalog = {
    getSnapshot: vi.fn(() => initial),
    refreshPackages: vi.fn(() => refresh),
  };
  const outcome = createThemeQuickActionMode({ catalog, previewSession, runtime });
  if (outcome.kind !== "child-mode") throw new Error("Expected a child mode");
  return { applyPreview, catalog, clearPreview, keepPreview, mode: outcome.mode, previewSession };
}

describe("Quick Actions theme mode", () => {
  it("shows built-ins immediately and merges added, edited, and removed packages", async () => {
    const pendingRefresh = deferred<ThemeCatalogSnapshot>();
    const initial = catalogSnapshot([
      validEntry(manifest("edited", { name: "Edited old" })),
      validEntry(manifest("removed")),
    ]);
    const harness = createHarness(initial, pendingRefresh.promise);

    expect(harness.catalog.refreshPackages).toHaveBeenCalledOnce();
    expect(harness.mode.getSnapshot()).toMatchObject({
      committedOptionId: "builtin:light",
      initialActiveOptionId: "builtin:light",
    });
    expect(harness.mode.getSnapshot().options.map((option) => option.id)).toEqual([
      "builtin:dark",
      "builtin:light",
      "custom:edited",
      "custom:removed",
    ]);

    const edited = validEntry(manifest("edited", { base: "dark", name: "Edited new" }));
    pendingRefresh.resolve(
      catalogSnapshot([edited, validEntry(manifest("added")), invalidEntry("invalid")]),
    );
    await pendingRefresh.promise;
    await Promise.resolve();

    const refreshed = harness.mode.getSnapshot();
    expect(refreshed.options.map((option) => option.id)).toEqual([
      "builtin:dark",
      "builtin:light",
      "custom:edited",
      "custom:added",
    ]);
    expect(refreshed.options.find((option) => option.id === "custom:edited")?.label).toBe(
      "Edited new",
    );
    harness.mode.preview?.("custom:edited");
    expect(harness.applyPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: "dark" }),
    );
  });

  it("previews movement without persistence and reverts on disposal", () => {
    const pendingRefresh = deferred<ThemeCatalogSnapshot>();
    const harness = createHarness(catalogSnapshot(), pendingRefresh.promise);
    const dark = harness.mode.getSnapshot().options.find((option) => option.id === "builtin:dark");

    harness.mode.preview?.(dark?.id);

    expect(harness.applyPreview).toHaveBeenCalledWith(expect.objectContaining({ base: "dark" }));
    expect(harness.keepPreview).not.toHaveBeenCalled();
    expect(
      harness.mode.getSnapshot().options.find((option) => option.id === "builtin:dark")?.status,
    ).toBeUndefined();

    harness.mode.dispose();
    harness.mode.dispose();
    expect(harness.clearPreview).toHaveBeenCalledOnce();
  });

  it("requires a second confirmation for contrast warnings and preserves Reader settings", async () => {
    const warningTheme = manifest("warning-theme", {
      app: { main: "#000000", text: "#000000" },
    });
    const snapshot = catalogSnapshot([validEntry(warningTheme)]);
    const harness = createHarness(snapshot, Promise.resolve(snapshot));
    const option = harness.mode
      .getSnapshot()
      .options.find((candidate) => candidate.id === "custom:warning-theme")!;
    expect(option.status).toContain("contrast warning");

    harness.mode.preview?.(option.id);
    expect(
      harness.mode.getSnapshot().options.find((candidate) => candidate.id === option.id)?.status,
    ).toContain("contrast warning");

    await expect(harness.mode.confirm(option)).resolves.toEqual({ kind: "keep-open" });
    expect(harness.mode.getSnapshot().feedback).toMatchObject({ tone: "warning" });
    expect(harness.keepPreview).not.toHaveBeenCalled();

    await expect(harness.mode.confirm(option)).resolves.toEqual({ kind: "close" });
    expect(harness.keepPreview).toHaveBeenCalledWith(expect.anything(), {
      kind: "custom",
      id: "warning-theme",
    });
  });

  it("keeps a failed save preview active and reports a recoverable mode error", async () => {
    const snapshot = catalogSnapshot();
    const harness = createHarness(snapshot, Promise.resolve(snapshot), { failKeep: true });
    const dark = harness.mode.getSnapshot().options.find((option) => option.id === "builtin:dark")!;
    harness.mode.preview?.(dark.id);

    await expect(harness.mode.confirm(dark)).resolves.toEqual({ kind: "keep-open" });

    expect(harness.previewSession.getSnapshot().status).toBe("error");
    expect(harness.mode.getSnapshot().feedback).toEqual({
      message: "The theme could not be saved. The preview is still active.",
      tone: "error",
    });
    expect(harness.clearPreview).not.toHaveBeenCalled();
    harness.mode.dispose();
    expect(harness.clearPreview).toHaveBeenCalledOnce();
  });

  it("keeps previous options and reports a quiet mode-local refresh failure", async () => {
    const refresh = Promise.reject(new Error("folder unavailable"));
    const initial = catalogSnapshot([validEntry(manifest("known"))]);
    const harness = createHarness(initial, refresh);
    await refresh.catch(() => undefined);
    await Promise.resolve();

    expect(harness.mode.getSnapshot().options.some((option) => option.id === "custom:known")).toBe(
      true,
    );
    expect(harness.mode.getSnapshot().feedback).toMatchObject({ tone: "status" });
  });
});
