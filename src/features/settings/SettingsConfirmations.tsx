import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

export type SettingsConfirmationKey =
  | "clearCoverCache"
  | "clearEpubWritebackBackups"
  | "clearScannerCache"
  | "reextractMetadata"
  | "rescanArchive";

export type SettingsConfirmationState = Record<SettingsConfirmationKey, boolean>;

type SettingsConfirmationsProps = {
  confirmations: SettingsConfirmationState;
  onClearCoverCache: () => void;
  onClearEpubWritebackBackups: () => void;
  onClearScannerCache: () => void;
  onClose: (confirmation: SettingsConfirmationKey) => void;
  onReextractMetadata: () => void;
  onRescanArchive: () => void;
};

export function SettingsConfirmations({
  confirmations,
  onClearCoverCache,
  onClearEpubWritebackBackups,
  onClearScannerCache,
  onClose,
  onReextractMetadata,
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
                variant="secondary"
                onClick={() => onClose("clearCoverCache")}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={onClearCoverCache}>
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
                variant="secondary"
                onClick={() => onClose("clearScannerCache")}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={onClearScannerCache}>
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
                variant="secondary"
                onClick={() => onClose("clearEpubWritebackBackups")}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={onClearEpubWritebackBackups}>
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
                variant="secondary"
                onClick={() => onClose("reextractMetadata")}
              >
                Cancel
              </Button>
              <Button autoFocus onClick={onReextractMetadata}>
                Re-extract
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
                onClick={() => onClose("rescanArchive")}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button autoFocus onClick={onRescanArchive}>
                Rescan archive
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
