// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import { SettingsWindow as SettingsWindowContent } from "./StandaloneSettingsWindow";
import { UtilityWindowFrame } from "../../app/UtilityWindowFrame";

function SettingsWindow() {
  return (
    <UtilityWindowFrame mode="settings">
      <SettingsWindowContent />
    </UtilityWindowFrame>
  );
}

const mocks = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
  archiveBoundary: {
    maintenance: null,
    snapshot: { archive: null, generation: 0, status: "unavailable" as const },
  },
  surfaceProps: vi.fn(),
}));

vi.mock("../../components/WindowTitlebar", () => ({
  WindowTitlebar: () => <header data-testid="settings-titlebar" />,
}));
vi.mock("../../stores/appPreferencesStore", () => ({
  appPreferencesStore: { initialize: mocks.initialize },
}));
vi.mock("../quick-actions/QuickActionsProvider", () => ({
  QuickActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./SettingsSurface", () => ({
  SettingsSurface: (props: unknown) => {
    mocks.surfaceProps(props);
    return <div data-testid="settings-surface">Settings surface</div>;
  },
}));
vi.mock("./useSettingsArchiveMaintenance", () => ({
  useSettingsArchiveMaintenance: () => mocks.archiveBoundary,
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

async function createFailingPreferencesStore() {
  const { AppPreferencesStore } = await vi.importActual<
    typeof import("../../stores/appPreferencesStore")
  >("../../stores/appPreferencesStore");
  const loadDesktop = vi
    .fn<() => Promise<unknown>>()
    .mockRejectedValue(new Error("settings unavailable"));
  const store = new AppPreferencesStore({
    isDesktop: () => true,
    loadDesktop,
    mutateDesktop: vi.fn(async () => ({ preferences: defaultAppPreferences, revision: 2 })),
    readLegacy: () => null,
    removeLegacy: vi.fn(),
    saveBrowserFallback: vi.fn(),
    subscribeDesktop: vi.fn(async () => () => undefined),
  });
  return { loadDesktop, store };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.initialize.mockReset();
  mocks.surfaceProps.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SettingsWindow", () => {
  it("bounds stalled preferences and ignores their late completion", async () => {
    vi.useFakeTimers();
    try {
      const initialization = deferred();
      mocks.initialize.mockReturnValue(initialization.promise);
      await act(async () => root.render(<SettingsWindow />));
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Settings could not be loaded",
      );
      await act(async () => initialization.resolve());
      expect(container.querySelector('[data-testid="settings-surface"]')).toBeNull();
      expect(container.querySelector('[data-testid="settings-titlebar"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("bootstraps global preferences before mounting the standalone Settings surface", async () => {
    const initialization = deferred();
    mocks.initialize.mockReturnValue(initialization.promise);
    await act(async () => root.render(<SettingsWindow />));

    expect(container.querySelector('[data-testid="settings-titlebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-surface"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Opening Settings");
    expect(container.querySelector('[data-utility-slot="navigation"]')).not.toBeNull();
    expect(container.querySelector("[data-utility-ready]")).toBeNull();

    await act(async () => initialization.resolve());
    expect(container.querySelector('[data-testid="settings-surface"]')).not.toBeNull();
    expect(mocks.surfaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ archiveBoundary: mocks.archiveBoundary }),
    );
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("keeps initialization failure inside the Settings layout and requests a real reload", async () => {
    const reload = vi.spyOn(location, "reload").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loadDesktop, store } = await createFailingPreferencesStore();
    mocks.initialize.mockImplementation(() => store.initialize());
    await act(async () => root.render(<SettingsWindow />));
    await act(async () => Promise.resolve());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Settings could not be loaded",
    );
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Reload window")
        ?.click();
      await Promise.resolve();
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(loadDesktop).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="settings-surface"]')).toBeNull();
    expect(container.querySelector('[data-utility-slot="navigation"]')).not.toBeNull();
    reload.mockRestore();
    consoleError.mockRestore();
  });
});
