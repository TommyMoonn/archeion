import { type ReactNode, useEffect, useState } from "react";

import type { LibraryStorage } from "./LibraryStorage";
import { getLibraryStorage } from "./defaultLibraryStorage";
import { LibraryStorageContext } from "./useLibraryStorage";

type LibraryStorageProviderProps = {
  children: ReactNode;
  storage?: LibraryStorage;
};

export function LibraryStorageProvider({ children, storage }: LibraryStorageProviderProps) {
  const [defaultStorage, setDefaultStorage] = useState<LibraryStorage | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const resolvedStorage = storage ?? defaultStorage;
  const didStorageFail = storage ? false : storageFailed;

  useEffect(() => {
    if (storage) {
      return undefined;
    }

    let active = true;

    void getLibraryStorage()
      .then((nextStorage) => {
        if (active) {
          setDefaultStorage(nextStorage);
          setStorageFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setStorageFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [storage]);

  if (!resolvedStorage) {
    return (
      <main className="archive-setup" aria-busy={!didStorageFail}>
        <p className="archive-loading">
          {didStorageFail ? "The active archive could not be loaded." : "Opening archive"}
        </p>
      </main>
    );
  }

  return <LibraryStorageContext value={resolvedStorage}>{children}</LibraryStorageContext>;
}
