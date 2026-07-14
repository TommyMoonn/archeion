import type { Annotation } from "../../types/annotation";
import type { ReaderAnnotationAnchorChanges } from "./readerAnnotationState";

type QueueAnchorUpdate = (
  annotation: Annotation,
  changes: ReaderAnnotationAnchorChanges,
  signature: string,
) => Promise<boolean>;

export function acknowledgeInvalidHighlightAnchor(
  annotations: readonly Annotation[],
  queueAnchorUpdate: QueueAnchorUpdate,
  annotationId: string,
  anchorSignature = annotationId,
): Promise<boolean> {
  const annotation = annotations.find(
    (candidate) => candidate.id === annotationId && candidate.type === "highlight",
  );
  if (!annotation) return Promise.resolve(false);
  if (annotation.anchorStatus === "detached") return Promise.resolve(true);
  return queueAnchorUpdate(annotation, { anchorStatus: "detached" }, anchorSignature);
}
