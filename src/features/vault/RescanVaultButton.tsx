import { ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useLibraryStorage } from "../../storage/useLibraryStorage";

type RescanVaultButtonProps = {
  onError: () => void;
};

export function RescanVaultButton({ onError }: RescanVaultButtonProps) {
  const storage = useLibraryStorage();
  const [isScanning, setIsScanning] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

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
      setConfirmationOpen(false);
    }
  }

  return (
    <>
      <Button
        disabled={isScanning}
        icon={<ArrowsClockwise aria-hidden="true" size={18} />}
        onClick={() => setConfirmationOpen(true)}
        variant="secondary"
      >
        {isScanning ? "Scanning" : "Rescan"}
      </Button>
      {confirmationOpen ? (
        <Dialog
          title="Rescan library?"
          description="This refreshes book and missing-file records. EPUB files are not changed."
          onClose={() => {
            if (!isScanning) setConfirmationOpen(false);
          }}
          footer={
            <>
              <Button
                disabled={isScanning}
                onClick={() => setConfirmationOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                autoFocus
                disabled={isScanning}
                onClick={() => void handleRescan()}
              >
                {isScanning ? "Scanning" : "Rescan library"}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
