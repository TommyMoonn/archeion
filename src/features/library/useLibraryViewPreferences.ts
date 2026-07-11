import { useCallback } from "react";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { LibraryFilterState, LibrarySort } from "../../types/library";
import type { LibraryDisplaySettings } from "../../types/settings";
import type { LibraryView } from "./LibraryToolbar";

type UseLibraryViewPreferencesInput = {
  preferences: LibraryDisplaySettings;
  showLibraryError: (title: string) => void;
};

export function useLibraryViewPreferences({
  preferences,
  showLibraryError,
}: UseLibraryViewPreferencesInput) {
  const changeSort = useCallback(
    (nextSort: LibrarySort) => {
      void appPreferencesStore
        .update({ library: { ...preferences, sortBy: nextSort } })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [preferences, showLibraryError],
  );

  const changeView = useCallback(
    (nextView: LibraryView) => {
      void appPreferencesStore
        .update({ library: { ...preferences, viewMode: nextView } })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [preferences, showLibraryError],
  );

  const changeFilters = useCallback(
    (nextFilters: LibraryFilterState) => {
      void appPreferencesStore
        .update({ library: { ...preferences, filters: nextFilters } })
        .catch(() => showLibraryError("Library filters could not be saved."));
    },
    [preferences, showLibraryError],
  );

  return { changeFilters, changeSort, changeView };
}
