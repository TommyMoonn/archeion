import { CircleCheck, Save, CircleAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Alert } from "../../components/ui/alert";
import { CoverWritebackFields } from "./CoverWritebackFields";
import type {
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  ReadonlyBook,
} from "../../types/book";

const feedbackClass =
  "flex items-start gap-control-gap rounded-menu border-standard border-solid px-dialog-gap-narrow py-dialog-copy text-caption-size leading-field-compact [&>svg]:mt-px [&>svg]:size-icon-glyph-medium [&>svg]:flex-none";
const errorClass = `${feedbackClass} border-danger-border bg-dialog-subtle text-danger`;

type BookCoverWritebackDialogProps = {
  book: ReadonlyBook;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  onPrepareCover: (
    book: ReadonlyBook,
    imagePath: string,
    framing: EpubCoverFraming,
  ) => Promise<EpubCoverPreparation>;
  onWriteCover: (
    book: ReadonlyBook,
    input: EpubCoverWritebackInput,
  ) => Promise<EpubCoverWritebackResult>;
};

function coverErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export function BookCoverWritebackDialog({
  book,
  onClose,
  onPrepareCover,
  onWriteCover,
  returnFocusTo,
}: BookCoverWritebackDialogProps) {
  const [framing, setFraming] = useState<EpubCoverFraming>("crop");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<EpubCoverPreparation | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const preparationRequest = useRef(0);
  const pendingOperation = useRef<"preparing" | "writing" | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const recoveryControlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      preparationRequest.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!error || isPreparing || isWriting) return;
    const frame = window.requestAnimationFrame(() => {
      recoveryControlsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, isPreparing, isWriting]);

  function replacePreviewUrl(nextPreviewUrl: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
  }

  async function prepareCover(path: string, nextFraming: EpubCoverFraming) {
    if (pendingOperation.current === "writing") return;
    pendingOperation.current = "preparing";
    const requestId = preparationRequest.current + 1;
    preparationRequest.current = requestId;
    setIsPreparing(true);
    setError(null);
    setSuccess(false);
    setWarning(null);

    try {
      const nextPreparation = await onPrepareCover(book, path, nextFraming);
      if (preparationRequest.current !== requestId) return;
      const nextPreviewUrl = URL.createObjectURL(
        new Blob([new Uint8Array(nextPreparation.previewBytes)], {
          type: nextPreparation.previewMimeType,
        }),
      );
      replacePreviewUrl(nextPreviewUrl);
      setPreparation(nextPreparation);
    } catch (prepareError) {
      if (preparationRequest.current !== requestId) return;
      setPreparation(null);
      replacePreviewUrl(null);
      setError(
        coverErrorMessage(prepareError, "The selected image could not be prepared as a cover."),
      );
    } finally {
      if (preparationRequest.current === requestId) {
        pendingOperation.current = null;
        setIsPreparing(false);
      }
    }
  }

  async function chooseImage() {
    if (pendingOperation.current || book.isFileMissing || !book.relativePath) return;
    const requestId = ++preparationRequest.current;
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Choose replacement cover",
        filters: [
          {
            name: "Cover images",
            extensions: ["jpg", "jpeg", "png", "webp"],
          },
        ],
      });
      if (preparationRequest.current !== requestId || typeof selected !== "string") return;
      setImagePath(selected);
      await prepareCover(selected, framing);
    } catch (pickerError) {
      if (preparationRequest.current !== requestId) return;
      setError(coverErrorMessage(pickerError, "The image picker could not be opened."));
    }
  }

  function changeFraming(nextFraming: EpubCoverFraming) {
    if (pendingOperation.current === "writing" || book.isFileMissing || nextFraming === framing)
      return;
    setFraming(nextFraming);
    if (imagePath) void prepareCover(imagePath, nextFraming);
  }

  async function writeCover() {
    if (!canWrite || pendingOperation.current || !imagePath || !preparation) return;
    pendingOperation.current = "writing";
    const requestId = preparationRequest.current;
    setIsWriting(true);
    setError(null);
    setSuccess(false);
    setWarning(null);
    try {
      const result = await onWriteCover(book, {
        imagePath,
        framing,
        expectedImageSize: preparation.imageSize,
        expectedImageModifiedAt: preparation.imageModifiedAt,
        expectedEpubSize: preparation.epubSize,
        expectedEpubModifiedAt: preparation.epubModifiedAt,
      });
      if (preparationRequest.current !== requestId) return;
      setSuccess(true);
      setPreparation(null);
      setWarning(result.coverCacheWarning ?? null);
    } catch (writeError) {
      if (preparationRequest.current !== requestId) return;
      setError(coverErrorMessage(writeError, "The replacement cover could not be written."));
    } finally {
      pendingOperation.current = null;
      if (preparationRequest.current === requestId) setIsWriting(false);
    }
  }

  function closeEditor() {
    if (pendingOperation.current !== "writing") onClose();
  }

  const canWrite = Boolean(
    imagePath &&
    preparation &&
    !isPreparing &&
    !isWriting &&
    !book.isFileMissing &&
    book.relativePath,
  );
  const writeDisabledReason = book.isFileMissing
    ? "The EPUB file is missing."
    : !book.relativePath
      ? "The EPUB file path is unavailable."
      : !imagePath
        ? "Choose a cover image first."
        : isPreparing
          ? "Wait for the preview to finish."
          : !preparation
            ? "Prepare a valid cover image first."
            : undefined;

  return (
    <Dialog
      className="dialog-width-cover"
      layout="workspace"
      feedbackPlacement="inline"
      returnFocusTo={returnFocusTo}
      closeOnBackdropClick={!isWriting}
      onClose={closeEditor}
      title="Replace embedded cover"
      feedback={
        <>
          <div role="status" aria-atomic="true">
            {isWriting ? (
              <Alert
                className={`${feedbackClass} border-line bg-dialog-subtle text-muted`}
                role={undefined}
              >
                Writing cover to EPUB…
              </Alert>
            ) : null}
            {success ? (
              <Alert
                className={`${feedbackClass} border-success-border bg-cover-feedback-success text-success`}
                role={undefined}
              >
                <CircleCheck aria-hidden="true" />
                Cover written to EPUB.
              </Alert>
            ) : null}
            {warning ? (
              <Alert
                className={`${feedbackClass} border-cover-feedback-warning-border bg-dialog-subtle text-accent`}
                role={undefined}
              >
                <CircleAlert aria-hidden="true" />
                {warning}
              </Alert>
            ) : null}
          </div>
          {book.isFileMissing ? (
            <Alert className={errorClass}>
              <CircleAlert aria-hidden="true" />
              The EPUB file is missing. Cover writeback is unavailable.
            </Alert>
          ) : null}
          {error ? (
            <Alert className={errorClass}>
              <CircleAlert aria-hidden="true" />
              {error}
            </Alert>
          ) : null}
        </>
      }
      footer={
        <>
          <Button disabled={isWriting} onClick={closeEditor} variant="secondary">
            Close
          </Button>
          <Button
            icon={<Save aria-hidden="true" />}
            busy={isWriting}
            disabled={!canWrite}
            disabledReason={!isWriting ? writeDisabledReason : undefined}
            onClick={() => void writeCover()}
          >
            Write cover to EPUB
          </Button>
        </>
      }
    >
      <CoverWritebackFields
        {...{
          book,
          previewUrl,
          isPreparing,
          isWriting,
          imagePath,
          framing,
          preparation,
          recoveryControlsRef,
          chooseImage,
          changeFraming,
        }}
      />
    </Dialog>
  );
}
