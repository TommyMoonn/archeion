import type { ReactNode } from "react";
import { Empty, EmptyDescription } from "./ui/empty";

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  role?: "alert";
  title: string;
};

export function EmptyState({ action, description, icon, role, title }: EmptyStateProps) {
  return (
    <Empty
      as="section"
      role={role}
      className={`empty-state box-border w-full max-w-empty-state items-center px-dialog-panel text-center ${icon ? "gap-empty-art py-status-inset" : "gap-empty-text py-dialog-panel"}`}
    >
      {icon ? (
        <span
          className="empty-state__icon grid size-control-compact flex-none place-items-center text-muted [&>svg]:block [&>svg]:size-full"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="grid justify-items-center gap-dialog-copy min-w-0">
        <h2
          className={`m-0 text-text-strong ${icon ? "font-app-display text-section-title" : "font-interface text-title-small tracking-normal"}`}
        >
          {title}
        </h2>
        <EmptyDescription className="max-w-empty-copy text-body-large">
          {description}
        </EmptyDescription>
      </div>
      {action}
    </Empty>
  );
}
