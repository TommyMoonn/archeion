import { normalizeArchiveRelativePath } from "../../storage/pathSafety";
import type { ReadonlyFolder } from "../../types/folder";
import type { LibraryLocation } from "../../types/library";
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
): URLSearchParams {
  const nextParams = new URLSearchParams(currentParams);

  if (activeArchiveId) {
    nextParams.set(ARCHIVE_ID_PARAM, activeArchiveId);
  }
  nextParams.delete(FOLDER_PATH_PARAM);
  nextParams.delete("folderView");
  if (location.type !== "duplicates" && location.type !== "epub-issues") {
    nextParams.delete("integrityRequest");
  }
  nextParams.delete(SERIES_KEY_PARAM);
  nextParams.delete(SMART_VIEW_PARAM);

  if (location.type === "folder") {
    const folderPath = folderPathForLocation(location, folders);

    if (!folderPath) {
      nextParams.set(LIBRARY_VIEW_PARAM, "library");
      return nextParams;
    }

    nextParams.set(LIBRARY_VIEW_PARAM, "folder");
    nextParams.set(FOLDER_PATH_PARAM, folderPath);
    return nextParams;
  }

  if (location.type === "series-detail") {
    nextParams.set(LIBRARY_VIEW_PARAM, "series");
    nextParams.set(SERIES_KEY_PARAM, location.seriesKey);
    return nextParams;
  }

  nextParams.set(LIBRARY_VIEW_PARAM, location.type);

  return nextParams;
}

export function legacyLibraryFallbackSearchParams(
  currentParams: URLSearchParams,
  activeArchiveId?: string,
): URLSearchParams | null {
  const view = currentParams.get(LIBRARY_VIEW_PARAM);
  if (view !== "smart" && view !== "continue") return null;
  return searchParamsForLibraryLocation(
    currentParams,
    DEFAULT_LIBRARY_LOCATION,
    [],
    activeArchiveId,
  );
}
