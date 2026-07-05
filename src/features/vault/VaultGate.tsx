import { useEffect } from "react";
import type { ReactNode } from "react";

import { vaultStore } from "../../stores/vaultStore";
import { useVault } from "./useVault";
import { VaultSetupPage } from "./VaultSetupPage";

type VaultGateProps = {
  children: ReactNode;
};

export function VaultGate({ children }: VaultGateProps) {
  const state = useVault();

  useEffect(() => {
    void vaultStore.initialize();
  }, []);

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
