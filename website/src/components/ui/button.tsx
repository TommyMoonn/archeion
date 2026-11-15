import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-button border-0 font-sans text-sm font-semibold whitespace-nowrap motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:bg-control-disabled disabled:text-content-subtle [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-hover",
        destructive: "bg-danger text-danger-foreground",
        outline:
          "border border-solid border-border-strong bg-transparent text-content hover:bg-control-hover active:bg-control-active",
        secondary: "bg-control text-content hover:bg-control-hover active:bg-control-active",
        ghost: "bg-transparent text-content hover:bg-control-hover active:bg-control-active",
        link: "bg-transparent text-accent underline-offset-4 hover:text-accent-hover hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-control px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-control px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-button px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-control [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
