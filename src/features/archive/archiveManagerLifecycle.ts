import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const ARCHIVE_MANAGER_CLOSED_EVENT = "archive-manager-closed";

function desktopRuntimeAvailable(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export async function listenForArchiveManagerClosed(listener: () => void): Promise<() => void> {
  if (!desktopRuntimeAvailable()) {
    return () => undefined;
  }

  return listen(ARCHIVE_MANAGER_CLOSED_EVENT, listener);
}

export async function hideMainWindowForStartup(): Promise<boolean> {
  if (!desktopRuntimeAvailable()) {
    return false;
  }

  try {
    await getCurrentWindow().hide();
    return true;
  } catch (error) {
    console.error("main window could not be hidden for startup", error);
    return false;
  }
}

export async function quitFromStartup(): Promise<void> {
  if (!desktopRuntimeAvailable()) {
    return;
  }

  await getCurrentWindow().close();
}
