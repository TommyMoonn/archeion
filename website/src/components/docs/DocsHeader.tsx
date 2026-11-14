import Link from "@docusaurus/Link";
import { ArrowUpRight, Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Brand } from "@/components/shared/Brand";
import { Button } from "@/components/ui/button";

export function DocsHeader({
  onSearch,
  onNavigation,
  navigationOpen,
}: {
  onSearch: () => void;
  onNavigation: () => void;
  navigationOpen: boolean;
}) {
  return (
    <header className="sticky top-0 z-header h-docs-header border-0 border-b border-solid border-border bg-surface-header backdrop-blur-lg docs-narrow:h-15.5">
      {/* The three tracks preserve the mock's centered search independently of action width. */}
      <div className="mx-auto grid h-full max-w-docs box-border grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-7 docs-full:gap-5 docs-full:px-6 docs-wide:gap-4 docs-brand:gap-3.5 docs-navigation:gap-3 docs-navigation:px-5.5 docs-search:gap-2.5 docs-narrow:px-4.25">
        <Link
          to="/"
          className="flex w-fit items-center gap-3.5 text-content-strong hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus-ring"
        >
          <Brand className="[&_img]:size-7.75 [&_span]:text-docs-brand docs-narrow:[&_img]:size-7 docs-narrow:[&_span]:text-xl docs-tiny:[&_img]:size-6.5 docs-tiny:[&_span]:text-lg" />
          <span aria-hidden="true" className="h-5 w-px bg-border-strong docs-brand:hidden" />
          <span className="text-caption text-content-subtle docs-brand:hidden">Documentation</span>
        </Link>
        <Button
          variant="ghost"
          onClick={onSearch}
          aria-label="Search documentation"
          className="h-9.5 w-docs-search justify-start rounded-control border border-solid border-border bg-surface-raised px-3 text-sm font-normal text-content-subtle docs-full:w-docs-search-full docs-wide:w-docs-search-wide docs-brand:w-docs-search-compact docs-navigation:w-docs-search-mobile docs-search:size-9.5 docs-search:justify-center docs-search:p-0"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="text-caption docs-search:hidden">Search docs</span>
          <kbd className="ms-auto rounded-sm border border-solid border-border-strong px-1 font-mono text-xs docs-search:hidden">
            Ctrl K
          </kbd>
        </Button>
        <nav
          aria-label="Website"
          className="flex items-center justify-end gap-4 docs-navigation:gap-2"
        >
          <Link
            to="/"
            className="inline-flex items-center text-sm text-content-muted hover:text-content-strong docs-brand:hidden"
          >
            Home
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" asChild className="docs-tiny:hidden">
              <a
                href="https://github.com/TommyMoonn/archeion"
                aria-label="Archeion on GitHub"
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* Lucide no longer includes brand marks; preserve the approved GitHub glyph. */}
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7.2 16.8c-3.1.9-3.1-1.6-4.3-2m8.6 3.9v-2.3a2 2 0 0 0-.6-1.6c2.1-.2 4.3-1 4.3-4.7a3.7 3.7 0 0 0-1-2.6 3.4 3.4 0 0 0-.1-2.6s-.8-.2-2.7 1a9.4 9.4 0 0 0-4.9 0c-1.9-1.2-2.7-1-2.7-1a3.4 3.4 0 0 0-.1 2.6 3.7 3.7 0 0 0-1 2.6c0 3.7 2.2 4.5 4.3 4.7a2 2 0 0 0-.6 1.6v2.3" />
                </svg>
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNavigation}
              aria-label="Open documentation navigation"
              aria-expanded={navigationOpen}
              aria-controls="docs-mobile-navigation"
              className="hidden docs-navigation:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <Menu aria-hidden="true" className={navigationOpen ? "invisible" : undefined} />
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
