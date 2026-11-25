import type { ComponentProps } from "react";

export function SettingsSection({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={`settings-section @container/settings-section w-full max-w-settings-section mx-auto pt-control-gap scroll-mt-control-compact [&:not(.settings-section--keyboard)>[data-settings-group]+[data-settings-group]]:mt-control-compact [&>[data-setting-id]+[data-settings-group]]:mt-control-compact ${className ?? ""}`.trim()}
      {...props}
    />
  );
}
