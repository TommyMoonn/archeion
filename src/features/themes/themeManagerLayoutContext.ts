import { createContext } from "react";

export const ThemeManagerLayoutContext = createContext<{
  toolbarHost: HTMLDivElement | null;
  noticeHost: HTMLDivElement | null;
  catalogHost: HTMLDivElement | null;
  previewHost: HTMLDivElement | null;
} | null>(null);
