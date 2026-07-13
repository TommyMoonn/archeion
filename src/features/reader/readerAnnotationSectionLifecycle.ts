import type { Book as EpubBook, Rendition } from "epubjs";
import type EpubSection from "epubjs/types/section";

import type { ReaderRecoverySection } from "./readerAnnotationRecovery";

export const READER_ANNOTATION_SECTION_LOAD_CONCURRENCY = 1;

export type ReaderSectionTaskResult<T> = { kind: "cancelled" } | { kind: "completed"; value: T };

function sectionIsLoaded(section: EpubSection): boolean {
  return Boolean(section.document || section.contents);
}

function renditionOwnsSection(rendition: Rendition | null, section: EpubSection): boolean {
  if (!rendition || typeof rendition.getContents !== "function") return false;
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

function recoverySection(section: EpubSection): ReaderRecoverySection | undefined {
  if (!section.document) return undefined;
  return {
    cfiFromElement: (element) => section.cfiFromElement(element),
    cfiFromRange: (range) => section.cfiFromRange(range),
    document: section.document,
    href: section.href,
  };
}

export class ReaderAnnotationSectionLifecycle {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();

  invalidate(): void {
    this.generation += 1;
  }

  run<T>(
    book: EpubBook,
    rendition: Rendition | null,
    section: EpubSection,
    signal: AbortSignal | undefined,
    task: (loaded: ReaderRecoverySection) => T | Promise<T>,
  ): Promise<ReaderSectionTaskResult<T>> {
    const generation = this.generation;
    const work = this.queue.then(async (): Promise<ReaderSectionTaskResult<T>> => {
      if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };

      const wasLoaded = sectionIsLoaded(section);
      try {
        if (!wasLoaded) await Promise.resolve(section.load(book.load.bind(book)));
        if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };
        const loaded = recoverySection(section);
        if (!loaded) throw new Error("EPUB section did not expose a document after loading.");
        const value = await task(loaded);
        if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };
        return { kind: "completed", value };
      } finally {
        if (!wasLoaded && !renditionOwnsSection(rendition, section)) section.unload();
      }
    });

    this.queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
}
