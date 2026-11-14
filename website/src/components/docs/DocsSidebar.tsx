import { handleDocsNavigation } from "./handleDocsNavigation";
import { useEffect, useRef } from "react";
import Link from "@docusaurus/Link";
import { useLocation } from "@docusaurus/router";
import { useDocsSidebar, isActiveSidebarItem } from "@docusaurus/plugin-content-docs/client";
import type { PropSidebarItem } from "@docusaurus/plugin-content-docs";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function SidebarItem({
  item,
  pathname,
  onNavigate,
}: {
  item: PropSidebarItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  if (item.type === "html") return null;
  if (item.type === "category")
    return <SidebarGroup item={item} pathname={pathname} onNavigate={onNavigate} />;
  const active = isActiveSidebarItem(item, pathname);
  return (
    <Link
      to={item.href}
      onClick={(event) => {
        if (onNavigate) handleDocsNavigation(event, onNavigate);
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block min-h-8.75 box-border py-1.75 text-sm leading-5 hover:text-content-strong hover:no-underline focus-visible:outline-2 focus-visible:outline-focus-ring pointer-coarse:min-h-11",
        active ? "font-semibold text-accent" : "text-content-muted",
      )}
    >
      {item.label}
    </Link>
  );
}

function SidebarGroup({
  item,
  pathname,
  onNavigate,
}: {
  item: Extract<PropSidebarItem, { type: "category" }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const storageKey = `archeion-docs-group:${item.label}`;
  useEffect(() => {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(storageKey) === "closed";
    } catch {
      /* Preference storage is optional. */
    }
    if (details.current) details.current.open = isActiveSidebarItem(item, pathname) || !collapsed;
  }, [item, pathname, storageKey]);
  return (
    <details ref={details} open className="group mb-1.5">
      <summary
        onClick={() => {
          try {
            localStorage.setItem(storageKey, details.current?.open ? "closed" : "open");
          } catch {
            /* Preference storage is optional. */
          }
        }}
        className="flex min-h-8.75 cursor-pointer list-none items-center justify-between py-1.25 pe-2.5 text-sm leading-snug font-semibold tracking-docs-group text-content-strong uppercase focus-visible:outline-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden"
      >
        {item.label}
        <ChevronDown aria-hidden="true" className="size-3.25 -rotate-90 group-[[open]]:rotate-0" />
      </summary>
      <div className="grid pt-0.5">
        {item.items.map((child, index) => (
          <SidebarItem key={index} item={child} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
    </details>
  );
}

export function DocsSidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  const sidebar = useDocsSidebar();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Documentation sidebar">
      {sidebar?.items.map((item, index) => (
        <SidebarItem key={index} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export function DocsSidebar() {
  return (
    <aside
      aria-label="Documentation navigation"
      className="sticky top-docs-header h-[calc(100vh-4.25rem)] box-border overflow-y-auto border-0 border-e border-solid border-border bg-surface-sidebar pt-7 pe-5 pb-9 docs-navigation:hidden"
    >
      <DocsSidebarContents />
    </aside>
  );
}
