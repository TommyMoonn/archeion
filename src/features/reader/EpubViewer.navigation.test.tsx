// @vitest-environment happy-dom

import type { Location, Rendition } from "epubjs";
import { act, createRef } from "react";
import type { Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultReaderSettings, type ReaderNavigationState } from "../../types/reader";
import type { HighlightAnnotation } from "../../types/annotation";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";

const epubModuleMock = vi.hoisted(() => ({
  openBook: vi.fn(),
}));

vi.mock("epubjs", () => ({
  default: epubModuleMock.openBook,
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

type MockNavigation = {
  toc: Array<{
    href: string;
    id: string;
    label: string;
  }>;
};

type MockRendition = Rendition & {
  annotations: {
    highlight: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  emitContentMock: (content: { document?: Document; window?: Window }) => void;
  emitMock: (event: string, ...args: unknown[]) => void;
};

type MockBookSession = ReturnType<typeof createBookSession>;

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function createMockRendition(): MockRendition {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const contentListeners: Array<(content: { document?: Document; window?: Window }) => void> = [];
  const rendition = {
    annotations: {
      highlight: vi.fn(),
      remove: vi.fn(),
    },
    display: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    prev: vi.fn(async () => undefined),
    themes: {
      register: vi.fn(),
      select: vi.fn(),
    },
    hooks: {
      content: {
        register: vi.fn((listener: (content: { document?: Document; window?: Window }) => void) => {
          contentListeners.push(listener);
        }),
      },
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emitContentMock(content: { document?: Document; window?: Window }) {
      for (const listener of contentListeners) {
        listener(content);
      }
    },
    emitMock(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };

  return rendition as unknown as MockRendition;
}

function createBookSession(chapterId: string, chapterHref: string) {
  const navigation = deferred<MockNavigation>();
  const rendition = createMockRendition();
  const section = {
    href: chapterHref,
    index: 0,
  };
  const open = vi.fn();
  const renderTo = vi.fn(() => rendition);
  const destroy = vi.fn();
  const generate = vi.fn(async () => undefined);
  const book = {
    opened: Promise.resolve(),
    loaded: {
      navigation: navigation.promise,
    },
    load: vi.fn(async () => undefined),
    open,
    packaging: {
      navPath: "nav.xhtml",
      spine: [{}],
    },
    resolve: vi.fn((target: string) => target),
    spine: {
      each: (callback: (entry: unknown) => void) => callback(section),
      epubcfi: {
        compare: vi.fn(() => 0),
      },
      get: vi.fn((target: string | number | undefined) => {
        if (target === 0 || target === chapterHref) {
          return section;
        }
        return null;
      }),
    },
    renderTo,
    locations: { generate },
    destroy,
  };

  return {
    book,
    chapter: {
      id: chapterId,
      href: chapterHref,
      label: chapterId,
    },
    destroy,
    generate,
    navigation,
    open,
    renderTo,
    rendition,
  };
}

function relocation(href: string, cfi = "epubcfi(/6/2!/4/2:10)", page = 1, total = 4): Location {
  return {
    start: {
      href,
      cfi,
      index: 0,
      location: 0,
      percentage: 0.25,
      displayed: { page, total },
    },
    end: {
      href,
      cfi,
      index: 0,
      location: 0,
      percentage: 0.25,
      displayed: { page, total },
    },
    atEnd: false,
    atStart: false,
  };
}

const renderedHighlight: HighlightAnnotation = {
  cfiRange: "epubcfi(/6/2!/4/2,/1:10,/1:30)",
  color: "yellow",
  createdAt: "2026-07-13T00:00:00.000Z",
  id: "highlight-stable-id",
  selectedText: "Highlighted text",
  type: "highlight",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

function markCallback(session: MockBookSession, index = 0): (event: Event) => void {
  const callback = session.rendition.annotations.highlight.mock.calls[index]?.[2];
  if (typeof callback !== "function") throw new Error("Highlight callback was not registered.");
  return callback as (event: Event) => void;
}

function touchEvent(type: string, x: number, y: number): TouchEvent {
  const touch = { clientX: x, clientY: y } as Touch;
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    changedTouches: [touch],
    touches: type === "touchend" ? [] : [touch],
  });
}

function defaultViewerProps(fileBlob: Blob) {
  return {
    fileBlob,
    highlights: [] as readonly HighlightAnnotation[],
    onError: vi.fn(),
    onHighlightError: vi.fn(),
    onInteraction: vi.fn(),
    onKeyDown: vi.fn(),
    onLocationChange: vi.fn(),
    onNavigationChange: vi.fn<(navigation: ReaderNavigationState) => void>(),
    onReady: vi.fn(),
    settings: defaultReaderSettings,
  };
}

async function renderViewer(
  props: ReturnType<typeof defaultViewerProps>,
  viewerRef?: Ref<EpubViewerHandle>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoot = root;
  activeContainer = container;

  await act(async () => {
    root.render(<EpubViewer {...props} ref={viewerRef} />);
  });

  return { container, root };
}

async function rerenderViewer(
  root: Root,
  props: ReturnType<typeof defaultViewerProps>,
): Promise<void> {
  await act(async () => {
    root.render(<EpubViewer {...props} />);
  });
}

async function waitForActiveRendition(session: MockBookSession): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      expect(session.renderTo).toHaveBeenCalledTimes(1);
      expect(session.rendition.display).toHaveBeenCalledTimes(1);
    });
  });
}

async function resolveNavigation(session: MockBookSession): Promise<void> {
  await act(async () => {
    session.navigation.resolve({ toc: [session.chapter] });
    await session.navigation.promise;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("EpubViewer navigation lifecycle", () => {
  beforeEach(() => {
    epubModuleMock.openBook.mockReset();
    document.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
    }
    activeRoot = null;
    activeContainer?.remove();
    activeContainer = null;
    vi.clearAllMocks();
  });

  it("keeps the active rendition while navigation loads and does not reopen the book", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));

    await renderViewer(props);
    await waitForActiveRendition(session);

    expect(props.onNavigationChange).toHaveBeenCalledWith({
      chapters: [],
      status: "loading",
    });
    expect(session.navigation.promise).toBeInstanceOf(Promise);
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.open).not.toHaveBeenCalled();
    expect(session.renderTo).toHaveBeenCalledTimes(1);

    await resolveNavigation(session);

    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
    expect(session.rendition.display).toHaveBeenCalledTimes(1);
    expect(props.onNavigationChange).toHaveBeenLastCalledWith({
      chapters: [expect.objectContaining({ id: "chapter-1" })],
      status: "ready",
    });
  });

  it("does not recreate the book or rendition when settings or callback identities change", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const fileBlob = new Blob(["book-one"]);
    const initialProps = defaultViewerProps(fileBlob);
    const { root } = await renderViewer(initialProps);
    await waitForActiveRendition(session);
    await resolveNavigation(session);

    const settingsProps = {
      ...initialProps,
      settings: {
        ...defaultReaderSettings,
        fontSize: defaultReaderSettings.fontSize + 2,
      },
    };
    await rerenderViewer(root, settingsProps);

    const replacementNavigationCallback = vi.fn<(navigation: ReaderNavigationState) => void>();
    await rerenderViewer(root, {
      ...settingsProps,
      onNavigationChange: replacementNavigationCallback,
    });

    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
    expect(session.rendition.display).toHaveBeenCalledTimes(1);
    expect(replacementNavigationCallback).toHaveBeenCalledWith({
      chapters: [expect.objectContaining({ id: "chapter-1" })],
      status: "ready",
    });
  });

  it("uses continuous scrolling and restores the canonical CFI when modes change", async () => {
    const pagedSession = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const continuousSession = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook
      .mockReturnValueOnce(pagedSession.book)
      .mockReturnValueOnce(continuousSession.book);
    const fileBlob = new Blob(["book-one"]);
    const props = defaultViewerProps(fileBlob);
    const { root, container } = await renderViewer(props);
    await waitForActiveRendition(pagedSession);

    const canonicalCfi = "epubcfi(/6/2!/4/2:42)";
    await act(async () => {
      pagedSession.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", canonicalCfi),
      );
    });

    await rerenderViewer(root, {
      ...props,
      settings: { ...defaultReaderSettings, mode: "continuous" },
    });
    await waitForActiveRendition(continuousSession);

    expect(pagedSession.renderTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ flow: "paginated", manager: "default" }),
    );
    expect(continuousSession.renderTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ flow: "scrolled-continuous", manager: "continuous" }),
    );
    expect(continuousSession.rendition.display).toHaveBeenCalledWith(canonicalCfi);
    expect(container.querySelector(".epub-viewer")?.getAttribute("data-reader-mode")).toBe(
      "continuous",
    );
    expect(container.querySelectorAll(".epub-viewer__click-zone")).toHaveLength(0);
  });

  it("retains wheel listeners on earlier chapter documents as new chapters mount", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      settings: { ...defaultReaderSettings, mode: "continuous" as const },
    };
    await renderViewer(props);
    await waitForActiveRendition(session);

    const firstChapter = document.implementation.createHTMLDocument("Chapter one");
    const secondChapter = document.implementation.createHTMLDocument("Chapter two");
    session.rendition.emitContentMock({ document: firstChapter });
    session.rendition.emitContentMock({ document: secondChapter });
    props.onInteraction.mockClear();

    firstChapter.dispatchEvent(new WheelEvent("wheel", { cancelable: true, deltaY: 80 }));

    expect(props.onInteraction).toHaveBeenCalledTimes(1);
  });

  it("publishes current chapter changes without recreating the reader session", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));

    await renderViewer(props);
    await waitForActiveRendition(session);
    await resolveNavigation(session);

    await act(async () => {
      session.rendition.emitMock("relocated", relocation("Text/chapter-1.xhtml"));
    });

    expect(props.onNavigationChange).toHaveBeenLastCalledWith({
      chapterProgress: 25,
      chapters: [expect.objectContaining({ id: "chapter-1" })],
      currentChapterId: "chapter-1",
      status: "ready",
    });
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
    expect(session.rendition.display).toHaveBeenCalledTimes(1);
  });

  it("publishes meaningful chapter progress changes within the current chapter", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));

    await renderViewer(props);
    await waitForActiveRendition(session);
    await resolveNavigation(session);

    await act(async () => {
      session.rendition.emitMock("relocated", relocation("Text/chapter-1.xhtml"));
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:20)", 2, 4),
      );
    });

    expect(props.onNavigationChange).toHaveBeenLastCalledWith({
      chapterProgress: 50,
      chapters: [expect.objectContaining({ id: "chapter-1" })],
      currentChapterId: "chapter-1",
      status: "ready",
    });
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
  });

  it("uses the shared chapter target when toolbar navigation requests a chapter", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    await resolveNavigation(session);

    let didNavigate = false;
    await act(async () => {
      didNavigate = (await viewerRef.current?.navigateToChapter("chapter-1")) ?? false;
    });

    expect(didNavigate).toBe(true);
    expect(session.rendition.display).toHaveBeenLastCalledWith("Text/chapter-1.xhtml");
    expect(session.rendition.display).toHaveBeenCalledTimes(2);
  });

  it("ignores stale navigation results after the book changes", async () => {
    const firstSession = createBookSession("old-chapter", "Text/old.xhtml");
    const secondSession = createBookSession("new-chapter", "Text/new.xhtml");
    epubModuleMock.openBook
      .mockReturnValueOnce(firstSession.book)
      .mockReturnValueOnce(secondSession.book);
    const firstProps = defaultViewerProps(new Blob(["book-one"]));
    const { root } = await renderViewer(firstProps);
    await waitForActiveRendition(firstSession);

    const navigationChanges = firstProps.onNavigationChange;
    await rerenderViewer(root, {
      ...firstProps,
      fileBlob: new Blob(["book-two"]),
    });
    await waitForActiveRendition(secondSession);
    await resolveNavigation(secondSession);
    await resolveNavigation(firstSession);

    expect(firstSession.destroy).toHaveBeenCalledTimes(1);
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(2);
    expect(secondSession.renderTo).toHaveBeenCalledTimes(1);
    expect(
      navigationChanges.mock.calls.some(([state]) =>
        state.chapters.some((chapter) => chapter.id === "old-chapter"),
      ),
    ).toBe(false);
    expect(navigationChanges).toHaveBeenLastCalledWith({
      chapters: [expect.objectContaining({ id: "new-chapter" })],
      status: "ready",
    });
  });

  it("ignores navigation results that resolve after the viewer unmounts", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const { root } = await renderViewer(props);
    await waitForActiveRendition(session);
    const callCountBeforeUnmount = props.onNavigationChange.mock.calls.length;

    act(() => root.unmount());
    activeRoot = null;
    await resolveNavigation(session);
    await flushAsyncWork();

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(props.onNavigationChange).toHaveBeenCalledTimes(callCountBeforeUnmount);
  });

  it("navigates directly to a saved bookmark CFI through the viewer handle", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    await act(async () => {
      await expect(viewerRef.current?.navigateToLocation("epubcfi(/6/2!/4/2:10)")).resolves.toBe(
        true,
      );
    });

    expect(session.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/2!/4/2:10)");
  });

  it("registers, activates, replaces, and removes rendered marks by stable annotation ID", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { container, root } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );

    expect(session.rendition.annotations.highlight.mock.calls[0]?.[1]).toEqual({
      annotationId: renderedHighlight.id,
    });
    const firstCallback = markCallback(session);
    const mark = document.createElement("button");
    mark.addEventListener("click", firstCallback);
    document.body.append(mark);
    await act(async () => {
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }));
    });

    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    expect(
      container.querySelector('[aria-label="yellow highlight"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(session.rendition.next).not.toHaveBeenCalled();
    expect(session.rendition.prev).not.toHaveBeenCalled();

    await rerenderViewer(root, props);
    session.rendition.emitMock("rendered", {}, {});
    expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1);

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const blueHighlight = { ...renderedHighlight, color: "blue" } as const;
    await rerenderViewer(root, { ...props, highlights: [blueHighlight] });
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(2),
    );
    expect(session.rendition.annotations.remove).toHaveBeenCalledWith(
      renderedHighlight.cfiRange,
      "highlight",
    );
    expect(session.rendition.annotations.remove.mock.invocationCallOrder[0]).toBeLessThan(
      session.rendition.annotations.highlight.mock.invocationCallOrder[1]!,
    );

    await act(async () => {
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }));
    });
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();

    const replacementCallback = markCallback(session, 1);
    const replacementMark = document.createElement("button");
    replacementMark.addEventListener("click", replacementCallback);
    document.body.append(replacementMark);
    await act(async () => {
      replacementMark.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }),
      );
    });
    expect(
      container.querySelector('[aria-label="blue highlight"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(session.rendition.annotations.highlight.mock.calls[1]?.[1]).toEqual({
      annotationId: renderedHighlight.id,
    });

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await rerenderViewer(root, { ...props, highlights: [] });
    expect(session.rendition.annotations.remove).toHaveBeenCalledTimes(2);
    expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(2);
    await act(async () => {
      replacementMark.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }),
      );
    });
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
  });

  it("handles touch taps once, ignores selection drags, and keeps page zones outside content", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
      settings: { ...defaultReaderSettings, margin: 24 },
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const callback = markCallback(session);
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", callback);
    mark.addEventListener("click", callback);
    document.body.append(mark);

    await act(async () => {
      mark.dispatchEvent(touchEvent("touchstart", 20, 20));
      document.dispatchEvent(touchEvent("touchend", 22, 21));
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 22, clientY: 21 }));
    });
    expect(props.onInteraction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const text = document.createTextNode("selected text");
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()?.addRange(range);
    await act(async () => {
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 22, clientY: 21 }));
    });
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
    expect(session.rendition.next).not.toHaveBeenCalled();
    expect(session.rendition.prev).not.toHaveBeenCalled();

    const zones = container.querySelectorAll<HTMLElement>(".epub-viewer__click-zone");
    expect(zones).toHaveLength(2);
    expect(zones[0]?.style.getPropertyValue("--reader-page-turn-zone-width")).toBe("24px");
  });

  it("activates rendered highlights in continuous mode without page-turn zones", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
      settings: { ...defaultReaderSettings, mode: "continuous" as const },
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const mark = document.createElement("button");
    mark.addEventListener("click", markCallback(session));
    document.body.append(mark);

    await act(async () => {
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }));
    });
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    expect(container.querySelectorAll(".epub-viewer__click-zone")).toHaveLength(0);
  });

  it("reports overlap as nonfatal feedback and keeps the rendition mounted", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    const selection = {
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ height: 10, left: 10, top: 10, width: 30 }),
      }),
      rangeCount: 1,
      toString: () => "partially overlapping text",
    } as unknown as Selection;

    await act(async () => {
      session.rendition.emitMock("selected", "epubcfi(/6/2!/4/2,/1:25,/1:40)", {
        section: { href: "Text/chapter-1.xhtml" },
        window: { getSelection: () => selection },
      });
    });

    expect(props.onHighlightError).toHaveBeenCalledWith(
      "Overlapping highlights cannot be edited together.",
    );
    expect(props.onError).not.toHaveBeenCalled();
    expect(container.querySelector(".epub-viewer")).toBeInstanceOf(HTMLElement);
    expect(session.destroy).not.toHaveBeenCalled();
  });

  it("clears pending mark gesture listeners during teardown", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { root } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", markCallback(session));
    document.body.append(mark);
    const removeListener = vi.spyOn(document, "removeEventListener");

    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    act(() => root.unmount());
    activeRoot = null;

    expect(removeListener).toHaveBeenCalledWith("touchend", expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith("touchmove", expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith("touchcancel", expect.any(Function), true);
  });
});
