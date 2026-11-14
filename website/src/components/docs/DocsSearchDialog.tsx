import { handleDocsNavigation } from "./handleDocsNavigation";
import { useDocsSidebar } from "@docusaurus/plugin-content-docs/client";
import type { PropSidebarItem } from "@docusaurus/plugin-content-docs";
import Link from "@docusaurus/Link";
import { useRef, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SearchFixtureLinks({ items, close }: { items: PropSidebarItem[]; close: () => void }) {
  return items.map((item) => {
    if (item.type === "html") return null;
    if (item.type === "category")
      return <SearchFixtureLinks key={item.label} items={item.items} close={close} />;
    return (
      <Link
        key={item.href}
        to={item.href}
        onClick={(event) => handleDocsNavigation(event, close)}
        className="grid gap-1 rounded-control border border-solid border-transparent px-3.5 py-3.25 hover:border-border hover:bg-surface hover:no-underline focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <span className="text-sm font-semibold text-content-strong">{item.label}</span>
        <span className="text-xs tracking-docs-label text-accent uppercase">
          Temporary document
        </span>
      </Link>
    );
  });
}

export function DocsSearchDialog({
  dialogRef,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onClose: () => void;
}) {
  const sidebar = useDocsSidebar();
  const outsidePress = useRef(false);
  const close = onClose;
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="docs-search-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        outsidePress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (outsidePress.current && event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-dialog m-0 h-screen max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-content backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      {/* Measured mock inset and viewport-bound result height are not spacing-scale values. */}
      <section className="mx-auto mt-[min(16vh,130px)] w-[calc(100%-36px)] max-w-docs-dialog overflow-hidden rounded-xl border border-solid border-border-strong bg-surface-raised shadow-docs-dialog docs-narrow:mt-[9vh]">
        <h2 id="docs-search-title" className="sr-only">
          Search documentation
        </h2>
        <div className="flex items-center gap-3.25 border-0 border-b border-solid border-border px-4.5 py-4.25">
          <Search aria-hidden="true" className="size-4.5 shrink-0 text-content-subtle" />
          <Input
            aria-label="Search documentation"
            placeholder="Search guides, features, and topics..."
            readOnly
            className="h-8 border-0 bg-transparent px-0 text-base shadow-none"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Close search" onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="max-h-[min(58vh,520px)] overflow-y-auto p-1.75">
          <SearchFixtureLinks items={sidebar?.items ?? []} close={close} />
        </div>
        <footer className="flex flex-wrap justify-between gap-3 border-0 border-t border-solid border-border px-4 py-2.75 text-xs text-content-subtle">
          <span>Temporary search surface</span>
          <span>Esc to close</span>
        </footer>
      </section>
    </dialog>
  );
}
