// Adapted from the shadcn Spinner registry component (MIT), using its Lucide icon.
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <LoaderCircle
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        "size-icon-glyph-standard stroke-3 motion-safe:app-motion:data-visible:animate-button-busy",
        className,
      )}
      {...props}
    />
  );
}
