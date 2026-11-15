import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "box-border h-9 w-full min-w-0 rounded-control border border-solid border-border-strong bg-control px-3 py-1 font-sans text-base text-content selection:bg-accent-subtle selection:text-content-strong file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-content placeholder:text-content-muted disabled:cursor-not-allowed disabled:bg-control-disabled disabled:text-content-subtle md:text-sm",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
