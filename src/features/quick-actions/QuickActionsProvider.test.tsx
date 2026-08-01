// @vitest-environment happy-dom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../settings/SettingsDialog";
import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import { useContextMenuController } from "../../components/contextMenuController";
import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { router } from "../../app/router";
import { commandDefinitions } from "../commands/commandBindings";
import { focusPresentationRuntime } from "../../app/inputModality";
import { useQuickActions, useRegisterQuickActions } from "./QuickActionsContext";
import { QuickActionsProvider } from "./QuickActionsProvider";
import type { QuickActionRegistration } from "./quickActions";

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

function installDialogPolyfill(): void {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
}

function createStorage(): LibraryStorage {
  return {
    clearCoverCache: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    getArchiveAppearanceSettings: vi.fn(async () => ({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    })),
    getArchiveImportSettings: vi.fn(async () => ({})),
    getCoverCacheStatus: vi.fn(async () => ({ fileCount: 1, totalBytes: 1024 })),
    getEpubWritebackBackupStatus: vi.fn(async () => ({
      fileCount: 1,
      totalBytes: 2048,
    })),
    listFolders: vi.fn(async () => []),
    getLibrarySnapshot: vi.fn(() => ({
      archiveGeneration: 1,
      archiveRootPath: "D:\\Books",
      books: [],
      folders: [],
      loadState: "ready" as const,
      revision: 1,
      scanStatus: { status: "idle" as const },
    })),
    observeLibrarySnapshot: vi.fn(() => () => undefined),
    repairArchiveMetadata: vi.fn(),
    rescan: vi.fn(),
    revealMetadataFolder: vi.fn(),
  } as unknown as LibraryStorage;
}

const readyArchive: ArchiveState = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
    {
      id: "archive-comics",
      displayName: "Comics",
      rootPath: "E:\\Comics",
      createdAt: "3",
      lastOpenedAt: "4",
    },
  ],
  error: null,
  watcherError: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let stopFocusPresentation: (() => void) | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Harness({
  onFocusSearch = () => undefined,
  onReaderCommand = () => undefined,
  onRun,
}: {
  onFocusSearch?: () => void;
  onReaderCommand?: () => void;
  onRun: () => void;
}) {
  const { openPalette, openSettings } = useQuickActions();
  const contextMenu = useContextMenuController();
  const commands = useMemo<QuickActionRegistration[]>(
    () => [
      {
        configuration: "unbound",
        execute: onRun,
        group: "System",
        id: "test.run",
        keywords: ["custom action"],
        label: "Run test command",
        scope: "global",
      },
      {
        ...commandDefinitions.focusSearch,
        execute: onFocusSearch,
        scope: "library",
      },
      {
        ...commandDefinitions.readerToc,
        execute: onReaderCommand,
        scope: "reader",
      },
    ],
    [onFocusSearch, onReaderCommand, onRun],
  );
  useRegisterQuickActions("test-harness", commands);

  return (
    <div>
      <button id="palette-opener" onClick={openPalette} type="button">
        Open from here
      </button>
      <button id="settings-opener" onClick={openSettings} type="button">
        Open settings
      </button>
      <input aria-label="Text field" type="text" />
      <ContextMenuTrigger controller={contextMenu} label="Open context actions">
        Context actions
      </ContextMenuTrigger>
      <ContextMenuSurface
        actions={[{ id: "menu-action", label: "Menu action", onSelect: () => undefined }]}
        ariaLabel="Context actions"
        controller={contextMenu}
      />
    </div>
  );
}

async function renderProvider(
  onRun = vi.fn(),
  options: { onFocusSearch?: () => void; onReaderCommand?: () => void } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LibraryStorageContext value={createStorage()}>
        <QuickActionsProvider>
          <Harness onRun={onRun} {...options} />
        </QuickActionsProvider>
      </LibraryStorageContext>,
    );
  });

  return { container, onRun };
}

async function waitForPalette(): Promise<HTMLDialogElement> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const palette = document.querySelector<HTMLDialogElement>(".quick-actions");
    if (palette) {
      return palette;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  throw new Error("Quick Actions palette was not rendered.");
}

async function waitForSettings(): Promise<HTMLDialogElement> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const settings = document.querySelector<HTMLDialogElement>(".settings-dialog");
    if (settings) return settings;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error("Settings dialog was not rendered.");
}

beforeEach(() => {
  stopFocusPresentation = focusPresentationRuntime.start(document);
  installDialogPolyfill();
  vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyArchive);
  vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  stopFocusPresentation?.();
  stopFocusPresentation = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  await appPreferencesStore.update({ keyboard: { shortcuts: {} } });
});

describe("QuickActionsProvider", () => {
  it("opens outside text fields and restores focus after Escape", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;
    opener.focus();

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "P",
          shiftKey: true,
        }),
      );
    });

    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
  }, 15_000);

  it("does not restore Quick Actions to a generic page or unrelated controls", async () => {
    const rendered = await renderProvider();
    const page = document.body.appendChild(document.createElement("main"));
    page.className = "page-shell";
    page.tabIndex = -1;
    const titlebarAction = document.body.appendChild(document.createElement("button"));
    const sidebarAction = document.body.appendChild(document.createElement("button"));
    page.focus();

    await act(async () => {
      page.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "P",
          shiftKey: true,
        }),
      );
    });
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(document.activeElement).not.toBe(page);
    expect(document.activeElement).not.toBe(titlebarAction);
    expect(document.activeElement).not.toBe(sidebarAction);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    });
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
    page.remove();
    titlebarAction.remove();
    sidebarAction.remove();
    expect(rendered.container.isConnected).toBe(true);
  }, 15_000);

  it("keeps global, search, and reader commands beneath an open context menu", async () => {
    const onFocusSearch = vi.fn();
    const onReaderCommand = vi.fn();
    const rendered = await renderProvider(vi.fn(), { onFocusSearch, onReaderCommand });
    const contextTrigger = rendered.container.querySelector<HTMLButtonElement>(
      '[aria-label="Open context actions"]',
    )!;
    act(() => contextTrigger.click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    for (const init of [
      { ctrlKey: true, key: "P", shiftKey: true },
      { ctrlKey: true, key: "," },
      { ctrlKey: true, key: "f" },
      { key: "t" },
    ]) {
      act(() => {
        contextTrigger.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
        );
      });
    }

    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(document.querySelector(".settings-dialog")).toBeNull();
    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onReaderCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => {
      contextTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("does not open from a text-entry field", async () => {
    const rendered = await renderProvider();
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="text"]')!;

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
      await Promise.resolve();
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
  });

  it("executes a registered surface command instead of duplicating its action", async () => {
    const onRun = vi.fn();
    const rendered = await renderProvider(onRun);
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
    });

    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Run test command"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".quick-actions")).toBeNull();
  }, 15_000);

  it("waits for an archive switch to settle before navigating once", async () => {
    const switching = deferred<boolean>();
    const switchArchive = vi
      .spyOn(archiveStore, "switchArchive")
      .mockReturnValue(switching.promise);
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined);
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
    });
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Switch archive"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(search.placeholder).toBe("Search archives…");
    expect(document.activeElement).toBe(search);
    expect(palette.querySelector('[aria-selected="true"]')?.textContent).toContain("Comics");
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(switchArchive).toHaveBeenCalledWith("archive-comics");
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => switching.resolve(true));
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("exposes one root archive command and marks the current archive in its child mode", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    act(() => opener.click());
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Switch archive"));

    expect(palette.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(palette.textContent).toContain("Archive: Switch archive…");
    expect(palette.textContent).not.toContain("Switch to Comics");

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    const currentArchive = palette.querySelector<HTMLElement>('[data-committed="true"]')!;
    expect(currentArchive.textContent).toContain("Books");
    expect(currentArchive.textContent).toContain("Current archive");
    expect(currentArchive.getAttribute("aria-disabled")).toBe("true");
    expect(palette.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it("keeps archive switching open with actionable feedback after a failed switch", async () => {
    const switchArchive = vi.spyOn(archiveStore, "switchArchive").mockResolvedValue(false);
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined);
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    act(() => opener.click());
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Switch archive"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });
    await act(async () => setInputValue(search, "Comics"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(switchArchive).toHaveBeenCalledWith("archive-comics");
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelector(".quick-actions")).toBe(palette);
    expect(palette.querySelector('[role="alert"]')?.textContent).toContain(
      "Check that its folder is available, then try again.",
    );
    expect(document.activeElement).toBe(search);
  });

  it("keeps the no-other-archive state inside the archive child mode", async () => {
    vi.mocked(archiveStore.getSnapshot).mockReturnValue({
      ...readyArchive,
      archives: [readyArchive.archive],
    });
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    act(() => opener.click());
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Switch archive"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(palette.textContent).toContain("No other known archives are available.");
    expect(palette.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(palette.querySelector('[role="option"]')?.getAttribute("aria-disabled")).toBe("true");
  });

  it("closes an active child mode when the archive scope is replaced", async () => {
    let archiveSnapshot = readyArchive;
    const archiveListeners: Array<() => void> = [];
    const publishArchive = () => archiveListeners.forEach((listener) => listener());
    vi.mocked(archiveStore.getSnapshot).mockImplementation(() => archiveSnapshot);
    vi.mocked(archiveStore.subscribe).mockImplementation((listener) => {
      archiveListeners.push(listener);
      return () => archiveListeners.splice(archiveListeners.indexOf(listener), 1).length > 0;
    });
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    act(() => opener.click());
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Switch archive"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });
    expect(search.placeholder).toBe("Search archives…");

    archiveSnapshot = {
      ...readyArchive,
      archive: readyArchive.archives[1]!,
      path: readyArchive.archives[1]!.rootPath,
    };
    act(() => publishArchive());

    expect(document.querySelector(".quick-actions")).toBeNull();
  });

  it("restores the original caller after Quick Actions opens and closes Settings", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;
    opener.focus();

    act(() => opener.click());
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => setInputValue(search, "Settings"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    const settings = await waitForSettings();
    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(document.activeElement).not.toBe(opener);

    await act(async () => {
      settings.dispatchEvent(new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });

    expect(document.querySelector(".settings-dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  }, 15_000);

  it("opens Settings with Ctrl+, by default", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: ",",
        }),
      );
    });

    const settings = await waitForSettings();
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
    expect(document.activeElement).toBe(
      settings.querySelector('button[aria-label="Close settings"]'),
    );
    expect(document.activeElement).not.toBe(settings.querySelector('input[type="search"]'));
  });

  it("keeps pointer-open Settings restoration out of keyboard-navigation presentation", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#settings-opener")!;
    opener.focus();

    act(() => {
      opener.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      opener.click();
    });
    const settings = await waitForSettings();
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
    expect(document.activeElement).toBe(
      settings.querySelector('button[aria-label="Close settings"]'),
    );

    await act(async () => {
      settings.dispatchEvent(new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
  });

  it("restores a keyboard-navigation Settings trigger with its strong-ring intent", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#settings-opener")!;
    opener.focus();

    act(() => {
      opener.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      opener.click();
    });
    const settings = await waitForSettings();
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");

    await act(async () => {
      settings.dispatchEvent(new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
  });

  it("focuses Settings search with Ctrl+F while Settings owns the modal scope", async () => {
    const rendered = await renderProvider();
    act(() => rendered.container.querySelector<HTMLButtonElement>("#settings-opener")!.click());
    const settings = await waitForSettings();
    const closeButton = settings.querySelector<HTMLButtonElement>(
      'button[aria-label="Close settings"]',
    );
    const search = settings.querySelector<HTMLInputElement>('input[type="search"]');
    expect(closeButton).toBeInstanceOf(HTMLButtonElement);
    expect(search).toBeInstanceOf(HTMLInputElement);
    closeButton?.focus();

    await act(async () => {
      closeButton?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "f",
        }),
      );
    });

    expect(document.activeElement).toBe(search);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-command");
  });

  it("uses a remapped Settings binding and stops matching the default", async () => {
    await appPreferencesStore.update({
      keyboard: {
        shortcuts: {
          "system.open-settings": {
            binding: { alt: false, key: "k", primary: true, shift: true },
          },
        },
      },
    });
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: ",",
        }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector(".settings-dialog")).toBeNull();

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "K",
          shiftKey: true,
        }),
      );
    });
    expect(await waitForSettings()).toBeTruthy();
  });

  it("keeps Settings reachable through visible UI after its binding is cleared", async () => {
    await appPreferencesStore.update({
      keyboard: { shortcuts: { "system.open-settings": { disabled: true } } },
    });
    const rendered = await renderProvider();
    const keyboardTarget = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      keyboardTarget.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: ",",
        }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector(".settings-dialog")).toBeNull();

    act(() => rendered.container.querySelector<HTMLButtonElement>("#settings-opener")!.click());
    expect(await waitForSettings()).toBeTruthy();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
