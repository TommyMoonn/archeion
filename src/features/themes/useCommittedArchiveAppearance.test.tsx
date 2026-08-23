// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import type { ArchiveAppearanceSettings } from "../../types/settings";
import { AppearanceRuntime, type AppearancePreviewContext } from "../../themes/AppearanceRuntime";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import type { ThemeManifestV1 } from "../../themes/domain";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import {
  useCommittedArchiveAppearance,
  type CommittedAppearanceSource,
} from "./useCommittedArchiveAppearance";

const candidate: ThemeManifestV1 = {
  schemaVersion: 1,
  id: "moon-ink",
  name: "Moon Ink",
  base: "dark",
  app: { accent: "#8fc1e3" },
  reader: { base: "sepia", link: "#765b34" },
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function cloneSettings(settings: Readonly<ArchiveAppearanceSettings>): ArchiveAppearanceSettings {
  return {
    appTheme: { ...settings.appTheme },
    readerTheme: { ...settings.readerTheme },
  };
}

let observed: AppearancePreviewContext | null = null;

function Harness({ source }: Readonly<{ source: CommittedAppearanceSource }>) {
  const context = useCommittedArchiveAppearance(source);
  useEffect(() => {
    observed = context;
  }, [context]);
  return null;
}

describe("useCommittedArchiveAppearance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    observed = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("observes an ownerless Keep and preserves it when the other channel changes", async () => {
    let persisted: ArchiveAppearanceSettings = {
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    };
    const keeping = deferred<ArchiveAppearanceSettings>();
    let saveCount = 0;
    let failNextSave = false;
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: async () => [candidate.id],
      readManifest: async () => JSON.stringify(candidate),
    }));
    const runtime = new AppearanceRuntime({
      catalog,
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: {
        getSnapshot: () => defaultAppPreferences,
        subscribe: () => () => undefined,
      },
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive" },
      {
        getArchiveAppearanceSettings: async () => cloneSettings(persisted),
        saveArchiveAppearanceSettings: async (settings) => {
          saveCount += 1;
          if (saveCount === 1) return keeping.promise;
          if (failNextSave) throw new Error("disk unavailable");
          persisted = cloneSettings(settings);
          return cloneSettings(persisted);
        },
      },
    );
    await act(async () => root.render(<Harness source={runtime} />));
    const session = new ThemePreviewSession(runtime);
    const started = session.startPreview({
      candidate,
    });
    if (!started.ok) throw new Error(started.reason);
    if (session.getSnapshot().status !== "idle") session.acknowledgeWarnings(true);

    let keepResult!: Promise<boolean>;
    await act(async () => {
      keepResult = session.keep();
      started.handle.dispose();
      await Promise.resolve();
    });
    const kept = {
      appTheme: { kind: "custom", id: candidate.id },
      readerTheme: { kind: "inherit" },
    } satisfies ArchiveAppearanceSettings;
    persisted = cloneSettings(kept);
    await act(async () => {
      keeping.resolve(cloneSettings(kept));
      await expect(keepResult).resolves.toBe(true);
    });

    expect(observed?.settings).toEqual(kept);

    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected committed archive appearance");
    const changedReader = {
      appTheme: { kind: "custom", id: candidate.id },
      readerTheme: { kind: "builtin", id: "sepia" },
    } satisfies ArchiveAppearanceSettings;
    await act(async () => {
      await runtime.saveArchiveAppearanceSettings(context.archive, changedReader);
    });

    expect(observed?.settings).toEqual(changedReader);
    expect(observed?.settings.appTheme).toEqual(kept.appTheme);

    const failedPreview = session.startPreview({
      candidate,
    });
    if (!failedPreview.ok) throw new Error(failedPreview.reason);
    session.acknowledgeWarnings(true);
    failNextSave = true;
    let failedKeep!: Promise<boolean>;
    await act(async () => {
      failedKeep = session.keep();
      failedPreview.handle.dispose();
      await expect(failedKeep).resolves.toBe(false);
    });
    expect(observed?.settings).toEqual(changedReader);
  });

  it("does not publish a pending Keep into a replacement archive context", async () => {
    const keeping = deferred<ArchiveAppearanceSettings>();
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: async () => [candidate.id],
      readManifest: async () => JSON.stringify(candidate),
    }));
    const runtime = new AppearanceRuntime({
      catalog,
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: {
        getSnapshot: () => defaultAppPreferences,
        subscribe: () => () => undefined,
      },
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () => ({
          appTheme: { kind: "inherit" },
          readerTheme: { kind: "inherit" },
        }),
        saveArchiveAppearanceSettings: async () => keeping.promise,
      },
    );
    await act(async () => root.render(<Harness source={runtime} />));
    const session = new ThemePreviewSession(runtime);
    const started = session.startPreview({
      candidate,
    });
    if (!started.ok) throw new Error(started.reason);
    session.acknowledgeWarnings(true);
    const keepResult = session.keep();
    started.handle.dispose();

    await act(async () => {
      await runtime.activateArchive(
        { id: "archive-b", rootPath: "D:\\Archive B" },
        {
          getArchiveAppearanceSettings: async () => ({
            appTheme: { kind: "builtin", id: "light" },
            readerTheme: { kind: "builtin", id: "sepia" },
          }),
          saveArchiveAppearanceSettings: async (settings) => settings,
        },
      );
    });
    keeping.resolve({
      appTheme: { kind: "custom", id: candidate.id },
      readerTheme: { kind: "inherit" },
    });
    await act(async () => expect(keepResult).resolves.toBe(false));

    expect(observed?.archive.id).toBe("archive-b");
    expect(observed?.settings).toEqual({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
  });
});
