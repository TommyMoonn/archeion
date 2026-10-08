import { useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { MAIN_CONTENT_ID } from "./SkipLink";

type PageShellProps = {
  children: ReactNode;
  importDropTarget?: {
    active: boolean;
    destination: string;
    id: string;
    label: string;
  };
  mainRef?: Ref<HTMLElement>;
  notice?: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed?: boolean;
};

export function PageShell({
  children,
  importDropTarget,
  mainRef,
  notice,
  sidebar,
  sidebarCollapsed = false,
}: PageShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const element = noticeRef.current;
    if (!shell || !element || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      shell.style.setProperty(
        "--page-shell-notice-height",
        `${element.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [notice]);
  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      ref={shellRef}
    >
      {sidebar}
      <main
        className="page-shell"
        data-import-drop-active={importDropTarget?.active || undefined}
        data-import-drop-destination={importDropTarget?.destination}
        data-import-drop-id={importDropTarget?.id}
        data-import-drop-label={importDropTarget?.label}
        data-import-drop-target={importDropTarget ? "true" : undefined}
        id={MAIN_CONTENT_ID}
        ref={mainRef}
        tabIndex={-1}
      >
        {children}
      </main>
      {notice ? (
        <div className="page-shell-notice" ref={noticeRef}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}
