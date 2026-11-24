import { invoke, isTauri } from "@tauri-apps/api/core";

export type ExternalReaderRequest = Readonly<{ token: string; fileName: string }>;

/** Only the native window owning this token can read its selected EPUB. */
export async function readExternalReaderEpub(token: string): Promise<Blob> {
  const bytes = await invoke<ArrayBuffer>("read_external_reader_epub", { token });
  return new Blob([bytes], { type: "application/epub+zip" });
}

export type StandaloneReaderManagedBook = Readonly<{
  archiveId: string;
  archiveRootPath: string;
  bookId: string;
  relativePath: string;
}>;

// The native window owns the selected path. The caller supplies only its opaque token.
export async function findStandaloneReaderManagedBook(
  token: string,
): Promise<StandaloneReaderManagedBook | null> {
  if (!isTauri()) return null;
  return invoke<StandaloneReaderManagedBook | null>("standalone_reader_archive_match", { token });
}

/** Closes only the native window that owns the selected EPUB. */
export async function closeStandaloneReaderWindow(token: string): Promise<void> {
  await invoke("close_standalone_reader_window", { token });
}
