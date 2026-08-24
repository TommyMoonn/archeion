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
  WindowTitlebar: () => <header data-testid="theme-manager-titlebar" />,
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
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => []),
    readManifest: vi.fn(async () => {
      throw new Error("No custom packages are installed.");
    }),
  }));
  let settings: GlobalAppearancePreferences = {
    appTheme: { kind: "builtin", id: "dark" },
    readerTheme: { kind: "builtin", id: "dark" },
  };
  const runtime = {
    getPreviewContext: () => ({ settings }),
    refreshAppearance: vi.fn(async () => {
      await catalog.refreshPackages();
    }),
    updateAppearanceSettings: vi.fn(
      async (changes: Pick<GlobalAppearancePreferences, "appTheme">) => {
        settings = { ...settings, ...changes };
        return settings;
      },
    ),
  } satisfies ThemeManagerControllerOptions["runtime"];
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview: vi.fn(() => true),
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
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Close Theme Manager"]')
        ?.click();
      await Promise.resolve();
    });

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
