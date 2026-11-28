import type { ReactNode } from "react";

import { ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";

export const archiveFallbackClassName =
  "grid w-full max-w-archive-content min-w-0 min-h-0 content-center justify-items-center justify-self-center gap-archive-feedback p-control-prominent text-center";
export const archiveFallbackHeadingClassName =
  "m-0 font-app-display text-section-title font-semibold leading-inherit tracking-archive-fallback text-text-strong";
export const archiveFallbackMessageClassName =
  "m-0 max-w-archive-message text-body leading-archive-feedback wrap-anywhere";

export function ArchiveManagerLayout({
  children,
  sidebar,
  titleId,
  busy,
  ready,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  titleId?: string;
  busy?: boolean;
  ready?: boolean;
}) {
  const hasSidebar = sidebar !== undefined;

  return (
    <main
      className="grid h-full min-h-0 bg-surface-app-frame"
      id={ARCHIVE_MANAGER_MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy={(!hasSidebar && busy) || undefined}
      data-utility-ready={ready || undefined}
    >
      <section
        aria-busy={(hasSidebar && busy) || undefined}
        aria-labelledby={titleId}
        className="grid size-full min-h-0 grid-rows-1 overflow-hidden bg-surface-app-frame"
      >
        <div className="grid h-full min-h-0 grid-cols-archive-manager archive-stacked:grid-cols-1 archive-stacked:overflow-y-auto">
          <aside
            aria-hidden={!hasSidebar || undefined}
            aria-label={hasSidebar ? "Archives" : undefined}
            className={`relative z-1 flex min-h-0 flex-col border-e-standard border-line-subtle bg-surface-sidebar p-sidebar-inset archive-stacked:min-h-archive-sidebar-stacked archive-stacked:border-e-0 archive-stacked:border-be-standard ${hasSidebar ? "" : "archive-stacked:hidden"}`}
            data-archive-catalog=""
          >
            {sidebar}
          </aside>
          <section
            aria-label={titleId === undefined ? "Archive Manager" : undefined}
            className="relative grid min-w-0 min-h-0 content-start gap-archive-main py-archive-main-block px-archive-main-inline bg-surface-main"
            data-archive-detail=""
          >
            {children}
          </section>
        </div>
      </section>
    </main>
  );
}
