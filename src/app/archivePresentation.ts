import { createContext, useContext } from "react";

import type { ArchiveState } from "../stores/archiveStore";

export const ArchivePresentationContext = createContext<{
  archive: Extract<ArchiveState, { status: "ready" }> | null;
  blocked: boolean;
} | null>(null);

export function useArchivePresentation() {
  return useContext(ArchivePresentationContext);
}
