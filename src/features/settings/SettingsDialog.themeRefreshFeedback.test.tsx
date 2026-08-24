// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { SettingsDialog } from "./SettingsDialog";

const copy = vi.hoisted(() => ({
  backgroundError:
    "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again.",
  laterError: "Themes could not be refreshed. Reload themes to try again.",
  managerError:
    "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again.",
}));
const managerState = vi.hoisted(() => ({ error: null as string | null }));
const themeManagerWindow = vi.hoisted(() => ({ open: vi.fn(async () => false) }));
const archiveState = vi.hoisted(() => ({
  archive: {
    createdAt: "2026-08-01T00:00:00.000Z",
    displayName: "Books",
    id: "archive-a",
    lastOpenedAt: "2026-08-01T00:00:00.000Z",
    rootPath: "D:\\Books",
  },
  archives: [],
  error: null,
  path: "D:\\Books",
  status: "ready",
  watcherError: null,
}));

vi.mock("../themes/useThemeCatalogEntries", async () => {
  const { useCallback, useState } = await vi.importActual<typeof import("react")>("react");
  return {
    useThemeCatalogEntries: (
      _enabled: boolean,
      { reportRefreshFailure = true }: Readonly<{ reportRefreshFailure?: boolean }> = {},
    ) => {
      const [failure, setFailure] = useState<string | null>(copy.backgroundError);
      return {
        entries: [],
        error: reportRefreshFailure ? failure : null,
        loading: false,
        refresh: useCallback(async () => {
          setFailure(copy.laterError);
          return false;
        }, []),
        retireRefreshFailure: useCallback(() => setFailure(null), []),
      };
    },
  };
});

vi.mock("../../stores/archiveStore", () => ({
  archiveStore: {
    getSnapshot: () => archiveState,
    subscribe: () => () => undefined,
  },
}));

vi.mock("../themes/ThemeManagerDialog", () => ({
  ThemeManagerDialog: ({ onClose }: Readonly<{ onClose: () => void }>) => (
    <section aria-label="Theme Manager">
      {managerState.error ? <p role="alert">{managerState.error}</p> : null}
      <button onClick={onClose} type="button">
        Close Theme Manager
      </button>
    </section>
  ),
}));
vi.mock("../themes/themeManagerWindowLifecycle", () => ({
  openThemeManagerWindow: themeManagerWindow.open,
}));

function installDialogPolyfill() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
}

function storage(): LibraryStorage {
  return {
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
  } as unknown as LibraryStorage;
}

async function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

afterEach(() => {
  managerState.error = null;
  themeManagerWindow.open.mockReset();
  themeManagerWindow.open.mockResolvedValue(false);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SettingsDialog theme refresh feedback ownership", () => {
  async function renderSettings() {
    installDialogPolyfill();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage()}>
          <SettingsDialog onClose={vi.fn()} />
        </LibraryStorageContext>,
      );
    });
    await click(container, "Appearance");
    return { container, root };
  }

  async function reportLaterSelectorFailure(container: HTMLElement) {
    const select = container.querySelector<HTMLButtonElement>('button[aria-label="App themes"]');
    if (!select) throw new Error("App themes selector not found");
    await act(async () => {
      select.click();
      await Promise.resolve();
    });
  }

  it("does not revive an old selector error after a successful manager refresh", async () => {
    const { container, root } = await renderSettings();

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.backgroundError);

    await click(container, "Manage themes");

    expect(container.querySelector('[role="alert"]')).toBeNull();

    await click(container, "Close Theme Manager");

    expect(container.querySelector('[role="alert"]')).toBeNull();

    await reportLaterSelectorFailure(container);

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.laterError);

    act(() => root.unmount());
  });

  it("does not reannounce a shared manager failure after foreground ownership ends", async () => {
    managerState.error = copy.managerError;
    const { container, root } = await renderSettings();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.backgroundError);

    await click(container, "Manage themes");

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.managerError);

    await click(container, "Close Theme Manager");

    expect(container.querySelector('[role="alert"]')).toBeNull();

    await reportLaterSelectorFailure(container);

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.laterError);

    act(() => root.unmount());
  });

  it("leaves the legacy dialog closed when the standalone window opens", async () => {
    themeManagerWindow.open.mockResolvedValue(true);
    const { container, root } = await renderSettings();

    await click(container, "Manage themes");

    expect(themeManagerWindow.open).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Theme Manager"]')).toBeNull();

    act(() => root.unmount());
  });

  it("uses the legacy dialog when native window creation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    themeManagerWindow.open.mockRejectedValue(new Error("window unavailable"));
    const { container, root } = await renderSettings();

    await click(container, "Manage themes");

    expect(container.querySelector('[aria-label="Theme Manager"]')).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "open_theme_manager_window failed",
      expect.any(Error),
    );

    act(() => root.unmount());
  });
});
