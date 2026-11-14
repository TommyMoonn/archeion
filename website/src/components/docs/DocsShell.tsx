import { useLocation } from "@docusaurus/router";
import { DocsMobileNavigation } from "./DocsMobileNavigation";
import { useDocsDialog } from "./useDocsDialog";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DocsHeader } from "./DocsHeader";
import { DocsSidebar } from "./DocsSidebar";
import { DocsSearchDialog } from "./DocsSearchDialog";

export function DocsShell({ children }: { children: ReactNode }) {
  const search = useRef<HTMLDialogElement>(null);
  const [modal, setModal] = useState<"navigation" | "search" | null>(null);
  const close = useCallback(() => setModal(null), []);
  const { pathname, hash } = useLocation();
  const previousRoute = useRef<string | null>(null);
  useDocsDialog(search, modal === "search");
  useEffect(() => {
    const initial = previousRoute.current === null;
    if (!initial && previousRoute.current === pathname + hash) return;
    previousRoute.current = pathname + hash;
    // Docusaurus relies on native initial fragment restoration. Its development
    // entry has no server-rendered headings for the browser to restore to.
    if (initial && (process.env.NODE_ENV !== "development" || !hash)) return;
    if (!initial) close();
    const frame = requestAnimationFrame(() => {
      let destination: HTMLElement | null = null;
      try {
        destination = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      } catch {
        /* A malformed fragment still leaves the article reachable. */
      }
      if (initial) destination?.scrollIntoView();
      else (destination ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, close]);
  return (
    <>
      <a
        href="#main-content"
        className="fixed start-4 top-3 z-skip-link -translate-y-24 rounded-button bg-accent px-4 py-2 text-accent-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <DocsHeader
        onSearch={() => {
          if (modal === null) setModal("search");
        }}
        onNavigation={() => {
          if (modal === null) setModal("navigation");
        }}
        navigationOpen={modal === "navigation"}
      />
      <div className="mx-auto grid max-w-docs box-border grid-cols-[var(--spacing-docs-sidebar)_minmax(0,1fr)] items-start gap-7 px-7 docs-full:px-6 docs-wide:gap-7.5 docs-navigation:block docs-navigation:px-5.5 docs-narrow:px-4.25">
        <DocsSidebar />
        {children}
      </div>
      <DocsSearchDialog dialogRef={search} onClose={close} />
      <DocsMobileNavigation open={modal === "navigation"} onClose={close} />
    </>
  );
}
