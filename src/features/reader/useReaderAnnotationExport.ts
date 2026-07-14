import { useCallback, useMemo, useRef, useLayoutEffect } from "react";

import type { Book } from "../../types/book";
import type { Annotation } from "../../types/annotation";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import type { ReaderNavigationState } from "../../types/reader";
import type { ReaderAnnotationExportFormat } from "./readerAnnotationExport";
import { exportReaderAnnotationsToFile } from "./readerAnnotationExportFile";

type UseReaderAnnotationExportOptions = {
  annotations: readonly Annotation[];
  book?: Book;
  chapters: ReaderNavigationState["chapters"];
};

export function useReaderAnnotationExport({
  annotations,
  book,
  chapters,
}: UseReaderAnnotationExportOptions) {
  const annotationsRef = useRef(annotations);
  const bookRef = useRef(book);
  const chaptersRef = useRef(chapters);

  useLayoutEffect(() => {
    annotationsRef.current = annotations;
    bookRef.current = book;
    chaptersRef.current = chapters;
  }, [annotations, book, chapters]);

  const exportCurrentAnnotations = useCallback((format: ReaderAnnotationExportFormat) => {
    const currentBook = bookRef.current;
    if (!currentBook) return Promise.resolve({ status: "empty" } as const);
    return exportReaderAnnotationsToFile({
      books: [
        {
          annotations: annotationsRef.current,
          author: bookAuthor(currentBook),
          chapters: chaptersRef.current,
          id: currentBook.id,
          title: bookTitle(currentBook),
        },
      ],
      format,
    });
  }, []);

  return useMemo(() => ({ exportCurrentAnnotations }), [exportCurrentAnnotations]);
}
