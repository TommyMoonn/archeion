import { useDoc } from "@docusaurus/plugin-content-docs/client";

import { useActiveSection } from "./useActiveSection";

export function DocsTableOfContents() {
  const { toc, frontMatter } = useDoc();
  const active = useActiveSection(
    toc
      .filter((heading) => heading.level === 2 || heading.level === 3)
      .map((heading) => heading.id),
  );
  if (frontMatter.hide_table_of_contents || toc.length === 0) return null;
  return (
    <aside
      aria-label="On this page"
      className="sticky top-docs-header max-h-[calc(100vh-4.25rem)] overflow-y-auto pt-10.5 pb-8 docs-wide:hidden"
    >
      <div className="mb-3 text-sm font-semibold tracking-docs-group text-content-strong uppercase">
        On this page
      </div>
      <nav aria-label="Table of contents">
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {toc
            .filter((heading) => heading.level === 2 || heading.level === 3)
            .map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  aria-current={active === heading.id ? "location" : undefined}
                  className={`block border-0 border-s border-solid py-1.25 pe-1 text-sm leading-relaxed hover:text-content-strong hover:no-underline focus-visible:outline-2 focus-visible:outline-focus-ring ${active === heading.id ? "border-accent text-accent" : "border-transparent text-content-muted"} ${heading.level === 3 ? "ps-5.25" : "ps-2.5"}`}
                >
                  {heading.value}
                </a>
              </li>
            ))}
        </ul>
      </nav>
    </aside>
  );
}
