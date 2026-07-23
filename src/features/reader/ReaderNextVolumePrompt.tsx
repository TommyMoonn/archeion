import { ArrowRight } from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import type { Book } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";

type ReaderNextVolumePromptProps = {
  book: Book;
  onOpen: () => void;
};

export function ReaderNextVolumePrompt({ book, onOpen }: ReaderNextVolumePromptProps) {
  const title = bookTitle(book);
  const volume = book.sourceMetadata?.volume?.trim();

  return (
    <aside aria-label="Next volume" className="reader-next-volume">
      <div className="reader-next-volume__copy">
        <span>{volume ? `Next volume · ${volume}` : "Next volume"}</span>
        <strong title={title}>{title}</strong>
      </div>
      <Button
        disabled={Boolean(book.isFileMissing)}
        disabledReason={book.isFileMissing ? "The EPUB file is missing." : undefined}
        icon={<ArrowRight aria-hidden="true" weight="bold" />}
        onClick={onOpen}
        size="standard"
        variant="secondary"
      >
        Open next volume
      </Button>
    </aside>
  );
}
