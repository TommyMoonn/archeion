import { createContext, type RefObject } from "react";

/** A loaded domain panel contributes content/actions to the frame already shown on click. */
export const ReaderPanelFrameContext = createContext<{
  actionsHost: HTMLSpanElement | null;
  focusInitialTarget: (target: HTMLElement | null) => boolean;
  panelRef: RefObject<HTMLElement | null>;
} | null>(null);
