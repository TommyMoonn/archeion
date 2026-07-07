import { FolderOpen, Plus } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { vaultStore } from "../../stores/vaultStore";

type ArchiveAction = "create" | "open";

type OpenVaultButtonProps = {
  action?: ArchiveAction;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
};

const actionLabels: Record<ArchiveAction, string> = {
  create: "Create empty archive",
  open: "Open folder as archive",
};

export function OpenVaultButton({
  action = "open",
  label = actionLabels[action],
  variant = "primary",
}: OpenVaultButtonProps) {
  const [isOpening, setIsOpening] = useState(false);

  async function handleOpen() {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      if (action === "create") {
        await vaultStore.createArchive();
      } else {
        await vaultStore.chooseVault();
      }
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <Button
      disabled={isOpening}
      icon={
        action === "create" ? (
          <Plus aria-hidden="true" size={18} />
        ) : (
          <FolderOpen aria-hidden="true" size={18} />
        )
      }
      onClick={handleOpen}
      variant={variant}
    >
      {isOpening ? "Opening" : label}
    </Button>
  );
}
