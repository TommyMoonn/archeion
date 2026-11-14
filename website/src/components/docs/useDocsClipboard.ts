import { createContext, useContext } from "react";
export type CopyRequest = (text: string, trigger: HTMLButtonElement) => Promise<void>;
export const ClipboardContext = createContext<CopyRequest | null>(null);
export function useDocsClipboard() {
  const copy = useContext(ClipboardContext);
  if (!copy) throw new Error("Code copying requires an article clipboard owner");
  return copy;
}
