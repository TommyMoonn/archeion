import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { serializeArticle } from "./serializeArticle";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

import { ClipboardContext, type CopyRequest } from "./useDocsClipboard";

export function DocsClipboard({
  children,
  articleRef,
}: {
  children: ReactNode;
  articleRef: RefObject<HTMLElement | null>;
}) {
  const generation = useRef(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dismiss = useRef<HTMLButtonElement | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [message, setMessage] = useState("");
  useEffect(
    () => () => {
      generation.current++;
      clearTimeout(timeout.current);
    },
    [],
  );
  const copy: CopyRequest = async (text, opener, kind = "code") => {
    const request = ++generation.current;
    clearTimeout(timeout.current);
    trigger.current = opener;
    setMessage(`Copying ${kind}…`);
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      if (request === generation.current)
        setMessage(kind === "page" ? "Page copied as Markdown." : "Code copied.");
    } catch {
      if (request === generation.current)
        setMessage(`Could not copy ${kind}. Try Copy ${kind} again.`);
    }
    if (request === generation.current) {
      timeout.current = setTimeout(() => {
        setMessage("");
        // Removing the focused dismiss control must not strand keyboard focus.
        if (document.activeElement === dismiss.current && trigger.current?.isConnected)
          trigger.current.focus();
      }, 6000);
    }
  };
  return (
    <ClipboardContext.Provider
      value={{
        copy,
        copyPage: (opener) => {
          void copy(
            () => {
              if (!articleRef.current) throw new Error("Article is no longer available");
              return serializeArticle(articleRef.current);
            },
            opener,
            "page",
          );
        },
      }}
    >
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
            ref={dismiss}
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss copy status"
            onClick={() => {
              generation.current++;
              clearTimeout(timeout.current);
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
