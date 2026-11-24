import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Semantic type roles are font sizes, not colors. Keep text-text and text-muted composable.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        "control-compact",
        "control-standard",
        "control-prominent",
        "control-gap",
        "control-gap-compact",
        "button-compact",
        "button-standard",
        "button-prominent",
        "input-gap",
        "input-inline",
        "search-field",
        "settings-search",
        "dialog-panel",
        "busy-inset",
        "icon-glyph-standard",
      ],
      text: [
        "caption",
        "meta",
        "body",
        "body-large",
        "title-small",
        "title",
        "heading",
        "dialog-title",
        "section-title",
        "page-title",
        "display-compact",
        "display-medium",
        "display-large",
        "application-title",
        "control-label",
        "body-supporting",
        "code",
        "reader-caption",
        "reader-meta",
        "reader-body",
        "reader-body-large",
        "reader-title-small",
      ],
    },
    classGroups: { "border-w": ["border-standard"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
