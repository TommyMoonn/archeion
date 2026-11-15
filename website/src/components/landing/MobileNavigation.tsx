import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Menu } from "lucide-react";
import { landingLinks, landingSections, type LandingSectionId } from "./content";
import { DownloadAction } from "./DownloadAction";

export function MobileNavigation({
  open,
  setOpen,
  active,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  active: LandingSectionId | null;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 1021px)");
    const update = () => {
      if (!desktop.matches) return;
      const hadFocus = details.current?.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() =>
          document.getElementById("landing-home")?.focus(),
        );
      }
    };
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, [setOpen]);
  useEffect(() => {
    if (!open) return;
    details.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
    const close = () => {
      setOpen(false);
      summary.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target)) {
        event.preventDefault();
        close();
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab") return;
      const elements = [
        summary.current,
        ...Array.from(details.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []),
      ];
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open, setOpen]);
  return (
    <details
      ref={details}
      open={open}
      className="hidden landing-menu:block"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        ref={summary}
        aria-controls="landing-mobile-navigation"
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Menu <Menu aria-hidden="true" className="size-4" />
      </summary>
      <nav
        id="landing-mobile-navigation"
        aria-label="Mobile navigation"
        className="fixed inset-x-0 top-17 bottom-0 overflow-y-auto overscroll-contain bg-surface px-6 py-8 landing-mobile:top-16"
      >
        {landingSections.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? "location" : undefined}
            onClick={(event) => {
              // Background inertness clears after React commits the close.
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              setOpen(false);
              const anchor = event.currentTarget.hash.slice(1);
              cancelAnimationFrame(focusFrame.current);
              focusFrame.current = requestAnimationFrame(() =>
                document.getElementById(anchor)?.focus({ preventScroll: true }),
              );
            }}
            className="mb-3 flex min-h-11 items-center text-xl text-content hover:text-accent focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            {label}
          </a>
        ))}
        <a
          href={landingLinks.source}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            setOpen(false);
            summary.current?.focus();
          }}
          className="mb-6 flex min-h-11 items-center text-content-muted focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          GitHub
        </a>
        <DownloadAction />
      </nav>
    </details>
  );
}
