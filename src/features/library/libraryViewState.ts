import { normalizeArchiveRelativePath } from "../../storage/pathSafety";
import type { Folder } from "../../types/folder";
import type { FolderBrowserView } from "../folders/FolderBrowser";
import type { LibraryLocation } from "./libraryFilters";
export type { FolderBrowserView } from "../folders/FolderBrowser";

const LIBRARY_VIEW_PARAM = "view";
const FOLDER_PATH_PARAM = "folderPath";
const FOLDER_BROWSER_VIEW_PARAM = "folderView";
const ARCHIVE_ID_PARAM = "archiveId";
const DEFAULT_LIBRARY_LOCATION: LibraryLocation = { type: "library" };
export const DEFAULT_FOLDER_BROWSER_VIEW: FolderBrowserView = "list";

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

function folderByRelativePath(folders: Folder[], folderPath: string | null): Folder | undefined {
  if (!folderPath) {
    return undefined;
  }

  return folders.find((folder) => normalizedFolderPathKey(folder.relativePath) === folderPath);
}

function folderPathForLocation(location: LibraryLocation, folders: Folder[]): string | null {
  if (location.type !== "folder") {
    return null;
  }

  return folders.find((folder) => folder.id === location.folderId)?.relativePath ?? null;
}

export function libraryLocationFromSearchParams(
  searchParams: URLSearchParams,
  folders: Folder[],
  activeArchiveId?: string,
): LibraryLocation {
  const urlArchiveId = searchParams.get(ARCHIVE_ID_PARAM);

  if (activeArchiveId && urlArchiveId && urlArchiveId !== activeArchiveId) {
    return DEFAULT_LIBRARY_LOCATION;
  }

  const view = searchParams.get(LIBRARY_VIEW_PARAM);

  switch (view) {
    case "favorites":
      return { type: "favorites" };
    case "continue":
      return { type: "continue" };
    case "folders":
      return { type: "folders" };
    case "folder": {
      const folderPath = normalizedFolderPathKey(searchParams.get(FOLDER_PATH_PARAM) ?? undefined);
      const folder = folderByRelativePath(folders, folderPath);

      return folder ? { type: "folder", folderId: folder.id } : DEFAULT_LIBRARY_LOCATION;
    }
    case "library":
    default:
      return DEFAULT_LIBRARY_LOCATION;
  }
}

export function folderBrowserViewFromSearchParams(
  searchParams: URLSearchParams,
): FolderBrowserView {
  return searchParams.get(FOLDER_BROWSER_VIEW_PARAM) === "cards"
    ? "cards"
    : DEFAULT_FOLDER_BROWSER_VIEW;
}

export function searchParamsForLibraryLocation(
  currentParams: URLSearchParams,
  location: LibraryLocation,
  folders: Folder[],
  activeArchiveId?: string,
): URLSearchParams {
  const nextParams = new URLSearchParams(currentParams);

  if (activeArchiveId) {
    nextParams.set(ARCHIVE_ID_PARAM, activeArchiveId);
  }
  nextParams.delete(FOLDER_PATH_PARAM);

  if (location.type === "folder") {
    const folderPath = folderPathForLocation(location, folders);

    if (!folderPath) {
      nextParams.set(LIBRARY_VIEW_PARAM, "library");
      return nextParams;
    }

    nextParams.set(LIBRARY_VIEW_PARAM, "folder");
    nextParams.set(FOLDER_PATH_PARAM, folderPath);
    nextParams.delete(FOLDER_BROWSER_VIEW_PARAM);
    return nextParams;
  }

  nextParams.set(LIBRARY_VIEW_PARAM, location.type);

  if (location.type !== "folders") {
    nextParams.delete(FOLDER_BROWSER_VIEW_PARAM);
  }

  return nextParams;
}

export function searchParamsForFolderBrowserView(
  currentParams: URLSearchParams,
  view: FolderBrowserView,
): URLSearchParams {
  const nextParams = new URLSearchParams(currentParams);

  if (view === DEFAULT_FOLDER_BROWSER_VIEW) {
    nextParams.delete(FOLDER_BROWSER_VIEW_PARAM);
  } else {
    nextParams.set(FOLDER_BROWSER_VIEW_PARAM, view);
  }

  return nextParams;
}
