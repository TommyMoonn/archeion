import { useEffect } from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { vaultStore } from "../../stores/vaultStore";
import { useVault } from "./useVault";
import { VaultWatcherController } from "./vaultWatcher";
import { VaultSetupPage } from "./VaultSetupPage";

type VaultGateProps = {
  children: ReactNode;
};

export function VaultGate({ children }: VaultGateProps) {
  const state = useVault();
  const storage = useLibraryStorage();
  const vaultPath = state.status === "ready" ? state.path : null;

  useEffect(() => {
    void vaultStore.initialize();
  }, []);

  useEffect(() => {
    if (!vaultPath) {
      return;
    }

    storage.reset(vaultPath);
    void storage.rescan().catch(() => undefined);

    const watcher = new VaultWatcherController({
      storage,
      onError: () => {
        vaultStore.setWatcherError(
          "Live refresh paused. Use Rescan library if files change.",
        );
      },
      onRecovered: () => vaultStore.setWatcherError(null),
    });
    void watcher.start().catch(() => undefined);

    return () => {
      void watcher.stop();
    };
  }, [vaultPath, storage]);

  if (state.status === "loading") {
    return (
      <main className="vault-setup" aria-busy="true">
        <p className="vault-loading">Opening library</p>
      </main>
    );
  }

  if (state.status !== "ready") {
    return <VaultSetupPage state={state} />;
  }

  return children;
}
