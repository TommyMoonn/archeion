import { invoke } from "@tauri-apps/api/core";

export type ExternalReaderRequest = Readonly<{ token: string; fileName: string }>;

/** Only the native window owning this token can read its selected EPUB. */
export async function readExternalReaderEpub(token: string): Promise<Blob> {
  const bytes = await invoke<ArrayBuffer>("read_external_reader_epub", { token });
  return new Blob([bytes], { type: "application/epub+zip" });
}
