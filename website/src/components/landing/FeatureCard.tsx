import type { LandingFeature } from "./content";

export function FeatureCard({ title, description, icon: Icon }: LandingFeature) {
  return (
    <article className="min-w-0">
      <div className="h-full min-h-49 rounded-card border border-solid border-border bg-surface-raised p-6.5 landing-mobile:min-h-0 landing-mobile:p-5.5">
        <span className="inline-flex size-9.5 items-center justify-center rounded-button border border-solid border-border-strong bg-control-active text-accent">
          <Icon aria-hidden="true" className="size-4.75" strokeWidth={1.7} />
        </span>
        <h3 className="mt-5 mb-2.5 text-lg leading-[1.3] font-semibold tracking-landing-card text-content-strong">
          {title}
        </h3>
        <p className="mb-0 text-landing-card text-content-muted">{description}</p>
      </div>
    </article>
  );
}
