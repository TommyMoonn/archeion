import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { Book } from "../../types/book";
import { bookSourceAuthor, bookSourceTitle } from "../../utils/bookDisplay";

type BookMetadataReferenceDialogProps = {
  book: Book;
  onClose: () => void;
};

function metadataValue(value: string | undefined): string {
  return value?.trim() || "—";
}

export function BookMetadataReferenceDialog({
  book,
  onClose,
}: BookMetadataReferenceDialogProps) {
  return (
    <Dialog
      title="View metadata"
      onClose={onClose}
      footer={
        <Button onClick={onClose} variant="secondary">
          Close
        </Button>
      }
    >
      <dl className="metadata-reference">
        <div>
          <dt>Title</dt>
          <dd>{bookSourceTitle(book)}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{bookSourceAuthor(book)}</dd>
        </div>
        <div>
          <dt>Identifier</dt>
          <dd>{metadataValue(book.sourceMetadata?.identifier)}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{metadataValue(book.sourceMetadata?.language)}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{book.fileName}</dd>
        </div>
      </dl>
    </Dialog>
  );
}
