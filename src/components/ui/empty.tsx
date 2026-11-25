// Adapted from the shadcn Empty registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Empty({
  as: Element = "div",
  className,
  ...props
}: ComponentProps<"div"> & { as?: "div" | "section" }) {
  return (
    <Element data-slot="empty" className={cn("flex min-w-0 flex-col", className)} {...props} />
  );
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("m-0 text-muted text-meta wrap-anywhere", className)}
      {...props}
    />
  );
}
