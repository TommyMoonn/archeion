import { lazy, Suspense } from "react";

import type { Annotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import type { ReaderAnnotationLoadStatus } from "./useReaderAnnotations";

const ReaderAnnotationsPanel = lazy(() =>
  import("./ReaderAnnotationsPanel").then((module) => ({
    default: module.ReaderAnnotationsPanel,
  })),
);

type LazyReaderAnnotationsPanelProps = {
  annotations: readonly Annotation[];
  currentAnnotationId?: string;
  currentCfi?: string;
  loadStatus: ReaderAnnotationLoadStatus;
  navigation: ReaderNavigationState;
  onClose: () => void;
  onEditNote: (annotation: Annotation) => Promise<boolean>;
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onReload: () => Promise<boolean>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: Annotation, label: string) => Promise<boolean>;
};

export function LazyReaderAnnotationsPanel(props: LazyReaderAnnotationsPanelProps) {
  return (
    <Suspense fallback={<ReaderAnnotationsLoadingShell />}>
      <ReaderAnnotationsPanel {...props} />
    </Suspense>
  );
}

function ReaderAnnotationsLoadingShell() {
  return (
    <aside
      aria-busy="true"
      aria-label="Annotations"
      className="reader-toc reader-annotations"
      data-reader-ignore-shortcuts
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div aria-label="Loading annotations" className="reader-toc__loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </aside>
  );
}
