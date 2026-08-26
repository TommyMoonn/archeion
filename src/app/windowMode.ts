import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const ARCHIVE_MANAGER_WINDOW_LABEL = "archive-manager";
export const ABOUT_WINDOW_LABEL = "about";
export const SETTINGS_WINDOW_LABEL = "settings";
export const THEME_MANAGER_WINDOW_LABEL = "theme-manager";

export type AppWindowMode =
  | "main"
  | typeof ABOUT_WINDOW_LABEL
  | typeof ARCHIVE_MANAGER_WINDOW_LABEL
  | typeof SETTINGS_WINDOW_LABEL
  | typeof THEME_MANAGER_WINDOW_LABEL;

type ResolveWindowModeOptions = {
  currentWindowLabel?: string | null;
  isDesktop?: boolean;
  search?: string;
};

function queryWindowMode(search: string): AppWindowMode {
  const mode = new URLSearchParams(search).get("window");
  if (
    mode === ABOUT_WINDOW_LABEL ||
    mode === ARCHIVE_MANAGER_WINDOW_LABEL ||
    mode === SETTINGS_WINDOW_LABEL ||
    mode === THEME_MANAGER_WINDOW_LABEL
  ) {
    return mode;
  }
  return "main";
}

function safeIsTauri(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

function safeCurrentWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

function currentSearch(): string {
  if (typeof globalThis.location === "undefined") {
    return "";
  }

  return globalThis.location.search;
}

export function resolveWindowMode({
  currentWindowLabel,
  isDesktop = safeIsTauri(),
  search = currentSearch(),
}: ResolveWindowModeOptions = {}): AppWindowMode {
  const windowLabel =
    currentWindowLabel === undefined && isDesktop
      ? safeCurrentWindowLabel()
      : (currentWindowLabel ?? null);

  if (isDesktop && windowLabel) {
    if (
      windowLabel === ABOUT_WINDOW_LABEL ||
      windowLabel === ARCHIVE_MANAGER_WINDOW_LABEL ||
      windowLabel === SETTINGS_WINDOW_LABEL ||
      windowLabel === THEME_MANAGER_WINDOW_LABEL
    ) {
      return windowLabel;
    }
    return "main";
  }

  return queryWindowMode(search);
}
