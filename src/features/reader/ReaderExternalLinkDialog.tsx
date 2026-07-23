import { useEffect, useRef } from "react";

import { Button } from "../../components/Button";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";

type ReaderExternalLinkDialogProps = {
  error?: string;
  host: string;
  opening: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  url: string;
};

export function ReaderExternalLinkDialog({
  error,
  host,
  opening,
  onCancel,
  onConfirm,
  url,
}: ReaderExternalLinkDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const modal = useModalDialogLifecycle({
    closeOnBackdropClick: !opening,
    dialogRef,
    onClose: () => {
      if (!opening) onCancel();
    },
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-describedby="reader-external-link-description"
      aria-labelledby="reader-external-link-title"
      className="dialog reader-external-link-dialog"
      data-reader-ignore-shortcuts
      onCancel={(event) => {
        event.preventDefault();
        if (!opening) modal.onCancel(event);
      }}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <div className="dialog__panel">
        <div className="dialog__copy">
          <h2 id="reader-external-link-title">Open external link?</h2>
          <p id="reader-external-link-description">
            This EPUB wants to open <strong>{host}</strong> in your browser.
          </p>
        </div>
        <p className="reader-external-link-dialog__url">{url}</p>
        {error ? (
          <p className="reader-external-link-dialog__error" data-tone="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__footer">
          <Button
            disabled={opening}
            onClick={onCancel}
            ref={cancelRef}
            size="standard"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button busy={opening} disabled={opening} onClick={onConfirm} size="standard">
            Open in browser
          </Button>
        </div>
      </div>
    </dialog>
  );
}
