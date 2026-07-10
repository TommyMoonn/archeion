export type LibrarySelectionState = {
  anchorBookId?: string;
  mode: boolean;
  selectedBookIds: ReadonlySet<string>;
};

export type LibrarySelectionIntent = {
  range: boolean;
};

export function createLibrarySelectionState(): LibrarySelectionState {
  return { mode: false, selectedBookIds: new Set() };
}

export function enterLibrarySelectionMode(state: LibrarySelectionState): LibrarySelectionState {
  return state.mode ? state : { ...state, mode: true };
}

export function exitLibrarySelectionMode(): LibrarySelectionState {
  return createLibrarySelectionState();
}

export function clearLibrarySelection(state: LibrarySelectionState): LibrarySelectionState {
  if (state.selectedBookIds.size === 0 && state.anchorBookId === undefined) return state;
  return { mode: state.mode, selectedBookIds: new Set() };
}

export function toggleLibraryBookSelection(
  state: LibrarySelectionState,
  bookId: string,
  orderedBookIds: readonly string[],
  intent: LibrarySelectionIntent,
): LibrarySelectionState {
  const selectedBookIds = new Set(state.selectedBookIds);
  const anchorIndex = state.anchorBookId ? orderedBookIds.indexOf(state.anchorBookId) : -1;
  const targetIndex = orderedBookIds.indexOf(bookId);

  if (intent.range && anchorIndex >= 0 && targetIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    for (let index = start; index <= end; index += 1) {
      const rangeBookId = orderedBookIds[index];
      if (rangeBookId) selectedBookIds.add(rangeBookId);
    }

    return {
      anchorBookId: state.anchorBookId,
      mode: true,
      selectedBookIds,
    };
  }

  if (selectedBookIds.has(bookId)) {
    selectedBookIds.delete(bookId);
  } else {
    selectedBookIds.add(bookId);
  }

  return { anchorBookId: bookId, mode: true, selectedBookIds };
}

export function selectVisibleLibraryBooks(
  state: LibrarySelectionState,
  visibleBookIds: readonly string[],
): LibrarySelectionState {
  const selectedBookIds = new Set(state.selectedBookIds);
  for (const bookId of visibleBookIds) selectedBookIds.add(bookId);

  return {
    anchorBookId: state.anchorBookId ?? visibleBookIds.at(-1),
    mode: true,
    selectedBookIds,
  };
}

export function deselectVisibleLibraryBooks(
  state: LibrarySelectionState,
  visibleBookIds: readonly string[],
): LibrarySelectionState {
  const selectedBookIds = new Set(state.selectedBookIds);
  for (const bookId of visibleBookIds) selectedBookIds.delete(bookId);

  return {
    ...(state.anchorBookId && selectedBookIds.has(state.anchorBookId)
      ? { anchorBookId: state.anchorBookId }
      : {}),
    mode: true,
    selectedBookIds,
  };
}

export function reconcileLibrarySelection(
  state: LibrarySelectionState,
  availableBookIds: ReadonlySet<string>,
): LibrarySelectionState {
  const selectedBookIds = new Set(
    [...state.selectedBookIds].filter((bookId) => availableBookIds.has(bookId)),
  );
  const anchorBookId =
    state.anchorBookId && availableBookIds.has(state.anchorBookId) ? state.anchorBookId : undefined;

  if (selectedBookIds.size === state.selectedBookIds.size && anchorBookId === state.anchorBookId) {
    return state;
  }

  return {
    ...(anchorBookId ? { anchorBookId } : {}),
    mode: state.mode,
    selectedBookIds,
  };
}
