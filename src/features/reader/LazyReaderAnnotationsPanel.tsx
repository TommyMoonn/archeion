import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import type { ReaderHighlightColor } from "./readerHighlights";
import type { ReaderAnnotationExportFormat } from "./readerAnnotationExport";
import type { ReaderAnnotationExportResult } from "./readerAnnotationExportFile";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderAnnotationLoadStatus } from "./useReaderAnnotations";
import { ReaderPanelFrame } from "./ReaderPanelLoadingShells";
import { annotationsPanelModule } from "./readerPanelModules";

type LazyReaderAnnotationsPanelProps = {
  active?: boolean;
  annotations: readonly Annotation[];
  currentAnnotationId?: string;
  currentCfi?: string;
  loadStatus: ReaderAnnotationLoadStatus;
  navigation: ReaderNavigationState;
  onClose: () => void;
  onModuleReload: () => void;
  onEditNote: (annotation: HighlightAnnotation) => Promise<boolean>;
  onExport: (format: ReaderAnnotationExportFormat) => Promise<ReaderAnnotationExportResult>;
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onRecolorHighlight: (annotationId: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRecover: (annotation: Annotation) => Promise<ReaderAnnotationRecoveryResult>;
  onReload: () => Promise<boolean>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: BookmarkAnnotation, label: string) => Promise<boolean>;
  restoreFocusAnnotationId?: string;
  restoreFocusOnOpen?: boolean;
};

export function LazyReaderAnnotationsPanel(props: LazyReaderAnnotationsPanelProps) {
  const { Component, status } = annotationsPanelModule.useModule();
  const readiness =
    status !== "ready"
      ? status
      : props.loadStatus === "ready" && props.annotations.length === 0
        ? "empty"
        : props.loadStatus;
  return (
    <ReaderPanelFrame
      kind="annotations"
      active={props.active}
      onClose={props.onClose}
      readiness={readiness}
      onModuleReload={status === "error" ? props.onModuleReload : undefined}
    >
      {Component ? <Component {...props} /> : null}
    </ReaderPanelFrame>
  );
}
