import Link from "@docusaurus/Link";
import { cn } from "@/lib/utils";

type Neighbor = { title: string; permalink: string };

export function DocsArticleNavigation({
  previous,
  next,
}: {
  previous?: Neighbor;
  next?: Neighbor;
}) {
  if (!previous && !next) return null;
  return (
    <nav aria-label="Documentation pages" className="mt-auto pt-11">
      <div className="grid grid-cols-2 gap-3.5 border-0 border-y border-solid border-border py-6 docs-search:grid-cols-1 docs-search:gap-2.5">
        {[
          { direction: "Previous", page: previous },
          { direction: "Next", page: next },
        ].map(
          ({ direction, page }) =>
            page && (
              <Link
                key={direction}
                to={page.permalink}
                className={cn(
                  "flex min-h-20 min-w-0 box-border flex-col justify-center gap-1.5 rounded-button border border-solid border-border bg-surface-raised px-4 py-3.5 hover:border-border-strong hover:bg-control-hover hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus-ring only:col-span-full",
                  direction === "Next" &&
                    "items-end text-end docs-search:items-start docs-search:text-start",
                )}
              >
                <span className="text-docs-label font-semibold tracking-docs-label text-content-subtle uppercase">
                  {direction}
                </span>
                <span className="text-docs-navigation leading-snug font-semibold wrap-anywhere text-content-strong">
                  {page.title}
                </span>
              </Link>
            ),
        )}
      </div>
    </nav>
  );
}
