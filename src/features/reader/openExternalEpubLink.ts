import { invoke } from "@tauri-apps/api/core";

export function openExternalEpubLink(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
