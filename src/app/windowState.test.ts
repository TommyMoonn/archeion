// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import {
  clampWindowStateToWorkAreas,
  MainWindowStateController,
  restoreMainWindowState,
  type WindowStateRuntime,
} from "./windowState";

function runtime(overrides: Partial<WindowStateRuntime> = {}): WindowStateRuntime {
  return {
    availableWorkAreas: async () => [{ height: 1040, width: 1920, x: 0, y: 0 }],
    capture: async () => ({ height: 800, maximized: false, width: 1280, x: 20, y: 30 }),
    isDesktop: true,
    label: "main",
    maximize: vi.fn(async () => undefined),
    onMoved: async () => () => undefined,
    onResized: async () => () => undefined,
    setPosition: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("window state", () => {
  it("clamps off-screen and undersized geometry into a visible work area", () => {
    expect(
      clampWindowStateToWorkAreas(
        { height: 300, maximized: false, width: 400, x: 5000, y: -2000 },
        [{ height: 1040, width: 1920, x: 0, y: 0 }],
      ),
    ).toEqual({ height: 600, maximized: false, width: 900, x: 1020, y: 0 });
  });

  it("restores geometry only when memory is enabled for the main window", async () => {
    const setSize = vi.fn(async () => undefined);
    const setPosition = vi.fn(async () => undefined);
    const appRuntime = runtime({ setPosition, setSize });
    const preferences: AppPreferences = {
      ...defaultAppPreferences,
      rememberWindowState: true,
      window: { height: 700, maximized: false, width: 1000, x: 40, y: 50 },
    };

    await expect(restoreMainWindowState(preferences, appRuntime)).resolves.toBe(true);
    expect(setSize).toHaveBeenCalledWith(1000, 700);
    expect(setPosition).toHaveBeenCalledWith(40, 50);

    await expect(
      restoreMainWindowState(preferences, runtime({ label: "archive-manager" })),
    ).resolves.toBe(false);
  });

  it("saves debounced geometry only while the preference is enabled", async () => {
    vi.useFakeTimers();
    let moved: (() => void) | undefined;
    const update = vi.fn(async (changes: Partial<AppPreferences>) => ({
      ...defaultAppPreferences,
      ...changes,
    }));
    let enabled = false;
    const controller = new MainWindowStateController(
      runtime({
        onMoved: async (listener) => {
          moved = listener;
          return () => undefined;
        },
      }),
      {
        getSnapshot: () => ({ ...defaultAppPreferences, rememberWindowState: enabled }),
        update,
      },
    );
    await controller.start();

    moved?.();
    await vi.advanceTimersByTimeAsync(300);
    expect(update).not.toHaveBeenCalled();

    enabled = true;
    moved?.();
    await vi.advanceTimersByTimeAsync(300);
    expect(update).toHaveBeenCalledWith({
      window: { height: 800, maximized: false, width: 1280, x: 20, y: 30 },
    });
    controller.stop();
  });
});
