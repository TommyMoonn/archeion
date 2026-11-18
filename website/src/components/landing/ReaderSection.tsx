import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { readingFeatures } from "./content";
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
      className="landing-reader-section scroll-mt-22 landing-mobile:scroll-mt-18 border-0 border-t border-solid border-landing-divider"
    >
      <span id="reader" tabIndex={-1} className="block scroll-mt-22 landing-mobile:scroll-mt-18" />
      <div className="landing-reader-container">
        <h2 ref={statement} id="reading-title" className="landing-reader-title font-display">
          {words.map((word, index) => (
            <Fragment key={word}>
              <span
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
              {index === 2 && <br />}
            </Fragment>
          ))}
        </h2>
        <div className="landing-reader-layout">
          <figure className="landing-reader-preview">
            <img
              src="/archeion/assets/images/landing-reader.png"
              alt="Archeion Reader showing a chapter in continuous mode with the Appearance settings panel open."
              width={1919}
              height={1079}
              loading="lazy"
              decoding="async"
              className="landing-reader-image"
            />
          </figure>
          <div className="landing-reader-features" role="group" aria-label="Reader features">
            {readingFeatures.map(({ title, description, icon: Icon }) => (
              <article key={title} className="landing-reader-feature">
                <span className="landing-reader-feature-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
