import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocsSidebarContents } from "./DocsSidebar";
import { useDocsDialog } from "./useDocsDialog";

export function DocsMobileNavigation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  useDocsDialog(dialog, open);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const resize = () => {
      const sidebar = document.querySelector<HTMLElement>(
        '[aria-label="Documentation navigation"]',
      );
      if (media.matches && sidebar?.contains(document.activeElement)) {
        document
          .querySelector<HTMLButtonElement>('[aria-controls="docs-mobile-navigation"]')
          ?.focus();
      }
      if (!media.matches && open) {
        dialog.current?.close();
        onClose();
        const current = sidebar?.querySelector<HTMLElement>('a[aria-current="page"]');
        let group = current?.closest("details");
        while (group) {
          group.open = true;
          group = group.parentElement?.closest("details") ?? null;
        }
        current?.focus();
      }
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, [open, onClose]);
  return (
    <dialog
      ref={dialog}
      id="docs-mobile-navigation"
      aria-label="Documentation menu"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        outsidePress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (outsidePress.current && event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-drawer m-0 h-screen max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-content backdrop:top-docs-header backdrop:bg-scrim-navigation docs-narrow:backdrop:top-15.5"
    >
      {open && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-docs-header items-center justify-end px-5.5 docs-narrow:h-15.5 docs-narrow:px-4.25">
          <Button
            autoFocus
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={onClose}
            className="pointer-events-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      {open && <NavigationPanel onClose={onClose} />}
    </dialog>
  );
}

function NavigationPanel({ onClose }: { onClose: () => void }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <section
      className={cn(
        "absolute start-0 top-docs-header bottom-0 w-[min(310px,calc(100%-52px))] box-border overflow-y-auto overscroll-contain border-0 border-e border-solid border-border-strong bg-surface-sidebar pt-6 pe-4.5 pb-9 ps-5.5 shadow-docs-drawer motion-safe:transition-transform motion-safe:duration-260 docs-narrow:top-15.5",
        !entered && "motion-safe:-translate-x-full",
      )}
    >
      <DocsSidebarContents onNavigate={onClose} />
    </section>
  );
}
