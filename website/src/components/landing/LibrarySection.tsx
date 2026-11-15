import { libraryFeatures } from "./content";
import { FeatureCard } from "./FeatureCard";

export function LibrarySection() {
  return (
    <section
      id="library"
      tabIndex={-1}
      aria-labelledby="library-title"
      className="scroll-mt-22 landing-mobile:scroll-mt-18 border-0 border-t border-solid border-landing-divider pt-22 pb-28 landing-tablet:py-22 landing-mobile:pt-14 landing-mobile:pb-18"
    >
      <div className="mx-auto w-landing-content landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow">
        <h2
          id="library-title"
          className="mb-11 max-w-landing-heading landing-mobile:mb-8 font-display text-section landing-mobile:text-landing-section-mobile text-balance font-normal tracking-display text-content-strong"
        >
          Find and manage books in your collection.
        </h2>
        <div className="grid grid-cols-3 gap-3 landing-tablet:grid-cols-2 landing-mobile:grid-cols-1">
          {libraryFeatures.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
