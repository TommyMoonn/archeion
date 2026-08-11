// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { Book as EpubBook } from "epubjs";
import type EpubSection from "epubjs/types/section";

import { emptyReaderNavigationModel, type ReaderNavigationModel } from "./readerNavigationModel";
import {
  createReaderPublicationSearchService,
  READER_PUBLICATION_SEARCH_RESULT_LIMIT,
  READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY,
} from "./readerPublicationSearch";

type TestSection = {
  cfiFromRange: ReturnType<typeof vi.fn>;
  contents?: Element;
  document?: Document;
  href: string;
  index: number;
  linear: boolean;
  load: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createSection(
  index: number,
  html: string,
  options: { href?: string; initiallyLoaded?: boolean; linear?: boolean } = {},
): {
  document: Document;
  section: TestSection;
} {
  const chapter = document.implementation.createHTMLDocument(`section-${index}`);
  chapter.body.innerHTML = html;
  const href = options.href ?? `Text/section-${index + 1}.xhtml`;
  const section = {
    cfiFromRange: vi.fn((range: Range) => {
      const start = range.startOffset;
      const end = range.endOffset;
      return `epubcfi(/6/${(index + 1) * 2}!/4/2:${start},/4/2:${end})`;
    }),
    contents: options.initiallyLoaded ? chapter.documentElement : undefined,
    document: options.initiallyLoaded ? chapter : undefined,
    href,
    index,
    linear: options.linear ?? true,
    load: vi.fn(async () => {
      section.document = chapter;
      section.contents = chapter.documentElement;
      return chapter.documentElement;
    }),
    unload: vi.fn(() => {
      section.document = undefined;
      section.contents = undefined;
    }),
  } satisfies TestSection;

  return { document: chapter, section };
}

function createBook(sections: readonly TestSection[]): EpubBook {
  const sectionByIndex = new Map(sections.map((section) => [section.index, section]));
  return {
    load: vi.fn(),
    packaging: {},
    resolve: vi.fn((href: string) => href),
    spine: {
      each: (callback: (section: TestSection) => void) => {
        for (const section of sections) callback(section);
      },
      get: (target?: string | number) => {
        if (typeof target === "number") return sectionByIndex.get(target);
        if (typeof target === "string" && target.startsWith("epubcfi(")) {
          const match = target.match(/^epubcfi\(\/6\/(\d+)/u);
          const packageIndex = match ? Number(match[1]) / 2 - 1 : Number.NaN;
          return sectionByIndex.get(packageIndex);
        }
        return sections.find((section) => section.href === target);
      },
    },
  } as unknown as EpubBook;
}

function createSectionAccess(sections: readonly TestSection[]) {
  return {
    isSectionRendered: vi.fn(() => false),
    listSections: () => sections as unknown as readonly EpubSection[],
    loadSection: async (section: EpubSection) => {
      await Promise.resolve(section.load());
    },
  };
}

function navigationModel(): ReaderNavigationModel {
  return {
    ...emptyReaderNavigationModel,
    findNearestChapter: vi.fn((cfi: string) =>
      cfi.includes("/6/2!")
        ? {
            depth: 0,
            href: "Text/section-1.xhtml",
            id: "chapter-one",
            label: "Chapter One",
            position: { cfi, spineIndex: 0 },
            target: cfi,
          }
        : undefined,
    ),
  };
}

describe("readerPublicationSearch", () => {
  it("finds readable linear-spine matches in publication order with stable exact Reader targets", async () => {
    const first = createSection(0, "<p>First Needle passage.</p>");
    const skipped = createSection(1, "<p>needle from non-linear notes</p>", { linear: false });
    const third = createSection(2, "<p>Later needle passage.</p>");
    const sections = [first.section, skipped.section, third.section];
    const service = createReaderPublicationSearchService({
      book: createBook(sections),
      getNavigationModel: navigationModel,
      sections: createSectionAccess(sections),
    });

    const outcome = await service.search("needle");

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.results).toEqual([
      expect.objectContaining({
        chapterId: "chapter-one",
        chapterLabel: "Chapter One",
        id: expect.stringMatching(/^search-result-1:/u),
        matchedText: "Needle",
        position: { matchIndex: 0, spineIndex: 0 },
        target: expect.stringContaining("epubcfi(/6/2!"),
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^search-result-3:/u),
        matchedText: "needle",
        position: { matchIndex: 0, spineIndex: 2 },
        target: expect.stringContaining("epubcfi(/6/6!"),
      }),
    ]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.truncated).toBe(false);
    expect(skipped.section.load).not.toHaveBeenCalled();
    expect(first.section.unload).toHaveBeenCalledOnce();
    expect(third.section.unload).toHaveBeenCalledOnce();
  });

  it("normalizes ordinary whitespace and case while excluding script and style text from readable excerpts", async () => {
    const { section } = createSection(
      0,
      `<p>Before <strong>Needle</strong>\n\t CASE after.</p>
       <script>needle case from script</script>
       <style>.fake::before { content: "needle case from style"; }</style>`,
    );
    const service = createReaderPublicationSearchService({
      book: createBook([section]),
      sections: createSectionAccess([section]),
    });

    const outcome = await service.search("  needle     case  ");

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toEqual(
      expect.objectContaining({
        excerpt: "Before Needle CASE after.",
        excerptMatch: { end: 18, start: 7 },
        matchedText: "Needle CASE",
      }),
    );
    expect(outcome.results[0]?.excerpt).not.toContain("script");
    expect(outcome.results[0]?.excerpt).not.toContain("style");
    expect(outcome.results[0]?.excerpt).not.toContain("<");
  });

  it("locates the actual case-preserved match inside a truncated displayed excerpt", async () => {
    const prefix = "context ".repeat(20);
    const suffix = " tail".repeat(20);
    const { section } = createSection(0, `<p>${prefix}NeEdLe${suffix}</p>`);
    const service = createReaderPublicationSearchService({
      book: createBook([section]),
      sections: createSectionAccess([section]),
    });

    const outcome = await service.search("needle");

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    const result = outcome.results[0];
    expect(result?.excerpt.startsWith("…")).toBe(true);
    expect(result?.excerpt.endsWith("…")).toBe(true);
    expect(result?.matchedText).toBe("NeEdLe");
    expect(result?.excerpt.slice(result.excerptMatch.start, result.excerptMatch.end)).toBe(
      "NeEdLe",
    );
  });

  it("caps returned results, reports truncation, and keeps deterministic publication ordering and ids", async () => {
    const first = createSection(0, "<p>hit hit hit</p>");
    const second = createSection(1, "<p>hit hit</p>");
    const sections = [first.section, second.section];
    const service = createReaderPublicationSearchService({
      book: createBook(sections),
      sections: createSectionAccess(sections),
    });

    const firstOutcome = await service.search("hit", { maxResults: 3 });
    const secondOutcome = await service.search("HIT", { maxResults: 3 });

    for (const outcome of [firstOutcome, secondOutcome]) {
      expect(outcome.kind).toBe("completed");
      if (outcome.kind !== "completed") continue;
      expect(outcome.truncated).toBe(true);
      expect(outcome.results.map((result) => result.position)).toEqual([
        { matchIndex: 0, spineIndex: 0 },
        { matchIndex: 1, spineIndex: 0 },
        { matchIndex: 2, spineIndex: 0 },
      ]);
    }
    if (firstOutcome.kind === "completed" && secondOutcome.kind === "completed") {
      expect(secondOutcome.results.map((result) => result.id)).toEqual(
        firstOutcome.results.map((result) => result.id),
      );
      expect(new Set(firstOutcome.results.map((result) => result.id)).size).toBe(3);
    }
  });

  it("never allows a caller result limit to raise the service hard cap", async () => {
    const overCapHtml = `<p>${Array.from(
      { length: READER_PUBLICATION_SEARCH_RESULT_LIMIT + 5 },
      () => "hit",
    ).join(" ")}</p>`;
    const overCapSection = createSection(0, overCapHtml);
    const service = createReaderPublicationSearchService({
      book: createBook([overCapSection.section]),
      sections: createSectionAccess([overCapSection.section]),
    });

    const outcome = await service.search("hit", { maxResults: 100_000 });

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.results).toHaveLength(READER_PUBLICATION_SEARCH_RESULT_LIMIT);
    expect(outcome.truncated).toBe(true);
  });

  it("shares one transient load between concurrent searches of the same section", async () => {
    const created = createSection(0, "<p>needle</p>");
    const load = deferred<Element>();
    created.section.load.mockImplementationOnce(async () => {
      await load.promise;
      created.section.document = created.document;
      created.section.contents = created.document.documentElement;
      return created.document.documentElement;
    });

    let cfiCalls = 0;
    created.section.cfiFromRange.mockImplementation((range: Range) => {
      cfiCalls += 1;
      if (cfiCalls === 2) {
        expect(created.section.unload).not.toHaveBeenCalled();
      }
      return `epubcfi(/6/2!/4/2:${range.startOffset},/4/2:${range.endOffset})`;
    });

    const service = createReaderPublicationSearchService({
      book: createBook([created.section]),
      sections: createSectionAccess([created.section]),
    });
    const first = service.search("needle");
    const second = service.search("needle");

    await vi.waitFor(() => expect(created.section.load).toHaveBeenCalledOnce());
    load.resolve(created.document.documentElement);

    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    for (const outcome of [firstOutcome, secondOutcome]) {
      expect(outcome.kind).toBe("completed");
      if (outcome.kind === "completed") {
        expect(outcome.results).toHaveLength(1);
      }
    }
    expect(created.section.load).toHaveBeenCalledOnce();
    expect(cfiCalls).toBe(2);
    expect(created.section.unload).toHaveBeenCalledOnce();
  });

  it("keeps a replacement search valid when the cancelled search releases a pending shared section load", async () => {
    const created = createSection(0, "<p>needle replacement</p>");
    const load = deferred<Element>();
    created.section.load.mockImplementationOnce(async () => {
      await load.promise;
      created.section.document = created.document;
      created.section.contents = created.document.documentElement;
      return created.document.documentElement;
    });

    const service = createReaderPublicationSearchService({
      book: createBook([created.section]),
      sections: createSectionAccess([created.section]),
    });
    const firstController = new AbortController();
    const first = service.search("needle", { signal: firstController.signal });
    await vi.waitFor(() => expect(created.section.load).toHaveBeenCalledOnce());

    firstController.abort();
    const second = service.search("replacement");
    await expect(first).resolves.toEqual({ kind: "cancelled" });
    expect(created.section.load).toHaveBeenCalledOnce();
    expect(created.section.unload).not.toHaveBeenCalled();

    load.resolve(created.document.documentElement);

    const secondOutcome = await second;
    expect(secondOutcome.kind).toBe("completed");
    if (secondOutcome.kind === "completed") {
      expect(secondOutcome.results).toHaveLength(1);
      expect(secondOutcome.results[0]?.matchedText).toBe("replacement");
    }
    expect(created.section.load).toHaveBeenCalledOnce();
    expect(created.section.unload).toHaveBeenCalledOnce();
  });

  it("bounds transient section loads and cancellation prevents queued work and result publication", async () => {
    expect(READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY).toBe(2);
    const created = [
      createSection(0, "<p>needle one</p>"),
      createSection(1, "<p>needle two</p>"),
      createSection(2, "<p>needle three</p>"),
    ];
    const sections = created.map(({ section }) => section);
    const loads = [deferred<Element>(), deferred<Element>()];
    let activeLoads = 0;
    let peakLoads = 0;

    for (let index = 0; index < 2; index += 1) {
      const entry = created[index];
      const load = loads[index];
      if (!entry || !load) continue;
      entry.section.load.mockImplementationOnce(async () => {
        activeLoads += 1;
        peakLoads = Math.max(peakLoads, activeLoads);
        await load.promise;
        entry.section.document = entry.document;
        entry.section.contents = entry.document.documentElement;
        activeLoads -= 1;
        return entry.document.documentElement;
      });
    }

    const controller = new AbortController();
    const service = createReaderPublicationSearchService({
      book: createBook(sections),
      sections: createSectionAccess(sections),
    });
    const outcomePromise = service.search("needle", { signal: controller.signal });

    await vi.waitFor(() => {
      expect(sections[0]?.load).toHaveBeenCalledOnce();
      expect(sections[1]?.load).toHaveBeenCalledOnce();
    });
    expect(sections[2]?.load).not.toHaveBeenCalled();
    controller.abort();
    loads[0]?.resolve(created[0]!.document.documentElement);
    loads[1]?.resolve(created[1]!.document.documentElement);

    await expect(outcomePromise).resolves.toEqual({ kind: "cancelled" });
    expect(peakLoads).toBe(2);
    expect(sections[2]?.load).not.toHaveBeenCalled();
    expect(sections[0]?.unload).toHaveBeenCalledOnce();
    expect(sections[1]?.unload).toHaveBeenCalledOnce();
  });

  it("applies the transient-section concurrency bound across concurrent searches in one session service", async () => {
    const created = [createSection(0, "<p>needle one</p>"), createSection(1, "<p>needle two</p>")];
    const sections = created.map(({ section }) => section);
    const pendingLoads: Array<Deferred<Element>> = [];
    let activeLoads = 0;
    let peakLoads = 0;

    for (const entry of created) {
      entry.section.load.mockImplementation(async () => {
        const load = deferred<Element>();
        pendingLoads.push(load);
        activeLoads += 1;
        peakLoads = Math.max(peakLoads, activeLoads);
        await load.promise;
        entry.section.document = entry.document;
        entry.section.contents = entry.document.documentElement;
        activeLoads -= 1;
        return entry.document.documentElement;
      });
    }

    const service = createReaderPublicationSearchService({
      book: createBook(sections),
      sections: createSectionAccess(sections),
    });
    const first = service.search("needle");
    const second = service.search("needle");

    await vi.waitFor(() => expect(pendingLoads).toHaveLength(2));
    expect(peakLoads).toBe(READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY);
    pendingLoads
      .splice(0, 2)
      .forEach((load, index) => load.resolve(created[index]!.document.documentElement));
    await vi.waitFor(() => expect(pendingLoads).toHaveLength(2));
    expect(peakLoads).toBe(READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY);
    pendingLoads
      .splice(0, 2)
      .forEach((load, index) => load.resolve(created[index]!.document.documentElement));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ kind: "completed" }),
      expect.objectContaining({ kind: "completed" }),
    ]);
    expect(peakLoads).toBe(READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY);
  });

  it("contains a malformed section failure while retaining matches from other readable sections", async () => {
    const malformed = createSection(0, "<p>needle unavailable</p>");
    const valid = createSection(1, "<p>recoverable needle result</p>");
    malformed.section.load.mockRejectedValueOnce(new Error("malformed XHTML"));
    const sections = [malformed.section, valid.section];
    const service = createReaderPublicationSearchService({
      book: createBook(sections),
      sections: createSectionAccess(sections),
    });

    const outcome = await service.search("needle");

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.failures).toEqual([
      { href: "Text/section-1.xhtml", reason: "load-failed", spineIndex: 0 },
    ]);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^search-result-2:/u),
        position: { matchIndex: 0, spineIndex: 1 },
      }),
    );
    expect(valid.section.unload).toHaveBeenCalledOnce();
  });

  it("retirement cancels active work and permanently retires the service", async () => {
    const created = createSection(0, "<p>needle</p>");
    const load = deferred<Element>();
    created.section.load.mockImplementationOnce(async () => {
      await load.promise;
      created.section.document = created.document;
      created.section.contents = created.document.documentElement;
      return created.document.documentElement;
    });
    const service = createReaderPublicationSearchService({
      book: createBook([created.section]),
      sections: createSectionAccess([created.section]),
    });
    const active = service.search("needle");
    await vi.waitFor(() => expect(created.section.load).toHaveBeenCalledOnce());

    service.retire();
    load.resolve(created.document.documentElement);

    await expect(active).resolves.toEqual({ kind: "cancelled" });
    await expect(service.search("needle")).resolves.toEqual({ kind: "cancelled" });
    expect(created.section.unload).toHaveBeenCalledOnce();
  });
});
