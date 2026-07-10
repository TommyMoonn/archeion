import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ARCHIVE_MANAGER_WINDOW_LABEL } from "../../app/windowMode";

type CompleteArchiveManagerActionOptions = {
  closeCurrentWindow?: () => Promise<void>;
  currentWindowLabel?: string | null;
  isDesktop?: boolean;
};

function currentArchiveManagerWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

function closeCurrentWindow(): Promise<void> {
  return getCurrentWindow().close();
}

function desktopRuntimeAvailable(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export async function completeArchiveManagerAction({
  closeCurrentWindow: closeWindow = closeCurrentWindow,
  currentWindowLabel = currentArchiveManagerWindowLabel(),
  isDesktop = desktopRuntimeAvailable(),
}: CompleteArchiveManagerActionOptions = {}): Promise<boolean> {
  if (!isDesktop || currentWindowLabel !== ARCHIVE_MANAGER_WINDOW_LABEL) {
    return false;
  }

  await closeWindow();
  return true;
}
