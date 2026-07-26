import type { ReactNode, Ref } from "react";

type PageShellProps = {
  children: ReactNode;
  importDropTarget?: {
    active: boolean;
    destination: string;
    id: string;
    label: string;
  };
  mainRef?: Ref<HTMLElement>;
  sidebar: ReactNode;
  sidebarCollapsed?: boolean;
};

export function PageShell({
  children,
  importDropTarget,
  mainRef,
  sidebar,
  sidebarCollapsed = false,
}: PageShellProps) {
  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed || undefined}>
      {sidebar}
      <main
        className="page-shell"
        data-import-drop-active={importDropTarget?.active || undefined}
        data-import-drop-destination={importDropTarget?.destination}
        data-import-drop-id={importDropTarget?.id}
        data-import-drop-label={importDropTarget?.label}
        data-import-drop-target={importDropTarget ? "true" : undefined}
        ref={mainRef}
        tabIndex={-1}
      >
        {children}
      </main>
    </div>
  );
}
