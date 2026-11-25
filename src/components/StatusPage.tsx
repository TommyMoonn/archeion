import type { ComponentProps } from "react";

export function StatusPage({
  as: Element = "main",
  className,
  ...props
}: ComponentProps<"main"> & { as?: "main" | "section" }) {
  return (
    <Element
      className={`${className ?? "status-page"} flex flex-col items-center justify-center p-status-inset text-center text-muted bg-canvas-deep ${Element === "section" ? "min-h-0" : "min-h-dvh"} [&>h1]:mt-status-heading-gap [&>h1]:mb-0 [&>h1]:font-app-display [&>h1]:text-display-medium [&>h1]:text-text-strong [&>p:not([data-status-code])]:mt-empty-text [&>p:not([data-status-code])]:mb-0 [&>p:not([data-status-code])]:max-w-status-copy [&>p:not([data-status-code])]:text-body-large [&>p:not([data-status-code])]:text-muted [&>p:not([data-status-code])]:wrap-anywhere`}
      {...props}
    />
  );
}
