// Adapted from the shadcn Base UI Input Group registry component (MIT).
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";
import { Input } from "./input";

// This group is a native label: clicking its noninteractive addon focuses the input.
export function InputGroup({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="input-group"
      className={cn(
        "flex w-search-field items-center gap-input-gap rounded-control border-standard border-solid border-line bg-surface px-input-inline py-0 text-muted transition-input-surface",
        "focus-within:border-accent-border focus-within:bg-surface-raised",
        "has-[input[aria-invalid=true]]:border-error-strong has-[input[aria-invalid=true]]:outline-2 has-[input[aria-invalid=true]]:outline-dashed has-[input[aria-invalid=true]]:outline-error-strong has-[input[aria-invalid=true]]:outline-offset-2",
        "keyboard-navigation:has-[input:focus-visible]:outline-2 keyboard-navigation:has-[input:focus-visible]:outline-solid keyboard-navigation:has-[input:focus-visible]:outline-focus keyboard-navigation:has-[input:focus-visible]:outline-offset-2",
        "has-disabled:cursor-not-allowed has-disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupAddon(props: ComponentProps<"span">) {
  return <span data-slot="input-group-addon" data-align="inline-start" {...props} />;
}

export function InputGroupInput(props: ComponentProps<"input">) {
  return <Input data-slot="input-group-control" {...props} />;
}
