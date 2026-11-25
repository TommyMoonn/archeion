// Adapted from the shadcn Base UI Checkbox registry component (MIT).
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/utils/cn";

export function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "relative inline-flex size-checkbox shrink-0 items-center justify-center rounded-checkbox border-standard border-solid border-muted-soft bg-checkbox-surface text-canvas-deep cursor-pointer data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-55",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        aria-hidden="true"
        className="flex size-full items-center justify-center"
      >
        {indeterminate ? <Minus className="size-full" /> : <Check className="size-full" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
