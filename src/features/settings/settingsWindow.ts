import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function closeSettingsWindow(): Promise<boolean> {
  if (!isTauri()) return false;

  await getCurrentWindow().close();
  return true;
}

export async function openSettingsWindow(): Promise<boolean> {
  if (!isTauri()) return false;

  await invoke("open_settings_window");
  return true;
}
