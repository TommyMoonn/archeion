import { invoke, isTauri } from "@tauri-apps/api/core";

export async function openSettingsWindow(): Promise<void> {
  if (!isTauri()) return;

  await invoke("open_settings_window");
}
