import { useEffect, useLayoutEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { router } from "../../app/router";
import { listenForArchiveIntegrityRequests } from "../../storage/archiveIntegrityNavigation";
import type { ActiveArchiveScope } from "../../storage/archiveReconciliation";

export function useArchiveIntegrityRequests(activeArchive: ActiveArchiveScope): void {
  const activeArchiveRef = useRef(activeArchive);
  useLayoutEffect(() => {
    activeArchiveRef.current = activeArchive;
  }, [activeArchive]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForArchiveIntegrityRequests(
      () => (disposed ? null : activeArchiveRef.current),
      (path) => {
        void router.navigate(path).catch((error) => {
          console.error("Archive maintenance navigation failed", error);
        });
      },
    ).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
      },
      (error) => console.error("Archive maintenance listener failed", error),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
