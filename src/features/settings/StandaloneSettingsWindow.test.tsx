// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsWindow } from "./StandaloneSettingsWindow";

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
  it("bootstraps global preferences before mounting the standalone Settings surface", async () => {
    const initialization = deferred();
    mocks.initialize.mockReturnValue(initialization.promise);
    await act(async () => root.render(<SettingsWindow />));

    expect(container.querySelector('[data-testid="settings-titlebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-surface"]')).toBeNull();
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => initialization.resolve());
    expect(container.querySelector('[data-testid="settings-surface"]')).not.toBeNull();
    expect(mocks.surfaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ archiveBoundary: mocks.archiveBoundary }),
    );
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("keeps initialization failure inside the Settings window and supports retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.initialize
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValueOnce();
    await act(async () => root.render(<SettingsWindow />));
    await act(async () => Promise.resolve());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Settings could not be loaded",
    );
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Retry")
        ?.click();
      await Promise.resolve();
    });

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="settings-surface"]')).not.toBeNull();
    consoleError.mockRestore();
  });
});
