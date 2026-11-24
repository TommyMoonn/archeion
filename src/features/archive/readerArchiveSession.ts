import { createContext, useContext, useMemo } from "react";

import { useArchive } from "./useArchive";

export type ReaderArchiveSession = Readonly<{
  archiveId: string | null;
  rootPath: string | null;
}>;

export const ReaderArchiveSessionContext = createContext<ReaderArchiveSession | null>(null);

export function useReaderArchiveSession(): ReaderArchiveSession {
  const override = useContext(ReaderArchiveSessionContext);
  const archive = useArchive();
  const archiveId = archive.status === "ready" ? archive.archive.id : null;
  const rootPath = archive.path;

  const current = useMemo(() => ({ archiveId, rootPath }), [archiveId, rootPath]);
  return override ?? current;
}
