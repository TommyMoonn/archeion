import type { LibraryStorage } from "./LibraryStorage";

let libraryStoragePromise: Promise<LibraryStorage> | null = null;

async function createLibraryStorage(): Promise<LibraryStorage> {
  const { TauriArchiveLibraryStorage } = await import(
    "./TauriArchiveLibraryStorage"
  );

  return new TauriArchiveLibraryStorage();
}

export function getLibraryStorage(): Promise<LibraryStorage> {
  libraryStoragePromise ??= createLibraryStorage();

  return libraryStoragePromise;
}
