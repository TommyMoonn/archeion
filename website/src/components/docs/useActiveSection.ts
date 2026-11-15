import { useEffect, useState } from "react";
import { useLocation } from "@docusaurus/router";

export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const { pathname } = useLocation();
  const key = ids.join("\n");
  useEffect(() => {
    const headings = key
      .split("\n")
      .map((id) => document.getElementById(id))
      .filter((heading) => heading !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const first = headings[0];
      if (!first) return;
      const anchor = parseFloat(getComputedStyle(first).scrollMarginTop);
      let current = first;
      for (const heading of headings) {
        if (Math.round(heading.getBoundingClientRect().top) <= Math.round(anchor))
          current = heading;
        else break;
      }
      const root = document.documentElement;
      if (scrollY > 0 && scrollY + innerHeight >= root.scrollHeight - 1)
        current = headings[headings.length - 1] ?? first;
      setActive(current.id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    const article = document.querySelector("article");
    if (article) observer.observe(article);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [key, pathname]);
  return active;
}
