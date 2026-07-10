import { useCallback, useMemo, useState } from "react";

import type { Book } from "../../types/book";
import {
  clearLibrarySelection,
  createLibrarySelectionState,
  deselectVisibleLibraryBooks,
  enterLibrarySelectionMode,
  exitLibrarySelectionMode,
  reconcileLibrarySelection,
  selectVisibleLibraryBooks,
  toggleLibraryBookSelection,
  type LibrarySelectionIntent,
} from "./librarySelection";

export function useLibrarySelection(books: Book[] | undefined) {
  const [state, setState] = useState(createLibrarySelectionState);
  const availableBookIds = useMemo(() => new Set((books ?? []).map((book) => book.id)), [books]);
  const reconciledState = useMemo(
    () => reconcileLibrarySelection(state, availableBookIds),
    [availableBookIds, state],
  );

  const enterMode = useCallback(() => {
    setState(enterLibrarySelectionMode);
  }, []);
  const exitMode = useCallback(() => {
    setState(exitLibrarySelectionMode());
  }, []);
  const clear = useCallback(() => {
    setState(clearLibrarySelection);
  }, []);
  const toggleBook = useCallback(
    (book: Book, intent: LibrarySelectionIntent, visibleBooks: readonly Book[]) => {
      const orderedBookIds = visibleBooks.map((visibleBook) => visibleBook.id);
      setState((current) =>
        toggleLibraryBookSelection(
          reconcileLibrarySelection(current, availableBookIds),
          book.id,
          orderedBookIds,
          intent,
        ),
      );
    },
    [availableBookIds],
  );
  const selectVisible = useCallback(
    (visibleBooks: readonly Book[]) => {
      setState((current) =>
        selectVisibleLibraryBooks(
          reconcileLibrarySelection(current, availableBookIds),
          visibleBooks.map((book) => book.id),
        ),
      );
    },
    [availableBookIds],
  );
  const deselectVisible = useCallback(
    (visibleBooks: readonly Book[]) => {
      setState((current) =>
        deselectVisibleLibraryBooks(
          reconcileLibrarySelection(current, availableBookIds),
          visibleBooks.map((book) => book.id),
        ),
      );
    },
    [availableBookIds],
  );

  return {
    clear,
    deselectVisible,
    enterMode,
    exitMode,
    selectVisible,
    selectionMode: reconciledState.mode,
    selectedBookIds: reconciledState.selectedBookIds,
    toggleBook,
  };
}
