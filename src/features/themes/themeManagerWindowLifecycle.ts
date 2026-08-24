import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function openThemeManagerWindow(): Promise<boolean> {
  if (!isTauri()) return false;

  await invoke("open_theme_manager_window");
  return true;
}

export async function closeThemeManagerWindow(): Promise<boolean> {
  if (!isTauri()) return false;

  await getCurrentWindow().close();
  return true;
}
