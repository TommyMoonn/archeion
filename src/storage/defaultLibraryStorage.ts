import { isTauri } from "@tauri-apps/api/core";

import type { LibraryStorage } from "./LibraryStorage";

let libraryStoragePromise: Promise<LibraryStorage> | null = null;

async function createLibraryStorage(): Promise<LibraryStorage> {
  if (isTauri()) {
    const { TauriVaultLibraryStorage } = await import(
      "./TauriVaultLibraryStorage"
    );

    return new TauriVaultLibraryStorage();
  }

  const { IndexedDbLibraryStorage } = await import(
    "./IndexedDbLibraryStorage"
  );

  return new IndexedDbLibraryStorage();
}

export function getLibraryStorage(): Promise<LibraryStorage> {
  libraryStoragePromise ??= createLibraryStorage();

  return libraryStoragePromise;
}
