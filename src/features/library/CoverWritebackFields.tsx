import { Image, Upload } from "lucide-react";
import type { Ref } from "react";
import { Button } from "../../components/Button";
import { FieldLabel } from "../../components/ui/field";
import { Skeleton } from "../../components/ui/skeleton";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ReadonlyBook, EpubCoverFraming, EpubCoverPreparation } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookTitle } from "./libraryFilters";
import { formatFileSize } from "../../utils/formatters";
const thumbnailClass = "w-cover-editor-thumbnail min-w-cover-editor-thumbnail rounded-small";
const detailRowClass =
  "grid cover-editor-detail-columns gap-dialog-gap-narrow border-b-line py-control-gap";

const framingOptions = [
  { label: "Crop", value: "crop" },
  { label: "Fit", value: "fit" },
] satisfies Array<{ label: string; value: EpubCoverFraming }>;

export function CoverWritebackFields({
  book,
  previewUrl = null,
  isPreparing = false,
  isWriting = false,
  imagePath = null,
  framing = "crop",
  preparation = null,
  recoveryControlsRef,
  chooseImage,
  changeFraming,
  skeleton = false,
}: {
  book: ReadonlyBook;
  previewUrl?: string | null;
  isPreparing?: boolean;
  isWriting?: boolean;
  imagePath?: string | null;
  framing?: EpubCoverFraming;
  preparation?: EpubCoverPreparation | null;
  recoveryControlsRef?: Ref<HTMLDivElement>;
  chooseImage: () => Promise<void>;
  changeFraming: (value: EpubCoverFraming) => void;
  skeleton?: boolean;
}) {
  return (
    <div className="grid min-h-0 gap-cover-editor">
      <div
        data-slot="cover-editor-book"
        className="grid min-w-0 cover-editor-book-columns items-center gap-dialog-gap-narrow rounded-menu border-standard border-solid border-line bg-dialog-subtle px-dialog-gap-narrow py-dialog-copy"
      >
        {skeleton ? (
          <Skeleton
            className={`book-cover relative aspect-book-cover overflow-hidden border-standard border-solid border-line shadow-app-card ${thumbnailClass}`}
          />
        ) : (
          <BookCover book={book} className={thumbnailClass} />
        )}
        <div className="grid min-w-0 gap-cover-editor-copy">
          <FieldLabel className="leading-inherit tracking-cover-editor-label">Book</FieldLabel>
          <strong className="truncate text-body-only text-text-strong">{bookTitle(book)}</strong>
          <small
            className="truncate text-caption-size tracking-cover-editor-label text-muted"
            title={book.relativePath ?? book.fileName}
          >
            {book.relativePath ?? book.fileName}
          </small>
        </div>
      </div>

      <section className="grid min-w-0 cover-editor-workspace-columns items-start gap-cover-editor-column cover-editor-narrow:grid-cols-1">
        <div className="grid content-start justify-items-start gap-control-gap">
          <div
            data-slot="cover-editor-preview"
            className="relative grid w-full max-w-cover-preview aspect-book-cover place-items-center overflow-hidden rounded-menu border-standard border-solid border-line cover-preview-checker shadow-app-card data-loading:opacity-70 cover-editor-narrow:max-w-cover-preview-narrow"
            data-loading={isPreparing || undefined}
          >
            {previewUrl ? (
              <img
                alt="Final replacement cover preview"
                className="size-full object-contain"
                src={previewUrl}
              />
            ) : null}
            {!previewUrl ? (
              <div className="grid justify-items-center gap-cover-preview-label p-dialog-gap text-center text-caption-size text-muted">
                <Image aria-hidden="true" className="size-cover-preview-glyph" strokeWidth={1.5} />
                <span>{isPreparing ? "Preparing preview" : "Choose a cover image"}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div
          data-slot="cover-editor-controls"
          className="grid min-w-0 content-start gap-cover-editor-controls"
          ref={recoveryControlsRef}
        >
          <Button
            className="justify-self-start"
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
            className="grid gap-field-label"
            role="group"
          >
            <FieldLabel
              className="leading-inherit tracking-cover-editor-label"
              id="cover-writeback-framing-label"
            >
              Framing
            </FieldLabel>
            <SegmentedControl
              ariaDescribedBy="cover-writeback-framing-help"
              className="justify-self-start"
              label="Cover framing"
              onChange={changeFraming}
              options={framingOptions.map((option) => ({
                ...option,
                disabled: isWriting || book.isFileMissing,
              }))}
              value={framing}
            />
            <p
              className="m-0 text-caption-size leading-field-compact text-muted"
              id="cover-writeback-framing-help"
            >
              {framing === "crop"
                ? "Fills the cover frame and crops evenly from the center."
                : "Keeps the full image and adds transparent or white padding."}
            </p>
          </div>

          {preparation ? (
            <dl className="m-0 grid border-t-line [&_dt]:m-0 [&_dt]:min-w-0 [&_dt]:text-muted [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:truncate [&_dd]:text-end [&_dd]:text-text [&_:is(dt,dd)]:text-caption-size">
              <div className={detailRowClass}>
                <dt>Image</dt>
                <dd title={preparation.fileName}>{preparation.fileName}</dd>
              </div>
              <div className={detailRowClass}>
                <dt>Source</dt>
                <dd>
                  {preparation.sourceWidth} × {preparation.sourceHeight} ·{" "}
                  {preparation.sourceFormat}
                </dd>
              </div>
              <div className={detailRowClass}>
                <dt>Output</dt>
                <dd>
                  {preparation.outputWidth} × {preparation.outputHeight} ·{" "}
                  {preparation.outputFormat}
                </dd>
              </div>
              <div className={detailRowClass}>
                <dt>Size</dt>
                <dd>{formatFileSize(preparation.imageSize)}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>
    </div>
  );
}
