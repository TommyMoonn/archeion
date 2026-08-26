import { invoke, isTauri } from "@tauri-apps/api/core";

export async function openAboutWindow(): Promise<void> {
  if (!isTauri()) return;

  await invoke("open_about_window");
}
