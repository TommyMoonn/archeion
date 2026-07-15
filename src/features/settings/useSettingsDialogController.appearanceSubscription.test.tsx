// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import type { AppearancePreviewContext } from "../../themes/AppearanceRuntime";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";
import {
  useSettingsDialogController,
  type SettingsDialogController,
} from "./useSettingsDialogController";

const archive = Object.freeze({ generation: 9, id: "archive-a", rootPath: "D:\\Archive" });
const initialContext: AppearancePreviewContext = Object.freeze({
  archive,
  settings: Object.freeze({
    appTheme: Object.freeze({ kind: "inherit" }),
    readerTheme: Object.freeze({ kind: "inherit" }),
  }),
});

function createStorage(): LibraryStorage {
  return {
    getArchiveAppearanceSettings: vi.fn(async () => initialContext.settings),
  } as unknown as LibraryStorage;
}

let latest: SettingsDialogController;

function Harness({
  committedArchiveAppearance,
}: Readonly<{ committedArchiveAppearance: AppearancePreviewContext | null }>) {
  const controller = useSettingsDialogController({
    committedArchiveAppearance,
  });
  useEffect(() => {
    latest = controller;
  }, [controller]);
  return null;
}

describe("Settings committed appearance subscription", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storage: LibraryStorage;

  beforeEach(() => {
    vi.spyOn(archiveStore, "getSnapshot").mockReturnValue({
      archive: {
        createdAt: "2026-01-01T00:00:00Z",
        displayName: "Archive",
        id: archive.id,
        lastOpenedAt: "2026-01-01T00:00:00Z",
        rootPath: archive.rootPath,
      },
      archives: [],
      error: null,
      path: archive.rootPath,
      status: "ready",
      watcherError: null,
    });
    storage = createStorage();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(context: AppearancePreviewContext | null) {
    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage}>
          <Harness committedArchiveAppearance={context} />
        </LibraryStorageContext>,
      );
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
  }

  it("updates a still-mounted Settings read model after an ownerless Keep", async () => {
    await render(initialContext);
    const keptContext: AppearancePreviewContext = Object.freeze({
      archive,
      settings: Object.freeze({
        appTheme: Object.freeze({ kind: "custom", id: "moon-ink" }),
        readerTheme: Object.freeze({ kind: "inherit" }),
      }),
    });

    await render(keptContext);

    expect(latest.archiveAppearance).toEqual(keptContext.settings);
    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("forwards rapid channel changes as partial runtime-owned updates", async () => {
    const update = vi
      .spyOn(appearanceRuntime, "updateArchiveAppearanceSettings")
      .mockResolvedValue(initialContext.settings);
    vi.spyOn(appearanceRuntime, "getPreviewContext").mockReturnValue(initialContext);
    await render(initialContext);

    await act(async () => {
      const application = latest.updateArchiveAppearance({
        appTheme: { kind: "builtin", id: "light" },
      });
      const reader = latest.updateArchiveAppearance({
        readerTheme: { kind: "builtin", id: "sepia" },
      });
      await Promise.all([application, reader]);
    });

    expect(update).toHaveBeenNthCalledWith(1, archive, {
      appTheme: { kind: "builtin", id: "light" },
    });
    expect(update).toHaveBeenNthCalledWith(2, archive, {
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("clears previous-archive selections when the committed scope is invalidated", async () => {
    await render(initialContext);
    expect(latest.archiveAppearance).toEqual(initialContext.settings);

    await render(null);

    expect(latest.archiveAppearance).toBeNull();
  });
});
