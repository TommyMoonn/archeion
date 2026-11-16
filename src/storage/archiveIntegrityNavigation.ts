import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ActiveArchiveScope } from "./archiveReconciliation";

export const ARCHIVE_INTEGRITY_REQUESTED_EVENT = "archive-integrity-requested";
export type ArchiveIntegrityDestination = "duplicates" | "epub-issues";
export type ArchiveIntegrityNavigationRequest = Readonly<{
  archiveId: string;
  rootPath: string;
  requestId: string;
  destination: ArchiveIntegrityDestination;
}>;

export function archiveIntegrityNavigationPath(
  request: ArchiveIntegrityNavigationRequest,
  active: ActiveArchiveScope,
): string | null {
  if (
    !active ||
    request.archiveId !== active.archiveId ||
    request.rootPath !== active.rootPath ||
    !request.requestId ||
    (request.destination !== "duplicates" && request.destination !== "epub-issues")
  ) {
    return null;
  }
  return `/?${new URLSearchParams({
    archiveId: request.archiveId,
    view: request.destination,
    integrityRequest: request.requestId,
  })}`;
}

export async function listenForArchiveIntegrityRequests(
  getActiveArchive: () => ActiveArchiveScope,
  navigate: (path: string) => void,
  subscribe: typeof listen = listen,
): Promise<UnlistenFn> {
  return subscribe<ArchiveIntegrityNavigationRequest>(
    ARCHIVE_INTEGRITY_REQUESTED_EVENT,
    (event) => {
      const path = archiveIntegrityNavigationPath(event.payload, getActiveArchive());
      if (path) navigate(path);
    },
  );
}
