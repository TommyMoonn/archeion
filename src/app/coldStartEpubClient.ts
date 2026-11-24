import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ExternalReaderRequest } from "../features/reader/externalReaderSource";

export type { ExternalReaderRequest } from "../features/reader/externalReaderSource";

// The selected absolute path stays native and is never exposed to the webview.
export async function loadColdStartEpub(): Promise<ExternalReaderRequest | null> {
  if (!isTauri()) return null;
  return invoke<ExternalReaderRequest | null>("cold_start_epub");
}

export async function revealColdStartReaderWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("standalone_reader_window_ready");
}
