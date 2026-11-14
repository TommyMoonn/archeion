import { useRef, type ReactNode } from "react";
import { DocsHeader } from "./DocsHeader";
import { DocsSidebar } from "./DocsSidebar";
import { DocsSearchDialog } from "./DocsSearchDialog";

export function DocsShell({ children }: { children: ReactNode }) {
  const search = useRef<HTMLDialogElement>(null);
  return (
    <>
      <a
        href="#main-content"
        className="fixed start-4 top-3 z-skip-link -translate-y-24 rounded-button bg-accent px-4 py-2 text-accent-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <DocsHeader onSearch={() => search.current?.showModal()} />
      <div className="mx-auto grid max-w-docs box-border grid-cols-[var(--spacing-docs-sidebar)_minmax(0,1fr)] items-start gap-7 px-7 docs-full:px-6 docs-wide:gap-7.5 docs-navigation:block docs-navigation:px-5.5 docs-narrow:px-4.25">
        <DocsSidebar />
        {children}
      </div>
      <DocsSearchDialog dialogRef={search} />
    </>
  );
}
