import type { ReactNode, Ref } from "react";

type PageShellProps = {
  children: ReactNode;
  mainRef?: Ref<HTMLElement>;
  sidebar: ReactNode;
};

export function PageShell({ children, mainRef, sidebar }: PageShellProps) {
  return (
    <div className="app-shell">
      {sidebar}
      <main className="page-shell" ref={mainRef}>
        {children}
      </main>
    </div>
  );
}
