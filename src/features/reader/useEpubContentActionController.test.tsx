// @vitest-environment happy-dom

import type { Book as EpubBook, Rendition } from "epubjs";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpubFootnoteResolution } from "./epubFootnoteResolver";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";
import type { EpubSessionSnapshot } from "./useEpubSession";
import {
  useEpubContentActionController,
  type EpubContentActionController,
} from "./useEpubContentActionController";

const resolveEpubFootnote = vi.hoisted(() => vi.fn());
const openExternalEpubLink = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./epubFootnoteResolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./epubFootnoteResolver")>()),
  resolveEpubFootnote,
}));
vi.mock("./openExternalEpubLink", () => ({ openExternalEpubLink }));

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

function clickFrom(link: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent("click", { button: 0 });
  Object.defineProperty(event, "target", { configurable: true, value: link });
  return event;
}

function pointerFrom(link: HTMLAnchorElement): PointerEvent {
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
  openExternalEpubLink.mockReset();
  openExternalEpubLink.mockResolvedValue(undefined);
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
    expect(openExternalEpubLink).not.toHaveBeenCalled();
    expect(harness.latest().external?.host).toBe("example.com");

    act(() => harness.latest().confirmExternal());
    await act(async () => Promise.resolve());
    expect(openExternalEpubLink).toHaveBeenCalledWith("https://example.com/source");
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

    expect(openExternalEpubLink).not.toHaveBeenCalled();
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

    expect(openExternalEpubLink).not.toHaveBeenCalled();
    expect(resolveEpubFootnote).not.toHaveBeenCalled();
  });

  it("keeps a failed external destination visible and restores focus after cancellation", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    openExternalEpubLink.mockRejectedValueOnce(new Error("unavailable"));
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
