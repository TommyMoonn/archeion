// Local shadcn-style wrapper for the Base UI Slider primitives.
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/utils/cn";

export function Slider({
  className,
  label,
  valueText,
  onThumbKeyDown,
  ...props
}: SliderPrimitive.Root.Props<number> & {
  label: string;
  valueText: string;
  onThumbKeyDown?: SliderPrimitive.Thumb.Props["onKeyDown"];
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("min-w-0 w-full", className)}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex h-slider-hit w-full touch-none items-center cursor-pointer select-none"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-slider-track w-full rounded-pill bg-line-strong"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="rounded-pill bg-accent"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            className="size-slider-thumb rounded-pill bg-accent"
            getAriaLabel={() => label}
            aria-valuetext={valueText}
            onKeyDown={onThumbKeyDown}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
