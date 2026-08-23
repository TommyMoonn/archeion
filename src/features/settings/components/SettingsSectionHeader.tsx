import type { ReactNode } from "react";

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
  const headerClassName = ["settings-section__header", className].filter(Boolean).join(" ");

  return (
    <header className={headerClassName}>
      <div className="settings-section__header-copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
