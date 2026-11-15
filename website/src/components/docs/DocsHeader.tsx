import useBaseUrl from "@docusaurus/useBaseUrl";
import { ArrowUpRight, Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Brand } from "@/components/shared/Brand";
import { Button } from "@/components/ui/button";

export function DocsHeader({
  onSearch,
  onNavigation,
  navigationOpen,
}: {
  onSearch: (keyboard: boolean) => void;
  onNavigation: () => void;
  navigationOpen: boolean;
}) {
  const homeUrl = useBaseUrl("/");
  return (
    <header className="sticky top-0 z-header h-docs-header border-0 border-b border-solid border-border bg-surface-header backdrop-blur-lg docs-narrow:h-15.5">
      {/* Fixed chrome geometry keeps icon targets separate when article text is enlarged. */}
      {/* The three tracks preserve the mock's centered search independently of action width. */}
      <div className="mx-auto grid h-full max-w-docs box-border grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-docs-header-gap px-docs-gutter docs-full:gap-docs-header-full docs-full:px-docs-gutter-full docs-wide:gap-docs-header-wide docs-brand:gap-docs-header-compact docs-navigation:gap-docs-header-mobile docs-navigation:px-docs-gutter-mobile docs-search:gap-docs-header-icon docs-narrow:px-docs-gutter-narrow [&_nav_button]:size-docs-icon [&_nav_a]:min-w-docs-icon [&_nav_a]:min-h-docs-icon [&_nav_svg]:size-docs-glyph pointer-coarse:[&_nav_button]:min-h-docs-touch pointer-coarse:[&_nav_button]:min-w-docs-touch pointer-coarse:[&_nav_a]:min-h-docs-touch pointer-coarse:[&_nav_a]:min-w-docs-touch">
        <a
          href={homeUrl}
          className="flex w-fit min-w-0 max-w-full items-center gap-docs-header-compact text-content-strong hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus-ring"
        >
          <Brand className="gap-docs-brand shrink-0 [&_img]:size-docs-mark [&_span]:text-docs-brand docs-narrow:[&_img]:size-docs-mark-mobile docs-narrow:[&_span]:text-docs-brand-mobile docs-tiny:[&_img]:size-docs-mark-tiny docs-tiny:[&_span]:text-docs-brand-tiny" />
          <span
            aria-hidden="true"
            className="h-5 w-px shrink-0 bg-border-strong docs-brand:hidden"
          />
          <span className="min-w-0 text-caption wrap-anywhere text-content-subtle docs-brand:hidden">
            Documentation
          </span>
        </a>
        <Button
          variant="ghost"
          onClick={(event) => onSearch(event.detail === 0)}
          aria-label="Search documentation"
          className="h-docs-icon w-docs-search justify-start rounded-control border border-solid border-border bg-surface-raised px-3 text-sm font-normal text-content-subtle docs-full:w-docs-search-full docs-wide:w-docs-search-wide docs-brand:w-docs-search-compact docs-navigation:w-docs-search-mobile docs-search:size-docs-icon docs-search:justify-center docs-search:px-0"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="text-caption docs-search:hidden">Search docs</span>
          <kbd className="ms-auto rounded-sm border border-solid border-border-strong bg-surface-sunken px-1 font-mono text-xs shadow-none docs-search:hidden">
            Ctrl K
          </kbd>
        </Button>
        <nav
          aria-label="Website"
          className="flex items-center justify-end gap-docs-header-wide docs-navigation:gap-docs-actions"
        >
          <a
            href={homeUrl}
            className="inline-flex items-center text-sm text-content-muted hover:text-content-strong docs-brand:hidden"
          >
            Home
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </a>
          <div className="flex items-center gap-docs-actions">
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
              className="hidden docs-navigation:inline-flex pointer-coarse:min-h-docs-touch pointer-coarse:min-w-docs-touch"
            >
              <Menu aria-hidden="true" className={navigationOpen ? "invisible" : undefined} />
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
