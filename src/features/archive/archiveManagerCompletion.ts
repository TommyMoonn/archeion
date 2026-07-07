import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ARCHIVE_MANAGER_WINDOW_LABEL } from "../../app/windowMode";
import { archiveStore } from "../../stores/archiveStore";

type CompleteArchiveManagerActionOptions = {
  closeCurrentWindow?: () => Promise<void>;
  currentWindowLabel?: string | null;
  focusMainWindow?: () => Promise<boolean>;
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
  focusMainWindow = archiveStore.focusMainWindow,
  isDesktop = desktopRuntimeAvailable(),
}: CompleteArchiveManagerActionOptions = {}): Promise<boolean> {
  if (!isDesktop || currentWindowLabel !== ARCHIVE_MANAGER_WINDOW_LABEL) {
    return false;
  }

  const focused = await focusMainWindow();
  if (!focused) {
    return false;
  }

  await closeWindow();
  return true;
}
