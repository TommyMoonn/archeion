// Adapted from the shadcn Kbd registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Kbd({
  className,
  variant = "keycap",
  ...props
}: ComponentProps<"kbd"> & {
  variant?: "keycap" | "inline";
}) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "min-w-0 max-w-full font-mono text-body-supporting font-medium",
        variant === "keycap" &&
          "min-h-control-compact rounded-control border-standard border-solid border-line-strong bg-surface px-dialog-footer py-control-gap-compact whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
