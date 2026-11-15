import { createContext, useContext } from "react";
export type CopyRequest = (
  text: string | (() => string),
  trigger: HTMLButtonElement,
  kind?: "page" | "code",
) => Promise<void>;
export const ClipboardContext = createContext<{
  copy: CopyRequest;
  copyPage: (trigger: HTMLButtonElement) => void;
} | null>(null);
export function useDocsClipboard() {
  const copy = useContext(ClipboardContext);
  if (!copy) throw new Error("Code copying requires an article clipboard owner");
  return copy;
}
