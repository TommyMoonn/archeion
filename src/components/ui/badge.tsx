// Adapted from the shadcn Badge registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const variants = {
  default:
    "inline-flex shrink-0 items-center rounded-pill border-standard border-solid border-line-strong px-badge-inline py-control-inset text-caption text-muted font-medium whitespace-nowrap",
  "cover-overlay":
    "inline-flex shrink-0 items-center justify-center rounded-control border-standard border-solid border-cover-progress-border bg-cover-progress-surface px-badge-inline py-0 text-caption text-cover-progress-text font-semibold leading-none tabular-nums shadow-cover-progress backdrop-blur-cover-progress",
  plain: "text-caption-size text-muted whitespace-nowrap",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: ComponentProps<"span"> & { variant?: keyof typeof variants }) {
  return <span data-slot="badge" className={cn(variants[variant], className)} {...props} />;
}
