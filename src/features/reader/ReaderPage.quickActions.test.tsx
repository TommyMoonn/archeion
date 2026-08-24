// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type {
  BookmarkAnnotation,
  CreateBookmarkAnnotationInput,
  HighlightAnnotation,
} from "../../types/annotation";
import { ReaderRoute } from "./ReaderPage";
import { MAIN_CONTENT_ID } from "../../components/SkipLink";
import type { ReaderSessionIdentity } from "./readerSession";
import type { ReaderNavigationHistorySnapshot } from "./readerNavigationHistory";
import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";
import type { ReaderSeekMapState } from "./readerSeekMap";

const viewerMock = vi.hoisted(() => ({
  closePublicationSearch: vi.fn(),
  historySnapshot: {
    backCount: 0,
    canGoBack: false,
    canGoForward: false,
    forwardCount: 0,
  } as ReaderNavigationHistorySnapshot,
  locationPublications: vi.fn(),
  navigateBack: vi.fn().mockResolvedValue(true),
  navigateForward: vi.fn().mockResolvedValue(true),
  navigateToLocation: vi.fn().mockResolvedValue(true),
  navigateToPublicationSearchResult: vi.fn().mockResolvedValue(true),
  navigateToSeekPercentage: vi.fn().mockResolvedValue(true),
  next: vi.fn().mockResolvedValue(undefined),
  previous: vi.fn().mockResolvedValue(undefined),
  nextPublicationSearchResult: vi.fn().mockResolvedValue(true),
  previousPublicationSearchResult: vi.fn().mockResolvedValue(true),
  publicationSearchState: {
    error: null,
    query: "",
    requestRevision: 0,
    results: [],
    selectedResult: null,
    status: "idle",
    truncated: false,
  } as ReaderPublicationSearchControllerState,
  onKeyDown: null as ((event: KeyboardEvent) => void) | null,
  publishNavigationHistory: null as ((snapshot: ReaderNavigationHistorySnapshot) => void) | null,
  publishPublicationSearch: null as
    ((state: ReaderPublicationSearchControllerState) => void) | null,
  publishSeekMap: null as ((state: ReaderSeekMapState) => void) | null,
  resolveAnnotationAnchor: vi.fn(),
  resolveSeekPreview: vi.fn((percentage: number) => ({
    chapterLabel: "Chapter 1",
    percentage,
  })),
  setPublicationSearchQuery: vi.fn(),
  teardown: vi.fn(),
}));

const navigationState = {
  chapters: [{ id: "chapter-1", href: "chapter-1", label: "Chapter 1", depth: 0 }],
  currentChapterId: "chapter-1",
  landmarks: [],
  pageReferences: [],
  status: "ready" as const,
};

vi.mock("./EpubViewer", async () => {
  const React = await import("react");

  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      {
        onKeyDown,
        onLocationChange,
        onNavigationChange,
        onNavigationHistoryChange,
        onPublicationSearchChange,
        onSeekMapChange,
        onReady,
        sessionIdentity,
      }: {
        onKeyDown: (event: KeyboardEvent) => void;
        onLocationChange: (location: {
          atEnd: boolean;
          atStart: boolean;
          cfi: string;
          rawPercentage: number;
          sectionCount: number;
        }) => void;
        onNavigationChange: (navigation: typeof navigationState) => void;
        onNavigationHistoryChange?: (snapshot: ReaderNavigationHistorySnapshot) => void;
        onPublicationSearchChange?: (state: ReaderPublicationSearchControllerState) => void;
        onSeekMapChange?: (state: ReaderSeekMapState) => void;
        onReady: (identity: ReaderSessionIdentity) => void;
        sessionIdentity: ReaderSessionIdentity;
        settings: { mode: "continuous" | "paged" };
      },
      ref: React.ForwardedRef<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        closePublicationSearch: viewerMock.closePublicationSearch,
        getNavigationHistorySnapshot: () => viewerMock.historySnapshot,
        navigateBack: viewerMock.navigateBack,
        navigateForward: viewerMock.navigateForward,
        navigateToChapter: vi.fn().mockResolvedValue(true),
        navigateToNavigationItem: vi.fn().mockResolvedValue(true),
        navigateToLocation: viewerMock.navigateToLocation,
        navigateToPublicationSearchResult: viewerMock.navigateToPublicationSearchResult,
        navigateToSeekPercentage: viewerMock.navigateToSeekPercentage,
        nextPublicationSearchResult: viewerMock.nextPublicationSearchResult,
        previousPublicationSearchResult: viewerMock.previousPublicationSearchResult,
        setPublicationSearchQuery: viewerMock.setPublicationSearchQuery,
        next: viewerMock.next,
        previous: viewerMock.previous,
        resolveAnnotationAnchor: viewerMock.resolveAnnotationAnchor,
        resolveSeekPreview: viewerMock.resolveSeekPreview,
        teardown: viewerMock.teardown,
      }));
      const initialCallbacks = React.useRef({
        onLocationChange,
        onNavigationChange,
        onNavigationHistoryChange,
        onPublicationSearchChange,
        onSeekMapChange,
        onReady,
        sessionIdentity,
      });

      React.useEffect(() => {
        viewerMock.onKeyDown = onKeyDown;
        return () => {
          if (viewerMock.onKeyDown === onKeyDown) {
            viewerMock.onKeyDown = null;
          }
        };
      }, [onKeyDown]);

      React.useEffect(() => {
        viewerMock.publishNavigationHistory = onNavigationHistoryChange ?? null;
        onNavigationHistoryChange?.(viewerMock.historySnapshot);
        return () => {
          if (viewerMock.publishNavigationHistory === onNavigationHistoryChange) {
            viewerMock.publishNavigationHistory = null;
          }
        };
      }, [onNavigationHistoryChange]);

      React.useEffect(() => {
        viewerMock.publishPublicationSearch = onPublicationSearchChange ?? null;
        onPublicationSearchChange?.(viewerMock.publicationSearchState);
        return () => {
          if (viewerMock.publishPublicationSearch === onPublicationSearchChange) {
            viewerMock.publishPublicationSearch = null;
          }
        };
      }, [onPublicationSearchChange]);

      React.useEffect(() => {
        viewerMock.publishSeekMap = onSeekMapChange ?? null;
        onSeekMapChange?.({ status: "pending" });
        return () => {
          if (viewerMock.publishSeekMap === onSeekMapChange) {
            viewerMock.publishSeekMap = null;
          }
        };
      }, [onSeekMapChange]);

      React.useEffect(() => {
        const callbacks = initialCallbacks.current;
        callbacks.onNavigationChange(navigationState);
        const initialLocation = {
          atEnd: false,
          atStart: false,
          cfi: "epubcfi(/6/4)",
          rawPercentage: 0.2,
          sectionCount: 10,
        };
        viewerMock.locationPublications(initialLocation);
        callbacks.onLocationChange(initialLocation);
        callbacks.onReady(callbacks.sessionIdentity);
      }, []);

      return (
        <div className="epub-viewer">
          <div className="epub-viewer__stage">
            <iframe data-testid="epub-viewer" title="EPUB rendition" />
          </div>
          <button
            aria-hidden="true"
            className="epub-viewer__click-zone epub-viewer__click-zone--previous"
            tabIndex={-1}
            type="button"
          />
          <button
            aria-hidden="true"
            className="epub-viewer__click-zone epub-viewer__click-zone--next"
            tabIndex={-1}
            type="button"
          />
        </div>
      );
    }),
  };
});

// These tests exercise ReaderPage actions and annotation navigation, not the
// Suspense boundary. Render the real panel synchronously so its module promise
// cannot settle after the interaction's act() scope.
vi.mock("./LazyReaderAnnotationsPanel", async () => {
  const { ReaderAnnotationsPanel } = await import("./ReaderAnnotationsPanel");
  return { LazyReaderAnnotationsPanel: ReaderAnnotationsPanel };
});

vi.mock("./LazyReaderSearchPanel", async () => {
  const { ReaderSearchPanel } = await import("./ReaderSearchPanel");
  return { LazyReaderSearchPanel: ReaderSearchPanel };
});

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({ status: "ready", archive: { id: "archive-books" } }),
}));

const readyArchive: ArchiveState = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
  ],
  error: null,
  watcherError: null,
};

const book: Book = {
  addedAt: "2026-07-01T00:00:00.000Z",
  fileName: "book.epub",
  id: "book",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function createStorage(): LibraryStorage {
  return {
    flushPendingWrites: vi.fn().mockResolvedValue(undefined),
    loadBookFile: vi.fn().mockResolvedValue(new Blob(["epub"])),
    listAnnotations: vi.fn().mockResolvedValue([]),
    createAnnotation: vi.fn(),
    updateBookmarkAnnotation: vi.fn(),
    updateHighlightAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    listBooks: vi.fn().mockResolvedValue([book]),
    updateBook: vi.fn().mockImplementation(async (_id, changes) => ({ ...book, ...changes })),
  } as unknown as LibraryStorage;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderReader(
  storage: LibraryStorage = createStorage(),
  returnHref = "/?view=favorites&archiveId=archive-books",
) {
  const returnContext = {
    archiveId: "archive-books",
    focusBookId: "book",
    href: returnHref,
    label: "Favorites",
    query: "favorite",
    scrollTop: 180,
  };
  const router = createMemoryRouter(
    [
      {
        HydrateFallback: () => null,
        path: "/reader/:bookId",
        element: <ReaderRoute />,
        loader: () => book,
      },
      { path: "/", element: <div data-testid="library" /> },
    ],
    {
      initialEntries: [
        {
          pathname: "/reader/book",
          state: { readerReturnContext: returnContext },
        },
      ],
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={storage}>
        <QuickActionsProvider>
          <RouterProvider router={router} />
        </QuickActionsProvider>
      </LibraryStorageContext.Provider>,
    );
  });

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (container.querySelector(".reader-page")) {
      break;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  return { container, returnContext, router };
}

function hideToolbar(rendered: Awaited<ReturnType<typeof renderReader>>): void {
  const toggle = rendered.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Hide Reader toolbar"]',
  );
  if (!toggle) throw new Error("Reader toolbar visibility toggle was not rendered.");
  act(() => toggle.click());
}

async function openPalette(): Promise<HTMLInputElement> {
  const target = container?.querySelector<HTMLElement>(".reader-page");
  if (!target) {
    throw new Error("Reader page was not rendered.");
  }

  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "p",
        shiftKey: true,
      }),
    );
  });

  return openPaletteSearch();
}

async function openPaletteSearch(): Promise<HTMLInputElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const input = document.querySelector<HTMLInputElement>(
      '.quick-actions input[placeholder="Type a command…"]',
    );
    if (input) {
      return input;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }

  throw new Error("Quick Actions search was not rendered.");
}

function getRenditionFrame(): HTMLIFrameElement {
  const frame = container?.querySelector<HTMLIFrameElement>('iframe[data-testid="epub-viewer"]');
  if (!frame?.contentDocument?.body || !frame.contentWindow) {
    throw new Error("EPUB rendition document was not rendered.");
  }
  return frame;
}

function createRenditionTarget<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] {
  const frame = getRenditionFrame();
  const target = frame.contentDocument!.createElement(tagName);
  frame.contentDocument!.body.append(target);
  return target;
}

function dispatchRenditionShortcut(
  target: HTMLElement,
  init: KeyboardEventInit = { ctrlKey: true, key: "p", shiftKey: true },
): KeyboardEvent {
  const view = target.ownerDocument.defaultView;
  if (!view) {
    throw new Error("EPUB rendition window was not available.");
  }

  const event = new view.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.addEventListener(
    "keydown",
    (forwardedEvent) => viewerMock.onKeyDown?.(forwardedEvent as KeyboardEvent),
    { once: true },
  );
  target.dispatchEvent(event);
  return event;
}

function publishNavigationHistory(snapshot: ReaderNavigationHistorySnapshot): void {
  viewerMock.historySnapshot = snapshot;
  act(() => {
    viewerMock.publishNavigationHistory?.(snapshot);
  });
}

function publishPublicationSearch(state: ReaderPublicationSearchControllerState): void {
  viewerMock.publicationSearchState = state;
  act(() => {
    viewerMock.publishPublicationSearch?.(state);
  });
}

function publishSeekMap(state: ReaderSeekMapState): void {
  act(() => {
    viewerMock.publishSeekMap?.(state);
  });
}

beforeEach(() => {
  viewerMock.closePublicationSearch.mockReset();
  viewerMock.historySnapshot = {
    backCount: 0,
    canGoBack: false,
    canGoForward: false,
    forwardCount: 0,
  };
  viewerMock.locationPublications.mockReset();
  viewerMock.navigateBack.mockReset().mockResolvedValue(true);
  viewerMock.navigateForward.mockReset().mockResolvedValue(true);
  viewerMock.navigateToLocation.mockReset().mockResolvedValue(true);
  viewerMock.navigateToPublicationSearchResult.mockReset().mockResolvedValue(true);
  viewerMock.navigateToSeekPercentage.mockReset().mockResolvedValue(true);
  viewerMock.next.mockReset().mockResolvedValue(undefined);
  viewerMock.previous.mockReset().mockResolvedValue(undefined);
  viewerMock.nextPublicationSearchResult.mockReset().mockResolvedValue(true);
  viewerMock.previousPublicationSearchResult.mockReset().mockResolvedValue(true);
  viewerMock.publicationSearchState = {
    error: null,
    query: "",
    requestRevision: 0,
    results: [],
    selectedResult: null,
    status: "idle",
    truncated: false,
  };
  viewerMock.publishNavigationHistory = null;
  viewerMock.publishPublicationSearch = null;
  viewerMock.publishSeekMap = null;
  viewerMock.resolveSeekPreview.mockClear();
  viewerMock.setPublicationSearchQuery.mockReset().mockImplementation((query: string) => {
    publishPublicationSearch({
      error: null,
      query,
      requestRevision: viewerMock.publicationSearchState.requestRevision + 1,
      results: [],
      selectedResult: null,
      status: query.trim() ? "searching" : "idle",
      truncated: false,
    });
  });
  viewerMock.resolveAnnotationAnchor.mockReset().mockImplementation(async (annotation) => ({
    chapterHref: annotation.chapterHref,
    cfiRange: annotation.cfiRange,
    kind: "resolved",
    strategy: "exact-cfi",
  }));
  viewerMock.teardown.mockReset();
  vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyArchive);
  vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  await appPreferencesStore.update({ keyboard: { shortcuts: {} } });
});

describe("ReaderPage Quick Actions", () => {
  it.each(["paged", "continuous"] as const)(
    "opens Contents without changing %s Reader geometry or position",
    async (mode) => {
      const original = appPreferencesStore.getSnapshot();

      try {
        await act(async () => {
          await appPreferencesStore.update({ reader: { ...original.reader, mode } });
        });
        const rendered = await renderReader();
        const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;
        const viewer = rendered.container.querySelector<HTMLElement>(".epub-viewer")!;
        const stage = rendered.container.querySelector<HTMLElement>(".epub-viewer__stage")!;
        const toolbar = rendered.container.querySelector<HTMLElement>(".reader-toolbar")!;
        const previousZone = rendered.container.querySelector<HTMLElement>(
          ".epub-viewer__click-zone--previous",
        )!;
        const nextZone = rendered.container.querySelector<HTMLElement>(
          ".epub-viewer__click-zone--next",
        )!;
        const tocButton = rendered.container.querySelector<HTMLButtonElement>(
          'button[aria-label="Book navigation"]',
        )!;
        const geometry = new Map<HTMLElement, DOMRect>([
          [reader, new DOMRect(0, 0, 1200, 800)],
          [viewer, new DOMRect(0, 54, 1200, 746)],
          [stage, new DOMRect(0, 54, 1200, 746)],
          [toolbar, new DOMRect(0, 0, 1200, 52)],
          [previousZone, new DOMRect(0, 54, 48, 746)],
          [nextZone, new DOMRect(1152, 54, 48, 746)],
        ]);

        for (const [element, bounds] of geometry) {
          element.getBoundingClientRect = () => bounds;
        }
        reader.scrollTop = 73;
        stage.scrollTop = mode === "continuous" ? 412 : 0;
        const before = Array.from(geometry.keys(), (element) => element.getBoundingClientRect());
        const readerScrollTop = reader.scrollTop;
        const renditionScrollTop = stage.scrollTop;

        await act(async () => tocButton.click());
        await vi.waitFor(() =>
          expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(
            HTMLElement,
          ),
        );

        expect(rendered.container.querySelector(".reader-page")).toBe(reader);
        expect(rendered.container.querySelector(".epub-viewer")).toBe(viewer);
        expect(rendered.container.querySelector(".epub-viewer__stage")).toBe(stage);
        expect(rendered.container.querySelector(".reader-toolbar")).toBe(toolbar);
        expect(rendered.container.querySelector(".epub-viewer__click-zone--previous")).toBe(
          previousZone,
        );
        expect(rendered.container.querySelector(".epub-viewer__click-zone--next")).toBe(nextZone);
        expect(Array.from(geometry.keys(), (element) => element.getBoundingClientRect())).toEqual(
          before,
        );
        expect(reader.scrollTop).toBe(readerScrollTop);
        expect(stage.scrollTop).toBe(renditionScrollTop);
        expect(viewerMock.locationPublications).toHaveBeenCalledTimes(1);
        expect(viewerMock.locationPublications).toHaveBeenLastCalledWith(
          expect.objectContaining({ cfi: "epubcfi(/6/4)", rawPercentage: 0.2 }),
        );
      } finally {
        await act(async () => {
          await appPreferencesStore.update(original);
        });
      }
    },
  );

  it("keeps Quick Actions shortcut-only in Reader chrome", async () => {
    const rendered = await renderReader();

    expect(rendered.container.querySelector('button[aria-label="Quick Actions"]')).toBeNull();
    expect(await openPalette()).toBe(document.activeElement);
  });

  it("does not register or react to the Library sidebar command", async () => {
    const rendered = await renderReader();
    const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "b",
    });

    expect(rendered.container.querySelector(".app-shell")).toBeNull();
    expect(rendered.container.querySelector(".page-shell")).toBeNull();
    expect(rendered.container.querySelector(".sidebar")).toBeNull();
    expect(rendered.container.querySelector(".library-titlebar-composition")).toBeNull();

    act(() => reader.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);

    const search = await openPalette();
    await act(async () => setInputValue(search, "sidebar"));
    expect(document.querySelector('[role="option"]')).toBeNull();
  });

  it("drives toolbar history availability and replay from the current history owner snapshot", async () => {
    const rendered = await renderReader();
    const back = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back in reading history"]',
    )!;
    const forward = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Forward in reading history"]',
    )!;

    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(forward.getAttribute("aria-disabled")).toBe("true");

    publishNavigationHistory({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });

    expect(back.getAttribute("aria-disabled")).not.toBe("true");
    expect(forward.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      back.click();
      await Promise.resolve();
    });
    expect(viewerMock.navigateBack).toHaveBeenCalledTimes(1);

    publishNavigationHistory({
      backCount: 0,
      canGoBack: false,
      canGoForward: true,
      forwardCount: 1,
    });
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(forward.getAttribute("aria-disabled")).not.toBe("true");

    await act(async () => {
      forward.click();
      await Promise.resolve();
    });
    expect(viewerMock.navigateForward).toHaveBeenCalledTimes(1);
  });

  it("disables history controls when the Reader history owner resets for replacement", async () => {
    const rendered = await renderReader();
    const back = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back in reading history"]',
    )!;
    const forward = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Forward in reading history"]',
    )!;

    publishNavigationHistory({
      backCount: 2,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });
    expect(back.getAttribute("aria-disabled")).not.toBe("true");
    expect(forward.getAttribute("aria-disabled")).not.toBe("true");

    publishNavigationHistory({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(forward.getAttribute("aria-disabled")).toBe("true");
  });

  it("replays Reader history with Alt+Left and Alt+Right from normal EPUB content", async () => {
    await renderReader();
    const paragraph = createRenditionTarget("p");
    publishNavigationHistory({
      backCount: 1,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });

    let backEvent!: KeyboardEvent;
    await act(async () => {
      backEvent = dispatchRenditionShortcut(paragraph, { altKey: true, key: "ArrowLeft" });
      await Promise.resolve();
    });
    expect(backEvent.defaultPrevented).toBe(true);
    expect(viewerMock.navigateBack).toHaveBeenCalledTimes(1);

    let forwardEvent!: KeyboardEvent;
    await act(async () => {
      forwardEvent = dispatchRenditionShortcut(paragraph, { altKey: true, key: "ArrowRight" });
      await Promise.resolve();
    });
    expect(forwardEvent.defaultPrevented).toBe(true);
    expect(viewerMock.navigateForward).toHaveBeenCalledTimes(1);
  });

  it("does not claim history shortcuts from editable EPUB controls", async () => {
    await renderReader();
    const input = createRenditionTarget("input");
    publishNavigationHistory({
      backCount: 1,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });

    let event!: KeyboardEvent;
    await act(async () => {
      event = dispatchRenditionShortcut(input, { altKey: true, key: "ArrowLeft" });
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(viewerMock.navigateBack).not.toHaveBeenCalled();
  });

  it("switches progress semantics with seek readiness and owns slider Arrow keys", async () => {
    const rendered = await renderReader();
    let progress = rendered.container.querySelector<HTMLElement>(".reader-progress")!;

    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.hasAttribute("tabindex")).toBe(false);

    publishSeekMap({ status: "unavailable" });
    progress = rendered.container.querySelector<HTMLElement>(".reader-progress")!;
    expect(progress.getAttribute("role")).toBe("progressbar");

    publishSeekMap({
      resolveCfi: vi.fn(() => "epubcfi(/6/2!/4/4:0)"),
      resolveChapterLabel: vi.fn(() => "Chapter 1"),
      resolvePercentage: vi.fn(() => 0.21),
      status: "ready",
    });
    progress = rendered.container.querySelector<HTMLElement>(".reader-progress")!;

    expect(progress.getAttribute("role")).toBe("slider");
    expect(progress.getAttribute("tabindex")).toBe("0");

    await act(async () => {
      progress.focus();
      progress.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(viewerMock.navigateToSeekPercentage).toHaveBeenCalledWith(21);
    expect(viewerMock.next).not.toHaveBeenCalled();
  });

  it("focuses the Reader main landmark when the explicit route mounts", async () => {
    const rendered = await renderReader();
    const main = rendered.container.querySelector<HTMLElement>(`main#${MAIN_CONTENT_ID}`);

    expect(rendered.container.querySelectorAll("main")).toHaveLength(1);
    expect(main).not.toBeNull();
    expect(main?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(main);
  });

  it("falls back to Library when its saved Smart View return destination becomes hidden", async () => {
    const original = appPreferencesStore.getSnapshot();

    try {
      await act(async () => {
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: true, visible: ["unread"] },
          },
        });
      });
      const rendered = await renderReader(
        createStorage(),
        "/?archiveId=archive-books&view=smart&smartView=completed&query=space",
      );
      const back = rendered.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Back to Library"]',
      );

      expect(back).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        back?.click();
        await Promise.resolve();
      });

      expect(rendered.router.state.location.pathname).toBe("/");
      expect(viewerMock.navigateBack).not.toHaveBeenCalled();
      expect(rendered.router.state.location.search).toContain("view=library");
      expect(rendered.router.state.location.search).toContain("query=space");
      expect(rendered.router.state.location.search).not.toContain("smartView");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it("falls back to Library when its archive-health return destination becomes hidden", async () => {
    const original = appPreferencesStore.getSnapshot();

    try {
      await act(async () => {
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: true, visible: ["unread"] },
          },
        });
      });
      const rendered = await renderReader(
        createStorage(),
        "/?archiveId=archive-books&view=duplicates&query=space",
      );
      const back = rendered.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Back to Library"]',
      );

      expect(back).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        back?.click();
        await Promise.resolve();
      });

      expect(rendered.router.state.location.pathname).toBe("/");
      expect(rendered.router.state.location.search).toContain("view=library");
      expect(rendered.router.state.location.search).toContain("query=space");
      expect(rendered.router.state.location.search).not.toContain("duplicates");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it("offers Continue navigation only while the In progress Smart View is visible", async () => {
    const original = appPreferencesStore.getSnapshot();

    try {
      await act(async () => {
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: false, visible: ["in-progress"] },
          },
        });
      });
      await renderReader();
      let search = await openPalette();
      await act(async () => setInputValue(search, "Go to Continue"));
      expect(document.querySelector('[role="option"]')).toBeNull();

      await act(async () => {
        search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: true, visible: ["in-progress"] },
          },
        });
      });
      search = await openPalette();
      await act(async () => setInputValue(search, "Go to Continue"));
      expect(document.querySelector('[role="option"]')?.textContent).toContain("Go to Continue");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it("opens the existing book-navigation action without changing the reader route or return context", async () => {
    const rendered = await renderReader();
    const search = await openPalette();
    await act(async () => setInputValue(search, "Toggle book navigation"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (rendered.container.querySelector(".reader-navigation")) {
        break;
      }
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }

    expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(HTMLElement);
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });
  });

  it("registers the annotation command and opens the existing annotation surface", async () => {
    const rendered = await renderReader();
    const search = await openPalette();
    await act(async () => setInputValue(search, "Toggle annotations"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (rendered.container.querySelector(".reader-annotations")) break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }

    expect(rendered.container.querySelector(".reader-annotations")).toBeInstanceOf(HTMLElement);
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });
  });

  it("ignores a rendition-forwarded shortcut from an iframe text input", async () => {
    const rendered = await renderReader();
    const input = createRenditionTarget("input");
    input.type = "text";
    await act(async () => input.focus());

    let shortcutEvent!: KeyboardEvent;
    await act(async () => {
      shortcutEvent = dispatchRenditionShortcut(input);
      await Promise.resolve();
    });

    expect(shortcutEvent.defaultPrevented).toBe(false);
    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });
  });

  it("does not take the global shortcut from a publisher-owned iframe control", async () => {
    const rendered = await renderReader();
    const publisherButton = createRenditionTarget("button");
    publisherButton.textContent = "Publisher action";

    let shortcutEvent!: KeyboardEvent;
    await act(async () => {
      shortcutEvent = dispatchRenditionShortcut(publisherButton);
      await Promise.resolve();
    });

    expect(shortcutEvent.defaultPrevented).toBe(false);
    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
  });

  it("opens from ordinary iframe content and restores focus without changing reader context", async () => {
    const rendered = await renderReader();
    const frame = getRenditionFrame();
    const paragraph = createRenditionTarget("p");
    await act(async () => frame.focus());
    expect(document.activeElement).toBe(frame);

    let shortcutEvent!: KeyboardEvent;
    await act(async () => {
      shortcutEvent = dispatchRenditionShortcut(paragraph);
    });

    const search = await openPaletteSearch();
    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(document.activeElement).toBe(frame);
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });
  });

  it("opens Find in Book with Ctrl+F and refocuses its query when repeated", async () => {
    const rendered = await renderReader();
    const paragraph = createRenditionTarget("p");

    let shortcutEvent!: KeyboardEvent;
    await act(async () => {
      shortcutEvent = dispatchRenditionShortcut(paragraph, { ctrlKey: true, key: "f" });
    });
    expect(shortcutEvent.defaultPrevented).toBe(true);

    const input = rendered.container.querySelector<HTMLInputElement>(
      '.reader-search input[type="search"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);

    const close = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Find in Book"]',
    )!;
    close.focus();
    await act(async () => {
      close.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "f",
        }),
      );
    });

    expect(document.activeElement).toBe(input);
  });

  it("keeps annotation search local while Ctrl+F opens Find in Book from that field", async () => {
    const rendered = await renderReader();
    const annotationsButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Annotations"]',
    )!;

    await act(async () => annotationsButton.click());
    const annotationSearch = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="Search annotations"]',
    );
    expect(annotationSearch).toBeInstanceOf(HTMLInputElement);

    await act(async () => setInputValue(annotationSearch!, "local note"));
    expect(annotationSearch?.value).toBe("local note");

    let shortcutEvent!: KeyboardEvent;
    await act(async () => {
      shortcutEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "f",
      });
      annotationSearch!.dispatchEvent(shortcutEvent);
    });

    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(rendered.container.querySelector(".reader-annotations")).toBeNull();
    const bookSearch = rendered.container.querySelector<HTMLInputElement>(
      '.reader-search input[type="search"]',
    );
    expect(bookSearch).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(bookSearch);
  });

  it("opens the same Find in Book surface from the toolbar and restores trigger focus on close", async () => {
    const rendered = await renderReader();
    const searchButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Find in book"]',
    )!;

    await act(async () => searchButton.click());
    const input = rendered.container.querySelector<HTMLInputElement>(
      '.reader-search input[type="search"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);

    const close = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Find in Book"]',
    )!;
    await act(async () => close.click());
    await vi.waitFor(() => expect(rendered.container.querySelector(".reader-search")).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(searchButton));
    expect(viewerMock.closePublicationSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps Reader controls visible after Find in Book closes and idle time passes", async () => {
    const rendered = await renderReader();
    const controls = rendered.container.querySelector<HTMLElement>(".reader-controls")!;
    const searchButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Find in book"]',
    )!;

    vi.useFakeTimers();
    try {
      await act(async () => searchButton.click());
      expect(rendered.container.querySelector(".reader-search")).toBeInstanceOf(HTMLElement);
      expect(controls.getAttribute("data-visible")).toBe("true");

      await act(async () => vi.advanceTimersByTimeAsync(4_000));
      expect(controls.getAttribute("data-visible")).toBe("true");

      const close = rendered.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Close Find in Book"]',
      )!;
      await act(async () => {
        close.click();
        vi.advanceTimersToNextFrame();
      });
      expect(rendered.container.querySelector(".reader-search")).toBeNull();
      expect(document.activeElement).toBe(searchButton);
      expect(controls.getAttribute("data-visible")).toBe("true");

      await act(async () => vi.advanceTimersByTimeAsync(4_000));
      expect(controls.getAttribute("data-visible")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["top", "side"] as const)(
    "keeps the %s progress scrubber and active rendition stable across toolbar collapse and reveal",
    async (progressPlacement) => {
      const original = appPreferencesStore.getSnapshot();

      try {
        await act(async () => {
          await appPreferencesStore.update({
            reader: { ...original.reader, progressPlacement },
          });
        });
        const rendered = await renderReader();
        publishSeekMap({
          resolveCfi: vi.fn(() => "epubcfi(/6/2!/4/4:0)"),
          resolveChapterLabel: vi.fn(() => "Chapter 1"),
          resolvePercentage: vi.fn(() => 0.21),
          status: "ready",
        });

        const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;
        const viewer = rendered.container.querySelector<HTMLElement>(".epub-viewer")!;
        const progress = rendered.container.querySelector<HTMLElement>(".reader-progress")!;
        const initialLocationPublications = viewerMock.locationPublications.mock.calls.length;

        expect(reader.getAttribute("data-toolbar-expanded")).toBe("true");
        expect(progress.getAttribute("data-placement")).toBe(progressPlacement);
        expect(progress.getAttribute("role")).toBe("slider");

        hideToolbar(rendered);

        expect(reader.getAttribute("data-toolbar-expanded")).toBeNull();
        expect(rendered.container.querySelector(".epub-viewer")).toBe(viewer);
        expect(rendered.container.querySelector(".reader-progress")).toBe(progress);
        expect(viewerMock.locationPublications).toHaveBeenCalledTimes(initialLocationPublications);
        expect(viewerMock.navigateToLocation).not.toHaveBeenCalled();
        expect(viewerMock.navigateToSeekPercentage).not.toHaveBeenCalled();
        expect(viewerMock.next).not.toHaveBeenCalled();
        expect(viewerMock.previous).not.toHaveBeenCalled();
        expect(viewerMock.teardown).not.toHaveBeenCalled();

        const reveal = rendered.container.querySelector<HTMLButtonElement>(
          'button[aria-label="Show Reader toolbar"]',
        )!;
        act(() =>
          reveal.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
          ),
        );

        expect(reader.getAttribute("data-toolbar-expanded")).toBe("true");
        expect(rendered.container.querySelector(".epub-viewer")).toBe(viewer);
        expect(rendered.container.querySelector(".reader-progress")).toBe(progress);
        expect(viewerMock.locationPublications).toHaveBeenCalledTimes(initialLocationPublications);
        expect(viewerMock.navigateToLocation).not.toHaveBeenCalled();
        expect(viewerMock.navigateToSeekPercentage).not.toHaveBeenCalled();
        expect(viewerMock.next).not.toHaveBeenCalled();
        expect(viewerMock.previous).not.toHaveBeenCalled();
        expect(viewerMock.teardown).not.toHaveBeenCalled();

        hideToolbar(rendered);
        expect(reader.getAttribute("data-toolbar-expanded")).toBeNull();
        expect(rendered.container.querySelector(".reader-progress")).toBe(progress);

        await act(async () => {
          progress.focus();
          progress.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "ArrowRight",
            }),
          );
          await Promise.resolve();
        });

        expect(viewerMock.navigateToSeekPercentage).toHaveBeenCalledTimes(1);
        expect(viewerMock.navigateToSeekPercentage).toHaveBeenCalledWith(21);
        expect(rendered.container.querySelector(".epub-viewer")).toBe(viewer);
        expect(rendered.container.querySelector(".reader-progress")).toBe(progress);
      } finally {
        vi.useRealTimers();
        await act(async () => {
          await appPreferencesStore.update(original);
        });
      }
    },
  );

  it("opens a side surface from collapsed state without replacing the active rendition", async () => {
    const rendered = await renderReader();
    try {
      hideToolbar(rendered);
      const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;
      const viewer = rendered.container.querySelector<HTMLElement>(".epub-viewer")!;
      const progress = rendered.container.querySelector<HTMLElement>(".reader-progress")!;
      const initialLocationPublications = viewerMock.locationPublications.mock.calls.length;

      expect(reader.getAttribute("data-toolbar-expanded")).toBeNull();

      await act(async () => {
        reader.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "s",
          }),
        );
      });

      expect(rendered.container.querySelector(".reader-settings")).toBeInstanceOf(HTMLElement);
      expect(reader.getAttribute("data-toolbar-expanded")).toBe("true");
      expect(rendered.container.querySelector(".epub-viewer")).toBe(viewer);
      expect(rendered.container.querySelector(".reader-progress")).toBe(progress);
      expect(viewerMock.locationPublications).toHaveBeenCalledTimes(initialLocationPublications);
      expect(viewerMock.navigateToLocation).not.toHaveBeenCalled();
      expect(viewerMock.navigateToSeekPercentage).not.toHaveBeenCalled();
      expect(viewerMock.next).not.toHaveBeenCalled();
      expect(viewerMock.previous).not.toHaveBeenCalled();
      expect(viewerMock.teardown).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a manually hidden toolbar hidden through ordinary Reader activity and idle time", async () => {
    const rendered = await renderReader();
    vi.useFakeTimers();
    try {
      hideToolbar(rendered);
      const controls = rendered.container.querySelector<HTMLElement>(".reader-controls")!;
      const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;
      const previousZone = rendered.container.querySelector<HTMLElement>(
        ".epub-viewer__click-zone--previous",
      )!;
      const frame = getRenditionFrame();

      expect(controls.getAttribute("data-visible")).toBeNull();
      expect(controls.hasAttribute("inert")).toBe(true);

      act(() => {
        reader.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
        previousZone.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
        frame.contentDocument!.body.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true }),
        );
        frame.contentDocument!.body.dispatchEvent(new TouchEvent("touchmove", { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(4_000));

      expect(controls.getAttribute("data-visible")).toBeNull();
      expect(
        rendered.container.querySelector('button[aria-label="Show Reader toolbar"]'),
      ).toBeInstanceOf(HTMLButtonElement);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "Find in Book",
      { ctrlKey: true, key: "f" },
      ".reader-search",
      'button[aria-label="Close Find in Book"]',
      'button[aria-label="Find in book"]',
    ],
    [
      "Book navigation",
      { key: "t" },
      ".reader-navigation",
      'button[aria-label="Close book navigation"]',
      'button[aria-label="Book navigation"]',
    ],
    [
      "Annotations",
      { key: "a" },
      ".reader-annotations",
      'button[aria-label="Close annotations"]',
      'button[aria-label="Annotations"]',
    ],
    [
      "Reader settings",
      { key: "s" },
      ".reader-settings",
      'button[aria-label="Close reader settings"]',
      'button[aria-label="Reader settings"]',
    ],
  ])(
    "keeps the toolbar expanded while the %s shortcut-owned surface is open",
    async (_label, shortcut, surfaceSelector, closeSelector, triggerSelector) => {
      const rendered = await renderReader();
      vi.useFakeTimers();
      try {
        hideToolbar(rendered);
        const controls = rendered.container.querySelector<HTMLElement>(".reader-controls")!;
        const reader = rendered.container.querySelector<HTMLElement>(".reader-page")!;

        await act(async () => {
          reader.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...shortcut,
            }),
          );
        });
        expect(rendered.container.querySelector(surfaceSelector)).toBeInstanceOf(HTMLElement);
        expect(controls.getAttribute("data-visible")).toBe("true");

        await act(async () => vi.advanceTimersByTimeAsync(3_000));
        expect(controls.getAttribute("data-visible")).toBe("true");

        const close = rendered.container.querySelector<HTMLButtonElement>(closeSelector)!;
        const trigger = rendered.container.querySelector<HTMLButtonElement>(triggerSelector)!;
        await act(async () => {
          close.click();
          vi.advanceTimersToNextFrame();
        });
        expect(rendered.container.querySelector(surfaceSelector)).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(controls.getAttribute("data-visible")).toBe("true");

        act(() => reader.focus());
        await act(async () => vi.advanceTimersByTimeAsync(4_000));
        expect(controls.getAttribute("data-visible")).toBe("true");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("routes Find in Book result activation through the publication search controller", async () => {
    const rendered = await renderReader();
    const searchButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Find in book"]',
    )!;
    await act(async () => searchButton.click());

    const result = Object.freeze({
      chapterId: "chapter-1",
      chapterLabel: "Chapter 1",
      excerpt: "A searchable phrase in context",
      excerptMatch: Object.freeze({ end: 19, start: 2 }),
      id: "search-result-1",
      matchedText: "searchable phrase",
      position: Object.freeze({ matchIndex: 0, spineIndex: 0 }),
      target: "epubcfi(/6/2!/4/2:3)",
    });
    publishPublicationSearch({
      error: null,
      query: "searchable phrase",
      requestRevision: 2,
      results: Object.freeze([result]),
      selectedResult: result,
      status: "ready",
      truncated: false,
    });

    const resultButton = rendered.container.querySelector<HTMLButtonElement>(
      ".reader-search__result > button",
    );
    expect(resultButton?.textContent).toContain("A searchable phrase in context");

    await act(async () => resultButton?.click());
    expect(viewerMock.navigateToPublicationSearchResult).toHaveBeenCalledWith("search-result-1");
  });

  it("executes configurable reader commands directly in the parent document", async () => {
    const rendered = await renderReader();
    const target = rendered.container.querySelector<HTMLElement>(".reader-page")!;

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }),
      );
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(HTMLElement);

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "s" }),
      );
    });
    expect(rendered.container.querySelector(".reader-settings")).toBeInstanceOf(HTMLElement);
    expect(rendered.container.querySelector(".reader-navigation")).toBeNull();
  });

  it("executes configurable reader commands from ordinary EPUB content", async () => {
    const rendered = await renderReader();
    const paragraph = createRenditionTarget("p");

    let event!: KeyboardEvent;
    await act(async () => {
      event = dispatchRenditionShortcut(paragraph, { key: "a" });
    });

    expect(event.defaultPrevented).toBe(true);
    expect(rendered.container.querySelector(".reader-annotations")).toBeInstanceOf(HTMLElement);
  });

  it("updates the bookmark control quietly for direct add and remove shortcuts", async () => {
    const storage = createStorage();
    const createdBookmark = {
      bookId: "book",
      cfiRange: "epubcfi(/6/4)",
      chapterHref: "chapter-1",
      createdAt: "2026-07-20T00:00:00.000Z",
      id: "bookmark-direct",
      type: "bookmark" as const,
      updatedAt: "2026-07-20T00:00:00.000Z",
    };
    const createBookmark = storage.createAnnotation as (
      bookId: string,
      input: CreateBookmarkAnnotationInput,
    ) => Promise<BookmarkAnnotation>;
    vi.mocked(createBookmark).mockResolvedValue(createdBookmark);
    vi.mocked(storage.deleteAnnotation).mockResolvedValue(true);
    const rendered = await renderReader(storage);
    const target = rendered.container.querySelector<HTMLElement>(".reader-page")!;

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "b" }),
      );
      await Promise.resolve();
    });

    expect(storage.createAnnotation).toHaveBeenCalledWith("book", {
      chapterHref: "chapter-1",
      cfiRange: "epubcfi(/6/4)",
      label: "Chapter 1",
      type: "bookmark",
    });
    const removeBookmark = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove bookmark"]',
    );
    expect(removeBookmark?.getAttribute("aria-pressed")).toBe("true");
    expect(rendered.container.querySelector(".reader-annotation-feedback")).toBeNull();

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "b" }),
      );
      await Promise.resolve();
    });

    expect(storage.deleteAnnotation).toHaveBeenCalledWith("book", createdBookmark.id);
    const addBookmark = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add bookmark"]',
    );
    expect(addBookmark?.getAttribute("aria-pressed")).toBe("false");
    expect(rendered.container.querySelector(".reader-annotation-feedback")).toBeNull();
    expect(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent === "Undo",
      ),
    ).toBe(false);
  });

  it("keeps bookmark failure feedback visible and dismissible without changing toolbar state", async () => {
    const storage = createStorage();
    vi.mocked(storage.createAnnotation).mockRejectedValue(new Error("disk unavailable"));
    const rendered = await renderReader(storage);
    const target = rendered.container.querySelector<HTMLElement>(".reader-page")!;

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "b" }),
      );
      await Promise.resolve();
    });

    const addBookmark = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add bookmark"]',
    );
    expect(addBookmark?.getAttribute("aria-pressed")).toBe("false");
    const feedback = rendered.container.querySelector<HTMLElement>(".reader-annotation-feedback");
    expect(feedback?.getAttribute("role")).toBe("alert");
    expect(feedback?.textContent).toContain("Bookmark could not be added.");

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss annotation message"]')
        ?.click();
    });
    expect(rendered.container.querySelector(".reader-annotation-feedback")).toBeNull();
  });

  it("applies reader remapping, clearing, reset, and active shortcut attributes immediately", async () => {
    await appPreferencesStore.update({
      keyboard: {
        shortcuts: {
          "reader.open-toc": {
            binding: { alt: false, key: "q", primary: false, shift: false },
          },
        },
      },
    });
    const rendered = await renderReader();
    const target = rendered.container.querySelector<HTMLElement>(".reader-page")!;
    const tocButton = () =>
      rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Book navigation"]')!;

    expect(tocButton().getAttribute("aria-keyshortcuts")).toBe("Q");
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }),
      );
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeNull();
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "q" }),
      );
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(HTMLElement);

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "q" }),
      );
      await appPreferencesStore.update({
        keyboard: { shortcuts: { "reader.open-toc": { disabled: true } } },
      });
    });
    expect(tocButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "q" }),
      );
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeNull();

    await act(async () => {
      await appPreferencesStore.update({ keyboard: { shortcuts: {} } });
    });
    expect(tocButton().getAttribute("aria-keyshortcuts")).toBe("T");
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }),
      );
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(HTMLElement);
  });

  it("blocks EPUB reader commands while the parent Quick Actions dialog is open", async () => {
    const rendered = await renderReader();
    const paragraph = createRenditionTarget("p");
    await openPalette();

    let event!: KeyboardEvent;
    await act(async () => {
      event = dispatchRenditionShortcut(paragraph, { key: "a" });
    });

    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".quick-actions")).not.toBeNull();
    expect(rendered.container.querySelector(".reader-annotations")).toBeNull();
  });

  it("closes the palette on Escape before the reader handles its own Back action", async () => {
    const rendered = await renderReader();
    const search = await openPalette();

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(rendered.router.state.location.pathname).toBe("/reader/book");
    expect(rendered.router.state.location.state).toEqual({
      readerReturnContext: rendered.returnContext,
    });
  });

  it("marks an annotation current only after start-CFI navigation succeeds", async () => {
    const highlight: HighlightAnnotation = {
      cfiRange: "epubcfi(/6/2!/4/2,/1:10,/1:30)",
      chapterHref: "chapter-1",
      color: "yellow",
      createdAt: "2026-07-13T00:00:00.000Z",
      id: "highlight-navigation",
      selectedText: "Boundary passage",
      type: "highlight",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const storage = createStorage();
    vi.mocked(storage.listAnnotations).mockResolvedValue([highlight]);
    let settleNavigation!: (opened: boolean) => void;
    const pendingNavigation = new Promise<boolean>((resolve) => {
      settleNavigation = resolve;
    });
    viewerMock.navigateToLocation
      .mockResolvedValueOnce(false)
      .mockReturnValueOnce(pendingNavigation);
    const rendered = await renderReader(storage);
    const openAnnotations = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Annotations"]',
    )!;

    await act(async () => openAnnotations.click());
    await vi.waitFor(() =>
      expect(rendered.container.querySelector('[aria-label="Go to Highlight"]')).toBeInstanceOf(
        HTMLElement,
      ),
    );
    const firstTarget = rendered.container.querySelector<HTMLButtonElement>(
      '[aria-label="Go to Highlight"]',
    )!;
    await act(async () => firstTarget.click());
    expect(rendered.container.querySelector(".reader-annotations")).toBeInstanceOf(HTMLElement);
    expect(firstTarget.getAttribute("aria-current")).toBeNull();

    act(() => firstTarget.click());
    expect(firstTarget.getAttribute("aria-current")).toBeNull();
    expect(rendered.container.querySelector(".reader-annotations")).toBeInstanceOf(HTMLElement);
    await act(async () => {
      settleNavigation(true);
      await pendingNavigation;
    });
    expect(rendered.container.querySelector(".reader-annotations")).toBeNull();
    const navigationTarget = viewerMock.navigateToLocation.mock.calls[1]?.[0] as string;
    expect(navigationTarget).not.toBe(highlight.cfiRange);
    expect(navigationTarget).toContain(":10");
    expect(navigationTarget).not.toContain(",");

    await act(async () => openAnnotations.click());
    await vi.waitFor(() =>
      expect(
        rendered.container
          .querySelector('[aria-label="Go to Highlight"]')
          ?.getAttribute("aria-current"),
      ).toBe("location"),
    );
  });
});
