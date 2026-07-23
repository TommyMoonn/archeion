import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

const archiveScanUnavailableReason = "Wait for the archive scan to finish";

export type SettingsConfirmationKey =
  | "clearCoverCache"
  | "clearEpubWritebackBackups"
  | "clearScannerCache"
  | "reextractMetadata"
  | "repairMetadata"
  | "rescanArchive";

export type SettingsConfirmationState = Record<SettingsConfirmationKey, boolean>;

type SettingsConfirmationsProps = {
  archiveScanActive: boolean;
  busyConfirmations: SettingsConfirmationState;
  confirmations: SettingsConfirmationState;
  onClearCoverCache: () => void;
  onClearEpubWritebackBackups: () => void;
  onClearScannerCache: () => void;
  onClose: (confirmation: SettingsConfirmationKey) => void;
  onReextractMetadata: () => void;
  onRepairMetadata: () => void;
  onRescanArchive: () => void;
};

export function SettingsConfirmations({
  archiveScanActive,
  busyConfirmations,
  confirmations,
  onClearCoverCache,
  onClearEpubWritebackBackups,
  onClearScannerCache,
  onClose,
  onReextractMetadata,
  onRepairMetadata,
  onRescanArchive,
}: SettingsConfirmationsProps) {
  return (
    <>
      {confirmations.clearCoverCache ? (
        <Dialog
          title="Clear cover cache?"
          description="Covers will be extracted again when needed."
          onClose={() => onClose("clearCoverCache")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.clearCoverCache}
                variant="secondary"
                onClick={() => onClose("clearCoverCache")}
              >
                Cancel
              </Button>
              <Button
                busy={busyConfirmations.clearCoverCache}
                disabled={busyConfirmations.clearCoverCache}
                variant="danger"
                onClick={onClearCoverCache}
              >
                Clear cover cache
              </Button>
            </>
          }
        />
      ) : null}
      {confirmations.clearScannerCache ? (
        <Dialog
          title="Clear scanner cache?"
          description="EPUB files, favorites, and reading progress will not be deleted."
          onClose={() => onClose("clearScannerCache")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.clearScannerCache}
                variant="secondary"
                onClick={() => onClose("clearScannerCache")}
              >
                Cancel
              </Button>
              <Button
                busy={busyConfirmations.clearScannerCache}
                disabled={busyConfirmations.clearScannerCache}
                variant="danger"
                onClick={onClearScannerCache}
              >
                Clear scanner cache
              </Button>
            </>
          }
        />
      ) : null}
      {confirmations.clearEpubWritebackBackups ? (
        <Dialog
          title="Clear EPUB writeback backups?"
          description="This removes saved recovery copies created after successful metadata edits. Your EPUB files and library metadata will not be changed."
          onClose={() => onClose("clearEpubWritebackBackups")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.clearEpubWritebackBackups}
                variant="secondary"
                onClick={() => onClose("clearEpubWritebackBackups")}
              >
                Cancel
              </Button>
              <Button
                busy={busyConfirmations.clearEpubWritebackBackups}
                disabled={busyConfirmations.clearEpubWritebackBackups}
                variant="danger"
                onClick={onClearEpubWritebackBackups}
              >
                Clear backups
              </Button>
            </>
          }
        />
      ) : null}
      {confirmations.reextractMetadata ? (
        <Dialog
          title="Re-extract source metadata?"
          description="EPUB files, favorites, and reading progress will not be deleted."
          onClose={() => onClose("reextractMetadata")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.reextractMetadata}
                variant="secondary"
                onClick={() => onClose("reextractMetadata")}
              >
                Cancel
              </Button>
              <Button
                autoFocus
                busy={busyConfirmations.reextractMetadata}
                disabled={busyConfirmations.reextractMetadata || archiveScanActive}
                disabledReason={
                  archiveScanActive && !busyConfirmations.reextractMetadata
                    ? archiveScanUnavailableReason
                    : undefined
                }
                onClick={onReextractMetadata}
              >
                Re-extract
              </Button>
            </>
          }
        />
      ) : null}
      {confirmations.repairMetadata ? (
        <Dialog
          title="Repair archive metadata?"
          description="Corrupted metadata files and scanner cache will be rebuilt when possible. EPUB files are not changed."
          onClose={() => onClose("repairMetadata")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.repairMetadata}
                variant="secondary"
                onClick={() => onClose("repairMetadata")}
              >
                Cancel
              </Button>
              <Button
                autoFocus
                busy={busyConfirmations.repairMetadata}
                disabled={busyConfirmations.repairMetadata || archiveScanActive}
                disabledReason={
                  archiveScanActive && !busyConfirmations.repairMetadata
                    ? archiveScanUnavailableReason
                    : undefined
                }
                onClick={onRepairMetadata}
              >
                Repair metadata
              </Button>
            </>
          }
        />
      ) : null}
      {confirmations.rescanArchive ? (
        <Dialog
          title="Rescan archive?"
          description="EPUB files are not changed."
          onClose={() => onClose("rescanArchive")}
          footer={
            <>
              <Button
                disabled={busyConfirmations.rescanArchive}
                onClick={() => onClose("rescanArchive")}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                autoFocus
                busy={busyConfirmations.rescanArchive}
                disabled={busyConfirmations.rescanArchive || archiveScanActive}
                disabledReason={
                  archiveScanActive && !busyConfirmations.rescanArchive
                    ? archiveScanUnavailableReason
                    : undefined
                }
                onClick={onRescanArchive}
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
