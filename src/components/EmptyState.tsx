import type { ReactNode } from "react";

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
};

export function EmptyState({ action, description, icon, title }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        <span className="empty-state__glow" />
        <span className="empty-state__icon">{icon}</span>
      </div>
      <div className="empty-state__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}
