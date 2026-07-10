import { lazy, Suspense } from "react";

import type { ReaderNavigationState } from "../../types/reader";

const ReaderTocPanel = lazy(() =>
  import("./ReaderTocPanel").then((module) => ({ default: module.ReaderTocPanel })),
);

type LazyReaderTocPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onNavigate: (chapterId: string) => Promise<boolean>;
};

export function LazyReaderTocPanel(props: LazyReaderTocPanelProps) {
  return (
    <Suspense fallback={<ReaderTocLoadingShell />}>
      <ReaderTocPanel {...props} />
    </Suspense>
  );
}

function ReaderTocLoadingShell() {
  return (
    <aside
      aria-busy="true"
      aria-label="Table of contents"
      className="reader-toc"
      data-reader-ignore-shortcuts
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div aria-label="Loading table of contents" className="reader-toc__loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </aside>
  );
}
