import { CheckCircle, ImageSquare, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import type {
  Book,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
} from "../../types/book";
import { formatFileSize } from "../../utils/formatters";
import { BookCover } from "./BookCover";
import { bookTitle } from "./libraryFilters";

type BookCoverWritebackDialogProps = {
  book: Book;
  onClose: () => void;
  onPrepareCover: (
    book: Book,
    imagePath: string,
    framing: EpubCoverFraming,
  ) => Promise<EpubCoverPreparation>;
  onWriteCover: (book: Book, input: EpubCoverWritebackInput) => Promise<EpubCoverWritebackResult>;
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
}: BookCoverWritebackDialogProps) {
  const [framing, setFraming] = useState<EpubCoverFraming>("crop");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<EpubCoverPreparation | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const preparationRequest = useRef(0);
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
    const requestId = preparationRequest.current + 1;
    preparationRequest.current = requestId;
    setIsPreparing(true);
    setError(null);
    setSuccess(false);
    setWarning(null);
    setConfirmed(false);

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
        setIsPreparing(false);
      }
    }
  }

  async function chooseImage() {
    if (isPreparing || isWriting) return;
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
      if (typeof selected !== "string") return;
      setImagePath(selected);
      await prepareCover(selected, framing);
    } catch (pickerError) {
      setError(coverErrorMessage(pickerError, "The image picker could not be opened."));
    }
  }

  function changeFraming(nextFraming: EpubCoverFraming) {
    setFraming(nextFraming);
    if (imagePath) void prepareCover(imagePath, nextFraming);
  }

  async function writeCover() {
    if (!imagePath || !preparation || !confirmed || isPreparing || isWriting) return;
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
      setSuccess(true);
      setConfirmed(false);
      setWarning(result.coverCacheWarning ?? null);
    } catch (writeError) {
      setError(coverErrorMessage(writeError, "The replacement cover could not be written."));
    } finally {
      setIsWriting(false);
    }
  }

  const canWrite = Boolean(
    imagePath && preparation && confirmed && !isPreparing && !isWriting && !book.isFileMissing,
  );
  const writeDisabledReason = book.isFileMissing
    ? "The EPUB file is missing."
    : !imagePath
      ? "Choose a cover image first."
      : isPreparing
        ? "Wait for the preview to finish."
        : !preparation
          ? "Prepare a valid cover image first."
          : !confirmed
            ? "Confirm the EPUB modification first."
            : undefined;

  return (
    <Dialog
      className="dialog--cover-writeback"
      closeOnBackdropClick={!isWriting}
      description="Review the final 2:3 cover frame, then confirm the EPUB modification. No separate app cover override is created."
      onClose={() => {
        if (!isWriting) onClose();
      }}
      title="Replace embedded cover"
      footer={
        <>
          <Button disabled={isWriting} onClick={onClose} variant="secondary">
            Close
          </Button>
          <Button
            disabled={!canWrite}
            onClick={() => void writeCover()}
            title={writeDisabledReason}
          >
            {isWriting ? "Writing cover" : "Write cover to EPUB"}
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
                  <ImageSquare aria-hidden="true" size={34} weight="thin" />
                  <span>{isPreparing ? "Preparing preview" : "Choose a cover image"}</span>
                </div>
              ) : null}
            </div>
            <span>{success ? "Saved embedded cover" : "Preview — not yet saved"}</span>
          </div>

          <div className="cover-writeback__controls" ref={recoveryControlsRef}>
            <Button
              disabled={isPreparing || isWriting || book.isFileMissing}
              icon={<UploadSimple aria-hidden="true" />}
              onClick={() => void chooseImage()}
              variant="secondary"
            >
              {imagePath ? "Choose another image" : "Choose image"}
            </Button>

            <div className="cover-writeback__framing">
              <span>Framing</span>
              <SegmentedControl
                label="Cover framing"
                onChange={changeFraming}
                options={framingOptions}
                value={framing}
              />
              <p>
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
                <div>
                  <dt>EPUB action</dt>
                  <dd>
                    {preparation.replacingExistingCover
                      ? "Replace active cover resource"
                      : "Add active cover resource"}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>

        {preparation && !success ? (
          <label className="cover-writeback__confirmation">
            <input
              checked={confirmed}
              disabled={isWriting}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I understand this writes into <strong>{book.fileName}</strong> and{" "}
              {preparation.replacingExistingCover ? "replaces" : "adds"} its embedded cover.
            </span>
          </label>
        ) : null}

        {book.isFileMissing ? (
          <p className="cover-writeback__status" data-tone="error" role="alert">
            <WarningCircle aria-hidden="true" size={17} />
            The EPUB file is missing. Cover writeback is unavailable.
          </p>
        ) : null}
        {error ? (
          <p className="cover-writeback__status" data-tone="error" role="alert">
            <WarningCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="cover-writeback__status" data-tone="success" role="status">
            <CheckCircle aria-hidden="true" size={17} weight="fill" />
            Cover written to EPUB.
          </p>
        ) : null}
        {warning ? (
          <p className="cover-writeback__status" data-tone="warning" role="status">
            <WarningCircle aria-hidden="true" size={17} />
            {warning}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
