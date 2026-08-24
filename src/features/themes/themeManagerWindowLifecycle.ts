import { invoke, isTauri } from "@tauri-apps/api/core";

export async function openThemeManagerWindow(): Promise<void> {
  if (!isTauri()) return;

  await invoke("open_theme_manager_window");
}
