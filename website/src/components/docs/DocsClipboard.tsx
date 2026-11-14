import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

import { ClipboardContext, type CopyRequest } from "./useDocsClipboard";

export function DocsClipboard({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [message, setMessage] = useState("");
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const copy: CopyRequest = async (text, opener) => {
    const request = ++generation.current;
    trigger.current = opener;
    setMessage("Copying code…");
    try {
      await navigator.clipboard.writeText(text);
      if (request === generation.current) setMessage("Code copied.");
    } catch {
      if (request === generation.current) setMessage("Could not copy code. Try Copy code again.");
    }
  };
  return (
    <ClipboardContext.Provider value={copy}>
      {children}
      <div
        className={cn(
          "fixed end-5 bottom-5 z-header flex max-w-[calc(100%-40px)] box-border items-center gap-3 text-sm text-content-muted",
          message &&
            "rounded-button border border-solid border-border-strong bg-surface-raised px-4 py-3",
        )}
      >
        <span role="status" aria-live="polite" aria-atomic="true">
          {message}
        </span>
        {message && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss copy status"
            onClick={() => {
              generation.current++;
              setMessage("");
              if (trigger.current?.isConnected) trigger.current.focus();
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </ClipboardContext.Provider>
  );
}
