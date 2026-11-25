// Adapted from the shadcn Field and Label registry components (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

// A single native wrapping label preserves activation of the input and its noninteractive addons.
export function Field({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="field"
      className={cn("form-field grid min-w-0 gap-field-label", className)}
      {...props}
    />
  );
}

export function FieldLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="field-label"
      className={cn("text-caption font-medium tracking-field-label text-muted", className)}
      {...props}
    />
  );
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn(
        "form-error m-0 wrap-anywhere text-body-supporting text-error-strong",
        className,
      )}
      {...props}
    />
  );
}

export function FieldRequired({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "form-required ms-field-required text-caption font-medium leading-inherit tracking-normal text-error-strong",
        className,
      )}
      {...props}
    />
  );
}

export const fieldInputClassName =
  "min-h-control-prominent rounded-control border-standard border-solid border-line-strong bg-canvas-deep px-field-inline py-0 focus:border-accent focus:ring-2 focus:ring-accent-soft";
