// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type {
  Annotation,
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from "../../types/annotation";
import type { Book } from "../../types/book";
import type { ReaderTextSelection } from "./EpubViewer";
import { ReaderRoute } from "./ReaderPage";

const viewerMock = vi.hoisted(() => ({
  autoReady: true,
  callbacks: null as null | {
    onError: (message: string) => void;
    onLocationChange: (location: {
      atEnd: boolean;
      atStart: boolean;
      cfi: string;
      percentage: number;
    }) => void;
    onNavigationChange: (navigation: {
      chapters: Array<{ depth: number; href: string; id: string; label: string }>;
      currentChapterId: string;
      status: "ready";
    }) => void;
    onOpenNote: (selection: ReaderTextSelection, annotation?: Annotation) => void;
    onReady: () => void;
  },
  location: {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/4)",
    percentage: 20,
  },
}));

const navigationState = {
  chapters: [
    {
      id: "chapter-1",
      label: "Chapter 1",
      href: "Text/chapter-1.xhtml",
      depth: 0,
    },
  ],
  currentChapterId: "chapter-1",
  status: "ready" as const,
};

vi.mock("./EpubViewer", async () => {
  const React = await import("react");

  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      props: NonNullable<typeof viewerMock.callbacks>,
      ref: React.ForwardedRef<unknown>,
    ) {
      viewerMock.callbacks = props;
      React.useImperativeHandle(ref, () => ({
        navigateToChapter: vi.fn().mockResolvedValue(true),
        navigateToLocation: vi.fn().mockResolvedValue(true),
        next: vi.fn().mockResolvedValue(undefined),
        previous: vi.fn().mockResolvedValue(undefined),
      }));
      const initial = React.useRef(props);

      React.useEffect(() => {
        if (!viewerMock.autoReady) return;
        initial.current.onNavigationChange(navigationState);
        initial.current.onLocationChange(viewerMock.location);
        initial.current.onReady();
      }, []);

      return <div data-testid="epub-viewer" />;
    }),
  };
});

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({ status: "ready", archive: { id: "archive-1" } }),
}));

const book: Book = {
  addedAt: "2026-07-01T00:00:00.000Z",
  fileName: "book.epub",
  id: "book-1",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const timestamp = "2026-07-12T00:00:00.000Z";
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createStorage(initial: Annotation[] = []) {
  const annotations = initial.map(clone);
  let id = 0;

  const listAnnotations = vi.fn(async () => annotations.map(clone));
  const createAnnotation = vi.fn(async (_bookId: string, input: CreateAnnotationInput) => {
    const created = {
      ...clone(input),
      id: `annotation-${++id}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as Annotation;
    annotations.push(created);
    return clone(created);
  });
  const updateAnnotation = vi.fn(
    async (_bookId: string, annotationId: string, changes: UpdateAnnotationInput) => {
      const index = annotations.findIndex((candidate) => candidate.id === annotationId);
      if (index < 0) return undefined;
      const updated: Annotation = {
        ...annotations[index],
        ...clone(changes),
        id: annotations[index].id,
        type: annotations[index].type,
        createdAt: annotations[index].createdAt,
        updatedAt: timestamp,
      };
      for (const [key, value] of Object.entries(updated)) {
        if (value === undefined) delete updated[key];
      }
      annotations[index] = updated;
      return clone(updated);
    },
  );
  const deleteAnnotation = vi.fn(async (_bookId: string, annotationId: string) => {
    const index = annotations.findIndex((candidate) => candidate.id === annotationId);
    if (index < 0) return false;
    annotations.splice(index, 1);
    return true;
  });

  const storage = {
    createAnnotation,
    deleteAnnotation,
    listAnnotations,
    loadBookFile: vi.fn().mockResolvedValue(new Blob(["epub"])),
    listBooks: vi.fn().mockResolvedValue([book]),
    restoreAnnotation: vi.fn(),
    updateAnnotation,
    updateBook: vi.fn().mockImplementation(async (_id, changes) => ({ ...book, ...changes })),
  } as unknown as LibraryStorage;

  return {
    annotations,
    createAnnotation,
    deleteAnnotation,
    listAnnotations,
    storage,
    updateAnnotation,
  };
}

async function waitFor(assertion: () => void, attempts = 50) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

async function renderReader(storage: LibraryStorage) {
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
    { initialEntries: ["/reader/book-1"] },
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

  await waitFor(() => {
    expect(container?.querySelector(".reader-page")).toBeInstanceOf(HTMLElement);
  });
  return { container: container!, router };
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const match = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function textButton(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function enterNote(target: HTMLElement, value: string) {
  const textarea = target.querySelector<HTMLTextAreaElement>(".reader-note-editor textarea");
  if (!textarea) throw new Error("Note editor was not open.");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openStandaloneNote(target: HTMLElement) {
  await act(async () => button(target, "Add note at current location").click());
  await waitFor(() => {
    expect(target.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);
  });
}

async function deleteOpenNote(target: HTMLElement) {
  await act(async () => textButton(target, "Delete note").click());
  await act(async () => textButton(target, "Delete").click());
}

async function openBookmarkNote(target: HTMLElement, label: string) {
  await act(async () => button(target, "Bookmarks").click());
  await waitFor(() => expect(button(target, `Note for ${label}`)).toBeDefined());
  await act(async () => button(target, `Note for ${label}`).click());
  await waitFor(() => {
    expect(target.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);
  });
}

async function openHighlightNote(target: HTMLElement, annotation: Annotation) {
  await act(async () =>
    viewerMock.callbacks?.onOpenNote(
      {
        cfiRange: annotation.cfiRange ?? "",
        chapterHref: annotation.chapterHref,
        selectedText: annotation.selectedText ?? "Passage",
      },
      annotation,
    ),
  );
  await waitFor(() => {
    expect(target.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);
  });
}

beforeEach(() => {
  viewerMock.autoReady = true;
  viewerMock.callbacks = null;
  viewerMock.location = {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/4)",
    percentage: 20,
  };
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    writable: true,
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  viewerMock.callbacks = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ReaderPage note integration", () => {
  it("gates standalone notes until the live reader location is ready", async () => {
    viewerMock.autoReady = false;
    const harness = createStorage();
    const rendered = await renderReader(harness.storage);
    const note = button(rendered.container, "Add note at current location");

    expect(note.disabled).toBe(true);
    expect(note.title).toBe("Current reading location is still loading.");
    act(() => note.click());
    expect(harness.listAnnotations).toHaveBeenCalledTimes(2);

    await act(async () => {
      viewerMock.callbacks?.onNavigationChange(navigationState);
      viewerMock.callbacks?.onLocationChange(viewerMock.location);
      viewerMock.callbacks?.onReady();
    });

    expect(button(rendered.container, "Add note at current location").disabled).toBe(false);
  });

  it("keeps standalone notes unavailable after an opening error", async () => {
    viewerMock.autoReady = false;
    const rendered = await renderReader(createStorage().storage);
    await act(async () => {
      viewerMock.callbacks?.onLocationChange(viewerMock.location);
      viewerMock.callbacks?.onError("This EPUB could not be opened.");
    });

    const note = button(rendered.container, "Add note at current location");
    expect(note.disabled).toBe(true);
    expect(note.title).toBe("Current reading location is unavailable.");
  });

  it("surfaces a note-load failure and retries without opening an empty editor", async () => {
    const bookmark: Annotation = {
      id: "bookmark-error-recovery",
      type: "bookmark",
      cfiRange: "epubcfi(/6/12)",
      label: "Recovery bookmark",
      note: "Persisted bookmark note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([bookmark]);
    const rendered = await renderReader(harness.storage);
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(2));
    harness.listAnnotations.mockRejectedValueOnce(new Error("read failed"));

    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() =>
      expect(rendered.container.textContent).toContain("Notes could not be loaded."),
    );
    expect(rendered.container.querySelector(".reader-note-editor")).toBeNull();

    await openBookmarkNote(rendered.container, "Recovery bookmark");
    expect(rendered.container.textContent).not.toContain("Notes could not be loaded.");
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Persisted bookmark note",
    );
    await act(async () => button(rendered.container, "Close note").click());

    await openStandaloneNote(rendered.container);
    expect(rendered.container.textContent).not.toContain("Notes could not be loaded.");
  });

  it("flushes exact standalone note text when closed before debounce", async () => {
    vi.useFakeTimers();
    const harness = createStorage();
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);
    const note = "  indented\n\n- list\n> quote\n    code\n";
    enterNote(rendered.container, note);

    await act(async () => button(rendered.container, "Close note").click());

    expect(harness.createAnnotation).toHaveBeenCalledTimes(1);
    expect(harness.createAnnotation.mock.calls[0]?.[1]).toMatchObject({ note });
    expect(rendered.container.querySelector(".reader-note-editor")).toBeNull();
  });

  it("keeps a failed save visible, retryable, and blocks another standalone action while saving", async () => {
    vi.useFakeTimers();
    const harness = createStorage();
    const pending = deferred<Annotation>();
    harness.createAnnotation
      .mockRejectedValueOnce(new Error("save failed"))
      .mockImplementationOnce(() => pending.promise);
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);
    enterNote(rendered.container, "Retry this note");

    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Not saved");

    await act(async () => textButton(rendered.container, "Retry").click());
    const noteAction = button(rendered.container, "Add note at current location");
    expect(noteAction.disabled).toBe(true);
    expect(noteAction.title).toBe("Wait for the current note action to finish.");

    const saved: Annotation = {
      id: "note-retried",
      type: "note",
      cfiRange: viewerMock.location.cfi,
      note: "Retry this note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await act(async () => pending.resolve(saved));

    expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Saved");
    expect(button(rendered.container, "Add note at current location").disabled).toBe(false);
  });

  it("does not create an annotation when a new standalone editor closes empty", async () => {
    const harness = createStorage();
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);

    await act(async () => button(rendered.container, "Close note").click());

    expect(harness.createAnnotation).not.toHaveBeenCalled();
    expect(rendered.container.querySelector(".reader-note-editor")).toBeNull();
  });

  it("deletes a standalone note but only clears attached bookmark and highlight notes", async () => {
    const standalone: Annotation = {
      id: "note-1",
      type: "note",
      cfiRange: viewerMock.location.cfi,
      note: "Standalone",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const bookmark: Annotation = {
      id: "bookmark-1",
      type: "bookmark",
      cfiRange: "epubcfi(/6/6)",
      label: "Bookmark",
      note: "Bookmark note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const highlight: Annotation = {
      id: "highlight-1",
      type: "highlight",
      cfiRange: "epubcfi(/6/8)",
      selectedText: "Passage",
      color: "yellow",
      note: "Highlight note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([standalone, bookmark, highlight]);
    const rendered = await renderReader(harness.storage);

    await openStandaloneNote(rendered.container);
    await deleteOpenNote(rendered.container);
    expect(harness.deleteAnnotation).toHaveBeenCalledWith(book.id, standalone.id);

    await act(async () => button(rendered.container, "Bookmarks").click());
    await waitFor(() => expect(button(rendered.container, "Note for Bookmark")).toBeDefined());
    await act(async () => button(rendered.container, "Note for Bookmark").click());
    await deleteOpenNote(rendered.container);
    expect(harness.updateAnnotation).toHaveBeenCalledWith(book.id, bookmark.id, {
      note: undefined,
    });

    await act(async () =>
      viewerMock.callbacks?.onOpenNote(
        {
          cfiRange: highlight.cfiRange!,
          chapterHref: "Text/chapter-1.xhtml",
          selectedText: "Passage",
        },
        highlight,
      ),
    );
    await waitFor(() =>
      expect(rendered.container.querySelector(".reader-note-editor")).toBeTruthy(),
    );
    await deleteOpenNote(rendered.container);
    expect(harness.updateAnnotation).toHaveBeenCalledWith(book.id, highlight.id, {
      note: undefined,
    });
    expect(harness.annotations.find((item) => item.id === bookmark.id)).not.toHaveProperty("note");
    expect(harness.annotations.find((item) => item.id === highlight.id)).not.toHaveProperty("note");
  });

  it("keeps a dirty highlight note open when target switching cannot flush", async () => {
    const first: Annotation = {
      id: "highlight-a",
      type: "highlight",
      cfiRange: "epubcfi(/6/8)",
      selectedText: "A",
      color: "yellow",
      note: "A original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const second: Annotation = {
      id: "highlight-b",
      type: "highlight",
      cfiRange: "epubcfi(/6/10)",
      selectedText: "B",
      color: "yellow",
      note: "B original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([first, second]);
    harness.updateAnnotation.mockRejectedValueOnce(new Error("save failed"));
    const rendered = await renderReader(harness.storage);

    await openHighlightNote(rendered.container, first);
    enterNote(rendered.container, "A pending");
    await act(async () =>
      viewerMock.callbacks?.onOpenNote({ cfiRange: second.cfiRange!, selectedText: "B" }, second),
    );

    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Not saved"),
    );
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "A pending",
    );

    await act(async () => textButton(rendered.container, "Retry").click());
    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Saved"),
    );
    await openHighlightNote(rendered.container, second);

    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "B original",
    );
    expect(harness.annotations.find((item) => item.id === first.id)?.note).toBe("A pending");
  });

  it("keeps a standalone note open when switching to a bookmark cannot flush", async () => {
    const bookmark: Annotation = {
      id: "bookmark-switch",
      type: "bookmark",
      cfiRange: "epubcfi(/6/14)",
      label: "Switch bookmark",
      note: "Bookmark note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([bookmark]);
    harness.createAnnotation.mockRejectedValueOnce(new Error("save failed"));
    const rendered = await renderReader(harness.storage);

    await openStandaloneNote(rendered.container);
    enterNote(rendered.container, "Standalone pending");
    await act(async () => button(rendered.container, "Bookmarks").click());
    await waitFor(() =>
      expect(button(rendered.container, "Note for Switch bookmark")).toBeDefined(),
    );
    await act(async () => button(rendered.container, "Note for Switch bookmark").click());

    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Not saved"),
    );
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Standalone pending",
    );

    await act(async () => textButton(rendered.container, "Retry").click());
    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Saved"),
    );
    await act(async () => button(rendered.container, "Note for Switch bookmark").click());
    await waitFor(() =>
      expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "Bookmark note",
      ),
    );
  });

  it("persists the previous note exactly once before a successful controlled switch", async () => {
    const first: Annotation = {
      id: "highlight-switch-a",
      type: "highlight",
      cfiRange: "epubcfi(/6/16)",
      selectedText: "A",
      color: "yellow",
      note: "A original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const second: Annotation = {
      id: "highlight-switch-b",
      type: "highlight",
      cfiRange: "epubcfi(/6/18)",
      selectedText: "B",
      color: "yellow",
      note: "B original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([first, second]);
    const rendered = await renderReader(harness.storage);

    await openHighlightNote(rendered.container, first);
    enterNote(rendered.container, "A saved before switch");
    await openHighlightNote(rendered.container, second);

    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
    expect(harness.updateAnnotation).toHaveBeenCalledWith(book.id, first.id, {
      note: "A saved before switch",
    });
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "B original",
    );
    await act(async () => Promise.resolve());
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("keeps the reader mounted and retryable when Back cannot flush the current note", async () => {
    const harness = createStorage();
    const pendingSave = deferred<Annotation>();
    harness.createAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);
    enterNote(rendered.container, "Back must wait");

    act(() => {
      button(rendered.container, "Back to Library").click();
      button(rendered.container, "Back to Library").click();
    });
    expect(harness.createAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => pendingSave.reject(new Error("save failed")));
    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Not saved"),
    );

    expect(rendered.router.state.location.pathname).toBe("/reader/book-1");
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Back must wait",
    );
    expect(textButton(rendered.container, "Retry")).toBeInstanceOf(HTMLButtonElement);

    await act(async () => textButton(rendered.container, "Retry").click());
    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Saved"),
    );
    await act(async () => button(rendered.container, "Back to Library").click());
    await waitFor(() => expect(rendered.router.state.location.pathname).toBe("/"));

    expect(harness.createAnnotation).toHaveBeenCalledTimes(2);
  });

  it("awaits a successful note flush before Back and avoids an unmount duplicate", async () => {
    const harness = createStorage();
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);
    enterNote(rendered.container, "Back-safe note");

    await act(async () => button(rendered.container, "Back to Library").click());
    await waitFor(() => expect(rendered.router.state.location.pathname).toBe("/"));

    expect(harness.createAnnotation).toHaveBeenCalledTimes(1);
    expect(harness.createAnnotation.mock.calls[0]?.[1]).toMatchObject({ note: "Back-safe note" });
  });

  it("cancels a superseded standalone load without clearing a newer load owner", async () => {
    const bookmark: Annotation = {
      id: "bookmark-load-owner",
      type: "bookmark",
      cfiRange: "epubcfi(/6/20)",
      label: "Load owner bookmark",
      note: "Bookmark note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([bookmark]);
    const firstLoad = deferred<Annotation[]>();
    const secondLoad = deferred<Annotation[]>();
    const rendered = await renderReader(harness.storage);
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(2));
    harness.listAnnotations
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);

    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(3));
    expect(button(rendered.container, "Add note at current location").disabled).toBe(true);

    await openBookmarkNote(rendered.container, "Load owner bookmark");
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Bookmark note",
    );
    await act(async () => button(rendered.container, "Close note").click());

    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(4));
    expect(button(rendered.container, "Add note at current location").disabled).toBe(true);

    await act(async () => firstLoad.resolve([]));
    expect(button(rendered.container, "Add note at current location").disabled).toBe(true);
    expect(rendered.container.querySelector(".reader-note-editor")).toBeNull();

    await act(async () => secondLoad.resolve([]));
    await waitFor(() => {
      expect(rendered.container.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);
    });
  });

  it("ignores a stale standalone-load rejection after a bookmark note opens", async () => {
    const bookmark: Annotation = {
      id: "bookmark-stale-error",
      type: "bookmark",
      cfiRange: "epubcfi(/6/22)",
      label: "Stale error bookmark",
      note: "Current note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([bookmark]);
    const staleLoad = deferred<Annotation[]>();
    const rendered = await renderReader(harness.storage);
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(2));
    harness.listAnnotations.mockImplementationOnce(() => staleLoad.promise);

    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(3));
    await openBookmarkNote(rendered.container, "Stale error bookmark");
    await act(async () => staleLoad.reject(new Error("stale read failed")));

    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Current note",
    );
    expect(rendered.container.textContent).not.toContain("Notes could not be loaded.");
    expect(button(rendered.container, "Add note at current location").disabled).toBe(false);
  });

  it("settles edits made while a standalone target is loading before replacement", async () => {
    const current: Annotation = {
      id: "highlight-loading-window",
      type: "highlight",
      cfiRange: "epubcfi(/6/24)",
      selectedText: "Current",
      color: "yellow",
      note: "Original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([current]);
    const pendingLoad = deferred<Annotation[]>();
    const rendered = await renderReader(harness.storage);
    await openHighlightNote(rendered.container, current);

    enterNote(rendered.container, "First settled draft");
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(2));
    harness.listAnnotations.mockImplementationOnce(() => pendingLoad.promise);
    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() => expect(harness.updateAnnotation).toHaveBeenCalledTimes(1));

    enterNote(rendered.container, "Edited during standalone load");
    await act(async () => pendingLoad.resolve(harness.annotations.map(clone)));

    await waitFor(() => {
      expect(harness.updateAnnotation).toHaveBeenCalledTimes(2);
      expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    });
    expect(harness.updateAnnotation.mock.calls[1]?.[2]).toEqual({
      note: "Edited during standalone load",
    });
  });

  it("keeps the current note visible when final settlement after standalone loading fails", async () => {
    const current: Annotation = {
      id: "highlight-loading-failure",
      type: "highlight",
      cfiRange: "epubcfi(/6/26)",
      selectedText: "Current",
      color: "yellow",
      note: "Original",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([current]);
    const originalUpdate = harness.updateAnnotation.getMockImplementation();
    const pendingLoad = deferred<Annotation[]>();
    harness.updateAnnotation
      .mockImplementationOnce(originalUpdate!)
      .mockRejectedValueOnce(new Error("final save failed"));
    const rendered = await renderReader(harness.storage);
    await openHighlightNote(rendered.container, current);

    enterNote(rendered.container, "First settled draft");
    await waitFor(() => expect(harness.listAnnotations).toHaveBeenCalledTimes(2));
    harness.listAnnotations.mockImplementationOnce(() => pendingLoad.promise);
    await act(async () => button(rendered.container, "Add note at current location").click());
    await waitFor(() => expect(harness.updateAnnotation).toHaveBeenCalledTimes(1));

    enterNote(rendered.container, "Unsaved during load");
    await act(async () => pendingLoad.resolve(harness.annotations.map(clone)));

    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain("Not saved"),
    );
    expect(rendered.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Unsaved during load",
    );
    expect(rendered.container.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);
  });

  it("waits for confirmed deletion before Back and blocks navigation after deletion failure", async () => {
    const standalone: Annotation = {
      id: "note-delete-navigation",
      type: "note",
      cfiRange: viewerMock.location.cfi,
      note: "Delete me",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const harness = createStorage([standalone]);
    const firstDeletion = deferred<boolean>();
    const secondDeletion = deferred<boolean>();
    harness.deleteAnnotation
      .mockImplementationOnce(() => firstDeletion.promise)
      .mockImplementationOnce(() => secondDeletion.promise);
    const rendered = await renderReader(harness.storage);
    await openStandaloneNote(rendered.container);

    await act(async () => textButton(rendered.container, "Delete note").click());
    await act(async () => textButton(rendered.container, "Delete").click());
    await waitFor(() => expect(harness.deleteAnnotation).toHaveBeenCalledTimes(1));
    act(() => {
      button(rendered.container, "Back to Library").click();
      button(rendered.container, "Back to Library").click();
    });

    expect(rendered.router.state.location.pathname).toBe("/reader/book-1");

    await act(async () => firstDeletion.resolve(false));
    await waitFor(() =>
      expect(rendered.container.querySelector("[role=status]")?.textContent).toContain(
        "Note could not be deleted.",
      ),
    );
    expect(rendered.router.state.location.pathname).toBe("/reader/book-1");

    await act(async () => textButton(rendered.container, "Delete").click());
    await waitFor(() => expect(harness.deleteAnnotation).toHaveBeenCalledTimes(2));
    act(() => button(rendered.container, "Back to Library").click());
    await act(async () => secondDeletion.resolve(true));
    await waitFor(() => expect(rendered.router.state.location.pathname).toBe("/"));
  });
});
