import { HtmlClassNameProvider } from "@docusaurus/theme-common";
import { useEffect, useRef, useState } from "react";
import { PointerGlow } from "./PointerDecoration";
import { LandingHeader } from "./LandingHeader";
import { HeroSection } from "./HeroSection";
import { ProductPreview } from "./ProductPreview";
import { LibrarySection } from "./LibrarySection";
import { ReaderSection } from "./ReaderSection";
import { ArchiveSection } from "./ArchiveSection";
import { DownloadSection } from "./DownloadSection";
import { LandingFooter } from "./LandingFooter";
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
    const reset = requestAnimationFrame(clear);
    window.addEventListener("blur", clear);
    return () => {
      cancelAnimationFrame(reset);
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", clear);
    };
  }, [pointer]);
  return (
    <HtmlClassNameProvider
      className={
        menuOpen ? "motion-safe:scroll-smooth overflow-hidden" : "motion-safe:scroll-smooth"
      }
    >
      <div
        data-landing=""
        data-theme="dark"
        className="min-h-screen bg-surface font-sans leading-[1.55] text-content antialiased [&_a]:no-underline"
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
        <PointerGlow point={pointer ? spotlight : null} radius={460} kind="page" />
        <LandingHeader open={menuOpen} setOpen={setMenuOpen} />
        <main
          id="main"
          tabIndex={-1}
          inert={menuOpen}
          className="scroll-mt-22 landing-mobile:scroll-mt-18"
        >
          <span
            id="main-content"
            tabIndex={-1}
            className="block scroll-mt-22 landing-mobile:scroll-mt-18"
          />
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
