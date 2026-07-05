import { createContext, useContext } from "react";

import type { LibraryStorage } from "./LibraryStorage";

export const LibraryStorageContext = createContext<LibraryStorage | null>(null);

export function useLibraryStorage(): LibraryStorage {
  const storage = useContext(LibraryStorageContext);

  if (!storage) {
    throw new Error("LibraryStorageProvider is missing.");
  }

  return storage;
}
