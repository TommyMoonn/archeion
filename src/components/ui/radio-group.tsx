// Local shadcn-style wrapper for the Base UI Radio Group primitives.
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { cn } from "@/utils/cn";

export const RadioGroup = RadioGroupPrimitive;

export function RadioGroupItem<TValue extends string>({
  className,
  iconOnly,
  size,
  ...props
}: RadioPrimitive.Root.Props<TValue> & {
  iconOnly: boolean;
  size: "compact" | "standard";
}) {
  return (
    <RadioPrimitive.Root
      render={<button type="button" />}
      nativeButton
      data-slot="radio-group-item"
      className={cn(
        "segmented-control__option inline-flex min-w-0 items-center justify-center gap-control-gap-compact border-standard border-solid border-transparent bg-transparent text-muted text-caption wrap-anywhere cursor-pointer disabled:cursor-not-allowed transition-segment control-hover:text-text-strong control-hover:bg-surface-hover aria-checked:border-line-strong aria-checked:text-text-strong aria-checked:bg-surface-raised control-active:text-text-strong control-active:bg-action-neutral-active motion-safe:app-motion:control-active:scale-98",
        iconOnly
          ? "size-segment-icon min-w-segment-icon min-h-segment-icon rounded-control p-0"
          : cn(
              "rounded-segment px-button-compact py-0",
              size === "compact" ? "min-h-control-compact" : "min-h-control-standard",
            ),
        className,
      )}
      {...props}
    />
  );
}
