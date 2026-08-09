import type EpubSection from "epubjs/types/section";

import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";
import type { ReaderRecoverySection } from "./readerAnnotationRecovery";

export const READER_ANNOTATION_SECTION_LOAD_CONCURRENCY = 1;

export type ReaderSectionTaskResult<T> = { kind: "cancelled" } | { kind: "completed"; value: T };

function sectionIsLoaded(section: EpubSection): boolean {
  return Boolean(section.document || section.contents);
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
    session: EpubAnnotationSessionAccess,
    section: EpubSection,
    signal: AbortSignal | undefined,
    task: (loaded: ReaderRecoverySection) => T | Promise<T>,
  ): Promise<ReaderSectionTaskResult<T>> {
    const generation = this.generation;
    const work = this.queue.then(async (): Promise<ReaderSectionTaskResult<T>> => {
      if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };

      const wasLoaded = sectionIsLoaded(section);
      try {
        if (!wasLoaded) await session.loadSection(section);
        if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };
        const loaded = recoverySection(section);
        if (!loaded) throw new Error("EPUB section did not expose a document after loading.");
        const value = await task(loaded);
        if (signal?.aborted || generation !== this.generation) return { kind: "cancelled" };
        return { kind: "completed", value };
      } finally {
        if (!wasLoaded && !session.isSectionRendered(section)) section.unload();
      }
    });

    this.queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
}
