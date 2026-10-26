import { Image, Upload } from "lucide-react";
import type { Ref } from "react";
import { Button } from "../../components/Button";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ReadonlyBook, EpubCoverFraming, EpubCoverPreparation } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookTitle } from "./libraryFilters";
import { formatFileSize } from "../../utils/formatters";
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
    <div className="cover-writeback">
      <div className="cover-writeback__book">
        {skeleton ? (
          <div className="book-cover cover-writeback__current-cover" />
        ) : (
          <BookCover book={book} className="cover-writeback__current-cover" />
        )}
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
  );
}
