import type { Book as EpubBook, Rendition } from "epubjs";
import type EpubSection from "epubjs/types/section";

import type { EpubLocalTarget } from "./epubContentActions";
import {
  resolveEpubFootnote,
  type EpubFootnoteResolution,
  type ResolveEpubFootnoteInput,
} from "./epubFootnoteResolver";
import {
  illustrationTargetForElement,
  resolveEpubIllustration,
  type EpubIllustrationResolution,
} from "./epubIllustrationResolver";

export type EpubAnnotationSessionAccess = Readonly<{
  getRange: (cfi: string) => Promise<Range>;
  getSection: (target: string) => EpubSection | undefined;
  highlight: (
    cfiRange: string,
    data?: object,
    callback?: (event: Event) => void,
    className?: string,
    styles?: object,
  ) => void;
  isSectionRendered: (section: EpubSection) => boolean;
  listSections: () => readonly EpubSection[];
  loadSection: (section: EpubSection) => Promise<void>;
  removeAnnotation: (cfiRange: string, type: string) => void;
  underline: (
    cfiRange: string,
    data?: object,
    callback?: (event: Event) => void,
    className?: string,
    styles?: object,
  ) => void;
}>;

export type EpubContentSessionAccess = Readonly<{
  illustrationTargetForElement: (
    element: Element,
    currentDocumentHref: string,
  ) => EpubLocalTarget | null;
  resolveFootnote: (
    input: Omit<ResolveEpubFootnoteInput, "book">,
  ) => Promise<EpubFootnoteResolution>;
  resolveIllustration: (
    target: EpubLocalTarget,
    signal?: AbortSignal,
  ) => Promise<EpubIllustrationResolution>;
}>;

export type EpubSessionInteractionAccess = Readonly<{
  annotations: EpubAnnotationSessionAccess;
  content: EpubContentSessionAccess;
}>;

function renditionOwnsSection(rendition: Rendition, section: EpubSection): boolean {
  if (typeof rendition.getContents !== "function") return false;
  try {
    const contents = rendition.getContents() as unknown;
    if (!Array.isArray(contents)) return false;
    return contents.some((content: { sectionIndex?: number; section?: EpubSection } | null) => {
      if (typeof content?.sectionIndex === "number" && content.sectionIndex === section.index) {
        return true;
      }
      return content?.section === section;
    });
  } catch {
    return false;
  }
}

export function createEpubSessionInteractionAccess(
  book: EpubBook,
  rendition: Rendition,
): EpubSessionInteractionAccess {
  const annotations: EpubAnnotationSessionAccess = Object.freeze({
    getRange: (cfi: string) => book.getRange(cfi),
    getSection: (target: string) => book.spine.get(target) ?? undefined,
    highlight: (cfiRange, data, callback, className, styles) => {
      rendition.annotations.highlight(cfiRange, data, callback, className, styles);
    },
    isSectionRendered: (section) => renditionOwnsSection(rendition, section),
    listSections: () => {
      const sections: EpubSection[] = [];
      book.spine.each((section: EpubSection) => sections.push(section));
      return sections;
    },
    loadSection: async (section) => {
      await Promise.resolve(section.load(book.load.bind(book)));
    },
    removeAnnotation: (cfiRange, type) => rendition.annotations.remove(cfiRange, type),
    underline: (cfiRange, data, callback, className, styles) => {
      rendition.annotations.underline(cfiRange, data, callback, className, styles);
    },
  });
  const content: EpubContentSessionAccess = Object.freeze({
    illustrationTargetForElement: (element, currentDocumentHref) =>
      illustrationTargetForElement(book, element, currentDocumentHref),
    resolveFootnote: (input) => resolveEpubFootnote({ ...input, book }),
    resolveIllustration: (target, signal) => resolveEpubIllustration(book, target, signal),
  });

  return Object.freeze({ annotations, content });
}
