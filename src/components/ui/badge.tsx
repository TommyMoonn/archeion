// Adapted from the shadcn Badge registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Badge({
  className,
  variant = "default",
  ...props
}: ComponentProps<"span"> & { variant?: "default" | "cover-overlay" }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex shrink-0 items-center border-standard border-solid text-caption",
        variant === "cover-overlay"
          ? "justify-center rounded-control border-cover-progress-border bg-cover-progress-surface px-badge-inline py-0 text-cover-progress-text font-semibold leading-none tabular-nums shadow-cover-progress backdrop-blur-cover-progress"
          : "rounded-pill border-line-strong px-badge-inline py-control-inset text-muted font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
