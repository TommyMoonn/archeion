import { useEffect, useLayoutEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import {
  ArchiveReconciliationRequestOwner,
  type ActiveArchiveScope,
} from "../../storage/archiveReconciliation";

export function useArchiveReconciliationRequests(
  storage: LibraryStorage,
  activeArchive: ActiveArchiveScope,
): void {
  const activeArchiveRef = useRef(activeArchive);

  useLayoutEffect(() => {
    activeArchiveRef.current = activeArchive;
  }, [activeArchive]);

  useEffect(() => {
    if (!isTauri()) return;
    const owner = new ArchiveReconciliationRequestOwner(storage, () => activeArchiveRef.current);
    void owner.start().catch((error) => {
      console.error("archive reconciliation request listener failed", error);
    });
    return () => owner.stop();
  }, [storage]);
}
