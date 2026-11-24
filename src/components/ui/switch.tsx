// Local shadcn-style wrapper for the Base UI Switch primitive.
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/utils/cn";

export function Switch({
  className,
  size = "standard",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "compact" | "standard";
}) {
  return (
    <SwitchPrimitive.Root
      render={<button type="button" />}
      nativeButton
      data-slot="switch"
      className={cn(
        "toggle-control relative inline-flex shrink-0 items-center border-standard border-solid border-line-strong rounded-pill bg-canvas-deep p-control-inset cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed transition-input-surface after:absolute after:inset-x-0 after:-inset-y-control-inset pointer-coarse:after:-inset-y-control-gap-compact control-hover:bg-surface-hover control-active:bg-action-neutral-active aria-checked:border-accent-border aria-checked:bg-accent-soft aria-checked:control-hover:border-accent aria-checked:control-hover:bg-switch-hover aria-checked:control-active:border-accent-strong aria-checked:control-active:bg-switch-active",
        size === "compact"
          ? "w-switch-compact h-switch-height-compact"
          : "w-switch-standard h-switch-height-standard",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "block shrink-0 rounded-pill bg-muted transition-switch-thumb data-checked:bg-accent-strong",
          size === "compact"
            ? "size-switch-thumb-compact data-checked:translate-x-switch-thumb-compact"
            : "size-switch-thumb-standard data-checked:translate-x-switch-thumb-standard",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
