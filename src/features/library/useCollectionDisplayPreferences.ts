import { useCallback } from "react";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { FolderBrowserView, FolderSort, LibraryView, SeriesSort } from "../../types/library";

type UseCollectionDisplayPreferencesInput = {
  showLibraryError: (title: string) => void;
};

export function useCollectionDisplayPreferences({
  showLibraryError,
}: UseCollectionDisplayPreferencesInput) {
  const changeFolderSort = useCallback(
    (sortBy: FolderSort) => {
      void appPreferencesStore
        .updateLibraryCollection("folders", { sortBy })
        .catch(() => showLibraryError("Folder preferences could not be saved."));
    },
    [showLibraryError],
  );

  const changeFolderView = useCallback(
    (viewMode: FolderBrowserView) => {
      void appPreferencesStore
        .updateLibraryCollection("folders", { viewMode })
        .catch(() => showLibraryError("Folder preferences could not be saved."));
    },
    [showLibraryError],
  );

  const changeSeriesSort = useCallback(
    (sortBy: SeriesSort) => {
      void appPreferencesStore
        .updateLibraryCollection("series", { sortBy })
        .catch(() => showLibraryError("Series preferences could not be saved."));
    },
    [showLibraryError],
  );

  const changeSeriesView = useCallback(
    (viewMode: LibraryView) => {
      void appPreferencesStore
        .updateLibraryCollection("series", { viewMode })
        .catch(() => showLibraryError("Series preferences could not be saved."));
    },
    [showLibraryError],
  );

  return {
    changeFolderSort,
    changeFolderView,
    changeSeriesSort,
    changeSeriesView,
  };
}
