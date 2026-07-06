import type { LibraryStorage } from "./LibraryStorage";

let libraryStoragePromise: Promise<LibraryStorage> | null = null;

async function createLibraryStorage(): Promise<LibraryStorage> {
  const { TauriVaultLibraryStorage } = await import(
    "./TauriVaultLibraryStorage"
  );

  return new TauriVaultLibraryStorage();
}

export function getLibraryStorage(): Promise<LibraryStorage> {
  libraryStoragePromise ??= createLibraryStorage();

  return libraryStoragePromise;
}
