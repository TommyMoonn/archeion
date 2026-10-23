import { CircleCheck, Image, Upload, CircleAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import type {
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  ReadonlyBook,
} from "../../types/book";
import { formatFileSize } from "../../utils/formatters";
import { BookCover } from "./BookCover";
import { bookTitle } from "./libraryFilters";

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

const framingOptions = [
  { label: "Crop", value: "crop" },
  { label: "Fit", value: "fit" },
] satisfies Array<{ label: string; value: EpubCoverFraming }>;

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
      className="dialog--cover-writeback"
      layout="workspace"
      feedbackPlacement="inline"
      returnFocusTo={returnFocusTo}
      closeOnBackdropClick={!isWriting}
      onClose={closeEditor}
      title="Replace embedded cover"
      feedback={
        <>
          <div role="status" aria-atomic="true">
            {isWriting ? <p className="cover-writeback__status">Writing cover to EPUB…</p> : null}
            {success ? (
              <p className="cover-writeback__status" data-tone="success">
                <CircleCheck aria-hidden="true" size={17} />
                Cover written to EPUB.
              </p>
            ) : null}
            {warning ? (
              <p className="cover-writeback__status" data-tone="warning">
                <CircleAlert aria-hidden="true" size={17} />
                {warning}
              </p>
            ) : null}
          </div>
          {book.isFileMissing ? (
            <p className="cover-writeback__status" data-tone="error" role="alert">
              <CircleAlert aria-hidden="true" size={17} />
              The EPUB file is missing. Cover writeback is unavailable.
            </p>
          ) : null}
          {error ? (
            <p className="cover-writeback__status" data-tone="error" role="alert">
              <CircleAlert aria-hidden="true" size={17} />
              {error}
            </p>
          ) : null}
        </>
      }
      footer={
        <>
          <Button disabled={isWriting} onClick={closeEditor} variant="secondary">
            Close
          </Button>
          <Button
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
      <div className="cover-writeback">
        <div className="cover-writeback__book">
          <BookCover book={book} className="cover-writeback__current-cover" />
          <div>
            <span>Book</span>
            <strong>{bookTitle(book)}</strong>
            <small title={book.relativePath ?? book.fileName}>
              {book.relativePath ?? book.fileName}
            </small>
          </div>
        </div>

        <section className="cover-writeback__workspace">
          <div className="cover-writeback__preview-column">
            <div className="cover-writeback__preview" data-loading={isPreparing || undefined}>
              {previewUrl ? <img alt="Final replacement cover preview" src={previewUrl} /> : null}
              {!previewUrl ? (
                <div className="cover-writeback__preview-empty">
                  <Image aria-hidden="true" size={34} strokeWidth={1.5} />
                  <span>{isPreparing ? "Preparing preview" : "Choose a cover image"}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="cover-writeback__controls" ref={recoveryControlsRef}>
            <Button
              disabled={isPreparing || isWriting || book.isFileMissing || !book.relativePath}
              icon={<Upload aria-hidden="true" />}
              onClick={() => void chooseImage()}
              variant="secondary"
            >
              {imagePath ? "Choose another image" : "Choose image"}
            </Button>

            <div
              aria-describedby="cover-writeback-framing-help"
              aria-labelledby="cover-writeback-framing-label"
              className="cover-writeback__framing"
              role="group"
            >
              <span id="cover-writeback-framing-label">Framing</span>
              <SegmentedControl
                ariaDescribedBy="cover-writeback-framing-help"
                label="Cover framing"
                onChange={changeFraming}
                options={framingOptions.map((option) => ({
                  ...option,
                  disabled: isWriting || book.isFileMissing,
                }))}
                value={framing}
              />
              <p id="cover-writeback-framing-help">
                {framing === "crop"
                  ? "Fills the cover frame and crops evenly from the center."
                  : "Keeps the full image and adds transparent or white padding."}
              </p>
            </div>

            {preparation ? (
              <dl className="cover-writeback__details">
                <div>
                  <dt>Image</dt>
                  <dd title={preparation.fileName}>{preparation.fileName}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {preparation.sourceWidth} × {preparation.sourceHeight} ·{" "}
                    {preparation.sourceFormat}
                  </dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>
                    {preparation.outputWidth} × {preparation.outputHeight} ·{" "}
                    {preparation.outputFormat}
                  </dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatFileSize(preparation.imageSize)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
