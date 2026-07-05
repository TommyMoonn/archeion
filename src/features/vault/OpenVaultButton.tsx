import { FolderOpen } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { vaultStore } from "../../stores/vaultStore";

type OpenVaultButtonProps = {
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
};

export function OpenVaultButton({
  label = "Open Library Folder",
  variant = "primary",
}: OpenVaultButtonProps) {
  const [isOpening, setIsOpening] = useState(false);

  async function handleOpen() {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      await vaultStore.chooseVault();
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <Button
      disabled={isOpening}
      icon={<FolderOpen aria-hidden="true" size={18} />}
      onClick={handleOpen}
      variant={variant}
    >
      {isOpening ? "Opening" : label}
    </Button>
  );
}
