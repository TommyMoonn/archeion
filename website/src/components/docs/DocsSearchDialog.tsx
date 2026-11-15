import { handleDocsNavigation } from "./handleDocsNavigation";
import Link from "@docusaurus/Link";
import { useRef, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocsSearchData } from "../../search/useDocsSearchData";
import { resultAnnouncement, searchEntries } from "../../search/match";
import { SearchHighlight } from "./SearchHighlight";

export function DocsSearchDialog({
  dialogRef,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onClose: () => void;
}) {
  const { entries } = useDocsSearchData();
  const outsidePress = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [active, setActive] = useState(0);
  const found = searchEntries(entries, query);
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
      onPointerCancel={() => {
        outsidePress.current = false;
      }}
      onClick={(event) => {
        const dismiss = outsidePress.current && event.target === event.currentTarget;
        outsidePress.current = false;
        if (dismiss) close();
      }}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        const links = Array.from(results.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
        const inInput = event.target === input.current;
        const index = links.findIndex((link) => link === event.target);
        if (!inInput && index < 0) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if (!links.length) return;
          event.preventDefault();
          if (!inInput && index === 0 && event.key === "ArrowUp") {
            input.current?.focus();
            return;
          }
          const next = inInput
            ? event.key === "ArrowDown"
              ? 0
              : links.length - 1
            : Math.min(links.length - 1, index + (event.key === "ArrowDown" ? 1 : -1));
          setActive(next);
          links[next].focus({ preventScroll: true });
          links[next].scrollIntoView({ block: "nearest" });
        } else if (inInput && event.key === "Enter" && links[active]) {
          event.preventDefault();
          links[active].click();
        }
      }}
      className="fixed inset-0 z-dialog m-0 h-screen max-h-none w-screen max-w-none border-0 overflow-y-auto bg-transparent p-0 text-content backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      {/* Measured mock inset and viewport-bound result height are not spacing-scale values. */}
      <section className="mx-auto mb-4.5 mt-[min(16vh,130px)] w-[calc(100%-36px)] max-w-docs-dialog overflow-hidden rounded-xl border border-solid border-border-strong bg-surface-raised shadow-docs-dialog docs-narrow:mt-[9vh]">
        <h2 id="docs-search-title" className="sr-only">
          Search documentation
        </h2>
        <div className="flex items-center gap-3.25 border-0 border-b border-solid border-border px-4.5 py-4.25">
          <Search aria-hidden="true" className="size-4.5 shrink-0 text-content-subtle" />
          <Input
            ref={input}
            type="search"
            aria-label="Search documentation"
            placeholder="Search guides, features, and topics..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              if (results.current) results.current.scrollTop = 0;
            }}
            className="min-w-0 h-8 border-0 bg-transparent px-0 text-base md:text-base shadow-none"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Close search" onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {resultAnnouncement(query, found.total, found.entries.length)}
        </p>
        <nav
          ref={results}
          aria-label="Documentation search results"
          className="max-h-[min(58vh,520px)] overflow-y-auto p-1.75"
        >
          {found.entries.map((entry, index) => {
            const id = `search-${entry.id}-${entry.sectionId || "page"}`;
            return (
              <Link
                key={id}
                to={`${entry.href}${entry.sectionId ? `#${entry.sectionId}` : ""}`}
                aria-labelledby={`${id}-title ${id}-context`}
                aria-describedby={detailed ? `${id}-excerpt` : undefined}
                data-active={active === index}
                onFocus={() => setActive(index)}
                onClick={(event) => handleDocsNavigation(event, close)}
                className="grid gap-1 rounded-control border border-solid border-transparent px-3.5 py-3.25 hover:border-border hover:bg-surface hover:no-underline data-[active=true]:border-border data-[active=true]:bg-surface focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <span id={`${id}-title`} className="text-sm font-bold text-content-strong">
                  <SearchHighlight text={entry.sectionHeading || entry.title} query={query} />
                </span>
                <span
                  id={`${id}-context`}
                  className="text-xs tracking-docs-label text-accent uppercase"
                >
                  <SearchHighlight
                    text={entry.sectionId ? `${entry.title} · ${entry.group}` : entry.group}
                    query={query}
                  />
                </span>
                <span className="text-caption leading-relaxed text-content-muted">
                  <SearchHighlight text={entry.description} query={query} />
                </span>
                <span
                  data-search-excerpt
                  id={`${id}-excerpt`}
                  hidden={!detailed}
                  className="text-caption leading-relaxed text-content-muted"
                >
                  <SearchHighlight text={entry.excerpt} query={query} />
                </span>
              </Link>
            );
          })}
          {!found.total && (
            <p data-search-empty className="px-3.5 py-3.25 text-sm text-content-muted">
              No matching results. Try another topic.
            </p>
          )}
        </nav>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border px-4 py-2.75 text-xs text-content-subtle">
          <span>
            {found.entries.length} of {found.total} results
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={detailed}
            onClick={() => setDetailed(!detailed)}
          >
            Show details
          </Button>
          <span>↑ ↓ to navigate · Enter to open · Esc to close</span>
        </footer>
      </section>
    </dialog>
  );
}
