import { useSyncExternalStore } from "react";

import {
  defaultAppPreferences,
  type AppPreferences,
} from "../types/appSettings";

const STORAGE_KEY = "archeion:preferences";
type Listener = () => void;

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== "object") {
    return { ...defaultAppPreferences };
  }

  const preferences = value as Partial<AppPreferences>;
  return {
    density:
      preferences.density === "compact" ? "compact" : "comfortable",
    bookCardSize:
      preferences.bookCardSize === "small" ||
      preferences.bookCardSize === "large"
        ? preferences.bookCardSize
        : "medium",
    showContinueReading: preferences.showContinueReading !== false,
    windowFrameStyle:
      preferences.windowFrameStyle === "archeion" ||
      preferences.windowFrameStyle === "native"
        ? preferences.windowFrameStyle
        : "hidden",
  };
}

function loadPreferences(): AppPreferences {
  if (typeof window === "undefined") {
    return { ...defaultAppPreferences };
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved
      ? normalizeAppPreferences(JSON.parse(saved))
      : { ...defaultAppPreferences };
  } catch {
    return { ...defaultAppPreferences };
  }
}

class AppPreferencesStore {
  private preferences = loadPreferences();
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.apply();
  }

  getSnapshot = () => this.preferences;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(changes: Partial<AppPreferences>) {
    this.preferences = normalizeAppPreferences({
      ...this.preferences,
      ...changes,
    });
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.preferences),
      );
    } catch {
      // The current session can still use the preference.
    }
    this.apply();
    this.listeners.forEach((listener) => listener());
  }

  private apply() {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.density = this.preferences.density;
    document.documentElement.dataset.cardSize = this.preferences.bookCardSize;
    document.documentElement.dataset.windowFrame =
      this.preferences.windowFrameStyle;
  }
}

export const appPreferencesStore = new AppPreferencesStore();

export function useAppPreferences() {
  return useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getSnapshot,
  );
}
