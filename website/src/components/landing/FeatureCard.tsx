import { PointerGlow } from "./PointerDecoration";
import { usePointerDecoration } from "./usePointerDecoration";
import type { LandingFeature } from "./content";

export function FeatureCard({ title, description, icon: Icon }: LandingFeature) {
  const { target, point, ...pointer } = usePointerDecoration("card");
  return (
    <article {...pointer}>
      <div
        ref={target}
        className="relative h-full overflow-hidden rounded-card border border-solid border-border bg-surface-raised p-6"
      >
        <PointerGlow point={point} />
        <span className="mb-5 inline-flex size-10 items-center justify-center rounded-control bg-accent-subtle text-accent">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <h3 className="mb-2 text-lg font-semibold text-content-strong">{title}</h3>
        <p className="mb-0 text-sm leading-relaxed text-content-muted">{description}</p>
      </div>
    </article>
  );
}
