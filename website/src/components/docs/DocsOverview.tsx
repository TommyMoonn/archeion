import Link from "@docusaurus/Link";
import { ArrowRight } from "lucide-react";
import { useDocsSearchData } from "../../search/useDocsSearchData";

export function DocsOverview({ group }: { group: string }) {
  const { pages } = useDocsSearchData();
  return (
    <ul
      data-docs-overview={group}
      className={`my-5 grid list-none gap-2.25 p-0 docs-narrow:grid-cols-1 ${group === "Getting started" ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {pages
        .filter((page) => page.group === group)
        .map((page) => (
          <li key={page.id} className="m-0 min-w-0">
            <Link
              to={page.href}
              className="group flex h-full min-h-19 min-w-0 box-border items-center justify-between gap-3 rounded-control border border-solid border-border bg-surface px-3.25 pt-3.25 pb-3 text-content hover:border-border-strong hover:bg-surface-raised hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus-ring motion-safe:transition motion-safe:duration-240 motion-safe:hover:-translate-y-px"
            >
              <span className="min-w-0">
                <span className="block text-docs-card-title font-bold text-content-strong">
                  {page.overviewTitle}
                </span>{" "}
                <span className="mt-1 block text-docs-card-description text-content-subtle">
                  {page.overviewDescription}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-3.5 shrink-0 text-content-subtle group-hover:text-accent motion-safe:transition motion-safe:duration-240 motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
    </ul>
  );
}
