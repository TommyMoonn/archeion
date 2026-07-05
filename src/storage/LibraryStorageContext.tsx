import {
  type ReactNode,
} from "react";

import type { LibraryStorage } from "./LibraryStorage";
import { libraryStorage } from "./defaultLibraryStorage";
import { LibraryStorageContext } from "./useLibraryStorage";

type LibraryStorageProviderProps = {
  children: ReactNode;
  storage?: LibraryStorage;
};

export function LibraryStorageProvider({
  children,
  storage = libraryStorage,
}: LibraryStorageProviderProps) {
  return (
    <LibraryStorageContext value={storage}>
      {children}
    </LibraryStorageContext>
  );
}
