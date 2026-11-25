// Adapted from the shadcn Base UI Progress registry component (MIT).
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/utils/cn";

export function Progress({ className, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("min-w-0 w-full", className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="h-control-gap-compact overflow-hidden rounded-pill bg-line-strong forced-colors:border-standard forced-colors:border-solid"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full rounded-pill bg-accent data-indeterminate:w-1/3 motion-safe:app-motion:data-indeterminate:animate-progress-indeterminate forced-colors:border-2 forced-colors:border-solid"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}
