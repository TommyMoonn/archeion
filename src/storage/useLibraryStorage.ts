import { createContext, useContext } from "react";

import type { LibraryStorage } from "./LibraryStorage";

export const LibraryStorageContext = createContext<LibraryStorage | null>(null);

export function useOptionalLibraryStorage(): LibraryStorage | null {
  return useContext(LibraryStorageContext);
}

export function useLibraryStorage(): LibraryStorage {
  const storage = useOptionalLibraryStorage();

  if (!storage) {
    throw new Error("LibraryStorageProvider is missing.");
  }

  return storage;
}
