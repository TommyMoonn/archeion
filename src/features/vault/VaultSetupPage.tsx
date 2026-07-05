import { FolderDashed } from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import type { VaultState } from "../../stores/vaultStore";
import { vaultStore } from "../../stores/vaultStore";
import { OpenVaultButton } from "./OpenVaultButton";

type VaultSetupPageProps = {
  state: Exclude<VaultState, { status: "ready" }>;
};

export function VaultSetupPage({ state }: VaultSetupPageProps) {
  const isMissing = state.status === "missing";
  const title = isMissing ? "Library folder not found" : "Open your library";
  const description = isMissing
    ? "The saved folder may have been moved, renamed, or disconnected."
    : state.status === "error"
      ? state.error
      : "Choose the root folder that contains your EPUB collection.";

  return (
    <main className="vault-setup">
      <section className="vault-setup__card">
        <div className="vault-setup__icon" aria-hidden="true">
          <FolderDashed size={34} weight="thin" />
        </div>
        <p className="eyebrow">Archeion</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {state.path ? (
          <code className="vault-setup__path">{state.path}</code>
        ) : null}
        <div className="vault-setup__actions">
          {isMissing ? (
            <Button variant="secondary" onClick={() => void vaultStore.retry()}>
              Try again
            </Button>
          ) : null}
          <OpenVaultButton
            label={state.path ? "Choose Another Folder" : undefined}
          />
        </div>
        <p className="vault-setup__note">
          EPUB files stay in their existing folders.
        </p>
      </section>
    </main>
  );
}
