// @vitest-environment happy-dom

import type { Location, Rendition } from "epubjs";
import { act, createRef } from "react";
import type { Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { defaultReaderSettings, type ReaderNavigationState } from "../../types/reader";
import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";
import type { EpubIllustrationResolution } from "./epubIllustrationResolver";
import { createReaderFileLease } from "./readerFileLease";
import { createReaderSessionLifecycle, transitionReaderSession } from "./readerSession";
import { READER_ILLUSTRATION_TRIGGER_ATTRIBUTE } from "./readerIllustrationTrigger";
import { resolveBuiltInReaderTheme, resolveReaderTheme } from "../../themes/resolveTheme";
import { createReaderContentTheme } from "./readerTheme";

const epubModuleMock = vi.hoisted(() => ({
  openBook: vi.fn(),
}));
const resolveEpubIllustration = vi.hoisted(() => vi.fn());

vi.mock("epubjs", () => ({
  default: epubModuleMock.openBook,
}));
vi.mock("./epubIllustrationResolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./epubIllustrationResolver")>()),
  resolveEpubIllustration,
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

type MockNavigation = {
  landmarks?: Array<{
    href: string;
    id: string;
    label: string;
    type?: string;
  }>;
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
    underline: ReturnType<typeof vi.fn>;
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
      underline: vi.fn(),
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
  const bookListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const navigation = deferred<MockNavigation>();
  const navigationSource = deferred<Document>();
  const navigationDocument = document.implementation.createHTMLDocument("navigation");
  const rendition = createMockRendition();
  const chapterDocument = document.implementation.createHTMLDocument(chapterId);
  chapterDocument.body.innerHTML = "<p id='chapter-text'>Highlighted text</p>";
  const section = {
    cfiFromElement: vi.fn(() => `epubcfi(${chapterHref}#start)`),
    cfiFromRange: vi.fn(() => `epubcfi(${chapterHref}#recovered-range)`),
    contents: chapterDocument.documentElement as Element | undefined,
    document: chapterDocument as Document | undefined,
    href: chapterHref,
    index: 0,
    load: vi.fn(async () => {
      section.document = chapterDocument;
      section.contents = chapterDocument.documentElement;
      return chapterDocument.documentElement;
    }),
    unload: vi.fn(() => {
      section.document = undefined;
      section.contents = undefined;
    }),
  };
  const open = vi.fn();
  const renderTo = vi.fn(() => rendition);
  const destroy = vi.fn();
  const generatedLocations = ["epubcfi(/6/2!/4/2:0)", "epubcfi(/6/2!/4/10:0)"];
  const generate = vi.fn(async () => generatedLocations);
  const cfiFromPercentage = vi.fn((percentage: number) =>
    percentage >= 1 ? generatedLocations[1] : generatedLocations[0],
  );
  const percentageFromCfi = vi.fn((cfi: string) => (cfi === generatedLocations[1] ? 1 : 0));
  const book = {
    opened: Promise.resolve(),
    loaded: {
      navigation: navigation.promise,
    },
    load: vi.fn(async (target: string) =>
      target === "nav.xhtml" ? navigationSource.promise : undefined,
    ),
    navigation: undefined as MockNavigation | undefined,
    getRange: vi.fn(async () => {
      const range = chapterDocument.createRange();
      range.selectNodeContents(chapterDocument.querySelector("p")!);
      return range;
    }),
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
        if (
          target === 0 ||
          target === chapterHref ||
          (typeof target === "string" && target.startsWith("epubcfi("))
        ) {
          return section;
        }
        return null;
      }),
    },
    renderTo,
    locations: { cfiFromPercentage, generate, percentageFromCfi },
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      bookListeners.get(event)?.delete(callback);
    }),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      const listeners = bookListeners.get(event) ?? new Set();
      listeners.add(callback);
      bookListeners.set(event, listeners);
    }),
    destroy,
  };

  return {
    book,
    chapter: {
      id: chapterId,
      href: chapterHref,
      label: chapterId,
    },
    chapterDocument,
    cfiFromPercentage,
    destroy,
    generate,
    navigationDocument,
    percentageFromCfi,
    navigation: {
      promise: navigation.promise,
      reject(reason?: unknown) {
        navigationSource.reject(reason);
        navigation.reject(reason);
      },
      resolve(value: MockNavigation) {
        book.navigation = value;
        navigationSource.resolve(navigationDocument);
        navigation.resolve(value);
      },
    },
    open,
    renderTo,
    rendition,
    section,
  };
}

function createSpineSection(href: string, text: string, index: number) {
  const chapter = document.implementation.createHTMLDocument(href);
  chapter.body.textContent = text;
  const value = {
    cfiFromElement: vi.fn(() => `epubcfi(${href}#start)`),
    cfiFromRange: vi.fn(() => `epubcfi(${href}#range)`),
    contents: undefined as Element | undefined,
    document: undefined as Document | undefined,
    href,
    index,
    load: vi.fn(async () => {
      value.document = chapter;
      value.contents = chapter.documentElement;
      return chapter.documentElement;
    }),
    unload: vi.fn(() => {
      value.document = undefined;
      value.contents = undefined;
    }),
  };
  return value;
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

function clientRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
}

function realClientRect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

function defaultViewerProps(fileBlob: Blob) {
  const sessionIdentity = transitionReaderSession(createReaderSessionLifecycle(), {
    bookId: "test-book",
    type: "open",
  }).state.identity;

  if (!sessionIdentity) {
    throw new Error("Expected an open reader session identity.");
  }

  const readerTheme = resolveBuiltInReaderTheme("dark");
  return {
    contentTheme: createReaderContentTheme(defaultReaderSettings, readerTheme.tokens),
    fileLease: createReaderFileLease({
      initialBlob: fileBlob,
      load: async () => fileBlob,
      requestKey: `test-reader-file:${fileBlob.size}`,
    }),
    highlights: [] as readonly HighlightAnnotation[],
    onError: vi.fn(),
    onHighlightInteractionClear: vi.fn(),
    onHighlightInteractionError: vi.fn(),
    onInteraction: vi.fn(),
    onKeyDown: vi.fn(),
    onLocationChange: vi.fn(),
    onNavigationChange: vi.fn<(navigation: ReaderNavigationState) => void>(),
    onNavigationHistoryChange: vi.fn(),
    onPublicationSearchChange: vi.fn(),
    onReady: vi.fn(),
    readerTheme,
    sessionIdentity,
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
  viewerRef?: Ref<EpubViewerHandle>,
): Promise<void> {
  await act(async () => {
    root.render(<EpubViewer {...props} ref={viewerRef} />);
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
    resolveEpubIllustration.mockReset();
    document.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
    }
    activeRoot = null;
    activeContainer?.remove();
    activeContainer = null;
    resetTransientSurfaceOwnershipForTests();
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
      landmarks: [],
      pageReferences: [],
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
      landmarks: [],
      pageReferences: [],
      status: "ready",
    });
  });

  it.each(["paged", "continuous"] as const)(
    "isolates illustration input in %s mode without recreating the rendition",
    async (mode) => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        callback(0);
        return 1;
      });
      const release = vi.fn();
      resolveEpubIllustration.mockResolvedValue({
        kind: "resolved",
        value: {
          blob: new Blob([new Uint8Array(1024)], { type: "image/jpeg" }),
          byteLength: 1024,
          height: 900,
          href: "Images/plate.jpg",
          mediaType: "image/jpeg",
          release,
          url: "blob:plate",
          width: 1200,
        },
      } satisfies EpubIllustrationResolution);
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        settings: { ...defaultReaderSettings, mode },
      };
      const { container } = await renderViewer(props);
      await waitForActiveRendition(session);
      const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
      const scroller = document.createElement("div");
      scroller.className = "epub-container";
      scroller.scrollTop = 40;
      stage.append(scroller);
      const frame = document.createElement("iframe");
      stage.append(frame);
      Object.defineProperty(frame.contentWindow, "frameElement", {
        configurable: true,
        value: frame,
      });
      const image = frame.contentDocument!.createElement("img");
      image.setAttribute("src", "../Images/plate.jpg");
      frame.contentDocument!.body.append(image);

      await act(async () =>
        session.rendition.emitMock(
          "rendered",
          { href: "Text/chapter-1.xhtml" },
          { document: frame.contentDocument },
        ),
      );
      expect(image.getAttribute("role")).toBe("button");
      if (mode === "paged") {
        act(() =>
          frame.contentDocument!.dispatchEvent(
            new WheelEvent("wheel", { cancelable: true, deltaY: 24 }),
          ),
        );
      }
      expect(session.rendition.next).not.toHaveBeenCalled();
      await act(async () => image.click());
      await act(async () => Promise.resolve());

      const dialog = container.querySelector<HTMLDialogElement>(".reader-illustration-viewer");
      expect(dialog?.open).toBe(true);
      expect(dialog?.querySelector("img")?.getAttribute("src")).toBe("blob:plate");
      expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
      expect(session.renderTo).toHaveBeenCalledTimes(1);
      expect(session.rendition.display).toHaveBeenCalledTimes(1);
      expect(props.onLocationChange).not.toHaveBeenCalled();
      const interactionCountBeforeModalWheel = props.onInteraction.mock.calls.length;
      const modalWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 80,
      });
      act(() =>
        dialog?.querySelector(".reader-illustration-viewer__viewport")?.dispatchEvent(modalWheel),
      );
      expect(modalWheel.defaultPrevented).toBe(true);
      expect(props.onInteraction).toHaveBeenCalledTimes(interactionCountBeforeModalWheel);
      expect(scroller.scrollTop).toBe(40);
      expect(session.rendition.next).not.toHaveBeenCalled();
      expect(session.rendition.prev).not.toHaveBeenCalled();

      if (mode === "paged") {
        act(() =>
          frame.contentDocument!.dispatchEvent(
            new WheelEvent("wheel", { cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).not.toHaveBeenCalled();
      }

      await act(async () => dialog?.dispatchEvent(new Event("cancel", { cancelable: true })));
      act(() =>
        frame.contentDocument!.dispatchEvent(
          new WheelEvent("wheel", { cancelable: true, deltaY: 24 }),
        ),
      );
      if (mode === "paged") {
        expect(session.rendition.next).not.toHaveBeenCalled();
        act(() =>
          frame.contentDocument!.dispatchEvent(
            new WheelEvent("wheel", { cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).toHaveBeenCalledOnce();
      } else {
        expect(scroller.scrollTop).toBe(64);
        expect(session.rendition.next).not.toHaveBeenCalled();
      }
      expect(container.querySelector(".reader-illustration-viewer")).toBeNull();
      expect(release).toHaveBeenCalledOnce();
      expect(frame.contentDocument?.activeElement).toBe(image);
      expect(session.destroy).not.toHaveBeenCalled();
      expect(props.onLocationChange).not.toHaveBeenCalled();
    },
  );

  it.each(["paged", "continuous"] as const)(
    "rejects transient-surface wheel input before %s reader handling",
    async (mode) => {
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        settings: { ...defaultReaderSettings, mode },
      };
      const { container } = await renderViewer(props);
      await waitForActiveRendition(session);
      const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
      const scroller = document.createElement("div");
      scroller.className = "epub-container";
      scroller.scrollTop = 40;
      const transient = document.createElement("div");
      transient.dataset.readerIgnoreShortcuts = "";
      const child = document.createElement("span");
      transient.append(child);
      stage.append(scroller, transient);
      const interactionCount = props.onInteraction.mock.calls.length;

      act(() =>
        child.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }),
        ),
      );

      expect(props.onInteraction).toHaveBeenCalledTimes(interactionCount);
      expect(scroller.scrollTop).toBe(40);
      expect(session.rendition.next).not.toHaveBeenCalled();
      expect(session.rendition.prev).not.toHaveBeenCalled();
    },
  );

  it.each(["paged", "continuous"] as const)(
    "applies %s wheel policy over the same ordinary EPUB link",
    async (mode) => {
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        settings: { ...defaultReaderSettings, mode },
      };
      const { container } = await renderViewer(props);
      await waitForActiveRendition(session);
      const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
      const scroller = document.createElement("div");
      scroller.className = "epub-container";
      scroller.scrollTop = 40;
      const frame = document.createElement("iframe");
      stage.append(scroller, frame);
      Object.defineProperty(frame.contentWindow, "frameElement", {
        configurable: true,
        value: frame,
      });
      const link = frame.contentDocument!.createElement("a");
      link.href = "#chapter";
      link.textContent = "Chapter link";
      const paragraph = frame.contentDocument!.createElement("p");
      paragraph.textContent = "Ordinary EPUB text";
      frame.contentDocument!.body.append(link, paragraph);

      await act(async () =>
        session.rendition.emitMock(
          "rendered",
          { href: "Text/chapter-1.xhtml" },
          { document: frame.contentDocument },
        ),
      );
      const interactionCount = props.onInteraction.mock.calls.length;

      act(() =>
        link.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: mode === "paged" ? 24 : 80,
          }),
        ),
      );

      if (mode === "paged") {
        expect(props.onInteraction).toHaveBeenCalledTimes(interactionCount);
        expect(session.rendition.next).not.toHaveBeenCalled();
        act(() =>
          paragraph.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).not.toHaveBeenCalled();
        act(() =>
          paragraph.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).toHaveBeenCalledOnce();
      } else {
        expect(props.onInteraction).toHaveBeenCalledTimes(interactionCount + 1);
        expect(scroller.scrollTop).toBe(120);
        expect(session.rendition.next).not.toHaveBeenCalled();
      }
      expect(session.rendition.prev).not.toHaveBeenCalled();
    },
  );

  it.each(["paged", "continuous"] as const)(
    "keeps prepared illustration hover wheel input active in %s mode",
    async (mode) => {
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        settings: { ...defaultReaderSettings, mode },
      };
      const { container } = await renderViewer(props);
      await waitForActiveRendition(session);
      const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
      const scroller = document.createElement("div");
      scroller.className = "epub-container";
      scroller.scrollTop = 40;
      const frame = document.createElement("iframe");
      stage.append(scroller, frame);
      Object.defineProperty(frame.contentWindow, "frameElement", {
        configurable: true,
        value: frame,
      });

      const standalone = frame.contentDocument!.createElement("img");
      standalone.setAttribute("src", "../Images/standalone.jpg");
      const link = frame.contentDocument!.createElement("a");
      link.setAttribute("href", "chapter-2.xhtml");
      const linked = frame.contentDocument!.createElement("img");
      linked.setAttribute("src", "../Images/linked.jpg");
      link.append(linked);
      const button = frame.contentDocument!.createElement("button");
      button.textContent = "Publisher control";
      frame.contentDocument!.body.append(standalone, link, button);

      await act(async () =>
        session.rendition.emitMock(
          "rendered",
          { href: "Text/chapter-1.xhtml" },
          { document: frame.contentDocument },
        ),
      );

      expect(standalone.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(true);
      expect(linked.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(false);

      if (mode === "paged") {
        act(() => {
          linked.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          );
          button.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          );
          standalone.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          );
        });
        expect(session.rendition.next).not.toHaveBeenCalled();

        act(() =>
          standalone.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          ),
        );

        expect(session.rendition.next).toHaveBeenCalledOnce();
        expect(scroller.scrollTop).toBe(40);
      } else {
        act(() =>
          standalone.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }),
          ),
        );
        expect(scroller.scrollTop).toBe(120);

        act(() =>
          linked.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }),
          ),
        );
        expect(scroller.scrollTop).toBe(200);
        expect(session.rendition.next).not.toHaveBeenCalled();
      }
      expect(session.rendition.prev).not.toHaveBeenCalled();
    },
  );

  it.each(["paged", "continuous"] as const)(
    "preserves publisher image-map wheel ownership in %s mode",
    async (mode) => {
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        settings: { ...defaultReaderSettings, mode },
      };
      const { container } = await renderViewer(props);
      await waitForActiveRendition(session);
      const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
      const scroller = document.createElement("div");
      scroller.className = "epub-container";
      scroller.scrollTop = 40;
      const frame = document.createElement("iframe");
      stage.append(scroller, frame);
      Object.defineProperty(frame.contentWindow, "frameElement", {
        configurable: true,
        value: frame,
      });

      const mappedImage = frame.contentDocument!.createElement("img");
      mappedImage.setAttribute("src", "../Images/diagram.png");
      mappedImage.setAttribute("usemap", "#diagram-map");
      const map = frame.contentDocument!.createElement("map");
      map.setAttribute("name", "diagram-map");
      const area = frame.contentDocument!.createElement("area");
      area.setAttribute("href", "chapter-2.xhtml");
      map.append(area);
      const paragraph = frame.contentDocument!.createElement("p");
      paragraph.textContent = "Ordinary EPUB text";
      frame.contentDocument!.body.append(mappedImage, map, paragraph);

      await act(async () =>
        session.rendition.emitMock(
          "rendered",
          { href: "Text/chapter-1.xhtml" },
          { document: frame.contentDocument },
        ),
      );

      expect(mappedImage.hasAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE)).toBe(false);
      expect(mappedImage.hasAttribute("role")).toBe(false);

      act(() =>
        mappedImage.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: mode === "paged" ? 24 : 80,
          }),
        ),
      );

      if (mode === "paged") {
        expect(session.rendition.next).not.toHaveBeenCalled();
        act(() =>
          paragraph.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).not.toHaveBeenCalled();
        act(() =>
          paragraph.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 }),
          ),
        );
        expect(session.rendition.next).toHaveBeenCalledOnce();
        expect(scroller.scrollTop).toBe(40);
      } else {
        expect(scroller.scrollTop).toBe(120);
        expect(session.rendition.next).not.toHaveBeenCalled();
      }
      expect(session.rendition.prev).not.toHaveBeenCalled();
    },
  );

  it("does not recreate the book or rendition when settings, palette, or callbacks change", async () => {
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
    settingsProps.contentTheme = createReaderContentTheme(
      settingsProps.settings,
      settingsProps.readerTheme.tokens,
    );
    await rerenderViewer(root, settingsProps);
    const registerTheme = vi.mocked(session.rendition.themes.register);
    const selectTheme = vi.mocked(session.rendition.themes.select);
    const registrationsBeforePalette = registerTheme.mock.calls.length;
    const selectionsBeforePalette = selectTheme.mock.calls.length;

    const paletteReaderTheme = resolveReaderTheme("dark", { background: "#123456" });
    const paletteProps = {
      ...settingsProps,
      contentTheme: createReaderContentTheme(settingsProps.settings, paletteReaderTheme.tokens),
      readerTheme: paletteReaderTheme,
    };
    await rerenderViewer(root, paletteProps);

    const replacementNavigationCallback = vi.fn<(navigation: ReaderNavigationState) => void>();
    await rerenderViewer(root, {
      ...paletteProps,
      onNavigationChange: replacementNavigationCallback,
    });

    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
    expect(session.rendition.display).toHaveBeenCalledTimes(1);
    expect(registerTheme).toHaveBeenCalledTimes(registrationsBeforePalette + 1);
    expect(selectTheme).toHaveBeenCalledTimes(selectionsBeforePalette + 1);
    expect(registerTheme).toHaveBeenLastCalledWith(
      "archeion-reader",
      expect.objectContaining({
        body: expect.objectContaining({ background: "#123456 !important" }),
      }),
    );
    expect(replacementNavigationCallback).toHaveBeenCalledWith({
      chapters: [expect.objectContaining({ id: "chapter-1" })],
      landmarks: [],
      pageReferences: [],
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
      landmarks: [],
      pageReferences: [],
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
      landmarks: [],
      pageReferences: [],
      status: "ready",
    });
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.renderTo).toHaveBeenCalledTimes(1);
  });

  it("routes Contents and annotation-location jumps through one deliberate history owner", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    await resolveNavigation(session);
    await act(async () => {
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:4)"),
      );
    });

    let didNavigate = false;
    await act(async () => {
      didNavigate = (await viewerRef.current?.navigateToChapter("chapter-1")) ?? false;
    });

    expect(didNavigate).toBe(true);
    expect(session.rendition.display).toHaveBeenLastCalledWith("Text/chapter-1.xhtml");
    expect(viewerRef.current?.getNavigationHistorySnapshot().backCount).toBe(1);
    expect(props.onNavigationHistoryChange).toHaveBeenLastCalledWith({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });

    await act(async () => {
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/6:8)"),
      );
      await expect(viewerRef.current?.navigateToLocation("epubcfi(/6/2!/4/10:2)")).resolves.toBe(
        true,
      );
    });

    expect(session.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/2!/4/10:2)");
    expect(viewerRef.current?.getNavigationHistorySnapshot()).toEqual({
      backCount: 2,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("routes committed seek targets through deliberate history and leaves history intact on failure", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    await resolveNavigation(session);
    await vi.waitFor(() => expect(session.generate).toHaveBeenCalledTimes(1));

    act(() => {
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:4)"),
      );
    });

    expect(viewerRef.current?.resolveSeekPreview(0)).toEqual({
      chapterLabel: "chapter-1",
      percentage: 0,
    });
    expect(viewerRef.current?.resolveSeekPreview(100)).toEqual({
      chapterLabel: "chapter-1",
      percentage: 100,
    });

    await act(async () => {
      await expect(viewerRef.current?.navigateToSeekPercentage(100)).resolves.toBe(true);
    });

    expect(session.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/2!/4/10:0)");
    expect(viewerRef.current?.getNavigationHistorySnapshot().backCount).toBe(1);

    vi.mocked(session.rendition.display).mockRejectedValueOnce(new Error("seek display failed"));

    await act(async () => {
      await expect(viewerRef.current?.navigateToSeekPercentage(0)).resolves.toBe(false);
    });

    expect(viewerRef.current?.getNavigationHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("routes landmark and page-list selections through the deliberate history owner", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    session.chapterDocument.body.insertAdjacentHTML(
      "beforeend",
      '<div id="cover"></div><span id="page-a12"></span>',
    );
    session.navigationDocument.body.innerHTML = `
      <nav epub:type="page-list">
        <ol>
          <li id="page-a12"><a href="Text/chapter-1.xhtml#page-a12">A-12</a></li>
        </ol>
      </nav>
    `;
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    await act(async () => {
      session.navigation.resolve({
        landmarks: [
          {
            href: "Text/chapter-1.xhtml#cover",
            id: "landmark-cover",
            label: "Cover",
            type: "cover",
          },
        ],
        toc: [session.chapter],
      });
      await session.navigation.promise;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:4)"),
      );
    });

    expect(props.onNavigationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        landmarks: [expect.objectContaining({ id: "landmark-cover", semanticType: "cover" })],
        pageReferences: [expect.objectContaining({ id: "page-a12", label: "A-12" })],
      }),
    );

    await act(async () => {
      await expect(viewerRef.current?.navigateToNavigationItem("landmark-cover")).resolves.toBe(
        true,
      );
    });
    expect(session.rendition.display).toHaveBeenLastCalledWith("Text/chapter-1.xhtml#cover");
    expect(viewerRef.current?.getNavigationHistorySnapshot().backCount).toBe(1);

    await act(async () => {
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/4:6)"),
      );
      await expect(viewerRef.current?.navigateToNavigationItem("page-a12")).resolves.toBe(true);
    });
    expect(session.rendition.display).toHaveBeenLastCalledWith("Text/chapter-1.xhtml#page-a12");
    expect(viewerRef.current?.getNavigationHistorySnapshot().backCount).toBe(2);
  });

  it("routes selected publication-search results through deliberate history and clears transient emphasis", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    act(() => {
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:4)"),
      );
    });
    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();
    expect(viewerRef.current?.getPublicationSearchState().status).toBe("ready");

    const searchState = viewerRef.current!.getPublicationSearchState();
    expect(searchState.results).toHaveLength(1);
    expect(searchState.selectedResult).toBe(searchState.results[0]);
    const target = searchState.selectedResult!.target;
    expect(session.rendition.annotations.underline).toHaveBeenCalledWith(
      target,
      { transient: "reader-search-match" },
      undefined,
      "archeion-search-match-emphasis",
      undefined,
    );

    await act(async () => {
      await expect(viewerRef.current?.navigateToSelectedPublicationSearchResult()).resolves.toBe(
        true,
      );
    });

    expect(session.rendition.display).toHaveBeenLastCalledWith(target);
    expect(viewerRef.current?.getNavigationHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });

    act(() => viewerRef.current?.closePublicationSearch());
    expect(viewerRef.current?.getPublicationSearchState()).toEqual(
      expect.objectContaining({
        query: "",
        results: [],
        selectedResult: null,
        status: "idle",
      }),
    );
    expect(session.rendition.annotations.remove).toHaveBeenCalledWith(target, "underline");
    expect(props.onPublicationSearchChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "idle" }),
    );
  });

  it("keeps overlapping persisted highlights independent from transient search emphasis", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    session.section.cfiFromRange.mockReturnValue(renderedHighlight.cfiRange);
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    await vi.waitFor(() => expect(session.rendition.annotations.highlight).toHaveBeenCalledOnce());

    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();

    const searchState = viewerRef.current!.getPublicationSearchState();
    expect(searchState.status).toBe("ready");
    expect(searchState.selectedResult?.target).toBe(renderedHighlight.cfiRange);
    expect(session.rendition.annotations.underline).toHaveBeenCalledWith(
      renderedHighlight.cfiRange,
      { transient: "reader-search-match" },
      undefined,
      "archeion-search-match-emphasis",
      undefined,
    );

    const persistedRemovalsBeforeClose = session.rendition.annotations.remove.mock.calls.filter(
      ([target, type]) => target === renderedHighlight.cfiRange && type === "highlight",
    ).length;
    act(() => viewerRef.current?.closePublicationSearch());

    expect(session.rendition.annotations.remove).toHaveBeenCalledWith(
      renderedHighlight.cfiRange,
      "underline",
    );
    expect(
      session.rendition.annotations.remove.mock.calls.filter(
        ([target, type]) => target === renderedHighlight.cfiRange && type === "highlight",
      ),
    ).toHaveLength(persistedRemovalsBeforeClose);
    expect(session.rendition.annotations.highlight).toHaveBeenCalledOnce();
  });

  it("preserves ready publication search and reapplies emphasis across a same-Reader mode replacement", async () => {
    const paged = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const continuous = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValueOnce(paged.book).mockReturnValueOnce(continuous.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    const { root } = await renderViewer(props, viewerRef);
    await waitForActiveRendition(paged);
    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();

    const beforeReplacement = viewerRef.current!.getPublicationSearchState();
    expect(beforeReplacement.status).toBe("ready");
    expect(beforeReplacement.query).toBe("Highlighted");
    expect(beforeReplacement.results).toHaveLength(1);
    const selectedId = beforeReplacement.selectedResult?.id;
    const target = beforeReplacement.selectedResult?.target;
    expect(selectedId).toBeTruthy();
    expect(target).toBeTruthy();
    expect(viewerRef.current!.getNavigationHistorySnapshot().backCount).toBe(0);

    await rerenderViewer(
      root,
      { ...props, settings: { ...defaultReaderSettings, mode: "continuous" } },
      viewerRef,
    );
    await waitForActiveRendition(continuous);
    await flushAsyncWork();

    const afterReplacement = viewerRef.current!.getPublicationSearchState();
    expect(paged.rendition.annotations.remove).toHaveBeenCalledWith(target, "underline");
    expect(afterReplacement).toEqual(
      expect.objectContaining({
        query: "Highlighted",
        status: "ready",
      }),
    );
    expect(afterReplacement.results).toBe(beforeReplacement.results);
    expect(afterReplacement.selectedResult).toBe(beforeReplacement.selectedResult);
    expect(continuous.rendition.annotations.underline).toHaveBeenCalledWith(
      target,
      { transient: "reader-search-match" },
      undefined,
      "archeion-search-match-emphasis",
      undefined,
    );
    expect(viewerRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("restarts a pending publication search once on the replacement runtime", async () => {
    const paged = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const continuous = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const oldLoad = deferred<HTMLElement>();
    paged.section.document = undefined;
    paged.section.contents = undefined;
    paged.section.cfiFromRange.mockReturnValue("epubcfi(/old-runtime)");
    paged.section.load.mockImplementation(async () => {
      const contents = await oldLoad.promise;
      paged.section.document = paged.chapterDocument;
      paged.section.contents = contents;
      return contents;
    });
    continuous.section.cfiFromRange.mockReturnValue("epubcfi(/replacement-runtime)");
    epubModuleMock.openBook.mockReturnValueOnce(paged.book).mockReturnValueOnce(continuous.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const viewerRef = createRef<EpubViewerHandle>();

    const { root } = await renderViewer(props, viewerRef);
    await waitForActiveRendition(paged);
    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();
    expect(viewerRef.current!.getPublicationSearchState()).toEqual(
      expect.objectContaining({ query: "Highlighted", status: "searching" }),
    );
    expect(paged.section.load).toHaveBeenCalledTimes(1);

    const searchChangesBeforeReplacement = props.onPublicationSearchChange.mock.calls.length;
    await rerenderViewer(
      root,
      { ...props, settings: { ...defaultReaderSettings, mode: "continuous" } },
      viewerRef,
    );
    await waitForActiveRendition(continuous);
    await flushAsyncWork();

    const replacementState = viewerRef.current!.getPublicationSearchState();
    expect(paged.destroy).toHaveBeenCalledTimes(1);
    expect(replacementState.status).toBe("ready");
    expect(replacementState.query).toBe("Highlighted");
    expect(replacementState.results).toHaveLength(1);
    expect(replacementState.selectedResult?.target).toBe("epubcfi(/replacement-runtime)");
    expect(continuous.section.cfiFromRange).toHaveBeenCalled();
    expect(continuous.rendition.annotations.underline).toHaveBeenCalledWith(
      "epubcfi(/replacement-runtime)",
      { transient: "reader-search-match" },
      undefined,
      "archeion-search-match-emphasis",
      undefined,
    );
    expect(
      props.onPublicationSearchChange.mock.calls
        .slice(searchChangesBeforeReplacement)
        .some(([state]) => state.query === "Highlighted" && state.status === "idle"),
    ).toBe(false);

    await act(async () => {
      oldLoad.resolve(paged.chapterDocument.documentElement);
      await oldLoad.promise;
    });
    await flushAsyncWork();

    expect(paged.section.unload).toHaveBeenCalledTimes(1);
    expect(viewerRef.current!.getPublicationSearchState().selectedResult?.target).toBe(
      "epubcfi(/replacement-runtime)",
    );
  });

  it("routes publication-search updates to a replacement callback", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = defaultViewerProps(new Blob(["book-one"]));
    const replacementSearchCallback = vi.fn();
    const viewerRef = createRef<EpubViewerHandle>();

    const { root } = await renderViewer(props, viewerRef);
    await waitForActiveRendition(session);
    props.onPublicationSearchChange.mockClear();
    await rerenderViewer(
      root,
      { ...props, onPublicationSearchChange: replacementSearchCallback },
      viewerRef,
    );

    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();

    expect(replacementSearchCallback).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "Highlighted", status: "ready" }),
    );
    expect(props.onPublicationSearchChange).not.toHaveBeenCalled();
  });

  it("clears publication-search state and transient emphasis when the Reader session is replaced", async () => {
    const first = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const second = createBookSession("chapter-2", "Text/chapter-2.xhtml");
    epubModuleMock.openBook.mockReturnValueOnce(first.book).mockReturnValueOnce(second.book);
    const firstProps = defaultViewerProps(new Blob(["book-one"]));
    const secondProps = defaultViewerProps(new Blob(["book-two"]));
    const viewerRef = createRef<EpubViewerHandle>();

    const { root } = await renderViewer(firstProps, viewerRef);
    await waitForActiveRendition(first);
    act(() => viewerRef.current?.setPublicationSearchQuery("Highlighted"));
    await flushAsyncWork();
    expect(viewerRef.current?.getPublicationSearchState().status).toBe("ready");
    const target = viewerRef.current?.getPublicationSearchState().selectedResult?.target;
    expect(target).toBeTruthy();

    await rerenderViewer(root, secondProps, viewerRef);
    await waitForActiveRendition(second);

    expect(first.rendition.annotations.remove).toHaveBeenCalledWith(target, "underline");
    expect(viewerRef.current?.getPublicationSearchState()).toEqual(
      expect.objectContaining({
        query: "",
        results: [],
        selectedResult: null,
        status: "idle",
      }),
    );
    expect(secondProps.onPublicationSearchChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "idle" }),
    );
  });

  it("records supported internal EPUB link navigation through deliberate history", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);
    const link = session.chapterDocument.createElement("a");
    link.href = "chapter-2.xhtml";
    link.textContent = "Next chapter";
    session.chapterDocument.body.append(link);
    await act(async () => {
      session.rendition.emitMock(
        "rendered",
        { href: "Text/chapter-1.xhtml" },
        { document: session.chapterDocument },
      );
      session.rendition.emitMock(
        "relocated",
        relocation("Text/chapter-1.xhtml", "epubcfi(/6/2!/4/2:4)"),
      );
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await vi.waitFor(() =>
        expect(session.rendition.display).toHaveBeenLastCalledWith("Text/chapter-2.xhtml"),
      );
    });

    expect(viewerRef.current?.getNavigationHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("validates an exact saved highlight range before navigation", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(renderedHighlight, false);
    });

    expect(result).toEqual({
      chapterHref: renderedHighlight.chapterHref,
      cfiRange: renderedHighlight.cfiRange,
      kind: "resolved",
      strategy: "exact-cfi",
    });
    expect(session.section.unload).not.toHaveBeenCalled();
  });

  it("unloads a section loaded temporarily for exact CFI validation", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    session.section.document = undefined;
    session.section.contents = undefined;
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(renderedHighlight, false);
    });

    expect(result?.kind).toBe("resolved");
    expect(session.section.load).toHaveBeenCalledOnce();
    expect(session.section.unload).toHaveBeenCalledOnce();
  });

  it("recovers changed highlight text in its last known chapter", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    session.chapterDocument.body.innerHTML =
      "<p id='chapter-text'>Before Highlighted text after.</p>";
    vi.mocked(session.book.getRange).mockImplementationOnce(async () => {
      const wrongDocument = document.implementation.createHTMLDocument("stale location");
      wrongDocument.body.textContent = "Wrong location";
      const wrong = wrongDocument.createRange();
      wrong.selectNodeContents(wrongDocument.body);
      return wrong;
    });
    session.section.load.mockImplementation(async () => {
      session.chapterDocument.body.innerHTML =
        "<p id='chapter-text'>Before Highlighted text after.</p>";
      session.section.document = session.chapterDocument;
      session.section.contents = session.chapterDocument.documentElement;
      return session.chapterDocument.documentElement;
    });
    session.section.document = undefined;
    session.section.contents = undefined;
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(
        { ...renderedHighlight, chapterHref: "Text/chapter-1.xhtml" },
        true,
      );
    });

    expect(result).toMatchObject({
      chapterHref: "Text/chapter-1.xhtml",
      kind: "resolved",
      strategy: "chapter-text",
    });
    expect(result?.kind === "resolved" ? result.cfiRange : "").toContain("recovered-range");
    expect(session.section.load).toHaveBeenCalledTimes(2);
    expect(session.section.unload).toHaveBeenCalledTimes(2);
  });

  it("evaluates a saved chapter beyond the fallback limit before loading fallback chapters", async () => {
    const session = createBookSession("exact", "Text/exact.xhtml");
    const wrongDocument = document.implementation.createHTMLDocument("wrong");
    wrongDocument.body.textContent = "Wrong location";
    const wrongRange = wrongDocument.createRange();
    wrongRange.selectNodeContents(wrongDocument.body);
    vi.mocked(session.book.getRange).mockResolvedValue(wrongRange);
    const fallback = Array.from({ length: 240 }, (_, index) =>
      createSpineSection(`Text/fallback-${index}.xhtml`, "No match", index),
    );
    const preferred = createSpineSection(
      "Text/preferred.xhtml",
      "Before Highlighted text after",
      240,
    );
    session.book.spine.each = (callback: (entry: unknown) => void) => {
      for (const section of [...fallback, preferred]) callback(section);
    };
    session.book.spine.get.mockImplementation((target: string | number | undefined) => {
      if (typeof target === "string" && target.startsWith("epubcfi(")) return session.section;
      return [...fallback, preferred].find(({ href }) => href === target) ?? null;
    });
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(
        { ...renderedHighlight, chapterHref: preferred.href },
        true,
      );
    });

    expect(result).toMatchObject({
      chapterHref: preferred.href,
      kind: "resolved",
      strategy: "chapter-text",
    });
    expect(preferred.load).toHaveBeenCalledOnce();
    expect(preferred.unload).toHaveBeenCalledOnce();
    expect(fallback.every(({ load }) => load.mock.calls.length === 0)).toBe(true);
  });

  it("returns failed when a required fallback section cannot be examined", async () => {
    const session = createBookSession("preferred", "Text/preferred.xhtml");
    const wrongDocument = document.implementation.createHTMLDocument("wrong");
    wrongDocument.body.textContent = "Wrong location";
    const wrongRange = wrongDocument.createRange();
    wrongRange.selectNodeContents(wrongDocument.body);
    vi.mocked(session.book.getRange).mockResolvedValue(wrongRange);
    session.chapterDocument.body.textContent = "No saved passage in the preferred chapter.";
    session.section.document = undefined;
    session.section.contents = undefined;
    const examined = createSpineSection("Text/examined.xhtml", "Still no saved passage", 1);
    const failed = createSpineSection("Text/failed.xhtml", "Unavailable", 2);
    failed.load.mockRejectedValueOnce(new Error("temporary I/O failure"));
    session.book.spine.each = (callback: (entry: unknown) => void) => {
      for (const section of [session.section, examined, failed]) callback(section);
    };
    session.book.spine.get.mockImplementation((target: string | number | undefined) => {
      if (
        target === session.section.href ||
        (typeof target === "string" && target.startsWith("epubcfi("))
      ) {
        return session.section;
      }
      return [examined, failed].find(({ href }) => href === target) ?? null;
    });
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(
        {
          ...renderedHighlight,
          chapterHref: session.section.href,
          contextAfter: "after context",
          contextBefore: "before context",
        },
        true,
      );
    });

    expect(result).toEqual({ kind: "failed" });
    expect(examined.load).toHaveBeenCalledOnce();
    expect(examined.unload).toHaveBeenCalledOnce();
    expect(failed.unload).toHaveBeenCalledOnce();
  });

  it("returns failed when the saved chapter cannot be loaded", async () => {
    const session = createBookSession("old", "Text/old.xhtml");
    const wrongDocument = document.implementation.createHTMLDocument("wrong");
    wrongDocument.body.textContent = "Wrong location";
    const wrongRange = wrongDocument.createRange();
    wrongRange.selectNodeContents(wrongDocument.body);
    vi.mocked(session.book.getRange).mockResolvedValue(wrongRange);
    const preferred = createSpineSection("Text/preferred.xhtml", "Highlighted text", 1);
    preferred.load.mockRejectedValueOnce(new Error("saved chapter unavailable"));
    session.book.spine.each = (callback: (entry: unknown) => void) => {
      for (const section of [session.section, preferred]) callback(section);
    };
    session.book.spine.get.mockImplementation((target: string | number | undefined) => {
      if (typeof target === "string" && target.startsWith("epubcfi(")) return session.section;
      if (target === preferred.href) return preferred;
      return target === session.section.href ? session.section : null;
    });
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(
        { ...renderedHighlight, chapterHref: preferred.href },
        true,
      );
    });

    expect(result).toEqual({ kind: "failed" });
    expect(preferred.unload).toHaveBeenCalledOnce();
  });

  it("unloads temporary preferred-section work after detached and failed results", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const wrongDocument = document.implementation.createHTMLDocument("wrong");
    wrongDocument.body.textContent = "Wrong location";
    const wrongRange = wrongDocument.createRange();
    wrongRange.selectNodeContents(wrongDocument.body);
    vi.mocked(session.book.getRange).mockResolvedValue(wrongRange);
    session.chapterDocument.body.textContent = "No matching passage remains.";
    session.section.document = undefined;
    session.section.contents = undefined;
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    const annotation = { ...renderedHighlight, chapterHref: session.section.href };
    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let detached: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      detached = await viewerRef.current?.resolveAnnotationAnchor(annotation, true);
    });
    expect(detached).toEqual({ kind: "detached", reason: "not-found" });
    expect(session.section.unload).toHaveBeenCalledTimes(2);

    session.section.document = undefined;
    session.section.contents = undefined;
    session.section.load.mockRejectedValueOnce(new Error("temporary parse failure"));
    let failed: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      failed = await viewerRef.current?.resolveAnnotationAnchor(annotation, true);
    });
    expect(failed).toEqual({ kind: "failed" });
    expect(session.section.unload).toHaveBeenCalledTimes(3);

    session.chapterDocument.body.textContent = "Highlighted text";
    let retried: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      retried = await viewerRef.current?.resolveAnnotationAnchor(annotation, true);
    });
    expect(retried?.kind).toBe("resolved");
  });

  it("recovers a detached bookmark to its last known chapter start", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    vi.mocked(session.book.getRange).mockRejectedValueOnce(new Error("stale CFI"));
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    const bookmark: BookmarkAnnotation = {
      anchorStatus: "detached",
      chapterHref: "Text/chapter-1.xhtml",
      cfiRange: "epubcfi(/stale)",
      createdAt: renderedHighlight.createdAt,
      id: "bookmark",
      type: "bookmark",
      updatedAt: renderedHighlight.updatedAt,
    };

    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await viewerRef.current?.resolveAnnotationAnchor(bookmark, true);
    });

    expect(result).toEqual({
      chapterHref: "Text/chapter-1.xhtml",
      cfiRange: "epubcfi(Text/chapter-1.xhtml#start)",
      kind: "resolved",
      strategy: "chapter-start",
    });
  });

  it("cancels pending recovery when the book changes", async () => {
    const firstSession = createBookSession("old", "Text/old.xhtml");
    const secondSession = createBookSession("new", "Text/new.xhtml");
    const pendingRange = deferred<Range>();
    vi.mocked(firstSession.book.getRange).mockReturnValueOnce(pendingRange.promise);
    firstSession.section.document = undefined;
    firstSession.section.contents = undefined;
    epubModuleMock.openBook
      .mockReturnValueOnce(firstSession.book)
      .mockReturnValueOnce(secondSession.book);
    const viewerRef = createRef<EpubViewerHandle>();
    const firstProps = defaultViewerProps(new Blob(["book-one"]));
    const { root } = await renderViewer(firstProps, viewerRef);
    await waitForActiveRendition(firstSession);

    let recovery: Promise<
      Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined
    >;
    act(() => {
      recovery = viewerRef.current!.resolveAnnotationAnchor(renderedHighlight, true);
    });
    await rerenderViewer(root, {
      ...firstProps,
      fileLease: createReaderFileLease({
        initialBlob: new Blob(["book-two"]),
        load: async () => new Blob(["book-two"]),
        requestKey: "test-reader-file:book-two",
      }),
    });
    const staleRange = firstSession.chapterDocument.createRange();
    staleRange.selectNodeContents(firstSession.chapterDocument.body);
    await act(async () => pendingRange.resolve(staleRange));

    let result: Awaited<ReturnType<EpubViewerHandle["resolveAnnotationAnchor"]>> | undefined;
    await act(async () => {
      result = await recovery!;
    });
    expect(result).toEqual({ kind: "cancelled" });
    expect(firstSession.section.unload).toHaveBeenCalledOnce();
  });

  it("detaches malformed highlights instead of registering a crashing mark", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const malformed = { ...renderedHighlight, cfiRange: "not-a-cfi" };
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [malformed],
      onHighlightAnchorInvalid: vi.fn(),
    };

    await renderViewer(props);
    await waitForActiveRendition(session);

    expect(props.onHighlightAnchorInvalid).toHaveBeenCalledOnce();
    expect(props.onHighlightAnchorInvalid).toHaveBeenCalledWith(
      malformed.id,
      expect.stringContaining("invalid-cfi"),
    );
    expect(session.rendition.annotations.highlight).not.toHaveBeenCalled();
  });

  it("does not render a saved CFI when it now resolves to unrelated text", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    const changedDocument = document.implementation.createHTMLDocument("changed chapter");
    changedDocument.body.textContent = "Unrelated replacement text";
    const changedRange = changedDocument.createRange();
    changedRange.selectNodeContents(changedDocument.body);
    vi.mocked(session.book.getRange).mockResolvedValue(changedRange);
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
      onHighlightAnchorInvalid: vi.fn(),
    };

    await renderViewer(props);
    await waitForActiveRendition(session);
    await flushAsyncWork();

    expect(props.onHighlightAnchorInvalid).toHaveBeenCalledOnce();
    expect(props.onHighlightAnchorInvalid).toHaveBeenCalledWith(
      renderedHighlight.id,
      expect.stringContaining(renderedHighlight.cfiRange),
    );
    expect(session.rendition.annotations.highlight).not.toHaveBeenCalled();
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
      fileLease: createReaderFileLease({
        initialBlob: new Blob(["book-two"]),
        load: async () => new Blob(["book-two"]),
        requestKey: "test-reader-file:book-two",
      }),
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
      landmarks: [],
      pageReferences: [],
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

  it.each(["paged", "continuous"] as const)(
    "waits for a usable target view before settling %s annotation navigation",
    async (mode) => {
      const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
      epubModuleMock.openBook.mockReturnValue(session.book);
      const viewerRef = createRef<EpubViewerHandle>();
      const props = {
        ...defaultViewerProps(new Blob(["book-one"])),
        highlights: [renderedHighlight],
        settings: {
          ...defaultReaderSettings,
          mode: mode === "continuous" ? ("continuous" as const) : ("paged" as const),
        },
      };
      const { container } = await renderViewer(props, viewerRef);
      await waitForActiveRendition(session);
      await vi.waitFor(() =>
        expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
      );
      const display = deferred<void>();
      (session.rendition.display as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => display.promise,
      );
      const target = "epubcfi(/6/4!/4/2/1:10)";
      let settled = false;
      let navigation!: Promise<boolean>;
      act(() => {
        navigation = viewerRef.current!.navigateToLocation(target).then((result) => {
          settled = true;
          return result;
        });
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      const frame = document.createElement("iframe");
      container.querySelector(".epub-viewer__stage")!.append(frame);
      Object.defineProperty(frame.contentWindow, "frameElement", {
        configurable: true,
        value: frame,
      });
      session.rendition.emitContentMock({
        document: frame.contentDocument!,
        window: frame.contentWindow!,
      });
      const text = frame.contentDocument!.createTextNode("target text");
      frame.contentDocument!.body.append(text);
      const range = frame.contentDocument!.createRange();
      range.selectNodeContents(text);
      session.rendition.getRange = vi.fn(() => range);
      await act(async () => {
        session.rendition.emitMock("rendered", {}, { document: frame.contentDocument });
        display.resolve(undefined);
        await expect(navigation).resolves.toBe(true);
      });

      expect(session.rendition.display).toHaveBeenLastCalledWith(target);
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1);
      expect(session.rendition.annotations.highlight).toHaveBeenCalledWith(
        renderedHighlight.cfiRange,
        { annotationId: renderedHighlight.id },
        expect.any(Function),
        "archeion-highlight",
        expect.any(Object),
      );

      await act(async () => {
        await expect(viewerRef.current!.navigateToLocation("epubcfi(/6/2!/4/8/1:4)")).resolves.toBe(
          true,
        );
      });
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1);
    },
  );

  it("returns false when the displayed annotation target cannot resolve to a usable view", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const viewerRef = createRef<EpubViewerHandle>();
    await renderViewer(defaultViewerProps(new Blob(["book-one"])), viewerRef);
    await waitForActiveRendition(session);
    session.rendition.getRange = vi.fn(() => {
      throw new Error("target view missing");
    });

    await act(async () => {
      await expect(viewerRef.current!.navigateToLocation("epubcfi(/6/8!/4/2/1:2)")).resolves.toBe(
        false,
      );
    });
  });

  it("registers, activates, replaces, and removes rendered marks by stable annotation ID", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
      onOpenNote: vi.fn(),
      onRemoveHighlight: vi.fn(async () => true),
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
    expect(container.querySelector('[aria-label="Add note"]')).toBeInstanceOf(HTMLButtonElement);
    expect(session.rendition.next).not.toHaveBeenCalled();
    expect(session.rendition.prev).not.toHaveBeenCalled();

    await rerenderViewer(root, props);
    await act(async () => session.rendition.emitMock("rendered", {}, {}));
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
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Add note"]')?.click(),
    );
    expect(props.onOpenNote).toHaveBeenCalledWith(
      expect.objectContaining({ cfiRange: renderedHighlight.cfiRange }),
      expect.objectContaining({ id: renderedHighlight.id }),
    );
    await act(async () => {
      replacementMark.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }),
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="No color — remove highlight"]')
        ?.click(),
    );
    expect(props.onRemoveHighlight).toHaveBeenCalledWith(renderedHighlight.id);
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

  it("recolors one rendered highlight without rebuilding unrelated marks", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const secondHighlight = {
      ...renderedHighlight,
      cfiRange: "epubcfi(/6/2!/4/4,/1:2,/1:18)",
      id: "highlight-2",
    };
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight, secondHighlight],
    };
    const { root } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(2),
    );

    await rerenderViewer(root, {
      ...props,
      highlights: [{ ...renderedHighlight, color: "blue" }, secondHighlight],
    });
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(3),
    );

    expect(session.rendition.annotations.remove).toHaveBeenCalledTimes(1);
    expect(session.rendition.annotations.remove).toHaveBeenCalledWith(
      renderedHighlight.cfiRange,
      "highlight",
    );
    expect(session.rendition.annotations.remove).not.toHaveBeenCalledWith(
      secondHighlight.cfiRange,
      "highlight",
    );
    expect(session.rendition.annotations.highlight.mock.calls[2]?.[1]).toEqual({
      annotationId: renderedHighlight.id,
    });
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
    Object.defineProperty(range, "cloneRange", { value: () => range });
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

  it("anchors a fresh selection to the exact second content frame and tracks its lifecycle", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      onCreateHighlight: vi.fn(async () => true),
      onRemoveHighlight: vi.fn(async () => true),
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    const viewer = container.querySelector<HTMLElement>(".epub-viewer")!;
    vi.spyOn(viewer, "getBoundingClientRect").mockReturnValue(clientRect(0, 0, 900, 700));
    const contentHost = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    contentHost.append(first, second);
    Object.defineProperty(first.contentWindow, "frameElement", {
      configurable: true,
      value: first,
    });
    Object.defineProperty(second.contentWindow, "frameElement", {
      configurable: true,
      value: second,
    });
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(clientRect(20, 40, 300, 500));
    let secondLeft = 420;
    vi.spyOn(second, "getBoundingClientRect").mockImplementation(() =>
      clientRect(secondLeft, 100, 360, 500),
    );
    session.rendition.emitContentMock({
      document: first.contentDocument!,
      window: first.contentWindow!,
    });
    session.rendition.emitContentMock({
      document: second.contentDocument!,
      window: second.contentWindow!,
    });
    const range = {
      cloneRange() {
        return this;
      },
      getBoundingClientRect: () => clientRect(20, 30, 120, 50),
      getClientRects: () => [clientRect(20, 30, 90, 18), clientRect(20, 62, 120, 18)],
      startContainer: second.contentDocument!.body,
    } as unknown as Range;
    const selection = {
      getRangeAt: () => range,
      rangeCount: 1,
      toString: () => "a multi-line selection",
    } as unknown as Selection;

    await act(async () => {
      session.rendition.emitMock("selected", "epubcfi(/6/4!/4/2,/1:1,/1:20)", {
        document: second.contentDocument,
        section: { href: "Text/chapter-2.xhtml" },
        window: { getSelection: () => selection },
      });
    });
    const palette = container.querySelector<HTMLElement>('[aria-label="Highlight color"]')!;
    expect(Number.parseFloat(palette.style.left)).toBeGreaterThan(420);
    expect(container.querySelector('[aria-label="Highlight and add note"]')).toBeInstanceOf(
      HTMLButtonElement,
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="No color"]')?.click(),
    );
    expect(props.onCreateHighlight).not.toHaveBeenCalled();
    expect(props.onRemoveHighlight).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();

    await act(async () => {
      session.rendition.emitMock("selected", "epubcfi(/6/4!/4/2,/1:1,/1:20)", {
        document: second.contentDocument,
        section: { href: "Text/chapter-2.xhtml" },
        window: { getSelection: () => selection },
      });
    });

    secondLeft = 500;
    await act(async () => window.dispatchEvent(new Event("resize")));
    const reopenedPalette = container.querySelector<HTMLElement>('[aria-label="Highlight color"]')!;
    expect(Number.parseFloat(reopenedPalette.style.left)).toBeGreaterThan(500);

    second.remove();
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
  });

  it("resolves a host mark overlay to its owning view and dismisses in capture phase", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    document.body.append(first, second);
    for (const frame of [first, second]) {
      const paragraph = frame.contentDocument!.createElement("p");
      paragraph.textContent =
        "A realistic highlighted passage with enough text for the saved range.";
      frame.contentDocument!.body.replaceChildren(paragraph);
    }
    Object.defineProperty(first.contentWindow, "frameElement", {
      configurable: true,
      value: first,
    });
    Object.defineProperty(second.contentWindow, "frameElement", {
      configurable: true,
      value: second,
    });
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(clientRect(20, 40, 300, 500));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(clientRect(420, 100, 360, 500));
    session.rendition.emitContentMock({
      document: first.contentDocument!,
      window: first.contentWindow!,
    });
    session.rendition.emitContentMock({
      document: second.contentDocument!,
      window: second.contentWindow!,
    });
    const mark = document.createElement("button");
    document.body.append(mark);
    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(realClientRect(470, 180, 80, 20));
    mark.addEventListener("click", markCallback(session));

    await act(async () => mark.click());
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    await act(async () => first.contentWindow!.dispatchEvent(new Event("pagehide")));
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    await act(async () => second.contentWindow!.dispatchEvent(new Event("pagehide")));
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();

    const stoppedSurface = document.createElement("button");
    stoppedSurface.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(stoppedSurface);
    session.rendition.emitContentMock({
      document: second.contentDocument!,
      window: second.contentWindow!,
    });
    await act(async () => mark.click());
    await act(async () =>
      stoppedSurface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();

    await act(async () => mark.click());
    const parentSurface = document.body.appendChild(document.createElement("div"));
    const parentDismiss = vi.fn();
    let unregisterParent: () => void = () => undefined;
    unregisterParent = registerTransientSurface({
      element: parentSurface,
      kind: "popover",
      onDismiss: (reason) => {
        parentDismiss(reason);
        unregisterParent();
      },
    });
    const topmostEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    await act(async () => second.contentDocument!.dispatchEvent(topmostEscape));
    expect(parentDismiss).toHaveBeenCalledWith("escape");
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    expect(topmostEscape.defaultPrevented).toBe(true);

    const paletteEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    await act(async () => second.contentDocument!.dispatchEvent(paletteEscape));
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
    expect(paletteEscape.defaultPrevented).toBe(true);
    expect(props.onKeyDown).not.toHaveBeenCalled();
    parentSurface.remove();
  });

  it("gives host-document Escape priority without leaking or duplicating listeners", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const mark = document.createElement("button");
    mark.addEventListener("click", markCallback(session));
    document.body.append(mark);
    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(realClientRect(200, 160, 90, 20));
    const hostControl = document.createElement("button");
    container.append(hostControl);
    const readerEscape = vi.fn();
    hostControl.addEventListener("keydown", readerEscape);
    const documentAddListener = vi.spyOn(document, "addEventListener");
    const documentRemoveListener = vi.spyOn(document, "removeEventListener");
    const windowAddListener = vi.spyOn(window, "addEventListener");
    const windowRemoveListener = vi.spyOn(window, "removeEventListener");

    await act(async () => mark.click());
    const firstEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    await act(async () => hostControl.dispatchEvent(firstEscape));
    expect(firstEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
    expect(readerEscape).not.toHaveBeenCalled();

    const secondEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    hostControl.dispatchEvent(secondEscape);
    expect(secondEscape.defaultPrevented).toBe(false);
    expect(readerEscape).toHaveBeenCalledTimes(1);

    await act(async () => mark.click());
    await act(async () =>
      hostControl.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );
    expect(
      documentAddListener.mock.calls.filter(
        ([type, , options]) => type === "keydown" && options === true,
      ),
    ).toHaveLength(0);
    expect(
      documentRemoveListener.mock.calls.filter(
        ([type, , options]) => type === "keydown" && options === true,
      ),
    ).toHaveLength(0);
    expect(
      windowAddListener.mock.calls.filter(
        ([type, , options]) => type === "keydown" && options === true,
      ),
    ).toHaveLength(2);
    expect(
      windowRemoveListener.mock.calls.filter(
        ([type, , options]) => type === "keydown" && options === true,
      ),
    ).toHaveLength(2);
  });

  it("prunes disconnected documents without disturbing a connected sibling palette", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    const { container } = await renderViewer(props);
    await waitForActiveRendition(session);
    const stage = container.querySelector<HTMLElement>(".epub-viewer__stage")!;
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    stage.append(first, second);
    Object.defineProperty(first.contentWindow, "frameElement", {
      configurable: true,
      value: first,
    });
    Object.defineProperty(second.contentWindow, "frameElement", {
      configurable: true,
      value: second,
    });
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(realClientRect(20, 40, 300, 500));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(realClientRect(420, 100, 360, 500));
    session.rendition.emitContentMock({
      document: first.contentDocument!,
      window: first.contentWindow!,
    });
    session.rendition.emitContentMock({
      document: second.contentDocument!,
      window: second.contentWindow!,
    });
    const firstRemove = vi.spyOn(first.contentDocument!, "removeEventListener");
    const secondRemove = vi.spyOn(second.contentDocument!, "removeEventListener");
    const range = {
      cloneRange() {
        return this;
      },
      getBoundingClientRect: () => realClientRect(20, 30, 100, 20),
      getClientRects: () => [realClientRect(20, 30, 100, 20)],
      startContainer: second.contentDocument!.body,
    } as unknown as Range;
    const selection = {
      getRangeAt: () => range,
      rangeCount: 1,
      toString: () => "selection in sibling",
    } as unknown as Selection;
    await act(async () =>
      session.rendition.emitMock("selected", "epubcfi(/6/4!/4/2,/1:1,/1:10)", {
        document: second.contentDocument,
        section: { href: "Text/chapter-2.xhtml" },
        window: { getSelection: () => selection },
      }),
    );
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);

    first.remove();
    await act(async () =>
      session.rendition.emitMock("rendered", {}, { document: second.contentDocument }),
    );
    expect(firstRemove).toHaveBeenCalledWith("keydown", expect.any(Function), {
      capture: true,
    });
    expect(secondRemove.mock.calls.some(([type]) => type === "keydown")).toBe(false);
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);

    second.remove();
    await act(async () => session.rendition.emitMock("rendered", {}, {}));
    expect(secondRemove).toHaveBeenCalledWith("keydown", expect.any(Function), {
      capture: true,
    });
    expect(container.querySelector('[aria-label="Highlight color"]')).toBeNull();
  });

  it("prunes missing frame ownership and keeps repeated bind/unload cycles singular", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderViewer(defaultViewerProps(new Blob(["book-one"])));
    await waitForActiveRendition(session);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame.contentWindow, "frameElement", {
      configurable: true,
      value: frame,
    });
    const addListener = vi.spyOn(frame.contentDocument!, "addEventListener");
    const removeListener = vi.spyOn(frame.contentDocument!, "removeEventListener");
    const content = { document: frame.contentDocument!, window: frame.contentWindow! };

    session.rendition.emitContentMock(content);
    session.rendition.emitContentMock(content);
    expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    await act(async () => frame.contentWindow!.dispatchEvent(new Event("pagehide")));
    session.rendition.emitContentMock(content);
    session.rendition.emitMock("rendered", {}, { document: frame.contentDocument });
    expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(2);

    Object.defineProperty(frame.contentWindow, "frameElement", {
      configurable: true,
      value: null,
    });
    await act(async () => session.rendition.emitMock("rendered", {}, {}));
    expect(removeListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(2);
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
    session.rendition.emitContentMock({ document, window });
    const text = document.createTextNode("partially overlapping text");
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, "cloneRange", { value: () => range });
    Object.defineProperty(range, "getClientRects", {
      value: () => [{ bottom: 20, height: 10, left: 10, right: 40, top: 10, width: 30 }],
    });
    const selection = {
      getRangeAt: () => range,
      rangeCount: 1,
      toString: () => "partially overlapping text",
    } as unknown as Selection;

    await act(async () => {
      session.rendition.emitMock("selected", "epubcfi(/6/2!/4/2,/1:25,/1:40)", {
        section: { href: "Text/chapter-1.xhtml" },
        document,
        window: { getSelection: () => selection },
      });
    });

    expect(props.onHighlightInteractionError).toHaveBeenCalledWith(
      "Overlapping highlights cannot be edited together.",
    );
    expect(props.onError).not.toHaveBeenCalled();
    expect(container.querySelector(".epub-viewer")).toBeInstanceOf(HTMLElement);
    expect(session.destroy).not.toHaveBeenCalled();

    const getSelection = vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: true,
    } as Selection);
    await act(async () => document.dispatchEvent(new Event("selectionchange")));
    expect(props.onHighlightInteractionClear).toHaveBeenCalledTimes(1);
    getSelection.mockRestore();
  });

  it("clears stale overlap feedback for a valid selection and direct activation", async () => {
    const session = createBookSession("chapter-1", "Text/chapter-1.xhtml");
    epubModuleMock.openBook.mockReturnValue(session.book);
    const props = {
      ...defaultViewerProps(new Blob(["book-one"])),
      highlights: [renderedHighlight],
    };
    await renderViewer(props);
    await waitForActiveRendition(session);
    await vi.waitFor(() =>
      expect(session.rendition.annotations.highlight).toHaveBeenCalledTimes(1),
    );
    const text = document.createTextNode("selection");
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, "cloneRange", { value: () => range });
    Object.defineProperty(range, "getClientRects", {
      value: () => [clientRect(10, 10, 80, 20)],
    });
    const selection = {
      getRangeAt: () => range,
      rangeCount: 1,
      toString: () => "selection",
    } as unknown as Selection;
    const contents = {
      document,
      section: { href: "Text/chapter-1.xhtml" },
      window: { getSelection: () => selection },
    };

    await act(async () =>
      session.rendition.emitMock("selected", "epubcfi(/6/2!/4/2,/1:25,/1:40)", contents),
    );
    expect(props.onHighlightInteractionError).toHaveBeenCalledTimes(1);
    await act(async () =>
      session.rendition.emitMock("selected", "epubcfi(/6/4!/4/2,/1:1,/1:8)", contents),
    );
    expect(props.onHighlightInteractionClear).toHaveBeenCalledTimes(1);

    const mark = document.createElement("button");
    mark.addEventListener("click", markCallback(session));
    document.body.append(mark);
    await act(async () => mark.click());
    expect(props.onHighlightInteractionClear).toHaveBeenCalledTimes(2);
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
