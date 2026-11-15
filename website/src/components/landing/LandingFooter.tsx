import darkLogo from "@/assets/brand/archeion-logo-dark.png";
import { landingLinks } from "./content";
import { focusLandingAnchor } from "./useSectionNavigation";

export function LandingFooter() {
  return (
    <footer className="border-0 border-t border-solid border-landing-footer-border landing-mobile:py-2.5">
      <div className="mx-auto flex min-h-17 w-landing-content flex-wrap items-center justify-between gap-6 landing-tablet:w-landing-media-tablet landing-mobile:min-h-16 landing-mobile:w-landing-media-mobile landing-mobile:gap-2.5">
        <div className="flex items-center gap-2.5 landing-mobile:gap-2">
          <a
            href="#top"
            aria-label="Back to top"
            onClick={focusLandingAnchor}
            className="opacity-[.72] motion-safe:transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <img
              src={darkLogo}
              alt=""
              width={22}
              height={22}
              className="block size-5.5 landing-mobile:size-5"
            />
          </a>
          <span className="text-xs leading-[1.3] whitespace-nowrap text-content-subtle landing-mobile:text-landing-copyright-mobile">
            © 2026 Khoa Luong
          </span>
        </div>
        <nav
          aria-label="Footer links"
          className="ml-auto flex flex-wrap gap-5.5 text-caption landing-mobile:gap-2.5 landing-mobile:text-landing-tree-mobile"
        >
          <a
            href={landingLinks.documentation}
            className="text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Documentation
          </a>
          <a
            href={landingLinks.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Source code
          </a>
          <a
            href={landingLinks.releases}
            target="_blank"
            rel="noopener noreferrer"
            className="text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Releases
          </a>
        </nav>
      </div>
    </footer>
  );
}
