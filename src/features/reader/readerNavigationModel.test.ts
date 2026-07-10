// @vitest-environment happy-dom

import type { Book as EpubBook, Location } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import {
  emptyReaderNavigationModel,
  flattenReaderNavigation,
  loadReaderNavigationModel,
} from "./readerNavigationModel";

type MockSectionDefinition = {
  anchors?: Record<string, string>;
  href: string;
  index: number;
  preloaded?: boolean;
  transientLoadFails?: boolean;
};

type MockBookOptions = {
  disableBookLoad?: boolean;
};

function readerLocation(href: string, index: number, cfi?: string): Location {
  return {
    start: { href, index, cfi },
    atEnd: false,
    atStart: false,
  } as Location;
}

function positionCfi(position: number): string {
  return `epubcfi(/6/2!/4/2:${position})`;
}

function comparePositionCfis(first: string, second: string): number {
  return cfiPosition(first) - cfiPosition(second);
}

function cfiPosition(cfi: string): number {
  const match = cfi.match(/:(\d+)\)$/);

  if (!match) {
    throw new Error(`Invalid test CFI: ${cfi}`);
  }

  return Number(match[1]);
}

function createMockSection(definition: MockSectionDefinition) {
  const sourceDocument = document.implementation.createHTMLDocument(definition.href);

  for (const [anchorId, cfi] of Object.entries(definition.anchors ?? {})) {
    const anchor = sourceDocument.createElement("section");
    anchor.id = anchorId;
    anchor.dataset.cfi = cfi;
    sourceDocument.body.appendChild(anchor);
  }

  const section: {
    cfiFromElement: ReturnType<typeof vi.fn>;
    document: Document | undefined;
    href: string;
    index: number;
    load: ReturnType<typeof vi.fn>;
    sourceDocument: Document;
    transientLoadFails: boolean;
    unload: ReturnType<typeof vi.fn>;
    url: string;
  } = {
    href: definition.href,
    url: definition.href,
    index: definition.index,
    sourceDocument,
    document: definition.preloaded === false ? undefined : sourceDocument,
    transientLoadFails: definition.transientLoadFails === true,
    load: vi.fn(),
    unload: vi.fn(),
    cfiFromElement: vi.fn((element: Element) => {
      const cfi = (element as HTMLElement).dataset.cfi;

      if (!cfi) {
        throw new Error("No comparable CFI for this element.");
      }

      return cfi;
    }),
  };

  section.load.mockImplementation(async () => {
    section.document = sourceDocument;
    return sourceDocument.documentElement;
  });
  section.unload.mockImplementation(() => {
    section.document = undefined;
  });

  return section;
}

function epubBook(
  toc: unknown,
  sectionDefinitions: MockSectionDefinition[] = [],
  paths: { navPath?: string; ncxPath?: string } = {},
  options: MockBookOptions = {},
) {
  const sections = sectionDefinitions.map(createMockSection);
  const open = vi.fn();
  const compare = vi.fn(comparePositionCfis);
  const get = vi.fn((target: string | number | undefined) => {
    if (typeof target === "number") {
      return sections.find((section) => section.index === target) ?? null;
    }

    if (typeof target !== "string") {
      return sections[0] ?? null;
    }

    const documentTarget = target.split(/[?#]/, 1)[0];
    return (
      sections.find((section) => {
        const variants = [section.href, encodeURI(section.href), decodeURI(section.href)];
        return variants.includes(documentTarget);
      }) ?? null
    );
  });
  const resolve = vi.fn((target: string) => target);
  const bookLoad = vi.fn(async (target: string) => {
    const documentTarget = target.split(/[?#]/, 1)[0];
    const section = sections.find((candidate) => {
      const variants = [candidate.href, candidate.url, encodeURI(candidate.href)];
      return variants.includes(documentTarget);
    });

    if (!section) {
      return undefined;
    }

    if (section.transientLoadFails) {
      throw new Error("Transient document loading failed.");
    }

    return section.sourceDocument;
  });
  const book = {
    loaded: {
      navigation: Promise.resolve({ toc }),
    },
    load: options.disableBookLoad ? undefined : bookLoad,
    open,
    packaging: paths,
    resolve,
    spine: {
      each: (callback: (section: unknown) => void) => sections.forEach(callback),
      epubcfi: { compare },
      get,
    },
  } as unknown as EpubBook;

  return { book, bookLoad, compare, get, open, sections };
}

describe("reader navigation model", () => {
  it("flattens nested navigation while preserving order, depth, and parent identity", () => {
    expect(
      flattenReaderNavigation([
        {
          id: "part-1",
          href: "Text/part-1.xhtml",
          label: "  Part   One  ",
          subitems: [
            {
              id: "chapter-1",
              href: "Text/chapter-1.xhtml#start",
              label: "Chapter 1",
            },
            {
              id: "chapter-2",
              href: "Text/chapter-2.xhtml",
              label: "Chapter 2",
              subitems: [
                {
                  id: "scene-1",
                  href: "Text/chapter-2.xhtml#scene-1",
                  label: "Scene 1",
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "part-1",
        href: "Text/part-1.xhtml",
        label: "Part One",
        depth: 0,
      },
      {
        id: "chapter-1",
        href: "Text/chapter-1.xhtml#start",
        label: "Chapter 1",
        depth: 1,
        parentId: "part-1",
      },
      {
        id: "chapter-2",
        href: "Text/chapter-2.xhtml",
        label: "Chapter 2",
        depth: 1,
        parentId: "part-1",
      },
      {
        id: "scene-1",
        href: "Text/chapter-2.xhtml#scene-1",
        label: "Scene 1",
        depth: 2,
        parentId: "chapter-2",
      },
    ]);
  });

  it("normalizes missing labels and duplicate or missing ids deterministically", () => {
    expect(
      flattenReaderNavigation([
        { id: "chapter", href: "one.xhtml", label: "" },
        { id: "chapter", href: "two.xhtml" },
        { href: "three.xhtml", label: "Three" },
      ]),
    ).toEqual([
      { id: "chapter", href: "one.xhtml", label: "one.xhtml", depth: 0 },
      { id: "chapter-2", href: "two.xhtml", label: "two.xhtml", depth: 0 },
      { id: "chapter-3", href: "three.xhtml", label: "Three", depth: 0 },
    ]);
  });

  it("skips malformed entries without throwing and terminates cyclic trees", () => {
    const cyclic: {
      href: string;
      id: string;
      label: string;
      subitems?: unknown[];
    } = {
      href: "chapter.xhtml",
      id: "chapter",
      label: "Chapter",
    };
    cyclic.subitems = [cyclic];

    expect(
      flattenReaderNavigation([
        null,
        "invalid",
        { label: "Container", subitems: [{ href: "nested.xhtml", label: "Nested" }] },
        cyclic,
      ]),
    ).toEqual([
      {
        id: "chapter-3-1",
        href: "nested.xhtml",
        label: "Nested",
        depth: 1,
      },
      {
        id: "chapter",
        href: "chapter.xhtml",
        label: "Chapter",
        depth: 0,
      },
    ]);
    expect(flattenReaderNavigation(undefined)).toEqual([]);
  });

  it("loads navigation from the opened book and resolves chapter targets through the spine", async () => {
    const { book, get, open } = epubBook(
      [
        {
          id: "chapter-1",
          href: "Text/chapter%201.xhtml#section",
          label: "Chapter 1",
        },
      ],
      [
        {
          href: "Text/chapter 1.xhtml",
          index: 2,
          anchors: { section: positionCfi(10) },
        },
      ],
    );

    const model = await loadReaderNavigationModel(book);

    expect(model.chapters).toHaveLength(1);
    expect(model.resolveChapterTarget("chapter-1")).toBe("Text/chapter 1.xhtml#section");
    expect(get).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("uses CFI positions to distinguish chapters within one spine document", async () => {
    const { book, compare } = epubBook(
      [
        { id: "chapter", href: "Text/chapter.xhtml", label: "Chapter" },
        { id: "scene-1", href: "Text/chapter.xhtml#scene-1", label: "Scene 1" },
        { id: "scene-2", href: "Text/chapter.xhtml#scene-2", label: "Scene 2" },
        { id: "missing", href: "Text/chapter.xhtml#missing", label: "Missing" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          anchors: {
            "scene-1": positionCfi(10),
            "scene-2": positionCfi(20),
          },
        },
      ],
    );
    const model = await loadReaderNavigationModel(book);

    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(5)))?.id,
    ).toBe("chapter");
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(15)))?.id,
    ).toBe("scene-1");
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(25)))?.id,
    ).toBe("scene-2");
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(12)))?.id,
    ).toBe("scene-1");
    expect(compare).toHaveBeenCalled();
  });

  it("does not eagerly load separate documents with one fragmented entry each", async () => {
    const { book, bookLoad, sections } = epubBook(
      [
        { id: "chapter-1", href: "Text/chapter-1.xhtml#start", label: "Chapter 1" },
        { id: "chapter-2", href: "Text/chapter-2.xhtml#start", label: "Chapter 2" },
        { id: "chapter-3", href: "Text/chapter-3.xhtml#start", label: "Chapter 3" },
      ],
      [
        { href: "Text/chapter-1.xhtml", index: 1, preloaded: false },
        { href: "Text/chapter-2.xhtml", index: 2, preloaded: false },
        { href: "Text/chapter-3.xhtml", index: 3, preloaded: false },
      ],
    );

    const model = await loadReaderNavigationModel(book);

    expect(model.chapters).toHaveLength(3);
    expect(bookLoad).not.toHaveBeenCalled();
    for (const section of sections) {
      expect(section.load).not.toHaveBeenCalled();
      expect(section.unload).not.toHaveBeenCalled();
      expect(section.document).toBeUndefined();
    }
  });

  it("loads one ambiguous document once without retaining it on the section", async () => {
    const { book, bookLoad, sections } = epubBook(
      [
        { id: "scene-1", href: "Text/chapter.xhtml#scene-1", label: "Scene 1" },
        { id: "scene-2", href: "Text/chapter.xhtml#scene-2", label: "Scene 2" },
        { id: "scene-3", href: "Text/chapter.xhtml#scene-3", label: "Scene 3" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          preloaded: false,
          anchors: {
            "scene-1": positionCfi(10),
            "scene-2": positionCfi(20),
            "scene-3": positionCfi(30),
          },
        },
      ],
    );

    const model = await loadReaderNavigationModel(book);
    const section = sections[0]!;

    expect(bookLoad).toHaveBeenCalledTimes(1);
    expect(section.load).not.toHaveBeenCalled();
    expect(section.unload).not.toHaveBeenCalled();
    expect(section.document).toBeUndefined();
    expect(section.cfiFromElement).toHaveBeenCalledTimes(3);
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(25)))?.id,
    ).toBe("scene-2");
  });

  it("releases documents loaded through the section fallback", async () => {
    const { book, bookLoad, sections } = epubBook(
      [
        { id: "scene-1", href: "Text/chapter.xhtml#scene-1", label: "Scene 1" },
        { id: "scene-2", href: "Text/chapter.xhtml#scene-2", label: "Scene 2" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          preloaded: false,
          anchors: {
            "scene-1": positionCfi(10),
            "scene-2": positionCfi(20),
          },
        },
      ],
      {},
      { disableBookLoad: true },
    );

    const model = await loadReaderNavigationModel(book);
    const section = sections[0]!;

    expect(bookLoad).not.toHaveBeenCalled();
    expect(section.load).toHaveBeenCalledTimes(1);
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(section.document).toBeUndefined();
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(25)))?.id,
    ).toBe("scene-2");
  });

  it("does not unload a section document that was already present", async () => {
    const { book, bookLoad, sections } = epubBook(
      [
        { id: "scene-1", href: "Text/chapter.xhtml#scene-1", label: "Scene 1" },
        { id: "scene-2", href: "Text/chapter.xhtml#scene-2", label: "Scene 2" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          anchors: {
            "scene-1": positionCfi(10),
            "scene-2": positionCfi(20),
          },
        },
      ],
    );
    const section = sections[0]!;
    const existingDocument = section.document;

    await loadReaderNavigationModel(book);

    expect(bookLoad).not.toHaveBeenCalled();
    expect(section.load).not.toHaveBeenCalled();
    expect(section.unload).not.toHaveBeenCalled();
    expect(section.document).toBe(existingDocument);
  });

  it("keeps document and spine fallbacks when transient anchor loading fails", async () => {
    const { book, bookLoad, sections } = epubBook(
      [
        { id: "chapter", href: "Text/chapter.xhtml", label: "Chapter" },
        { id: "scene", href: "Text/chapter.xhtml#scene", label: "Scene" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          preloaded: false,
          transientLoadFails: true,
          anchors: { scene: positionCfi(10) },
        },
      ],
    );

    const model = await loadReaderNavigationModel(book);
    const section = sections[0]!;

    expect(bookLoad).toHaveBeenCalledTimes(1);
    expect(section.load).not.toHaveBeenCalled();
    expect(section.unload).not.toHaveBeenCalled();
    expect(section.document).toBeUndefined();
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(25)))?.id,
    ).toBe("chapter");
    expect(model.resolveChapterTarget("scene")).toBe("Text/chapter.xhtml#scene");
  });

  it("falls back safely when a same-document anchor cannot be resolved", async () => {
    const { book } = epubBook(
      [
        { id: "chapter", href: "Text/chapter.xhtml", label: "Chapter" },
        { id: "missing", href: "Text/chapter.xhtml#missing", label: "Missing" },
      ],
      [{ href: "Text/chapter.xhtml", index: 1 }],
    );
    const model = await loadReaderNavigationModel(book);

    expect(
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1, positionCfi(30)))?.id,
    ).toBe("chapter");
  });

  it("resolves nested navigation hrefs relative to the navigation document", async () => {
    const { book } = epubBook(
      [
        {
          id: "encoded",
          href: "../Text/chapter%201.xhtml?edition=1#scene%201",
          label: "Encoded",
        },
        {
          id: "decoded",
          href: "../Text/chapter 1.xhtml#scene 2",
          label: "Decoded",
        },
      ],
      [
        {
          href: "Text/chapter 1.xhtml",
          index: 3,
          anchors: {
            "scene 1": positionCfi(10),
            "scene 2": positionCfi(20),
          },
        },
      ],
      { navPath: "Nav/nav.xhtml" },
    );
    const model = await loadReaderNavigationModel(book);

    expect(model.resolveChapterTarget("encoded")).toBe("Text/chapter 1.xhtml#scene%201");
    expect(model.resolveChapterTarget("decoded")).toBe("Text/chapter 1.xhtml#scene 2");
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter 1.xhtml", 3, positionCfi(15)))?.id,
    ).toBe("encoded");
    expect(
      model.findCurrentChapter(readerLocation("Text/chapter%201.xhtml", 3, positionCfi(25)))?.id,
    ).toBe("decoded");
  });

  it("uses the NCX document path as a relative resolution base when applicable", async () => {
    const { book } = epubBook(
      [{ id: "chapter", href: "../Text/chapter.xhtml#scene", label: "Chapter" }],
      [
        {
          href: "Text/chapter.xhtml",
          index: 4,
          anchors: { scene: positionCfi(10) },
        },
      ],
      { ncxPath: "Navigation/toc.ncx" },
    );
    const model = await loadReaderNavigationModel(book);

    expect(model.resolveChapterTarget("chapter")).toBe("Text/chapter.xhtml#scene");
  });

  it("maps relocations to an exact chapter or the closest preceding spine chapter", async () => {
    const { book } = epubBook(
      [
        { id: "intro", href: "Text/intro.xhtml", label: "Introduction" },
        { id: "chapter-1", href: "Text/chapter-1.xhtml", label: "Chapter 1" },
        { id: "chapter-3", href: "Text/chapter-3.xhtml", label: "Chapter 3" },
      ],
      [
        { href: "Text/intro.xhtml", index: 0 },
        { href: "Text/chapter-1.xhtml", index: 2 },
        { href: "Text/chapter-3.xhtml", index: 5 },
      ],
    );
    const model = await loadReaderNavigationModel(book);

    expect(model.findCurrentChapter(readerLocation("Text/chapter-3.xhtml", 5))?.id).toBe(
      "chapter-3",
    );
    expect(model.findCurrentChapter(readerLocation("Text/unlisted.xhtml", 4))?.id).toBe(
      "chapter-1",
    );
    expect(model.findCurrentChapter(readerLocation("Text/frontmatter.xhtml", -1))).toBeUndefined();
  });

  it("keeps exact fragment matching as a fallback when a relocation CFI is unavailable", async () => {
    const { book } = epubBook(
      [
        { id: "chapter", href: "Text/chapter.xhtml", label: "Chapter" },
        { id: "scene", href: "Text/chapter.xhtml#scene", label: "Scene" },
      ],
      [
        {
          href: "Text/chapter.xhtml",
          index: 1,
          anchors: { scene: positionCfi(10) },
        },
      ],
    );
    const model = await loadReaderNavigationModel(book);

    expect(model.findCurrentChapter(readerLocation("Text/chapter.xhtml#scene", 1))?.id).toBe(
      "scene",
    );
    expect(model.findCurrentChapter(readerLocation("Text/chapter.xhtml", 1))?.id).toBe("chapter");
  });

  it("returns a stable empty model when navigation is absent or fails to load", async () => {
    const noToc = epubBook(undefined).book;
    const failedBook = {
      loaded: { navigation: Promise.reject(new Error("invalid navigation")) },
    } as unknown as EpubBook;

    expect(await loadReaderNavigationModel(noToc)).toBe(emptyReaderNavigationModel);
    expect(await loadReaderNavigationModel(failedBook)).toBe(emptyReaderNavigationModel);
  });
});
