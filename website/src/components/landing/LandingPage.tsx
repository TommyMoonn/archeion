import { HtmlClassNameProvider } from "@docusaurus/theme-common";
import { useEffect, useRef, useState } from "react";
import { LandingHeader } from "./LandingHeader";
import { HeroSection } from "./HeroSection";
import { ProductPreview } from "./ProductPreview";
import { LibrarySection } from "./LibrarySection";
import { ReaderSection } from "./ReaderSection";
import { ArchiveSection } from "./ArchiveSection";
import { DownloadSection } from "./DownloadSection";
import { LandingFooter } from "./LandingFooter";
import { focusLandingAnchor } from "./useSectionNavigation";
import { useLandingMotion } from "./useLandingMotion";

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pointer = useLandingMotion(true);
  const [spotlight, setSpotlight] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  useEffect(() => {
    const clear = () => {
      cancelAnimationFrame(frame.current);
      setSpotlight(null);
    };
    window.addEventListener("blur", clear);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return (
    <HtmlClassNameProvider className={menuOpen ? "overflow-hidden" : ""}>
      <div
        data-landing=""
        data-theme="dark"
        className="min-h-screen bg-surface font-sans text-content antialiased"
        onPointerLeave={() => {
          cancelAnimationFrame(frame.current);
          setSpotlight(null);
        }}
        onPointerMove={(event) => {
          if (!pointer || event.pointerType !== "mouse") return;
          const { clientX: x, clientY: y } = event;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setSpotlight({ x, y }));
        }}
      >
        {pointer && spotlight && (
          <svg
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-header h-screen w-screen opacity-5 mix-blend-screen"
          >
            <circle cx={spotlight.x} cy={spotlight.y} r={230} className="fill-accent" />
          </svg>
        )}
        <a
          href="#main"
          onClick={focusLandingAnchor}
          inert={menuOpen}
          className="fixed top-3 left-3 z-skip-link -translate-y-24 rounded-control bg-accent px-4 py-3 text-accent-foreground focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Skip to content
        </a>
        <LandingHeader open={menuOpen} setOpen={setMenuOpen} />
        <main id="main" tabIndex={-1} inert={menuOpen} className="scroll-mt-22">
          <span id="main-content" tabIndex={-1} className="block scroll-mt-22" />
          <HeroSection />
          <ProductPreview />
          <LibrarySection />
          <ReaderSection />
          <ArchiveSection />
          <DownloadSection />
        </main>
        <div inert={menuOpen}>
          <LandingFooter />
        </div>
      </div>
    </HtmlClassNameProvider>
  );
}
