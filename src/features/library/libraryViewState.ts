import { normalizeArchiveRelativePath } from "../../storage/pathSafety";
import type { ReadonlyFolder } from "../../types/folder";
import type { LibraryLocation, LibrarySmartViewPreferences } from "../../types/library";
import {
  isLibrarySmartView,
  isLibrarySmartViewVisible,
  normalizeVisibleLibraryLocation,
} from "../../types/librarySmartViews";
import {
  rewriteFolderPathForMutation,
  type FolderPathMutationMapping,
} from "./folderPathMutationContinuity";

const LIBRARY_VIEW_PARAM = "view";
const FOLDER_PATH_PARAM = "folderPath";
const SERIES_KEY_PARAM = "seriesKey";
const SMART_VIEW_PARAM = "smartView";
const ARCHIVE_ID_PARAM = "archiveId";
const DEFAULT_LIBRARY_LOCATION: LibraryLocation = { type: "library" };

function normalizedFolderPathKey(path: string | undefined): string | null {
  if (!path?.trim()) {
    return null;
  }

  try {
    return normalizeArchiveRelativePath(path).toLocaleLowerCase();
  } catch {
    return null;
  }
}

function folderByRelativePath(
  folders: readonly ReadonlyFolder[],
  folderPath: string | null,
): ReadonlyFolder | undefined {
  if (!folderPath) {
    return undefined;
  }

  return folders.find((folder) => normalizedFolderPathKey(folder.relativePath) === folderPath);
}

function folderPathForLocation(
  location: LibraryLocation,
  folders: readonly ReadonlyFolder[],
): string | null {
  if (location.type !== "folder") {
    return null;
  }

  return folders.find((folder) => folder.id === location.folderId)?.relativePath ?? null;
}

export function libraryLocationFromSearchParams(
  searchParams: URLSearchParams,
  folders: readonly ReadonlyFolder[],
  activeArchiveId?: string,
  smartViewPreferences?: LibrarySmartViewPreferences,
  pendingFolderPathMutation?: FolderPathMutationMapping | null,
): LibraryLocation {
  const urlArchiveId = searchParams.get(ARCHIVE_ID_PARAM);

  if (activeArchiveId && urlArchiveId && urlArchiveId !== activeArchiveId) {
    return DEFAULT_LIBRARY_LOCATION;
  }

  const view = searchParams.get(LIBRARY_VIEW_PARAM);

  switch (view) {
    case "duplicates":
      return { type: "duplicates" };
    case "epub-issues":
      return { type: "epub-issues" };
    case "favorites":
      return { type: "favorites" };
    case "smart": {
      const smartView = searchParams.get(SMART_VIEW_PARAM);
      const location: LibraryLocation = isLibrarySmartView(smartView)
        ? { type: "smart-view", smartView }
        : DEFAULT_LIBRARY_LOCATION;
      return smartViewPreferences
        ? normalizeVisibleLibraryLocation(location, smartViewPreferences)
        : location;
    }
    case "continue": {
      const location: LibraryLocation = { type: "continue" };
      return smartViewPreferences
        ? normalizeVisibleLibraryLocation(location, smartViewPreferences)
        : location;
    }
    case "folders":
      return { type: "folders" };
    case "series": {
      const seriesKey = searchParams.get(SERIES_KEY_PARAM)?.trim();
      return seriesKey ? { type: "series-detail", seriesKey } : { type: "series" };
    }
    case "folder": {
      const folderPath = normalizedFolderPathKey(searchParams.get(FOLDER_PATH_PARAM) ?? undefined);
      const directFolder = folderByRelativePath(folders, folderPath);
      const rewrittenFolderPath = pendingFolderPathMutation
        ? rewriteFolderPathForMutation(
            searchParams.get(FOLDER_PATH_PARAM) ?? undefined,
            pendingFolderPathMutation,
          )
        : null;
      const folder =
        directFolder ??
        folderByRelativePath(folders, normalizedFolderPathKey(rewrittenFolderPath ?? undefined));

      return folder ? { type: "folder", folderId: folder.id } : DEFAULT_LIBRARY_LOCATION;
    }
    case "library":
    default:
      return DEFAULT_LIBRARY_LOCATION;
  }
}

export function searchParamsForLibraryLocation(
  currentParams: URLSearchParams,
  location: LibraryLocation,
  folders: readonly ReadonlyFolder[],
  activeArchiveId?: string,
  smartViewPreferences?: LibrarySmartViewPreferences,
): URLSearchParams {
  const nextParams = new URLSearchParams(currentParams);
  const visibleLocation = smartViewPreferences
    ? normalizeVisibleLibraryLocation(location, smartViewPreferences)
    : location;

  if (activeArchiveId) {
    nextParams.set(ARCHIVE_ID_PARAM, activeArchiveId);
  }
  nextParams.delete(FOLDER_PATH_PARAM);
  nextParams.delete("folderView");
  nextParams.delete(SERIES_KEY_PARAM);
  nextParams.delete(SMART_VIEW_PARAM);

  if (visibleLocation.type === "folder") {
    const folderPath = folderPathForLocation(visibleLocation, folders);

    if (!folderPath) {
      nextParams.set(LIBRARY_VIEW_PARAM, "library");
      return nextParams;
    }

    nextParams.set(LIBRARY_VIEW_PARAM, "folder");
    nextParams.set(FOLDER_PATH_PARAM, folderPath);
    return nextParams;
  }

  if (visibleLocation.type === "series-detail") {
    nextParams.set(LIBRARY_VIEW_PARAM, "series");
    nextParams.set(SERIES_KEY_PARAM, visibleLocation.seriesKey);
    return nextParams;
  }

  if (visibleLocation.type === "smart-view") {
    nextParams.set(LIBRARY_VIEW_PARAM, "smart");
    nextParams.set(SMART_VIEW_PARAM, visibleLocation.smartView);
    return nextParams;
  }

  nextParams.set(LIBRARY_VIEW_PARAM, visibleLocation.type);

  return nextParams;
}

export function hiddenSmartViewFallbackSearchParams(
  currentParams: URLSearchParams,
  smartViewPreferences: LibrarySmartViewPreferences,
  activeArchiveId?: string,
): URLSearchParams | null {
  const view = currentParams.get(LIBRARY_VIEW_PARAM);
  const requestedSmartView = currentParams.get(SMART_VIEW_PARAM);
  const smartView =
    view === "continue"
      ? "in-progress"
      : view === "smart" && isLibrarySmartView(requestedSmartView)
        ? requestedSmartView
        : null;

  if (!smartView || isLibrarySmartViewVisible(smartViewPreferences, smartView)) {
    return null;
  }

  return searchParamsForLibraryLocation(
    currentParams,
    DEFAULT_LIBRARY_LOCATION,
    [],
    activeArchiveId,
  );
}
