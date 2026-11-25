import { useLayoutEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";

import {
  DialogFrame,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import { Button } from "../../components/Button";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { useReaderSideSurfaceDismiss } from "./readerSideSurfaceDismissal";

type ReaderExternalLinkDialogProps = {
  error?: string;
  host: string;
  opening: boolean;
  onCancel: (restoreFocus?: boolean) => void;
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
  const dismissal = useReaderSideSurfaceDismiss(
    (restoreFocus = true) => {
      if (!opening) onCancel(restoreFocus);
      return true;
    },
    true,
    "external-link",
  );
  const modal = useModalDialogLifecycle({
    closeOnBackdropClick: !opening,
    dialogRef,
    initialFocusRef: cancelRef,
    onClose: dismissal.requestDismissal,
  });

  // The Reader restores the EPUB link inside its owning iframe after native close.
  const { suppressFocusRestoration } = modal;
  useLayoutEffect(suppressFocusRestoration, [suppressFocusRestoration]);

  return (
    <DialogFrame
      ref={dialogRef}
      aria-describedby="reader-external-link-description"
      aria-labelledby="reader-external-link-title"
      className="reader-external-link-dialog"
      data-reader-ignore-shortcuts
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle id="reader-external-link-title">Open external link?</DialogTitle>
          <p id="reader-external-link-description">
            This EPUB wants to open <strong>{host}</strong> in your browser.
          </p>
        </DialogHeader>
        <p className="reader-external-link-dialog__url">{url}</p>
        {error ? (
          <p className="reader-external-link-dialog__error" data-tone="error" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={opening}
            onClick={() => dismissal.requestDismissal()}
            ref={cancelRef}
            size="standard"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            icon={<ExternalLink aria-hidden="true" />}
            busy={opening}
            disabled={opening}
            onClick={onConfirm}
            size="standard"
          >
            Open in browser
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogFrame>
  );
}
