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

function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

afterEach(() => {
  managerState.error = null;
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
    click(container, "Appearance");
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

    click(container, "Manage themes");

    expect(container.querySelector('[role="alert"]')).toBeNull();

    click(container, "Close Theme Manager");

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

    click(container, "Manage themes");

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.managerError);

    click(container, "Close Theme Manager");

    expect(container.querySelector('[role="alert"]')).toBeNull();

    await reportLaterSelectorFailure(container);

    expect([...container.querySelectorAll('[role="alert"]')]).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.laterError);

    act(() => root.unmount());
  });
});
