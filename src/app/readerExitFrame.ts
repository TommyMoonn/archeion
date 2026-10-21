import { createContext, type Dispatch, type SetStateAction } from "react";
import type { ResolvedReaderTheme } from "../themes/domain";

export type ReaderExitFrame = Readonly<{ theme: ResolvedReaderTheme; toolbarExpanded: boolean }>;

// Presentation metadata only. The destination clears it when its shell mounts.
export const ReaderExitFrameContext = createContext<{
  frame: ReaderExitFrame | null;
  setFrame: Dispatch<SetStateAction<ReaderExitFrame | null>>;
} | null>(null);
