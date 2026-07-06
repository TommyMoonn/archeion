import { WarningCircle } from "@phosphor-icons/react";

import { useVault } from "./useVault";

export function VaultStatusBar() {
  const state = useVault();

  if (state.status !== "ready" || !state.watcherError) {
    return null;
  }

  return (
    <div className="import-notice import-notice--error" role="status">
      <WarningCircle aria-hidden="true" size={19} weight="regular" />
      <div>
        <p>{state.watcherError}</p>
      </div>
    </div>
  );
}
