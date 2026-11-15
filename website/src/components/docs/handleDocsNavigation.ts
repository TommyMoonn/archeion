import type { MouseEvent } from "react";

export function handleDocsNavigation(event: MouseEvent<HTMLAnchorElement>, close: () => void) {
  const link = event.currentTarget;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    (link.target && link.target !== "_self")
  )
    return;
  close();
  const url = new URL(link.href);
  if (url.pathname === location.pathname && url.search === location.search) {
    requestAnimationFrame(() => {
      let heading: HTMLElement | null = null;
      try {
        heading = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      } catch {
        /* Invalid fragments fall back to the article. */
      }
      (heading ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
    });
  }
}
