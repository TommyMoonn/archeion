import { ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { useLibraryStorage } from "../../storage/useLibraryStorage";

type RescanVaultButtonProps = {
  onError: () => void;
};

export function RescanVaultButton({ onError }: RescanVaultButtonProps) {
  const storage = useLibraryStorage();
  const [isScanning, setIsScanning] = useState(false);

  async function handleRescan() {
    if (isScanning) {
      return;
    }

    setIsScanning(true);
    try {
      await storage.rescan();
    } catch {
      onError();
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <Button
      disabled={isScanning}
      icon={<ArrowsClockwise aria-hidden="true" size={18} />}
      onClick={handleRescan}
      variant="secondary"
    >
      {isScanning ? "Scanning" : "Rescan"}
    </Button>
  );
}
