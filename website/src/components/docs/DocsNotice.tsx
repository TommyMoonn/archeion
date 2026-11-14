import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function DocsNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="my-6 grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.75 gap-y-1 rounded-button border border-solid border-border bg-surface-raised px-4.5 py-4">
      <Info aria-hidden="true" className="mt-1 size-4.5 text-content-muted" />
      <div className="text-sm font-semibold text-content-strong">{title}</div>
      <div className="col-start-2 text-sm leading-relaxed text-content-muted [&_p:last-child]:mb-0">
        {children}
      </div>
    </aside>
  );
}
