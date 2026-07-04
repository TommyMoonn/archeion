import type { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
};

export function PageShell({ children, sidebar }: PageShellProps) {
  return (
    <div className="app-shell">
      {sidebar}
      <main className="page-shell">{children}</main>
    </div>
  );
}
