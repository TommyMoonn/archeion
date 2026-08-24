// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { ThemeManagerWindow } from "./ThemeManagerWindow";
import type { ThemeManagerControllerOptions } from "./useThemeManagerController";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  initialize: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../components/WindowTitlebar", () => ({
  WindowTitlebar: () => (
    <header data-testid="theme-manager-titlebar">
      <button aria-label="Close window" onClick={() => void mocks.close()} type="button" />
    </header>
  ),
}));
vi.mock("../../stores/appPreferencesStore", () => ({
  appPreferencesStore: {
    getSnapshot: () => ({
      appTheme: { kind: "builtin", id: "dark" },
      readerTheme: { kind: "builtin", id: "dark" },
    }),
    initialize: mocks.initialize,
    subscribe: () => () => undefined,
  },
}));
vi.mock("./themeManagerWindowLifecycle", () => ({
  closeThemeManagerWindow: mocks.close,
}));

let container: HTMLDivElement;
let root: Root;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createServices() {
  const customManifest = {
    schemaVersion: 1 as const,
    id: "moon-ink",
    name: "Moon Ink",
    base: "dark" as const,
    app: { accent: "#8fc1e3" as const },
  };
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => [customManifest.id]),
    readManifest: vi.fn(async () => JSON.stringify(customManifest)),
  }));
  let settings: GlobalAppearancePreferences = {
    appTheme: { kind: "builtin", id: "dark" },
    readerTheme: { kind: "builtin", id: "dark" },
  };
  let appearanceContext = { settings };
  const listeners = new Set<() => void>();
  const runtime = {
    getPreviewContext: () => appearanceContext,
    refreshAppearance: vi.fn(async () => {
      await catalog.refreshPackages();
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateAppearanceSettings: vi.fn(
      async (changes: Pick<GlobalAppearancePreferences, "appTheme">) => {
        settings = { ...settings, ...changes };
        appearanceContext = { settings };
        return settings;
      },
    ),
  } satisfies ThemeManagerControllerOptions["runtime"];
  const clearPreview = vi.fn(() => true);
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      reader: resolveBuiltInReaderTheme("dark"),
    }),
    keepPreview: vi.fn(async () => undefined),
    subscribe: () => () => undefined,
  });
  return {
    catalog,
    clearPreview,
    previewSession,
    repository: {
      deletePackage: vi.fn(async () => ({ revision: 1 })),
      replaceManifest: vi.fn(async () => ({ revision: 1 })),
      revealThemesRoot: vi.fn(async () => undefined),
      storeManifest: vi.fn(async () => ({ revision: 1 })),
    },
    runtime,
  };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.close.mockClear();
  mocks.initialize.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ThemeManagerWindow", () => {
  it("initializes preferences before mounting the real non-modal manager surface", async () => {
    const initialization = deferred();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => {
      throw new DOMException("Modal startup is unavailable.", "InvalidStateError");
    });
    mocks.initialize.mockReturnValue(initialization.promise);
    await act(async () => root.render(<ThemeManagerWindow services={createServices()} />));

    expect(container.querySelector('[data-testid="theme-manager-titlebar"]')).not.toBeNull();
    expect(container.querySelector(".theme-manager-surface")).toBeNull();
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => initialization.resolve());
    await settle();

    expect(container.querySelector(".theme-manager-surface")).not.toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector('button[aria-label="Close Theme Manager"]')).toBeNull();
    expect(container.textContent).toContain("Archeion Dark");
    expect(showModal).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="theme-manager-titlebar"]')?.isConnected).toBe(
      true,
    );
  });

  it("closes only the current Theme Manager window", async () => {
    mocks.initialize.mockResolvedValue();
    await act(async () => root.render(<ThemeManagerWindow services={createServices()} />));
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close window"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("discards an uncommitted preview before closing the standalone window", async () => {
    mocks.initialize.mockResolvedValue();
    const services = createServices();
    await act(async () => root.render(<ThemeManagerWindow services={services} />));
    await settle();

    act(() =>
      [...container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.startsWith("Moon Ink"))
        ?.click(),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.startsWith("Preview"))
        ?.click(),
    );
    expect(container.querySelector(".theme-preview-controls")).not.toBeNull();

    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Close window"]')!.click(),
    );
    act(() => root.unmount());
    root = createRoot(container);

    expect(services.clearPreview).toHaveBeenCalledOnce();
    expect(services.previewSession.getSnapshot()).toEqual({ status: "idle" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps initialization failure and retry inside the standalone root", async () => {
    mocks.initialize.mockRejectedValueOnce(new Error("settings unavailable")).mockResolvedValue();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => root.render(<ThemeManagerWindow services={createServices()} />));

    expect(container.textContent).toContain("Theme Manager could not be loaded");
    expect(container.querySelector(".theme-manager-surface")).toBeNull();

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Retry"))
        ?.click();
      await Promise.resolve();
    });
    await settle();

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".theme-manager-surface")).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Theme Manager initialization failed",
      expect.any(Error),
    );
  });
});
