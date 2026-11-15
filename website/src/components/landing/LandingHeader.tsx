import type { Dispatch, SetStateAction } from "react";
import { GithubMark } from "@/components/shared/GithubMark";
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
    <header className="sticky top-0 z-header h-17 landing-mobile:h-16 border-0 border-b border-solid border-landing-divider bg-surface">
      <div className="mx-auto w-landing-content landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 landing-menu:grid-cols-[minmax(0,1fr)_auto]">
        <a
          id="landing-home"
          href="#top"
          aria-label="Archeion home"
          inert={open}
          onClick={focusLandingAnchor}
          className="justify-self-start text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <Brand className="font-display [&>span]:text-landing-brand" />
        </a>
        <nav
          aria-label="Main navigation"
          className="flex items-center justify-self-center gap-7.5 landing-menu:hidden"
        >
          {landingSections.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={focusLandingAnchor}
              aria-current={active === id ? "location" : undefined}
              className="border-0 border-b border-solid border-transparent py-2 text-sm font-medium text-content-muted hover:border-accent hover:text-content-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-focus-ring aria-[current=location]:border-accent"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-self-end gap-5.5 landing-menu:hidden">
          <a
            href={landingLinks.installer}
            className="inline-flex min-h-9 items-center text-caption font-medium text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Download
          </a>
          <a
            href={landingLinks.source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-2 text-caption font-medium text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <GithubMark className="size-4" />
            GitHub
          </a>
        </div>
        <MobileNavigation open={open} setOpen={setOpen} active={active} />
      </div>
    </header>
  );
}
