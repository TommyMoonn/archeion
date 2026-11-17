import { cn } from "@/lib/utils";
import type { LandingFeature } from "./content";

export function FeatureCard({
  title,
  description,
  icon: Icon,
  compact = false,
}: LandingFeature & { compact?: boolean }) {
  const details = (
    <>
      <h3
        className={cn(
          "font-semibold tracking-landing-card text-content-strong",
          compact
            ? "mb-1.5 text-base leading-[1.35] landing-menu:mt-5 landing-menu:mb-2.5 landing-menu:text-lg"
            : "mt-5 mb-2.5 text-lg leading-[1.3]",
        )}
      >
        {title}
      </h3>
      <p className="mb-0 text-landing-card text-content-muted">{description}</p>
    </>
  );

  return (
    <article className="min-w-0">
      <div
        className={cn(
          "h-full rounded-card border border-solid border-border bg-surface-raised",
          compact
            ? "flex items-start gap-3.5 p-4.5 landing-menu:block landing-menu:min-h-49 landing-menu:p-6.5 landing-mobile:min-h-0 landing-mobile:p-5.5"
            : "min-h-49 p-6.5 landing-mobile:min-h-0 landing-mobile:p-5.5",
        )}
      >
        <span
          className={cn(
            "inline-flex size-9.5 items-center justify-center rounded-button border border-solid border-border-strong bg-control-active text-accent",
            compact && "shrink-0",
          )}
        >
          <Icon aria-hidden="true" className="size-4.75" strokeWidth={1.7} />
        </span>
        {compact ? <div className="min-w-0">{details}</div> : details}
      </div>
    </article>
  );
}
