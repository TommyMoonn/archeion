// Adapted from the shadcn Skeleton registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-control bg-surface-raised", className)}
      {...props}
    />
  );
}
