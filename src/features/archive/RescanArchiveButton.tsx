import { ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { useLibraryStorage } from "../../storage/useLibraryStorage";

type RescanArchiveButtonProps = {
  onError: () => void;
  onSuccess: () => void;
};

export function RescanArchiveButton({ onError, onSuccess }: RescanArchiveButtonProps) {
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
      onSuccess();
    } catch {
      onError();
    } finally {
      setIsScanning(false);
      setConfirmationOpen(false);
    }
  }

  return (
    <>
      <IconButton
        aria-expanded={confirmationOpen}
        aria-haspopup="dialog"
        className="library-rescan-button"
        disabled={isScanning}
        disabledReason="Wait for the archive scan to finish"
        label={isScanning ? "Scanning archive" : "Rescan archive"}
        onClick={() => setConfirmationOpen(true)}
      >
        <ArrowsClockwise aria-hidden="true" />
      </IconButton>
      {confirmationOpen ? (
        <Dialog
          title="Rescan archive?"
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
                busy={isScanning}
                disabled={isScanning}
                onClick={() => void handleRescan()}
              >
                Rescan archive
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
