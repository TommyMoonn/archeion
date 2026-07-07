import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const ARCHIVE_MANAGER_WINDOW_LABEL = "archive-manager";

export type AppWindowMode = "main" | typeof ARCHIVE_MANAGER_WINDOW_LABEL;

type ResolveWindowModeOptions = {
  currentWindowLabel?: string | null;
  isDesktop?: boolean;
  search?: string;
};

function queryWindowMode(search: string): AppWindowMode {
  return new URLSearchParams(search).get("window") ===
    ARCHIVE_MANAGER_WINDOW_LABEL
    ? ARCHIVE_MANAGER_WINDOW_LABEL
    : "main";
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
    return windowLabel === ARCHIVE_MANAGER_WINDOW_LABEL
      ? ARCHIVE_MANAGER_WINDOW_LABEL
      : "main";
  }

  return queryWindowMode(search);
}
