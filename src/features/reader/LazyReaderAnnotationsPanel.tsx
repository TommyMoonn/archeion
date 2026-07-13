import { lazy, Suspense } from "react";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import type { ReaderHighlightColor } from "./readerHighlights";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderAnnotationLoadStatus } from "./useReaderAnnotations";

const ReaderAnnotationsPanel = lazy(() =>
  import("./ReaderAnnotationsPanel").then((module) => ({
    default: module.ReaderAnnotationsPanel,
  })),
);

type LazyReaderAnnotationsPanelProps = {
  active?: boolean;
  annotations: readonly Annotation[];
  currentAnnotationId?: string;
  currentCfi?: string;
  loadStatus: ReaderAnnotationLoadStatus;
  navigation: ReaderNavigationState;
  onClose: () => void;
  onEditNote: (annotation: HighlightAnnotation) => Promise<boolean>;
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onRecolorHighlight: (annotationId: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRecover: (annotation: Annotation) => Promise<ReaderAnnotationRecoveryResult>;
  onReload: () => Promise<boolean>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: Annotation, label: string) => Promise<boolean>;
  restoreFocusAnnotationId?: string;
};

export function LazyReaderAnnotationsPanel(props: LazyReaderAnnotationsPanelProps) {
  return (
    <Suspense fallback={<ReaderAnnotationsLoadingShell active={props.active} />}>
      <ReaderAnnotationsPanel {...props} />
    </Suspense>
  );
}

function ReaderAnnotationsLoadingShell({ active = true }: { active?: boolean }) {
  return (
    <aside
      aria-busy="true"
      aria-label="Annotations"
      className="reader-toc reader-annotations"
      data-reader-ignore-shortcuts
      hidden={!active}
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
