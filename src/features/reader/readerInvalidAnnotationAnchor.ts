import type { Annotation, HighlightAnnotation } from "../../types/annotation";

export function invalidHighlightAnchorTarget(
  annotations: readonly Annotation[],
  annotationId: string,
): HighlightAnnotation | undefined {
  const annotation = annotations.find(
    (candidate) => candidate.id === annotationId && candidate.type === "highlight",
  );
  return annotation?.type === "highlight" ? annotation : undefined;
}
