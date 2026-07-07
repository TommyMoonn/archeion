import { useSyncExternalStore } from "react";

import { archiveStore } from "../../stores/archiveStore";

export function useArchive() {
  return useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );
}
