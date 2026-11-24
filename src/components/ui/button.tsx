// Adapted from the shadcn Base UI Button registry component (MIT).
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const buttonVariants = cva("border-standard rounded-control border-solid", {
  variants: {
    variant: {
      primary:
        "border-accent bg-accent text-canvas-deep control-hover:border-accent-strong control-hover:bg-accent-strong control-active:border-accent-strong control-active:bg-action-primary-active",
      secondary: "border-line-strong bg-transparent text-text",
      ghost: "border-transparent bg-transparent text-text",
      danger:
        "border-danger bg-danger text-canvas-deep control-hover:border-danger-strong control-hover:bg-danger-strong control-active:border-danger-strong control-active:bg-action-danger-active",
      icon: "inline-grid shrink-0 place-items-center border-transparent bg-transparent p-0 text-muted no-underline transition-icon-action control-hover:bg-surface-hover control-hover:text-text-strong control-active:bg-action-neutral-active control-active:text-text-strong motion-safe:app-motion:control-active:scale-98",
    },
    size: {
      compact:
        "min-h-control-compact gap-control-gap-compact px-button-compact text-meta font-medium leading-control-label motion-safe:app-motion:control-active:scale-98",
      standard:
        "min-h-control-standard gap-control-gap px-button-standard text-control-label motion-safe:app-motion:control-active:scale-98",
      prominent: "min-h-control-prominent gap-control-gap px-button-prominent text-control-label",
      "icon-compact": "size-control-compact",
      "icon-standard": "size-control-standard",
      "icon-prominent": "size-control-prominent",
    },
  },
  compoundVariants: [
    {
      variant: ["secondary", "ghost"],
      class:
        "control-hover:border-line-strong control-hover:bg-surface-hover control-hover:text-text-strong control-active:border-line-strong control-active:bg-action-neutral-active control-active:text-text-strong",
    },
    {
      variant: ["primary", "secondary", "ghost", "danger"],
      class:
        "inline-flex items-center justify-center whitespace-nowrap py-0 transition-action aria-busy:cursor-progress",
    },
  ],
  defaultVariants: { variant: "primary", size: "prominent" },
});

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
