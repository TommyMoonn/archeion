import { useMemo } from "react";

import { useArchive } from "./useArchive";

export type ReaderArchiveSession = Readonly<{
  archiveId: string | null;
  rootPath: string | null;
}>;

export function useReaderArchiveSession(): ReaderArchiveSession {
  const archive = useArchive();
  const archiveId = archive.status === "ready" ? archive.archive.id : null;
  const rootPath = archive.path;

  return useMemo(() => ({ archiveId, rootPath }), [archiveId, rootPath]);
}
