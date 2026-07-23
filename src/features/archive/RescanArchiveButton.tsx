import { ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";

type RescanArchiveButtonProps = {
  isRescanning: boolean;
  onRescan: () => Promise<void>;
};

export function RescanArchiveButton({ isRescanning, onRescan }: RescanArchiveButtonProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  async function handleRescan() {
    if (isRescanning) {
      return;
    }

    const rescan = onRescan();
    setConfirmationOpen(false);
    await rescan;
  }

  return (
    <>
      <IconButton
        aria-expanded={confirmationOpen}
        aria-haspopup="dialog"
        className="library-rescan-button"
        disabled={isRescanning}
        disabledReason="Wait for the archive scan to finish"
        label={isRescanning ? "Scanning archive" : "Rescan archive"}
        onClick={() => setConfirmationOpen(true)}
      >
        <ArrowsClockwise aria-hidden="true" />
      </IconButton>
      {confirmationOpen ? (
        <Dialog
          title="Rescan archive?"
          description="This refreshes book and missing-file records. EPUB files are not changed."
          onClose={() => {
            if (!isRescanning) setConfirmationOpen(false);
          }}
          footer={
            <>
              <Button
                disabled={isRescanning}
                onClick={() => setConfirmationOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                autoFocus
                busy={isRescanning}
                disabled={isRescanning}
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
