// @vitest-environment happy-dom

import type { Book as EpubBook, Rendition } from "epubjs";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpubFootnoteResolution } from "./epubFootnoteResolver";
import type { EpubIllustrationResolution } from "./epubIllustrationResolver";
import { READER_ILLUSTRATION_TRIGGER_ATTRIBUTE } from "./readerIllustrationTrigger";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";
import type { EpubSessionSnapshot } from "./useEpubSession";
import {
  useEpubContentActionController,
  type EpubContentActionController,
} from "./useEpubContentActionController";

const resolveEpubFootnote = vi.hoisted(() => vi.fn());
const resolveEpubIllustration = vi.hoisted(() => vi.fn());
const openExternalUrl = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./epubFootnoteResolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./epubFootnoteResolver")>()),
  resolveEpubFootnote,
}));
vi.mock("./epubIllustrationResolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./epubIllustrationResolver")>()),
  resolveEpubIllustration,
}));
vi.mock("../../app/openExternalUrl", () => ({ openExternalUrl }));

type HarnessProps = {
  getSession: () => EpubSessionSnapshot | null;
  navigateToTarget: (target: string) => Promise<boolean>;
  onController: (controller: EpubContentActionController) => void;
  registry: ReaderContentDocumentRegistry;
  viewer: HTMLDivElement;
};

function Harness({ getSession, navigateToTarget, onController, registry, viewer }: HarnessProps) {
  const controller = useEpubContentActionController({
    getSession,
    navigateToTarget,
    onInteraction: vi.fn(),
    registry,
    viewerRef: { current: viewer },
  });
  useLayoutEffect(() => onController(controller), [controller, onController]);
  return null;
}

function session(generation = 1): EpubSessionSnapshot {
  return {
    book: { spine: {} } as unknown as EpubBook,
    generation,
    rendition: {} as Rendition,
  };
}

function clickFrom(link: Element): MouseEvent {
  const event = new MouseEvent("click", { button: 0 });
  Object.defineProperty(event, "target", { configurable: true, value: link });
  return event;
}

function pointerFrom(link: Element): PointerEvent {
  const event = new PointerEvent("pointerdown", { button: 0 });
  Object.defineProperty(event, "target", { configurable: true, value: link });
  return event;
}

function linkedDocument(
  href: string,
  attributes = "",
): { document: Document; link: HTMLAnchorElement } {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.defineProperty(frame.contentWindow, "frameElement", { configurable: true, value: frame });
  const chapter = frame.contentDocument!;
  const link = chapter.createElement("a");
  link.setAttribute("href", href);
  if (attributes.includes("noteref")) link.setAttribute("epub:type", "noteref");
  link.textContent = "link";
  chapter.body.append(link);
  Object.defineProperty(link, "getBoundingClientRect", {
    value: () => ({ bottom: 40, height: 20, left: 20, right: 60, top: 20, width: 40 }),
  });
  return { document: chapter, link };
}

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  resolveEpubFootnote.mockReset();
  resolveEpubIllustration.mockReset();
  openExternalUrl.mockReset();
  openExternalUrl.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe("useEpubContentActionController", () => {
  function renderController(activeSession: { current: EpubSessionSnapshot | null }) {
    const host = document.createElement("div");
    const viewer = document.createElement("div");
    document.body.append(host, viewer);
    Object.defineProperty(viewer, "getBoundingClientRect", {
      value: () => ({ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }),
    });
    const registry = new ReaderContentDocumentRegistry();
    const navigateToTarget = vi.fn(async () => true);
    let latest!: EpubContentActionController;
    const root = createRoot(host);
    roots.push(root);
    act(() => {
      root.render(
        <Harness
          getSession={() => activeSession.current}
          navigateToTarget={navigateToTarget}
          onController={(controller) => {
            latest = controller;
          }}
          registry={registry}
          viewer={viewer}
        />,
      );
    });
    return { latest: () => latest, navigateToTarget, registry };
  }

  it("opens a footnote without navigating and restores focus after Escape", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const release = vi.fn();
    resolveEpubFootnote.mockResolvedValue({
      kind: "resolved",
      value: { nodes: [{ text: "A note", type: "text" }], release },
    } satisfies EpubFootnoteResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    expect(harness.navigateToTarget).not.toHaveBeenCalled();
    expect(harness.latest().footnote?.content?.nodes).toEqual([{ text: "A note", type: "text" }]);
    act(() => expect(harness.latest().handleEscape()).toBe(true));
    expect(release).toHaveBeenCalledOnce();
    expect(chapter.activeElement).toBe(link);
  });

  it("dismisses an open footnote after an outside pointer interaction", async () => {
    const release = vi.fn();
    resolveEpubFootnote.mockResolvedValue({
      kind: "resolved",
      value: { nodes: [{ text: "A note", type: "text" }], release },
    } satisfies EpubFootnoteResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(harness.latest().footnote).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("delegates ordinary internal links to the canonical reader navigation facade", async () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("chapter-2.xhtml#part");
    resolveEpubFootnote.mockResolvedValue({
      kind: "not-footnote",
    } satisfies EpubFootnoteResolution);

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    expect(harness.navigateToTarget).toHaveBeenCalledWith("Text/chapter-2.xhtml#part");
  });

  it("opens a local image without navigation and prepares it for keyboard activation", async () => {
    const release = vi.fn();
    resolveEpubIllustration.mockResolvedValue({
      kind: "resolved",
      value: {
        blob: new Blob([new Uint8Array(1024)], { type: "image/jpeg" }),
        byteLength: 1024,
        height: 1200,
        href: "Images/plate.jpg",
        mediaType: "image/jpeg",
        release,
        url: "blob:plate",
        width: 1600,
      },
    } satisfies EpubIllustrationResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.src = "../Images/plate.jpg";
    chapter.body.append(image);
    const context = { document: chapter, sectionHref: "Text/chapter.xhtml" };

    act(() => harness.latest().prepareDocument(context));
    expect(image.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(true);
    expect(image.tabIndex).toBe(0);
    expect(image.getAttribute("role")).toBe("button");
    expect(image.getAttribute("aria-label")).toBe("Open illustration");

    const pointer = pointerFrom(image);
    expect(harness.latest().handleContentPointerDown(pointer, context)).toBe(true);
    const keyboard = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(keyboard, "target", { configurable: true, value: image });
    act(() => expect(harness.latest().handleContentKeyDown(keyboard, context)).toBe(true));
    await act(async () => Promise.resolve());

    expect(harness.navigateToTarget).not.toHaveBeenCalled();
    expect(resolveEpubIllustration).toHaveBeenCalledWith(
      activeSession.current?.book,
      expect.objectContaining({ documentHref: "Images/plate.jpg" }),
      expect.any(AbortSignal),
    );
    expect(harness.latest().illustration?.resource?.url).toBe("blob:plate");
  });

  it("activates an SVG image reference from its prepared keyboard focus host", async () => {
    resolveEpubIllustration.mockResolvedValue({
      kind: "resolved",
      value: {
        blob: new Blob([new Uint8Array(256)], { type: "image/png" }),
        byteLength: 256,
        height: 480,
        href: "Images/plate.png",
        mediaType: "image/png",
        release: vi.fn(),
        url: "blob:svg-plate",
        width: 640,
      },
    } satisfies EpubIllustrationResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const svg = chapter.createElementNS("http://www.w3.org/2000/svg", "svg");
    const image = chapter.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", "../Images/plate.png");
    svg.append(image);
    chapter.body.append(svg);
    const context = { document: chapter, sectionHref: "Text/chapter.xhtml" };

    act(() => harness.latest().prepareDocument(context));
    expect(svg.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(true);
    expect(svg.getAttribute("role")).toBe("button");
    expect(svg.getAttribute("tabindex")).toBe("0");

    const keyboard = new KeyboardEvent("keydown", { key: " " });
    Object.defineProperty(keyboard, "target", { configurable: true, value: svg });
    act(() => expect(harness.latest().handleContentKeyDown(keyboard, context)).toBe(true));
    await act(async () => Promise.resolve());

    expect(resolveEpubIllustration).toHaveBeenCalledWith(
      activeSession.current?.book,
      expect.objectContaining({ documentHref: "Images/plate.png" }),
      expect.any(AbortSignal),
    );
    expect(harness.latest().illustration?.resource?.url).toBe("blob:svg-plate");
  });

  it("marks standalone triggers without replacing publisher accessibility values", () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.setAttribute("src", "../Images/plate.jpg");
    image.setAttribute("tabindex", "2");
    image.setAttribute("role", "img");
    image.setAttribute("aria-label", "Publisher plate description");
    chapter.body.append(image);

    act(() =>
      harness.latest().prepareDocument({
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      }),
    );

    expect(image.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(true);
    expect(image.getAttribute("tabindex")).toBe("2");
    expect(image.getAttribute("role")).toBe("img");
    expect(image.getAttribute("aria-label")).toBe("Publisher plate description");
  });

  it.each(["a", "button"])("does not mark an illustration owned by a publisher %s", (ownerName) => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const owner = chapter.createElement(ownerName);
    if (ownerName === "a") owner.setAttribute("href", "chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.setAttribute("src", "../Images/plate.jpg");
    owner.append(image);
    chapter.body.append(owner);

    act(() =>
      harness.latest().prepareDocument({
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      }),
    );

    expect(image.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(false);
    expect(image.hasAttribute("tabindex")).toBe(false);
    expect(image.hasAttribute("role")).toBe(false);
    expect(image.hasAttribute("aria-label")).toBe(false);
  });

  it.each(["name", "id"])(
    "does not prepare an illustration owned by a matching image map %s",
    (mapIdentity) => {
      const activeSession = { current: session() };
      const harness = renderController(activeSession);
      const { document: chapter } = linkedDocument("chapter-2.xhtml");
      const image = chapter.createElement("img");
      image.setAttribute("src", "../Images/diagram.png");
      image.setAttribute("usemap", "#diagram-map");
      const map = chapter.createElement("map");
      map.setAttribute(mapIdentity, "diagram-map");
      const area = chapter.createElement("area");
      area.setAttribute("href", "chapter-2.xhtml");
      map.append(area);
      chapter.body.append(image, map);

      act(() =>
        harness.latest().prepareDocument({
          document: chapter,
          sectionHref: "Text/chapter.xhtml",
        }),
      );

      expect(image.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(false);
      expect(image.hasAttribute("tabindex")).toBe(false);
      expect(image.hasAttribute("role")).toBe(false);
      expect(image.hasAttribute("aria-label")).toBe(false);
    },
  );

  it.each(["#missing-map", "chapter.xhtml#diagram-map", "#%", "#unrelated-map"])(
    "keeps an illustration standalone when image-map reference %s has no active owner",
    (useMap) => {
      const activeSession = { current: session() };
      const harness = renderController(activeSession);
      const { document: chapter } = linkedDocument("chapter-2.xhtml");
      const image = chapter.createElement("img");
      image.setAttribute("src", "../Images/diagram.png");
      image.setAttribute("usemap", useMap);
      const unrelatedMap = chapter.createElement("map");
      unrelatedMap.setAttribute("name", "unrelated-map");
      chapter.body.append(image, unrelatedMap);

      expect(() =>
        act(() =>
          harness.latest().prepareDocument({
            document: chapter,
            sectionHref: "Text/chapter.xhtml",
          }),
        ),
      ).not.toThrow();

      expect(image.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(true);
      expect(image.getAttribute("tabindex")).toBe("0");
      expect(image.getAttribute("role")).toBe("button");
      expect(image.getAttribute("aria-label")).toBe("Open illustration");
    },
  );

  it("does not prepare or activate illustration sources containing raw controls", () => {
    const getBlob = vi.fn();
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const activeSession = {
      current: {
        ...session(),
        book: { archive: { getBlob } } as unknown as EpubBook,
      },
    };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const context = { document: chapter, sectionHref: "Text/chapter.xhtml" };
    const malformedSources = [
      "\nImages/plate.jpg",
      "Images/plate.jpg\t",
      "\rImages/plate.jpg",
      "Images/\u007fplate.jpg",
    ];
    const illustrations: Element[] = [];

    for (const source of malformedSources) {
      const image = chapter.createElement("img");
      image.setAttribute("src", source);
      illustrations.push(image);

      const svg = chapter.createElementNS("http://www.w3.org/2000/svg", "svg");
      const svgImage = chapter.createElementNS("http://www.w3.org/2000/svg", "image");
      svgImage.setAttribute("href", source);
      svg.append(svgImage);
      illustrations.push(svgImage);
      chapter.body.append(image, svg);
    }

    act(() => harness.latest().prepareDocument(context));
    for (const illustration of illustrations) {
      const focusTarget =
        illustration.localName === "image" ? illustration.closest("svg")! : illustration;
      expect(focusTarget.hasAttribute("tabindex")).toBe(false);
      expect(focusTarget.hasAttribute("role")).toBe(false);
      act(() =>
        expect(harness.latest().handleContentClick(clickFrom(illustration), context)).toBe(false),
      );
    }

    expect(harness.latest().illustration).toBeNull();
    expect(resolveEpubIllustration).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("routes a linked full-size image into the illustration viewer", async () => {
    resolveEpubIllustration.mockResolvedValue({
      kind: "resolved",
      value: {
        blob: new Blob([new Uint8Array(512)], { type: "image/png" }),
        byteLength: 512,
        height: 800,
        href: "Images/full.png",
        mediaType: "image/png",
        release: vi.fn(),
        url: "blob:full",
        width: 1000,
      },
    } satisfies EpubIllustrationResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("../Images/full.png");
    const thumbnail = chapter.createElement("img");
    thumbnail.src = "../Images/thumb.png";
    link.replaceChildren(thumbnail);

    act(() => {
      harness.latest().handleContentClick(clickFrom(thumbnail), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    expect(resolveEpubIllustration).toHaveBeenCalledWith(
      activeSession.current?.book,
      expect.objectContaining({ documentHref: "Images/full.png" }),
      expect.any(AbortSignal),
    );
    expect(harness.latest().illustration?.resource?.url).toBe("blob:full");
  });

  it("releases the illustration and restores focus when Escape closes it", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const release = vi.fn();
    resolveEpubIllustration.mockResolvedValue({
      kind: "resolved",
      value: {
        blob: new Blob([new Uint8Array(512)], { type: "image/jpeg" }),
        byteLength: 512,
        height: 600,
        href: "Images/plate.jpg",
        mediaType: "image/jpeg",
        release,
        url: "blob:plate",
        width: 800,
      },
    } satisfies EpubIllustrationResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.src = "../Images/plate.jpg";
    image.tabIndex = 0;
    chapter.body.append(image);

    act(() => {
      harness.latest().handleContentClick(clickFrom(image), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());
    act(() => expect(harness.latest().handleEscape()).toBe(true));

    expect(release).toHaveBeenCalledOnce();
    expect(chapter.activeElement).toBe(image);
    expect(harness.latest().illustration).toBeNull();
  });

  it("releases a displayed illustration before resolving its replacement", async () => {
    const firstRelease = vi.fn();
    const secondRelease = vi.fn();
    resolveEpubIllustration
      .mockResolvedValueOnce({
        kind: "resolved",
        value: {
          blob: new Blob([new Uint8Array(1)], { type: "image/jpeg" }),
          byteLength: 1,
          height: 100,
          href: "Images/first.jpg",
          mediaType: "image/jpeg",
          release: firstRelease,
          url: "blob:first",
          width: 100,
        },
      } satisfies EpubIllustrationResolution)
      .mockResolvedValueOnce({
        kind: "resolved",
        value: {
          blob: new Blob([new Uint8Array(1)], { type: "image/jpeg" }),
          byteLength: 1,
          height: 100,
          href: "Images/second.jpg",
          mediaType: "image/jpeg",
          release: secondRelease,
          url: "blob:second",
          width: 100,
        },
      } satisfies EpubIllustrationResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const first = chapter.createElement("img");
    first.setAttribute("src", "../Images/first.jpg");
    const second = chapter.createElement("img");
    second.setAttribute("src", "../Images/second.jpg");
    chapter.body.append(first, second);
    const context = { document: chapter, sectionHref: "Text/chapter.xhtml" };

    act(() => harness.latest().handleContentClick(clickFrom(first), context));
    await act(async () => Promise.resolve());
    act(() => harness.latest().handleContentClick(clickFrom(second), context));
    await act(async () => Promise.resolve());

    expect(firstRelease).toHaveBeenCalledOnce();
    expect(secondRelease).not.toHaveBeenCalled();
    expect(harness.latest().illustration?.resource?.url).toBe("blob:second");
  });

  it("leaves image activation to selection handling while EPUB text is selected", () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.setAttribute("src", "../Images/plate.jpg");
    chapter.body.append(image);
    vi.spyOn(chapter, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);

    expect(
      harness.latest().handleContentClick(clickFrom(image), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      }),
    ).toBe(false);
    expect(resolveEpubIllustration).not.toHaveBeenCalled();
  });

  it("releases stale illustration results after the active book changes", async () => {
    let finish!: (resolution: EpubIllustrationResolution) => void;
    resolveEpubIllustration.mockImplementation(
      () => new Promise<EpubIllustrationResolution>((resolve) => (finish = resolve)),
    );
    const activeSession = { current: session(1) as EpubSessionSnapshot | null };
    const harness = renderController(activeSession);
    const { document: chapter } = linkedDocument("chapter-2.xhtml");
    const image = chapter.createElement("img");
    image.src = "../Images/plate.jpg";
    chapter.body.append(image);

    act(() => {
      harness.latest().handleContentClick(clickFrom(image), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    activeSession.current = session(2);
    act(() => harness.latest().resetForSession());
    const release = vi.fn();
    await act(async () => {
      finish({
        kind: "resolved",
        value: {
          blob: new Blob([new Uint8Array(1)], { type: "image/jpeg" }),
          byteLength: 1,
          height: 10,
          href: "Images/plate.jpg",
          mediaType: "image/jpeg",
          release,
          url: "blob:stale",
          width: 10,
        },
      });
      await Promise.resolve();
    });

    expect(release).toHaveBeenCalledOnce();
    expect(harness.latest().illustration).toBeNull();
  });

  it("requires confirmation before opening an external destination", async () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("https://example.com/source");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(harness.latest().external?.host).toBe("example.com");

    act(() => harness.latest().confirmExternal());
    await act(async () => Promise.resolve());
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/source");
  });

  it("does not create external confirmation state for malformed authorities", () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);

    for (const href of [
      "https:example.com",
      "http:foo.com",
      String.raw`https:\example.com`,
      String.raw`https:\\example.com`,
      "https:///missing-host",
      "https://",
    ]) {
      const { document: chapter, link } = linkedDocument(href);
      act(() => {
        expect(
          harness.latest().handleContentClick(clickFrom(link), {
            document: chapter,
            sectionHref: "Text/chapter.xhtml",
          }),
        ).toBe(true);
      });
      expect(harness.latest().external).toBeNull();
    }

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(resolveEpubFootnote).not.toHaveBeenCalled();
  });

  it("does not create external confirmation state for raw ASCII controls", () => {
    const activeSession = { current: session() };
    const harness = renderController(activeSession);

    for (const href of [
      "https://exa\tmple.com",
      "https://exa\nmple.com",
      "https://exa\rmple.com",
      "https://example.com/\nsource",
      `https://example.com/${String.fromCharCode(0x7f)}source`,
    ]) {
      const { document: chapter, link } = linkedDocument(href);
      act(() => {
        expect(
          harness.latest().handleContentClick(clickFrom(link), {
            document: chapter,
            sectionHref: "Text/chapter.xhtml",
          }),
        ).toBe(true);
      });
      expect(harness.latest().external).toBeNull();
    }

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(resolveEpubFootnote).not.toHaveBeenCalled();
  });

  it("keeps a failed external destination visible and restores focus after cancellation", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    openExternalUrl.mockRejectedValueOnce(new Error("unavailable"));
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("https://example.com/source");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    act(() => harness.latest().confirmExternal());
    await act(async () => Promise.resolve());

    expect(harness.latest().external).toMatchObject({
      error: "The link could not be opened in your browser.",
      opening: false,
    });
    act(() => harness.latest().dismissExternal());
    expect(chapter.activeElement).toBe(link);
  });

  it("reuses the original EPUB anchor when one footnote replaces another", async () => {
    const firstRelease = vi.fn();
    const secondRelease = vi.fn();
    resolveEpubFootnote
      .mockResolvedValueOnce({
        kind: "resolved",
        value: { nodes: [{ text: "First note", type: "text" }], release: firstRelease },
      } satisfies EpubFootnoteResolution)
      .mockResolvedValueOnce({
        kind: "resolved",
        value: { nodes: [{ text: "Second note", type: "text" }], release: secondRelease },
      } satisfies EpubFootnoteResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());
    const originalAnchor = harness.latest().footnote?.anchor;

    act(() =>
      harness.latest().handleFootnoteAction({
        kind: "footnote",
        target: {
          displayTarget: "Text/chapter.xhtml#note-2",
          documentHref: "Text/chapter.xhtml",
          fragment: "note-2",
          resourceKind: "document",
        },
      }),
    );
    await act(async () => Promise.resolve());

    expect(firstRelease).toHaveBeenCalledOnce();
    expect(harness.latest().footnote?.anchor).toBe(originalAnchor);
    expect(harness.latest().footnote?.anchor.focusTarget).toBe(link);
    expect(harness.latest().footnote?.content?.nodes).toEqual([
      { text: "Second note", type: "text" },
    ]);
    expect(secondRelease).not.toHaveBeenCalled();

    act(() => harness.latest().dismissFootnote(false));
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(secondRelease).toHaveBeenCalledOnce();
  });

  it("restores an external action from a footnote to the connected EPUB origin", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const release = vi.fn();
    resolveEpubFootnote.mockResolvedValueOnce({
      kind: "resolved",
      value: { nodes: [{ text: "A note", type: "text" }], release },
    } satisfies EpubFootnoteResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    act(() =>
      harness.latest().handleFootnoteAction({
        host: "example.com",
        kind: "external",
        url: "https://example.com/source",
      }),
    );

    expect(release).toHaveBeenCalledOnce();
    expect(harness.latest().footnote).toBeNull();
    expect(harness.latest().external?.anchor.focusTarget).toBe(link);
    act(() => harness.latest().dismissExternal());
    expect(chapter.activeElement).toBe(link);
  });

  it("dismisses a footnote from one mounted document before routing a link in another", async () => {
    const release = vi.fn();
    resolveEpubFootnote
      .mockResolvedValueOnce({
        kind: "resolved",
        value: { nodes: [{ text: "A note", type: "text" }], release },
      } satisfies EpubFootnoteResolution)
      .mockResolvedValueOnce({ kind: "not-footnote" } satisfies EpubFootnoteResolution);
    const activeSession = { current: session() };
    const harness = renderController(activeSession);
    const first = linkedDocument("#note-1", "noteref");
    const second = linkedDocument("chapter-3.xhtml#section");

    act(() => {
      harness.latest().handleContentClick(clickFrom(first.link), {
        document: first.document,
        sectionHref: "Text/chapter-1.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    act(() => {
      expect(
        harness.latest().handleContentPointerDown(pointerFrom(second.link), {
          document: second.document,
          sectionHref: "Text/chapter-2.xhtml",
        }),
      ).toBe(true);
    });
    expect(harness.latest().footnote).toBeNull();
    expect(release).toHaveBeenCalledOnce();

    act(() => {
      harness.latest().handleContentClick(clickFrom(second.link), {
        document: second.document,
        sectionHref: "Text/chapter-2.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    expect(harness.navigateToTarget).toHaveBeenCalledWith("Text/chapter-3.xhtml#section");
  });

  it("cancels and releases pending nested-note resolution when the active book changes", async () => {
    const firstRelease = vi.fn();
    let finishNested!: (resolution: EpubFootnoteResolution) => void;
    resolveEpubFootnote
      .mockResolvedValueOnce({
        kind: "resolved",
        value: { nodes: [{ text: "First note", type: "text" }], release: firstRelease },
      } satisfies EpubFootnoteResolution)
      .mockImplementationOnce(
        () => new Promise<EpubFootnoteResolution>((resolve) => (finishNested = resolve)),
      );
    const activeSession = { current: session(1) as EpubSessionSnapshot | null };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    await act(async () => Promise.resolve());

    act(() =>
      harness.latest().handleFootnoteAction({
        kind: "footnote",
        target: {
          displayTarget: "Text/chapter.xhtml#note-2",
          documentHref: "Text/chapter.xhtml",
          fragment: "note-2",
          resourceKind: "document",
        },
      }),
    );
    expect(firstRelease).toHaveBeenCalledOnce();

    activeSession.current = session(2);
    act(() => harness.latest().resetForSession());
    const nestedRelease = vi.fn();
    await act(async () => {
      finishNested({ kind: "resolved", value: { nodes: [], release: nestedRelease } });
      await Promise.resolve();
    });

    expect(firstRelease).toHaveBeenCalledOnce();
    expect(nestedRelease).toHaveBeenCalledOnce();
    expect(harness.latest().footnote).toBeNull();
  });

  it("releases a stale resolved note after the active book changes", async () => {
    let finish!: (resolution: EpubFootnoteResolution) => void;
    resolveEpubFootnote.mockImplementation(
      () => new Promise<EpubFootnoteResolution>((resolve) => (finish = resolve)),
    );
    const first = session(1);
    const activeSession = { current: first as EpubSessionSnapshot | null };
    const harness = renderController(activeSession);
    const { document: chapter, link } = linkedDocument("#note-1", "noteref");

    act(() => {
      harness.latest().handleContentClick(clickFrom(link), {
        document: chapter,
        sectionHref: "Text/chapter.xhtml",
      });
    });
    activeSession.current = session(2);
    act(() => harness.latest().resetForSession());
    const release = vi.fn();
    await act(async () => {
      finish({ kind: "resolved", value: { nodes: [], release } });
      await Promise.resolve();
    });

    expect(release).toHaveBeenCalledOnce();
    expect(harness.latest().footnote).toBeNull();
  });
});
