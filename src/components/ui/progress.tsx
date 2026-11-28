// Adapted from the shadcn Base UI Progress registry component (MIT).
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/utils/cn";

type ProgressProps = Omit<ProgressPrimitive.Root.Props, "render"> &
  ({ nativeAppearance?: false } | { nativeAppearance: true; min?: 0 });

export function Progress({ className, nativeAppearance, ...props }: ProgressProps) {
  if (nativeAppearance) {
    return (
      <ProgressPrimitive.Root
        data-slot="progress"
        className={cn("h-control-gap-compact min-w-0 w-full accent-accent", className)}
        {...props}
        // Keep the native rendering, with the same value Base UI exposes to assistive technology.
        render={(elementProps) => (
          <progress
            {...elementProps}
            children={null}
            max={elementProps["aria-valuemax"]}
            value={elementProps["aria-valuenow"]}
          />
        )}
      />
    );
  }

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
