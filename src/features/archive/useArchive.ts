import { useSyncExternalStore } from "react";

import { archiveStore } from "../../stores/archiveStore";
import { useArchivePresentation } from "../../app/archivePresentation";

export function useArchive() {
  const presentation = useArchivePresentation();
  const state = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );
  return presentation?.archive ?? state;
}
