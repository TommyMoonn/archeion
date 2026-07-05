import { useEffect } from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { vaultStore } from "../../stores/vaultStore";
import { useVault } from "./useVault";
import { VaultSetupPage } from "./VaultSetupPage";

type VaultGateProps = {
  children: ReactNode;
};

export function VaultGate({ children }: VaultGateProps) {
  const state = useVault();
  const storage = useLibraryStorage();

  useEffect(() => {
    void vaultStore.initialize();
  }, []);

  useEffect(() => {
    if (state.status === "ready" && storage.source === "vault") {
      void storage.rescan().catch(() => undefined);
    }
  }, [state, storage]);

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
