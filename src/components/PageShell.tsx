import type { ReactNode, Ref } from "react";

type PageShellProps = {
  children: ReactNode;
  importDropTarget?: {
    active: boolean;
    destination: string;
    id: string;
  };
  mainRef?: Ref<HTMLElement>;
  sidebar: ReactNode;
};

export function PageShell({ children, importDropTarget, mainRef, sidebar }: PageShellProps) {
  return (
    <div className="app-shell">
      {sidebar}
      <main
        className="page-shell"
        data-import-drop-active={importDropTarget?.active || undefined}
        data-import-drop-destination={importDropTarget?.destination}
        data-import-drop-id={importDropTarget?.id}
        data-import-drop-target={importDropTarget ? "true" : undefined}
        ref={mainRef}
      >
        {children}
      </main>
    </div>
  );
}
