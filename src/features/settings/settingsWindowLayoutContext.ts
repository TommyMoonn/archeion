import { createContext, type RefObject } from "react";

export const SettingsWindowLayoutContext = createContext<{
  navigationHost: HTMLDivElement | null;
  contentRef: RefObject<HTMLElement | null>;
} | null>(null);
