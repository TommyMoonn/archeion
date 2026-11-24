// Adapted from the shadcn Badge registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex shrink-0 items-center rounded-pill border-standard border-solid border-line-strong px-badge-inline py-control-inset text-muted text-caption font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
