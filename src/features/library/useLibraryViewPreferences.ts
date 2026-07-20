import { useCallback } from "react";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { LibraryFilterState, LibrarySort, LibraryView } from "../../types/library";

type UseLibraryViewPreferencesInput = {
  showLibraryError: (title: string) => void;
};

export function useLibraryViewPreferences({ showLibraryError }: UseLibraryViewPreferencesInput) {
  const changeSort = useCallback(
    (nextSort: LibrarySort) => {
      void appPreferencesStore
        .updateLibraryCollection("books", { sortBy: nextSort })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [showLibraryError],
  );

  const changeView = useCallback(
    (nextView: LibraryView) => {
      void appPreferencesStore
        .updateLibraryCollection("books", { viewMode: nextView })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [showLibraryError],
  );

  const changeFilters = useCallback(
    (nextFilters: LibraryFilterState) => {
      void appPreferencesStore
        .updateLibrary({ filters: nextFilters })
        .catch(() => showLibraryError("Library filters could not be saved."));
    },
    [showLibraryError],
  );

  return { changeFilters, changeSort, changeView };
}
