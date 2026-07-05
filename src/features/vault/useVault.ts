import { useSyncExternalStore } from "react";

import { vaultStore } from "../../stores/vaultStore";

export function useVault() {
  return useSyncExternalStore(
    vaultStore.subscribe,
    vaultStore.getSnapshot,
    vaultStore.getSnapshot,
  );
}
