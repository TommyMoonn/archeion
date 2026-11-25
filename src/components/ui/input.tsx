// Adapted from the shadcn Base UI Input registry component (MIT).
import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Input({
  className,
  type,
  standalone = false,
  ...props
}: ComponentProps<"input"> & { standalone?: boolean }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 border-none border-current bg-transparent text-body text-text outline-none",
        !standalone && "placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
}
