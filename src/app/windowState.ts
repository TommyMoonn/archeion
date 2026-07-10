import { isTauri } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  type Monitor,
} from "@tauri-apps/api/window";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import type { AppPreferences, PersistedWindowState } from "../types/appSettings";

export const MAIN_WINDOW_LABEL = "main";
export const MAIN_WINDOW_MIN_WIDTH = 900;
export const MAIN_WINDOW_MIN_HEIGHT = 600;
const WINDOW_STATE_DEBOUNCE_MS = 300;

export type WindowWorkArea = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type WindowStateRuntime = {
  availableWorkAreas: () => Promise<WindowWorkArea[]>;
  capture: () => Promise<PersistedWindowState>;
  isDesktop: boolean;
  label: string;
  maximize: () => Promise<void>;
  onMoved: (listener: () => void) => Promise<() => void>;
  onResized: (listener: () => void) => Promise<() => void>;
  setPosition: (x: number, y: number) => Promise<void>;
  setSize: (width: number, height: number) => Promise<void>;
};

type WindowPreferencesAccess = {
  getSnapshot: () => AppPreferences;
  update: (changes: Partial<AppPreferences>) => Promise<AppPreferences>;
};

function workAreaFromMonitor(monitor: Monitor): WindowWorkArea {
  return {
    height: monitor.workArea.size.height,
    width: monitor.workArea.size.width,
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
  };
}

export function createWindowStateRuntime(): WindowStateRuntime {
  const desktop = (() => {
    try {
      return isTauri();
    } catch {
      return false;
    }
  })();

  if (!desktop) {
    return {
      availableWorkAreas: async () => [],
      capture: async () => {
        throw new Error("Window state is unavailable outside the desktop app.");
      },
      isDesktop: false,
      label: MAIN_WINDOW_LABEL,
      maximize: async () => undefined,
      onMoved: async () => () => undefined,
      onResized: async () => () => undefined,
      setPosition: async () => undefined,
      setSize: async () => undefined,
    };
  }

  const appWindow = getCurrentWindow();

  return {
    availableWorkAreas: async () => (await availableMonitors()).map(workAreaFromMonitor),
    capture: async () => {
      const [position, size, maximized] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        appWindow.isMaximized(),
      ]);
      return {
        height: size.height,
        maximized,
        width: size.width,
        x: position.x,
        y: position.y,
      };
    },
    isDesktop: desktop,
    label: appWindow.label,
    maximize: () => appWindow.maximize(),
    onMoved: (listener) => appWindow.onMoved(listener),
    onResized: (listener) => appWindow.onResized(listener),
    setPosition: (x, y) => appWindow.setPosition(new PhysicalPosition(x, y)),
    setSize: (width, height) => appWindow.setSize(new PhysicalSize(width, height)),
  };
}

function intersectionArea(state: PersistedWindowState, workArea: WindowWorkArea): number {
  const left = Math.max(state.x, workArea.x);
  const top = Math.max(state.y, workArea.y);
  const right = Math.min(state.x + state.width, workArea.x + workArea.width);
  const bottom = Math.min(state.y + state.height, workArea.y + workArea.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampWindowStateToWorkAreas(
  state: PersistedWindowState,
  workAreas: WindowWorkArea[],
): PersistedWindowState | null {
  if (workAreas.length === 0) {
    return null;
  }

  const validWorkAreas = workAreas.filter(
    (workArea) =>
      Number.isFinite(workArea.x) &&
      Number.isFinite(workArea.y) &&
      Number.isFinite(workArea.width) &&
      Number.isFinite(workArea.height) &&
      workArea.width > 0 &&
      workArea.height > 0,
  );
  if (validWorkAreas.length === 0) {
    return null;
  }

  const targetWorkArea = validWorkAreas.reduce((best, candidate) =>
    intersectionArea(state, candidate) > intersectionArea(state, best) ? candidate : best,
  );
  const width = Math.min(
    Math.max(Math.round(state.width), MAIN_WINDOW_MIN_WIDTH),
    targetWorkArea.width,
  );
  const height = Math.min(
    Math.max(Math.round(state.height), MAIN_WINDOW_MIN_HEIGHT),
    targetWorkArea.height,
  );
  const maximumX = targetWorkArea.x + targetWorkArea.width - width;
  const maximumY = targetWorkArea.y + targetWorkArea.height - height;

  return {
    height,
    maximized: state.maximized,
    width,
    x: Math.round(clamp(state.x, targetWorkArea.x, maximumX)),
    y: Math.round(clamp(state.y, targetWorkArea.y, maximumY)),
  };
}

export async function restoreMainWindowState(
  preferences: AppPreferences,
  runtime: WindowStateRuntime = createWindowStateRuntime(),
): Promise<boolean> {
  if (
    !runtime.isDesktop ||
    runtime.label !== MAIN_WINDOW_LABEL ||
    !preferences.rememberWindowState ||
    !preferences.window
  ) {
    return false;
  }

  try {
    const restored = clampWindowStateToWorkAreas(
      preferences.window,
      await runtime.availableWorkAreas(),
    );
    if (!restored) {
      return false;
    }

    await runtime.setSize(restored.width, restored.height);
    await runtime.setPosition(restored.x, restored.y);
    if (restored.maximized) {
      await runtime.maximize();
    }
    return true;
  } catch {
    return false;
  }
}

export class MainWindowStateController {
  private stopped = false;
  private timer: number | null = null;
  private unlisteners: Array<() => void> = [];

  constructor(
    private readonly runtime: WindowStateRuntime = createWindowStateRuntime(),
    private readonly preferencesStore: WindowPreferencesAccess = appPreferencesStore,
  ) {}

  async start(): Promise<void> {
    if (!this.runtime.isDesktop || this.runtime.label !== MAIN_WINDOW_LABEL) {
      return;
    }

    const listenerResults = await Promise.allSettled([
      this.runtime.onMoved(() => this.scheduleCapture()),
      this.runtime.onResized(() => this.scheduleCapture()),
    ]);
    const listeners = listenerResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (this.stopped) {
      listeners.forEach((unlisten) => unlisten());
      return;
    }
    this.unlisteners = listeners;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.unlisteners.forEach((unlisten) => unlisten());
    this.unlisteners = [];
  }

  private scheduleCapture(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.capture();
    }, WINDOW_STATE_DEBOUNCE_MS);
  }

  private async capture(): Promise<void> {
    if (this.stopped || !this.preferencesStore.getSnapshot().rememberWindowState) {
      return;
    }

    try {
      const windowState = await this.runtime.capture();
      if (!this.stopped && this.preferencesStore.getSnapshot().rememberWindowState) {
        await this.preferencesStore.update({ window: windowState });
      }
    } catch {
      // Window state persistence must never prevent the application from closing or resizing.
    }
  }
}
