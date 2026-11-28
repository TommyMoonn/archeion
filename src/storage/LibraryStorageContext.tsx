import { LoadingStatus } from "../components/LoadingStatus";
import { type ReactNode, useEffect, useState } from "react";

import { MAIN_CONTENT_ID } from "../components/SkipLink";
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
      <main
        className="archive-setup grid h-full min-h-0 place-items-center bg-canvas-deep p-archive-setup in-[.window-app__content]:min-h-full"
        aria-busy={!didStorageFail}
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
      >
        {didStorageFail ? (
          <p className="text-muted text-body" role="alert">
            The active archive could not be loaded. Restart Archeion and open it again.
          </p>
        ) : (
          <LoadingStatus message="Opening archive" />
        )}
      </main>
    );
  }

  return <LibraryStorageContext value={resolvedStorage}>{children}</LibraryStorageContext>;
}
