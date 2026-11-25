// Adapted from the shadcn Textarea registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 resize-y rounded-control border-standard border-solid border-line bg-canvas-deep text-body text-text outline-none disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
