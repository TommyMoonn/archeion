import darkLogo from "@/assets/brand/archeion-logo-dark.png";
import { landingLinks } from "./content";
import { focusLandingAnchor } from "./useSectionNavigation";

export function LandingFooter() {
  return (
    <footer className="border-0 border-t border-solid border-border px-8 landing-mobile:px-4">
      <div className="mx-auto flex min-h-17 max-w-site flex-wrap items-center justify-between gap-4 py-3">
        <div className="flex items-center gap-3">
          <a
            href="#top"
            aria-label="Back to top"
            onClick={focusLandingAnchor}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <img src={darkLogo} alt="" width={22} height={22} className="block size-5.5" />
          </a>
          <span className="text-xs text-content-subtle">© 2026 Khoa Luong</span>
        </div>
        <nav aria-label="Footer links" className="flex flex-wrap gap-5 text-xs">
          <a
            href={landingLinks.documentation}
            className="text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Documentation
          </a>
          <a
            href={landingLinks.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Source code
          </a>
          <a
            href={landingLinks.releases}
            target="_blank"
            rel="noopener noreferrer"
            className="text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            Releases
          </a>
        </nav>
      </div>
    </footer>
  );
}
