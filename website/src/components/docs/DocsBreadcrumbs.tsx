import Link from "@docusaurus/Link";
import { useSidebarBreadcrumbs } from "@docusaurus/plugin-content-docs/client";

export function DocsBreadcrumbs() {
  const breadcrumbs = useSidebarBreadcrumbs() ?? [];
  return (
    <nav
      aria-label="Breadcrumb"
      className="max-w-full min-w-0 flex-auto basis-24 text-caption text-content-subtle"
    >
      <ol className="m-0 flex list-none items-center gap-2 overflow-hidden p-0 whitespace-nowrap">
        <li className="min-w-0">
          <Link
            to="/docs/"
            title="Documentation"
            className="block truncate text-content-subtle hover:text-content-strong focus-visible:underline focus-visible:decoration-2 focus-visible:decoration-focus-ring focus-visible:underline-offset-4"
          >
            Documentation
          </Link>
        </li>
        {breadcrumbs.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="text-border-strong">
              /
            </span>
            {index === breadcrumbs.length - 1 ? (
              <span aria-current="page" title={item.label} className="truncate text-content-muted">
                {item.label}
              </span>
            ) : item.href ? (
              <Link
                to={item.href}
                title={item.label}
                className="truncate text-content-subtle hover:text-content-strong focus-visible:underline focus-visible:decoration-2 focus-visible:decoration-focus-ring focus-visible:underline-offset-4"
              >
                {item.label}
              </Link>
            ) : (
              <span title={item.label} className="truncate">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
