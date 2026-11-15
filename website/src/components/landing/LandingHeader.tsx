import type { Dispatch, SetStateAction } from "react";
import { CodeXml } from "lucide-react";
import { Brand } from "@/components/shared/Brand";
import { landingLinks, landingSections } from "./content";
import { MobileNavigation } from "./MobileNavigation";
import { focusLandingAnchor, useSectionNavigation } from "./useSectionNavigation";

export function LandingHeader({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const active = useSectionNavigation();
  return (
    <header className="sticky top-0 z-header border-0 border-b border-solid border-border-subtle bg-surface">
      <div className="mx-auto flex min-h-17 max-w-site items-center justify-between gap-6 px-8 landing-mobile:min-h-16 landing-mobile:px-5">
        <a
          id="landing-home"
          href="#top"
          aria-label="Archeion home"
          inert={open}
          onClick={focusLandingAnchor}
          className="text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <Brand className="font-display" />
        </a>
        <nav aria-label="Main navigation" className="flex gap-8 landing-menu:hidden">
          {landingSections.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={focusLandingAnchor}
              aria-current={active === id ? "location" : undefined}
              className="border-0 border-b border-solid border-transparent py-3 text-sm text-content-muted hover:border-accent hover:text-content-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-focus-ring aria-[current=location]:border-accent"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-6 landing-menu:hidden">
          <a
            href={landingLinks.installer}
            className="text-sm text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Download
          </a>
          <a
            href={landingLinks.source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <CodeXml aria-hidden="true" className="size-4" />
            GitHub
          </a>
        </div>
        <MobileNavigation open={open} setOpen={setOpen} active={active} />
      </div>
    </header>
  );
}
