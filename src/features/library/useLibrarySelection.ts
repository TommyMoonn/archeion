import { useCallback, useMemo, useState } from "react";

import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import {
  clearLibrarySelection,
  createLibrarySelectionState,
  deselectVisibleLibraryBooks,
  enterLibrarySelectionMode,
  exitLibrarySelectionMode,
  reconcileLibrarySelection,
  retainLibraryBookSelection,
  selectVisibleLibraryBooks,
  toggleLibraryBookSelection,
  type LibrarySelectionIntent,
} from "./librarySelection";

export function useLibrarySelection(books: readonly LibrarySnapshotBook[] | undefined) {
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
    (
      book: LibrarySnapshotBook,
      intent: LibrarySelectionIntent,
      visibleBooks: readonly LibrarySnapshotBook[],
    ) => {
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
    (visibleBooks: readonly LibrarySnapshotBook[]) => {
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
    (visibleBooks: readonly LibrarySnapshotBook[]) => {
      setState((current) =>
        deselectVisibleLibraryBooks(
          reconcileLibrarySelection(current, availableBookIds),
          visibleBooks.map((book) => book.id),
        ),
      );
    },
    [availableBookIds],
  );
  const retain = useCallback((bookIds: ReadonlySet<string>) => {
    setState((current) => retainLibraryBookSelection(current, bookIds));
  }, []);

  return {
    clear,
    deselectVisible,
    enterMode,
    exitMode,
    selectVisible,
    retain,
    selectionMode: reconciledState.mode,
    selectedBookIds: reconciledState.selectedBookIds,
    toggleBook,
  };
}
