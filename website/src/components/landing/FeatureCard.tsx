import { PointerGlow } from "./PointerDecoration";
import { usePointerDecoration } from "./usePointerDecoration";
import type { LandingFeature } from "./content";

export function FeatureCard({ title, description, icon: Icon }: LandingFeature) {
  const { target, point, ...pointer } = usePointerDecoration("card");
  return (
    <article {...pointer} className="group min-w-0">
      <div
        ref={target}
        className="relative h-full overflow-hidden isolate min-h-49 rounded-card border border-solid border-border bg-surface-raised p-6.5 landing-mobile:min-h-0 landing-mobile:p-5.5 motion-safe:transition-[border-color,background-color,box-shadow] landing-pointer:group-hover:border-landing-card-border-hover landing-pointer:group-hover:bg-landing-card-hover landing-pointer:group-hover:shadow-landing-card-hover"
      >
        <PointerGlow point={point} />
        <span className="relative inline-flex size-9.5 items-center justify-center rounded-button border border-solid border-border-strong bg-control-active text-accent motion-safe:transition-transform landing-pointer:group-hover:-translate-y-0.5 landing-pointer:group-hover:border-landing-card-border-hover landing-pointer:group-hover:bg-landing-icon-hover">
          <Icon aria-hidden="true" className="size-4.75" strokeWidth={1.7} />
        </span>
        <h3 className="relative mt-5 mb-2.5 text-lg leading-[1.3] font-semibold tracking-landing-card text-content-strong">
          {title}
        </h3>
        <p className="relative mb-0 text-landing-card text-content-muted">{description}</p>
      </div>
    </article>
  );
}
