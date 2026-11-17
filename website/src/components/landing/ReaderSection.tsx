import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { readingFeatures } from "./content";
import { FeatureCard } from "./FeatureCard";
import { useLandingMotion } from "./useLandingMotion";

const words = ["Read", "and", "annotate", "your", "books."];

export function ReaderSection() {
  const statement = useRef<HTMLHeadingElement>(null);
  const motion = useLandingMotion();
  const [activeCount, setActiveCount] = useState(words.length);
  useEffect(() => {
    if (!motion) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = statement.current?.getBoundingClientRect();
      if (!bounds) return;
      const start = innerHeight * 0.84;
      const distance = Math.max(1, innerHeight * 0.42 + bounds.height);
      const progress = Math.max(0, Math.min(1, (start - bounds.top) / distance));
      setActiveCount(
        innerHeight + scrollY >= document.documentElement.scrollHeight - 2
          ? words.length
          : Math.round(progress * words.length),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    if (statement.current) resize.observe(statement.current);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [motion]);
  return (
    <section
      id="reading"
      tabIndex={-1}
      aria-labelledby="reading-title"
      className="scroll-mt-22 landing-mobile:scroll-mt-18 border-0 border-t border-solid border-landing-divider py-28 landing-tablet:py-22 landing-mobile:py-18"
    >
      <span id="reader" tabIndex={-1} className="block scroll-mt-22 landing-mobile:scroll-mt-18" />
      <div className="mx-auto w-landing-content landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow">
        <h2
          ref={statement}
          id="reading-title"
          className="mb-11 max-w-landing-heading landing-mobile:mb-8 font-display text-section leading-[1.12] landing-mobile:text-landing-section-mobile landing-mobile:leading-[1.12] text-balance font-normal tracking-landing-reading"
        >
          {words.map((word, index) => (
            <span
              key={word}
              className={cn(
                "motion-safe:transition-colors",
                motion && index >= activeCount
                  ? "text-content-subtle"
                  : index === words.length - 1
                    ? "text-accent"
                    : "text-content-strong",
              )}
            >
              {word}
              {index < words.length - 1 ? " " : ""}
            </span>
          ))}
        </h2>
        <div className="grid grid-cols-[minmax(0,2.25fr)_minmax(0,1fr)] items-center gap-6 landing-menu:grid-cols-1 landing-menu:gap-8">
          <figure className="m-0 min-w-0">
            <img
              src="/archeion/assets/images/landing-reader.png"
              alt="Archeion Reader showing a chapter in continuous mode with the Appearance settings panel open."
              width={1919}
              height={1079}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full rounded-card border border-solid border-landing-preview-border shadow-landing-preview"
            />
          </figure>
          <div className="grid min-w-0 grid-cols-1 gap-3 landing-menu:grid-cols-3 landing-tablet:grid-cols-2 landing-mobile:grid-cols-1">
            {readingFeatures.map((feature) => (
              <FeatureCard key={feature.title} {...feature} compact />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
