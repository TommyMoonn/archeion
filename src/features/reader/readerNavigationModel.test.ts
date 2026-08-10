// @vitest-environment happy-dom

import type { Book as EpubBook, Location } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import { emptyReaderNavigationModel, loadReaderNavigationModel } from "./readerNavigationModel";

type MockSectionDefinition = {
  anchors?: Record<string, string>;
  href: string;
  index: number;
  preloaded?: boolean;
  transientLoadFails?: boolean;
};

type MockBookOptions = {
  disableBookLoad?: boolean;
  landmarks?: unknown;
  navigationDocument?: Document;
  navigationPromise?: Promise<unknown>;
  parsedPageList?: unknown[];
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

function spinePositionCfi(spineIndex: number, position: number): string {
  return `epubcfi(/6/${(spineIndex + 1) * 2}[s${spineIndex}]!/4/2:${position})`;
}

function comparePositionCfis(first: string, second: string): number {
  const firstSpine = cfiSpineIndex(first);
  const secondSpine = cfiSpineIndex(second);

  if (firstSpine !== undefined && secondSpine !== undefined && firstSpine !== secondSpine) {
    return firstSpine - secondSpine;
  }

  return cfiPosition(first) - cfiPosition(second);
}

function cfiSpineIndex(cfi: string): number | undefined {
  const match = cfi.match(/\[s(\d+)\]/);
  return match ? Number(match[1]) : undefined;
}

function cfiPosition(cfi: string): number {
  const match = cfi.match(/:(\d+)\)$/);

  if (!match) {
    throw new Error(`Invalid test CFI: ${cfi}`);
  }

  return Number(match[1]);
}

function xmlDocument(
  source: string,
  mimeType: DOMParserSupportedType = "application/xml",
): Document {
  return new DOMParser().parseFromString(source, mimeType);
}

function navigationPageListDocument(items: string): Document {
  return navigationDocumentWithPageList("", items);
}

function navigationDocumentWithPageList(tocItems: string, pageListItems: string): Document {
  return xmlDocument(
    `<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"
            xmlns:epub="http://www.idpf.org/2007/ops">
        <body>
          <nav epub:type="toc">
            <ol>${tocItems}</ol>
          </nav>
          <nav epub:type="page-list">
            <ol>${pageListItems}</ol>
          </nav>
        </body>
      </html>`,
    "application/xhtml+xml",
  );
}

function ncxPageListDocument(items: string): Document {
  return ncxDocumentWithPageList("", items);
}

function ncxDocumentWithPageList(navPoints: string, pageTargets: string): Document {
  return xmlDocument(`<?xml version="1.0" encoding="UTF-8"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap>${navPoints}</navMap>
      <pageList>${pageTargets}</pageList>
    </ncx>`);
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

    if (target.startsWith("epubcfi(")) {
      const spineIndex = cfiSpineIndex(target);
      return spineIndex === undefined
        ? (sections[0] ?? null)
        : (sections.find((section) => section.index === spineIndex) ?? null);
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
    const navigationPath = paths.navPath ?? paths.ncxPath;

    if (options.navigationDocument && navigationPath === documentTarget) {
      return options.navigationDocument;
    }

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
  const navigation = { landmarks: options.landmarks ?? [], toc };
  const book = {
    loaded: {
      navigation: options.navigationPromise ?? Promise.resolve(navigation),
      pageList: Promise.resolve(undefined),
    },
    load: options.disableBookLoad ? undefined : bookLoad,
    navigation,
    open,
    pageList: { pageList: options.parsedPageList ?? [] },
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
  it("publishes flattened Contents in publication order with depth and parent identity", async () => {
    const { book } = epubBook([
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
    ]);

    const model = await loadReaderNavigationModel(book);

    expect(model.chapters).toEqual([
      expect.objectContaining({
        id: "part-1",
        href: "Text/part-1.xhtml",
        label: "Part One",
        depth: 0,
      }),
      expect.objectContaining({
        id: "chapter-1",
        href: "Text/chapter-1.xhtml#start",
        label: "Chapter 1",
        depth: 1,
        parentId: "part-1",
      }),
      expect.objectContaining({
        id: "chapter-2",
        href: "Text/chapter-2.xhtml",
        label: "Chapter 2",
        depth: 1,
        parentId: "part-1",
      }),
      expect.objectContaining({
        id: "scene-1",
        href: "Text/chapter-2.xhtml#scene-1",
        label: "Scene 1",
        depth: 2,
        parentId: "chapter-2",
      }),
    ]);
  });

  it("keeps deterministic ids and valid siblings when Contents entries are malformed", async () => {
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
    const { book } = epubBook([
      null,
      "invalid",
      { label: "Container", subitems: [{ href: "nested.xhtml", label: "Nested" }] },
      cyclic,
      { id: "chapter", href: "duplicate.xhtml", label: "" },
      { href: "last.xhtml", label: "Last" },
    ]);

    const model = await loadReaderNavigationModel(book);

    expect(model.chapters).toEqual([
      expect.objectContaining({
        id: "chapter-3-1",
        href: "nested.xhtml",
        label: "Nested",
        depth: 1,
      }),
      expect.objectContaining({
        id: "chapter",
        href: "chapter.xhtml",
        label: "Chapter",
        depth: 0,
      }),
      expect.objectContaining({
        id: "chapter-2",
        href: "duplicate.xhtml",
        label: "duplicate.xhtml",
        depth: 0,
      }),
      expect.objectContaining({
        id: "chapter-6",
        href: "last.xhtml",
        label: "Last",
        depth: 0,
      }),
    ]);
  });

  it("publishes valid Landmarks with normalized labels, semantic types, and resolved targets", async () => {
    const { book } = epubBook(
      [],
      [
        { href: "Text/front.xhtml", index: 0 },
        { href: "Text/nav.xhtml", index: 1 },
      ],
      { navPath: "Text/nav.xhtml" },
      {
        landmarks: [
          { href: "front.xhtml#cover", label: "  Cover   Page ", type: "cover" },
          { label: "Missing target", type: "bodymatter" },
          { href: "#contents", label: " Table\n of   Contents ", type: "toc" },
        ],
      },
    );

    const model = await loadReaderNavigationModel(book);

    expect(model.landmarks).toEqual([
      {
        id: "landmark-1",
        href: "front.xhtml#cover",
        label: "Cover Page",
        position: { spineIndex: 0 },
        semanticType: "cover",
        target: "Text/front.xhtml#cover",
      },
      {
        id: "landmark-3",
        href: "#contents",
        label: "Table of Contents",
        position: { spineIndex: 1 },
        semanticType: "toc",
        target: "Text/nav.xhtml#contents",
      },
    ]);
    expect(model.resolveItemTarget("landmark-3")).toBe("Text/nav.xhtml#contents");
  });

  it("publishes EPUB navigation-document Page List entries with publisher labels and exact CFI targets", async () => {
    const sourceCfi = spinePositionCfi(2, 11);
    const navigationDocument = navigationPageListDocument(`
      <li id="page-ten"><a href="../Text/pages.xhtml#p10">  10  </a></li>
      <li><a href="../package.opf#${sourceCfi}">  xi   verso  </a></li>
      <li><a href="">Missing target</a></li>
      <li><a href="../Text/pages.xhtml#p12">   </a></li>
    `);
    const { book } = epubBook(
      [],
      [
        {
          href: "Text/pages.xhtml",
          index: 2,
          anchors: { p10: spinePositionCfi(2, 10) },
        },
      ],
      { navPath: "Nav/nav.xhtml" },
      {
        navigationDocument,
        parsedPageList: [
          { href: "../Text/pages.xhtml#p10", page: 10 },
          {
            cfi: sourceCfi,
            href: `../package.opf#${sourceCfi}`,
            packageUrl: "../package.opf",
            page: Number.NaN,
          },
          { href: "", page: Number.NaN },
          { href: "../Text/pages.xhtml#p12", page: Number.NaN },
        ],
      },
    );

    const model = await loadReaderNavigationModel(book);

    expect(model.pageReferences).toEqual([
      {
        id: "page-ten",
        href: "../Text/pages.xhtml#p10",
        label: "10",
        position: { cfi: spinePositionCfi(2, 10), spineIndex: 2 },
        target: "Text/pages.xhtml#p10",
      },
      {
        id: "page-reference-2",
        href: `../package.opf#${sourceCfi}`,
        label: "xi verso",
        position: { cfi: sourceCfi, spineIndex: 2 },
        target: sourceCfi,
      },
    ]);
    expect(model.resolveItemTarget("page-reference-2")).toBe(sourceCfi);
  });

  it("keeps publisher Page List metadata when loaded.pageList resolves before epub.js pageList population", async () => {
    const navigationDocument = navigationPageListDocument(
      `<li id="page-i"><a href="../Text/pages.xhtml#page-i"> i </a></li>`,
    );
    const setup = epubBook(
      [],
      [{ href: "Text/pages.xhtml", index: 0, anchors: { "page-i": positionCfi(4) } }],
      { navPath: "Nav/nav.xhtml" },
      { navigationDocument },
    );
    const mutableBook = setup.book as unknown as {
      pageList: unknown;
    };
    mutableBook.pageList = undefined;

    const model = await loadReaderNavigationModel(setup.book);

    expect(model.chapters).toEqual([]);
    expect(model.pageReferences).toEqual([
      {
        id: "page-i",
        href: "../Text/pages.xhtml#page-i",
        label: "i",
        position: { cfi: positionCfi(4), spineIndex: 0 },
        target: "Text/pages.xhtml#page-i",
      },
    ]);
    expect(setup.bookLoad).toHaveBeenCalledWith("Nav/nav.xhtml");
  });

  it("recovers EPUB navigation and valid Page List siblings when epub.js navigation readiness stalls after PageList parsing fails", async () => {
    const navigationDocument = navigationDocumentWithPageList(
      `<li id="chapter-one"><a href="../Text/chapter.xhtml">Chapter One</a></li>`,
      `
        <li id="page-iv"><a href="../Text/chapter.xhtml#page-iv">  iv  </a></li>
        <li id="broken"><span>Missing page link</span></li>
        <li id="page-a2"><a href="../Text/chapter.xhtml#page-a2"> Appendix   A-2 </a></li>
      `,
    );
    const navigationNeverSettles = new Promise<unknown>(() => undefined);
    const setup = epubBook(
      [{ id: "chapter-one", href: "../Text/chapter.xhtml", label: "Chapter One" }],
      [
        {
          href: "Text/chapter.xhtml",
          index: 0,
          anchors: {
            "page-a2": positionCfi(8),
            "page-iv": positionCfi(4),
          },
        },
      ],
      { navPath: "Nav/nav.xhtml" },
      { navigationDocument, navigationPromise: navigationNeverSettles },
    );
    const mutableBook = setup.book as unknown as { pageList: unknown };
    mutableBook.pageList = undefined;

    const model = await loadReaderNavigationModel(setup.book);

    expect(model.chapters).toEqual([
      expect.objectContaining({
        id: "chapter-one",
        href: "../Text/chapter.xhtml",
        label: "Chapter One",
        target: "Text/chapter.xhtml",
      }),
    ]);
    expect(model.pageReferences).toEqual([
      {
        id: "page-iv",
        href: "../Text/chapter.xhtml#page-iv",
        label: "iv",
        position: { cfi: positionCfi(4), spineIndex: 0 },
        target: "Text/chapter.xhtml#page-iv",
      },
      {
        id: "page-a2",
        href: "../Text/chapter.xhtml#page-a2",
        label: "Appendix A-2",
        position: { cfi: positionCfi(8), spineIndex: 0 },
        target: "Text/chapter.xhtml#page-a2",
      },
    ]);
    expect(setup.bookLoad).toHaveBeenCalledWith("Nav/nav.xhtml");
  });

  it("recovers NCX navigation and valid Page List siblings when epub.js navigation readiness stalls after PageList parsing fails", async () => {
    const navigationDocument = ncxDocumentWithPageList(
      `
        <navPoint id="chapter-one">
          <navLabel><text>Chapter One</text></navLabel>
          <content src="../Text/chapter.xhtml"/>
        </navPoint>
      `,
      `
        <pageTarget id="page-xii">
          <navLabel><text>  xii  </text></navLabel>
          <content src="../Text/chapter.xhtml#page-xii"/>
        </pageTarget>
        <pageTarget id="broken">
          <navLabel><text>Missing content</text></navLabel>
        </pageTarget>
        <pageTarget id="page-notes">
          <navLabel><text> Notes   A-3 </text></navLabel>
          <content src="../Text/chapter.xhtml#page-notes"/>
        </pageTarget>
      `,
    );
    const navigationNeverSettles = new Promise<unknown>(() => undefined);
    const setup = epubBook(
      [{ id: "chapter-one", href: "../Text/chapter.xhtml", label: "Chapter One" }],
      [
        {
          href: "Text/chapter.xhtml",
          index: 0,
          anchors: {
            "page-notes": positionCfi(9),
            "page-xii": positionCfi(5),
          },
        },
      ],
      { ncxPath: "Navigation/toc.ncx" },
      { navigationDocument, navigationPromise: navigationNeverSettles },
    );
    const mutableBook = setup.book as unknown as { pageList: unknown };
    mutableBook.pageList = undefined;

    const model = await loadReaderNavigationModel(setup.book);

    expect(model.chapters).toEqual([
      expect.objectContaining({
        id: "chapter-one",
        href: "../Text/chapter.xhtml",
        label: "Chapter One",
        target: "Text/chapter.xhtml",
      }),
    ]);
    expect(model.pageReferences).toEqual([
      {
        id: "page-xii",
        href: "../Text/chapter.xhtml#page-xii",
        label: "xii",
        position: { cfi: positionCfi(5), spineIndex: 0 },
        target: "Text/chapter.xhtml#page-xii",
      },
      {
        id: "page-notes",
        href: "../Text/chapter.xhtml#page-notes",
        label: "Notes A-3",
        position: { cfi: positionCfi(9), spineIndex: 0 },
        target: "Text/chapter.xhtml#page-notes",
      },
    ]);
    expect(setup.bookLoad).toHaveBeenCalledWith("Navigation/toc.ncx");
  });

  it("publishes NCX Page List labels without epub.js numeric coercion", async () => {
    const navigationDocument = ncxPageListDocument(`
      <pageTarget id="front-cover">
        <navLabel><text> Cover   2A </text></navLabel>
        <content src="../Text/front.xhtml#cover"/>
      </pageTarget>
      <pageTarget id="page-12">
        <navLabel><text>12</text></navLabel>
        <content src="../Text/chapter.xhtml#p12"/>
      </pageTarget>
      <pageTarget id="broken">
        <navLabel><text>Broken</text></navLabel>
        <content src=""/>
      </pageTarget>
    `);
    const { book } = epubBook(
      [],
      [
        { href: "Text/front.xhtml", index: 0, anchors: { cover: positionCfi(1) } },
        { href: "Text/chapter.xhtml", index: 1, anchors: { p12: positionCfi(12) } },
      ],
      { ncxPath: "Navigation/toc.ncx" },
      {
        navigationDocument,
        parsedPageList: [
          { href: "../Text/front.xhtml#cover", page: Number.NaN },
          { href: "../Text/chapter.xhtml#p12", page: 12 },
          { href: "", page: Number.NaN },
        ],
      },
    );

    const model = await loadReaderNavigationModel(book);

    expect(model.pageReferences).toEqual([
      {
        id: "front-cover",
        href: "../Text/front.xhtml#cover",
        label: "Cover 2A",
        position: { cfi: positionCfi(1), spineIndex: 0 },
        target: "Text/front.xhtml#cover",
      },
      {
        id: "page-12",
        href: "../Text/chapter.xhtml#p12",
        label: "12",
        position: { cfi: positionCfi(12), spineIndex: 1 },
        target: "Text/chapter.xhtml#p12",
      },
    ]);
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

    expect(model.chapters).toEqual([
      expect.objectContaining({
        id: "chapter-1",
        position: { cfi: positionCfi(10), spineIndex: 2 },
        target: "Text/chapter 1.xhtml#section",
      }),
    ]);
    expect(model.resolveItemTarget("chapter-1")).toBe("Text/chapter 1.xhtml#section");
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
      model.findCurrentChapter(readerLocation("Text/chapter.xhtml#scene-2", 1, positionCfi(20)))
        ?.id,
    ).toBe("scene-2");
    expect(compare).toHaveBeenCalled();
  });

  it("finds current and nearest chapters using the CFI's actual spine section", async () => {
    const { book, get } = epubBook(
      [
        { id: "chapter-1", href: "Text/chapter-1.xhtml#start", label: "Chapter 1" },
        { id: "scene-1", href: "Text/chapter-1.xhtml#scene-1", label: "Scene 1" },
        { id: "chapter-2", href: "Text/chapter-2.xhtml#start", label: "Chapter 2" },
      ],
      [
        {
          href: "Text/chapter-1.xhtml",
          index: 1,
          anchors: {
            start: spinePositionCfi(1, 1),
            "scene-1": spinePositionCfi(1, 20),
          },
        },
        {
          href: "Text/chapter-2.xhtml",
          index: 2,
          anchors: { start: spinePositionCfi(2, 5) },
        },
      ],
    );
    const model = await loadReaderNavigationModel(book);

    expect(
      model.findCurrentChapter(readerLocation("Text/chapter-2.xhtml", 2, spinePositionCfi(2, 10)))
        ?.id,
    ).toBe("chapter-2");
    expect(model.findNearestChapter(spinePositionCfi(1, 10))?.id).toBe("chapter-1");
    expect(model.findNearestChapter(spinePositionCfi(1, 25))?.id).toBe("scene-1");
    expect(model.findNearestChapter(spinePositionCfi(2, 10))?.id).toBe("chapter-2");
    expect(get).toHaveBeenCalledWith(spinePositionCfi(2, 10));
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
    expect(model.resolveItemTarget("scene")).toBe("Text/chapter.xhtml#scene");
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

    expect(model.resolveItemTarget("encoded")).toBe("Text/chapter 1.xhtml#scene%201");
    expect(model.resolveItemTarget("decoded")).toBe("Text/chapter 1.xhtml#scene 2");
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

    expect(model.resolveItemTarget("chapter")).toBe("Text/chapter.xhtml#scene");
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
      load: vi.fn(async () => {
        throw new Error("invalid navigation");
      }),
      packaging: { navPath: "Nav/nav.xhtml" },
    } as unknown as EpubBook;

    expect(await loadReaderNavigationModel(noToc)).toBe(emptyReaderNavigationModel);
    expect(await loadReaderNavigationModel(failedBook)).toBe(emptyReaderNavigationModel);
  });
});
