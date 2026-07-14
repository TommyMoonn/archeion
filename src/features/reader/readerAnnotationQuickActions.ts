import type { QuickActionCommand } from "../quick-actions/quickActions";

export function readerAnnotationQuickActions(
  openAnnotations: () => void,
): readonly QuickActionCommand[] {
  return [
    {
      execute: openAnnotations,
      group: "Reader",
      id: "reader.open-annotations",
      keywords: ["bookmarks", "highlights", "notes"],
      label: "Open annotations",
      order: 81,
    },
  ];
}
