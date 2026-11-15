import { libraryFeatures } from "./content";
import { FeatureCard } from "./FeatureCard";

export function LibrarySection() {
  return (
    <section
      id="library"
      tabIndex={-1}
      aria-labelledby="library-title"
      className="scroll-mt-22 border-0 border-t border-solid border-border-subtle px-8 py-24 landing-mobile:px-5 landing-mobile:py-14"
    >
      <div className="mx-auto max-w-site">
        <h2
          id="library-title"
          className="mb-11 max-w-hero-copy font-display text-section font-normal tracking-display text-content-strong"
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
