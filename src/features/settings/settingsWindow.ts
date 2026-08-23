import { invoke, isTauri } from "@tauri-apps/api/core";

export async function openSettingsWindow(): Promise<boolean> {
  if (!isTauri()) return false;

  await invoke("open_settings_window");
  return true;
}
