import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type SettingsSectionHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: string;
};

export function SettingsSectionHeader({
  actions,
  className,
  description,
  title,
}: SettingsSectionHeaderProps) {
  const headerClassName = cn("settings-section__header mb-dialog-panel", className);

  return (
    <header className={headerClassName}>
      <div className="settings-section__header-copy grid min-w-0 gap-control-gap-compact">
        <h2 className="m-0 text-text-strong text-title-small">{title}</h2>
        {description ? (
          <p className="m-0 max-w-dialog-description text-muted text-body text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
