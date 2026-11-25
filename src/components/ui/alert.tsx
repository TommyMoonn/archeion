// Adapted from the shadcn Alert registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Alert({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn("relative min-w-0 wrap-anywhere", className)}
      {...props}
    />
  );
}
