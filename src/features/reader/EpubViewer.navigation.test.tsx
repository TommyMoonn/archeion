// @vitest-environment happy-dom

import type { Location, Rendition } from "epubjs";
import { act, createRef } from "react";
import type { Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultReaderSettings, type ReaderNavigationState } from "../../types/reader";
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
  const rendition = {
    display: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    prev: vi.fn(async () => undefined),
    themes: {
      register: vi.fn(),
      select: vi.fn(),
    },
    hooks: {
      content: {
        register: vi.fn(),
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

function defaultViewerProps(fileBlob: Blob) {
  return {
    fileBlob,
    onError: vi.fn(),
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
});
