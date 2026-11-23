import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Native validation is authoritative. Never infer an external Reader request from the URL.
export async function loadColdStartEpub(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("cold_start_epub");
}

export async function revealColdStartReaderWindow(): Promise<void> {
  if (!isTauri()) return;
  const window = getCurrentWindow();
  await window.show();
  await window.setFocus();
}
