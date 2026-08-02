// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { Book } from "../../types/book";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import { archiveStore, type ArchiveTransitionGuard } from "../../stores/archiveStore";
import { ReaderRoute } from "./ReaderPage";
import type { ReaderFileLease } from "./readerFileLease";

type TextSelection = {
  cfiRange: string;
  chapterHref?: string;
  selectedText: string;
};

type MockViewerProps = {
  fileLease: ReaderFileLease;
  highlights: readonly HighlightAnnotation[];
  onNavigationChange?: (navigation: {
    chapters: Array<{ depth: number; href: string; id: string; label: string }>;
    currentChapterId: string;
    status: "ready";
  }) => void;
  onHighlightAnchorInvalid?: (annotationId: string, anchorSignature: string) => Promise<boolean>;
  onOpenNote?: (selection: TextSelection, existingHighlight?: HighlightAnnotation) => void;
  onReady: () => void;
  onRemoveHighlight?: (annotationId: string) => Promise<boolean>;
};

const viewerControl = vi.hoisted(() => ({
  navigateToChapter: vi.fn(async () => true),
  paletteOpen: false,
  props: null as MockViewerProps | null,
  resolveAnnotationAnchor: vi.fn(),
}));

const seriesControl = vi.hoisted(() => ({
  nextVolume: undefined as Book | undefined,
}));

const tocControl = vi.hoisted(() => ({
  onNavigate: undefined as ((chapterId: string) => Promise<boolean>) | undefined,
}));

vi.mock("./EpubViewer", async () => {
  const React = await import("react");
  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      props: MockViewerProps,
      ref: React.ForwardedRef<unknown>,
    ) {
      viewerControl.props = props;
      const { onNavigationChange, onReady } = props;
      React.useImperativeHandle(ref, () => ({
        navigateToChapter: viewerControl.navigateToChapter,
        navigateToLocation: vi.fn(async () => true),
        next: vi.fn(async () => undefined),
        previous: vi.fn(async () => undefined),
        resolveAnnotationAnchor: viewerControl.resolveAnnotationAnchor,
      }));
      React.useEffect(() => {
        onNavigationChange?.({
          chapters: [
            {
              depth: 0,
              href: "Text/chapter.xhtml",
              id: "chapter",
              label: "Chapter",
            },
          ],
          currentChapterId: "chapter",
          status: "ready",
        });
        onReady();
      }, [onNavigationChange, onReady]);
      return (
        <div data-testid="epub-viewer-mock">
          {props.highlights.map((highlight) => (
            <span data-highlight-id={highlight.id} key={highlight.id}>
              {highlight.note}
            </span>
          ))}
        </div>
      );
    }),
  };
});

vi.mock("./LazyReaderAnnotationsPanel", async () => {
  const { ReaderAnnotationsPanel } = await import("./ReaderAnnotationsPanel");
  return { LazyReaderAnnotationsPanel: ReaderAnnotationsPanel };
});

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({
    status: "ready",
    archive: { id: "archive-books" },
  }),
}));

vi.mock("./LazyReaderTocPanel", async () => {
  const React = await import("react");
  const { ReaderTocPanel } = await import("./ReaderTocPanel");
  return {
    LazyReaderTocPanel: (props: ComponentProps<typeof ReaderTocPanel>) => {
      tocControl.onNavigate = props.onNavigate;
      return React.createElement(ReaderTocPanel, props);
    },
  };
});

vi.mock("./useReaderSeriesContinuation", () => ({
  useReaderSeriesContinuation: () => seriesControl.nextVolume,
}));

const timestamp = "2026-07-13T00:00:00.000Z";
const nextTimestamp = "2026-07-13T00:00:01.000Z";

const books: Record<string, Book> = {
  "book-1": {
    addedAt: timestamp,
    fileName: "book-1.epub",
    id: "book-1",
    isFavorite: false,
    originalTitle: "Book One",
    updatedAt: timestamp,
  },
  "book-2": {
    addedAt: timestamp,
    fileName: "book-2.epub",
    id: "book-2",
    isFavorite: false,
    originalTitle: "Book Two",
    updatedAt: timestamp,
  },
};

function highlight(id: string, overrides: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    chapterHref: "Text/chapter.xhtml",
    cfiRange: `epubcfi(/6/2!/4/2,/1:${id.length},/1:${id.length + 12})`,
    color: "rose",
    createdAt: timestamp,
    id,
    selectedText: `Passage ${id}`,
    type: "highlight",
    updatedAt: timestamp,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

type StorageHarness = ReturnType<typeof createStorageHarness>;

function createStorageHarness(initial: Record<string, Annotation[]> = {}) {
  const records = new Map(
    Object.entries(initial).map(([bookId, annotations]) => [bookId, structuredClone(annotations)]),
  );
  let createdSequence = 0;

  const listAnnotations = vi.fn(async (bookId: string) =>
    structuredClone(records.get(bookId) ?? []),
  );
  const createAnnotation = vi.fn(async (bookId: string, input: Record<string, unknown>) => {
    const created = {
      ...input,
      createdAt: timestamp,
      id: `created-${++createdSequence}`,
      updatedAt: timestamp,
    } as HighlightAnnotation;
    records.set(bookId, [...(records.get(bookId) ?? []), structuredClone(created)]);
    return structuredClone(created);
  });
  const updateAnnotation = vi.fn(
    async (bookId: string, annotationId: string, patch: Record<string, unknown>) => {
      const annotations = records.get(bookId) ?? [];
      const index = annotations.findIndex((candidate) => candidate.id === annotationId);
      if (index < 0) return undefined;
      const updated = {
        ...annotations[index],
        ...patch,
        updatedAt: nextTimestamp,
      } as Annotation;
      if (Object.prototype.hasOwnProperty.call(patch, "note") && patch.note === undefined) {
        delete (updated as HighlightAnnotation).note;
      }
      annotations[index] = structuredClone(updated);
      records.set(bookId, annotations);
      return structuredClone(updated);
    },
  );
  const deleteAnnotation = vi.fn(async (bookId: string, annotationId: string) => {
    const annotations = records.get(bookId) ?? [];
    const next = annotations.filter((candidate) => candidate.id !== annotationId);
    if (next.length === annotations.length) return false;
    records.set(bookId, next);
    return true;
  });
  const restoreAnnotation = vi.fn(async (bookId: string, annotation: Annotation) => {
    records.set(bookId, [
      ...(records.get(bookId) ?? []).filter((candidate) => candidate.id !== annotation.id),
      structuredClone(annotation),
    ]);
    return structuredClone(annotation);
  });
  const updateBook = vi.fn(async (bookId: string, changes: Partial<Book>) => ({
    ...books[bookId],
    ...changes,
  }));
  const storage = {
    createAnnotation,
    deleteAnnotation,
    listAnnotations,
    loadBookFile: vi.fn(async (bookId: string) => new Blob([bookId])),
    restoreAnnotation,
    updateHighlightAnnotation: updateAnnotation,
    updateBook,
  } as unknown as LibraryStorage;

  return {
    createAnnotation,
    deleteAnnotation,
    listAnnotations,
    records,
    restoreAnnotation,
    storage,
    updateAnnotation,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderReader(
  harness: StorageHarness,
  initialBookId = "book-1",
  historyEntries: string[] = [`/reader/${initialBookId}`],
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <div data-testid="library-route" />,
      },
      {
        HydrateFallback: () => null,
        path: "/reader/:bookId",
        element: <ReaderRoute />,
        loader: ({ params }) => books[params.bookId ?? ""],
      },
    ],
    { initialEntries: historyEntries, initialIndex: historyEntries.length - 1 },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={harness.storage}>
        <QuickActionsProvider>
          <RouterProvider router={router} />
        </QuickActionsProvider>
      </LibraryStorageContext.Provider>,
    );
  });
  await waitForHighlights(
    (harness.records.get(initialBookId) ?? [])
      .filter(
        (annotation) => annotation.type === "highlight" && annotation.anchorStatus !== "detached",
      )
      .map(({ id }) => id),
  );
  return router;
}

async function waitForHighlights(expectedIds: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const currentIds = viewerControl.props?.highlights.map(({ id }) => id) ?? [];
    if (JSON.stringify(currentIds) === JSON.stringify(expectedIds)) return;
    await flush();
  }
  throw new Error(`Expected rendered highlights ${expectedIds.join(", ")}.`);
}

async function waitForEditor(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const editor = container?.querySelector<HTMLElement>(".reader-note-editor");
    if (editor) return editor;
    await flush();
  }
  throw new Error("The note editor did not open.");
}

async function waitForEditorToClose(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!container?.querySelector(".reader-note-editor")) return;
    await flush();
  }
  throw new Error("The note editor did not close.");
}

async function waitForElement<T extends Element>(selector: string): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const match = container?.querySelector<T>(selector);
    if (match) return match;
    await flush();
  }
  throw new Error(`Element ${selector} was not rendered.`);
}

function invokeNoteAction(selection: TextSelection, existingHighlight?: HighlightAnnotation): void {
  const callback = viewerControl.props?.onOpenNote;
  if (!callback) throw new Error("The viewer note callback is unavailable.");
  viewerControl.paletteOpen = false;
  callback(selection, existingHighlight);
}

async function openNote(
  selection: TextSelection,
  existingHighlight?: HighlightAnnotation,
): Promise<HTMLElement> {
  viewerControl.paletteOpen = true;
  act(() => invokeNoteAction(selection, existingHighlight));
  return waitForEditor();
}

function textarea(editor: HTMLElement): HTMLTextAreaElement {
  const field = editor.querySelector<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("The note textarea was not rendered.");
  return field;
}

function setTextareaValue(editor: HTMLElement, value: string): void {
  const field = textarea(editor);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const byLabel = container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const byText = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const match = byLabel ?? byText;
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

async function closeEditor(): Promise<void> {
  await act(async () => {
    button("Back to annotations").click();
    await Promise.resolve();
  });
  await waitForEditorToClose();
}

async function confirmDeleteNote(): Promise<void> {
  act(() => button("Delete note").click());
  await act(async () => {
    button("Delete").click();
    await Promise.resolve();
  });
}

async function switchBook(
  router: ReturnType<typeof createMemoryRouter>,
  bookId: string,
  expectedHighlightIds: readonly string[],
): Promise<void> {
  await act(async () => {
    await router.navigate(`/reader/${bookId}`);
  });
  await waitForHighlights(expectedHighlightIds);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (router.state.location.pathname === `/reader/${bookId}` && viewerControl.props) return;
    await flush();
  }
  throw new Error(`Reader did not switch to ${bookId}.`);
}

function requestNavigation(
  router: ReturnType<typeof createMemoryRouter>,
  to: string | number,
): Promise<void> {
  let navigation: Promise<void> | undefined;
  act(() => {
    navigation = typeof to === "number" ? router.navigate(to) : router.navigate(to);
  });
  return navigation!;
}

async function waitForRoute(
  router: ReturnType<typeof createMemoryRouter>,
  pathname: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (router.state.location.pathname === pathname) return;
    await flush();
  }
  throw new Error(`Expected reader route ${pathname}.`);
}

beforeEach(() => {
  seriesControl.nextVolume = undefined;
  tocControl.onNavigate = undefined;
  viewerControl.paletteOpen = false;
  viewerControl.props = null;
  viewerControl.resolveAnnotationAnchor.mockReset().mockImplementation(async (annotation) => ({
    chapterHref: annotation.chapterHref,
    cfiRange: annotation.cfiRange,
    kind: "resolved",
    strategy: "exact-cfi",
  }));
  viewerControl.navigateToChapter.mockReset().mockResolvedValue(true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  viewerControl.props = null;
  vi.restoreAllMocks();
});

describe("ReaderPage annotation notes", () => {
  it("recolors a detached panel highlight while keeping it detached and unrendered", async () => {
    const detached = highlight("detached-recolor", {
      anchorStatus: "detached",
      color: "blue",
      note: "Keep the note",
    });
    const harness = createStorageHarness({ "book-1": [detached] });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => trigger.click());
    act(() => button("Recolor highlight").click());
    await act(async () => button("Green").click());

    expect(harness.records.get("book-1")?.[0]).toMatchObject({
      anchorStatus: "detached",
      color: "green",
      id: detached.id,
      note: detached.note,
    });
    expect(viewerControl.props?.highlights).toEqual([]);
  });

  it("recovers a detached highlight in place without duplicating authored data", async () => {
    const existing = {
      ...highlight("detached-recovery", {
        anchorStatus: "detached",
        contextAfter: "After context",
        contextBefore: "Before context",
        note: "Keep this note",
      }),
      futureMetadata: { source: "preserved" },
    } as HighlightAnnotation;
    const harness = createStorageHarness({ "book-1": [existing] });
    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({
      chapterHref: "Text/renamed.xhtml",
      cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
      kind: "resolved",
      strategy: "context-text",
    });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'button[aria-label="Actions for Highlight"]',
    );
    act(() => trigger.click());
    await act(async () => button("Attempt to locate").click());

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (viewerControl.props?.highlights[0]?.anchorStatus !== "detached") break;
      await flush();
    }

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      anchorStatus: undefined,
      cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
      chapterHref: "Text/renamed.xhtml",
    });
    expect(harness.records.get("book-1")).toHaveLength(1);
    expect(viewerControl.props?.highlights[0]).toMatchObject({
      color: existing.color,
      contextAfter: existing.contextAfter,
      contextBefore: existing.contextBefore,
      futureMetadata: { source: "preserved" },
      id: existing.id,
      note: existing.note,
      selectedText: existing.selectedText,
    });
  });

  it("marks a viewer-rejected highlight detached without deleting or duplicating it", async () => {
    const existing = highlight("invalid-rendered-anchor", { note: "Authored note" });
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);

    await act(async () => {
      await viewerControl.props?.onHighlightAnchorInvalid?.(existing.id, "invalid-signature");
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (viewerControl.props?.highlights[0]?.anchorStatus === "detached") break;
      await flush();
    }

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      anchorStatus: "detached",
    });
    expect(harness.records.get("book-1")).toHaveLength(1);
    expect(viewerControl.props?.highlights).toEqual([]);
    expect(harness.records.get("book-1")?.[0]).toMatchObject({
      anchorStatus: "detached",
      id: existing.id,
      note: "Authored note",
    });
  });

  it("persists two invalid rendered highlights discovered in one reconciliation", async () => {
    const first = highlight("invalid-first");
    const second = highlight("invalid-second");
    const harness = createStorageHarness({ "book-1": [first, second] });
    await renderReader(harness);

    await act(async () => {
      await Promise.all([
        viewerControl.props?.onHighlightAnchorInvalid?.(first.id, "first-signature"),
        viewerControl.props?.onHighlightAnchorInvalid?.(second.id, "second-signature"),
      ]);
    });
    await waitForHighlights([]);

    expect(harness.updateAnnotation).toHaveBeenCalledTimes(2);
    expect(harness.records.get("book-1")).toEqual([
      expect.objectContaining({ anchorStatus: "detached", id: first.id }),
      expect.objectContaining({ anchorStatus: "detached", id: second.id }),
    ]);
  });

  it("clears current-annotation state when its highlight becomes detached", async () => {
    const existing = highlight("current-then-detached");
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const target = await waitForElement<HTMLButtonElement>(
      '.reader-annotations__target[aria-label^="Go to"]',
    );
    await act(async () => target.click());
    if (!container?.querySelector('aside[aria-label="Annotations"]')) {
      act(() => button("Annotations").click());
      await waitForElement('aside[aria-label="Annotations"]');
    }
    expect(
      container?.querySelector(".reader-annotations__item")?.hasAttribute("data-current"),
    ).toBe(true);

    await act(async () => {
      await viewerControl.props?.onHighlightAnchorInvalid?.(existing.id, "current-invalid");
    });
    await waitForHighlights([]);

    expect(
      container?.querySelector(".reader-annotations__item")?.hasAttribute("data-current"),
    ).toBe(false);
  });

  it("keeps a detached highlight intact when recovery reaches an occupied active range", async () => {
    const occupied = highlight("occupied", {
      cfiRange: "epubcfi(/6/2!/4/2,/1:4,/1:20)",
    });
    const detached = highlight("detached-conflict", {
      anchorStatus: "detached",
      cfiRange: "epubcfi(/6/4!/4/2,/1:2,/1:12)",
      note: "Preserve this detached note",
    });
    const harness = createStorageHarness({ "book-1": [occupied, detached] });
    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({
      chapterHref: occupied.chapterHref,
      cfiRange: occupied.cfiRange,
      kind: "resolved",
      strategy: "context-text",
    });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => trigger.click());
    await act(async () => button("Attempt to locate").click());

    expect(container?.textContent).toContain("overlaps another annotation");
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.createAnnotation).not.toHaveBeenCalled();
    expect(harness.deleteAnnotation).not.toHaveBeenCalled();
    expect(harness.records.get("book-1")).toEqual([occupied, detached]);
  });

  it("keeps a partially overlapping recovered highlight detached", async () => {
    const occupied = highlight("partial-owner", {
      cfiRange: "epubcfi(/6/2!/4/2,/1:4,/1:20)",
    });
    const detached = highlight("partial-detached", {
      anchorStatus: "detached",
      cfiRange: "epubcfi(/6/4!/4/2,/1:2,/1:12)",
    });
    const harness = createStorageHarness({ "book-1": [occupied, detached] });
    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({
      chapterHref: occupied.chapterHref,
      cfiRange: "epubcfi(/6/2!/4/2,/1:15,/1:28)",
      kind: "resolved",
      strategy: "context-text",
    });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => trigger.click());
    await act(async () => button("Attempt to locate").click());

    expect(container?.textContent).toContain("overlaps another annotation");
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.records.get("book-1")).toEqual([occupied, detached]);
  });

  it("keeps both bookmarks when recovered location is already occupied", async () => {
    const occupied: Annotation = {
      chapterHref: "Text/chapter.xhtml",
      cfiRange: "epubcfi(/6/2!/4/2:8)",
      createdAt: timestamp,
      id: "occupied-bookmark",
      type: "bookmark",
      updatedAt: timestamp,
    };
    const detached: Annotation = {
      anchorStatus: "detached",
      chapterHref: "Text/old.xhtml",
      cfiRange: "epubcfi(/6/4!/4/2:3)",
      createdAt: timestamp,
      id: "detached-bookmark",
      label: "Keep this bookmark",
      type: "bookmark",
      updatedAt: timestamp,
    };
    const harness = createStorageHarness({ "book-1": [occupied, detached] });
    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({
      chapterHref: occupied.chapterHref,
      cfiRange: occupied.cfiRange!,
      kind: "resolved",
      strategy: "chapter-start",
    });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => trigger.click());
    await act(async () => button("Attempt to locate").click());

    expect(container?.textContent).toContain("overlaps another annotation");
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.createAnnotation).not.toHaveBeenCalled();
    expect(harness.deleteAnnotation).not.toHaveBeenCalled();
    expect(harness.records.get("book-1")).toEqual([occupied, detached]);
  });

  it("leaves a detached record unchanged when recovery fails", async () => {
    const detached = highlight("failed-recovery", {
      anchorStatus: "detached",
      note: "Retry this later",
    });
    const harness = createStorageHarness({ "book-1": [detached] });
    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({ kind: "failed" });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => trigger.click());
    await act(async () => button("Attempt to locate").click());

    expect(container?.textContent).toContain("Recovery failed. Try again.");
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.records.get("book-1")).toEqual([detached]);

    viewerControl.resolveAnnotationAnchor.mockResolvedValueOnce({ kind: "cancelled" });
    const retryTrigger = await waitForElement<HTMLButtonElement>(
      'li[data-detached] button[aria-label^="Actions for"]',
    );
    act(() => retryTrigger.click());
    await act(async () => button("Attempt to locate").click());
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.records.get("book-1")).toEqual([detached]);
  });

  it("recolors a panel highlight through shared annotation state without losing its note", async () => {
    const existing = {
      ...highlight("panel-recolor", {
        color: "blue",
        note: "Keep this attached note",
      }),
      futureMetadata: { source: "preserved" },
    } as HighlightAnnotation;
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);

    act(() => button("Annotations").click());
    const trigger = await waitForElement<HTMLButtonElement>(
      'button[aria-label="Actions for Highlight"]',
    );
    act(() => trigger.click());
    act(() => button("Recolor highlight").click());
    await act(async () => button("Green").click());

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (viewerControl.props?.highlights[0]?.color === "green") break;
      await flush();
    }

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      color: "green",
    });
    const updated = viewerControl.props?.highlights[0];
    expect(updated).toEqual({
      ...existing,
      color: "green",
      updatedAt: nextTimestamp,
    });
    expect(harness.listAnnotations).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('aside[aria-label="Annotations"]')).toBeInstanceOf(HTMLElement);
    expect(container?.querySelector('[aria-label="green highlight"]')).toBeInstanceOf(HTMLElement);
    expect(container?.textContent).toContain("Keep this attached note");
    expect(document.activeElement).toBe(trigger);
  });

  it("replaces the annotation browser with its note subview and restores panel state and row focus", async () => {
    const existing = highlight("surface-state", { note: "Existing note" });
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    await renderReader(harness);

    act(() => button("Annotations").click());
    const search = await waitForElement<HTMLInputElement>(
      'aside[aria-label="Annotations"] input[type="search"]',
    );
    const panel = search.closest<HTMLElement>('aside[aria-label="Annotations"]')!;
    const panelBody = panel.querySelector<HTMLElement>(".reader-annotations__body")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "Passage");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      panelBody.scrollTop = 72;
      button("Actions for Highlight").click();
    });
    act(() => button("Edit note").click());

    const editor = await waitForEditor();
    expect(panel.hidden).toBe(true);
    expect(editor.classList.contains("reader-annotations")).toBe(true);
    expect(container?.querySelectorAll("#reader-annotations")).toHaveLength(1);

    setTextareaValue(editor, "Updated while preserving state");
    act(() => {
      button("Table of contents").click();
      button("Back to annotations").click();
    });
    await flush();
    expect(container?.querySelector(".reader-note-editor")).toBe(editor);
    await act(async () =>
      pendingSave.resolve({ ...existing, note: "Updated while preserving state" }),
    );
    await waitForEditorToClose();

    expect(panel.hidden).toBe(false);
    expect(search.value).toBe("Passage");
    expect(panelBody.scrollTop).toBe(72);
    expect(document.activeElement).toBe(button("Actions for Highlight"));
    expect(container?.querySelector('aside[aria-label="Table of contents"]')).toBeNull();
  });

  it("settles the note before switching to another reader side surface", async () => {
    const existing = highlight("surface-settle");
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Settled before TOC");

    act(() => button("Table of contents").click());
    await waitForEditorToClose();
    const toc = await waitForElement<HTMLElement>('aside[aria-label="Table of contents"]');

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      note: "Settled before TOC",
    });
    expect(toc).toBeInstanceOf(HTMLElement);
    expect(container?.querySelector('aside[aria-label="Annotations"]')).toBeNull();
    expect(container?.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
  });

  it("lets editor Escape supersede a pending settings transition", async () => {
    const existing = highlight("surface-escape-latest", { note: "Original" });
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Escape wins");

    act(() => {
      button("Reader settings").click();
      textarea(editor).dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });
    await act(async () => pendingSave.resolve({ ...existing, note: "Escape wins" }));
    await waitForEditorToClose();
    await waitForElement('aside[aria-label="Annotations"]');

    expect(container?.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
  });

  it("keeps a failed note settlement active instead of destroying it for another surface", async () => {
    const existing = highlight("surface-failure");
    const harness = createStorageHarness({ "book-1": [existing] });
    harness.updateAnnotation.mockRejectedValueOnce(new Error("disk unavailable"));
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Cannot settle yet");

    act(() => button("Reader settings").click());
    await flush();

    expect(container?.querySelector(".reader-note-editor")).toBe(editor);
    expect(editor.querySelector('[role="status"]')?.textContent).toContain("Not saved");
    expect(container?.querySelector('aside[aria-label="Reader settings"]')).toBeNull();

    act(() => button("Back to annotations").click());
    await waitForEditorToClose();
    await waitForElement('aside[aria-label="Annotations"]');
    expect(container?.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
  });

  it("applies only the latest side-surface request while note settlement is pending", async () => {
    const existing = highlight("surface-latest");
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Settle once");

    act(() => {
      button("Table of contents").click();
      button("Reader settings").click();
    });
    await act(async () => pendingSave.resolve({ ...existing, note: "Settle once" }));
    await waitForEditorToClose();
    await waitForElement('aside[aria-label="Reader settings"]');

    expect(container?.querySelector('aside[aria-label="Table of contents"]')).toBeNull();
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("settles the active note before leaving the reader", async () => {
    const existing = highlight("reader-exit");
    const harness = createStorageHarness({ "book-1": [existing] });
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Saved before reader exit");

    act(() => button("Back to Library").click());
    for (let attempt = 0; attempt < 30 && router.state.location.pathname !== "/"; attempt += 1) {
      await flush();
    }

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      note: "Saved before reader exit",
    });
    expect(router.state.location.pathname).toBe("/");
    expect(container?.querySelector('[data-testid="library-route"]')).toBeInstanceOf(HTMLElement);
  });

  it("deduplicates repeated controlled returns while the route blocker settles", async () => {
    const existing = highlight("reader-exit-dedup");
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness);
    const navigate = vi.spyOn(router, "navigate");
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Save once");

    act(() => {
      button("Back to Library").click();
      button("Back to Library").click();
    });
    await flush();

    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);

    await act(async () => pendingSave.resolve({ ...existing, note: "Save once" }));
    await waitForRoute(router, "/");

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("keeps the first controlled destination when return and next-volume intents compete", async () => {
    const existing = highlight("reader-exit-first");
    const harness = createStorageHarness({ "book-1": [existing], "book-2": [] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    seriesControl.nextVolume = books["book-2"];
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "First destination wins");

    act(() => {
      button("Back to Library").click();
      button("Open next volume").click();
    });
    await flush();
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => pendingSave.resolve({ ...existing, note: "First destination wins" }));
    await waitForRoute(router, "/");
    expect(harness.storage.loadBookFile).not.toHaveBeenCalledWith("book-2");
  });

  it("keeps next volume when it owns a competing return first", async () => {
    const existing = highlight("next-volume-first");
    const harness = createStorageHarness({ "book-1": [existing], "book-2": [] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    seriesControl.nextVolume = books["book-2"];
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Next wins");

    act(() => {
      button("Open next volume").click();
      button("Back to Library").click();
    });
    await flush();

    await act(async () => pendingSave.resolve({ ...existing, note: "Next wins" }));
    await waitForRoute(router, "/reader/book-2");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("lets a later settings intent invalidate a blocked controlled return", async () => {
    const existing = highlight("reader-exit-settings");
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Settings wins");

    act(() => button("Back to Library").click());
    await flush();
    act(() => button("Reader settings").click());

    await act(async () => pendingSave.resolve({ ...existing, note: "Settings wins" }));
    await waitForEditorToClose();
    await waitForElement('aside[aria-label="Reader settings"]');

    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("lets a later chapter transition invalidate a blocked controlled return", async () => {
    const existing = highlight("reader-exit-chapter");
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness);
    act(() => button("Table of contents").click());
    await waitForElement('aside[aria-label="Table of contents"]');
    const navigateToChapter = tocControl.onNavigate;
    expect(navigateToChapter).toBeTypeOf("function");

    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Chapter wins");
    act(() => button("Back to Library").click());
    await flush();

    let chapterNavigation!: Promise<boolean>;
    act(() => {
      chapterNavigation = navigateToChapter!("chapter");
    });
    await act(async () => pendingSave.resolve({ ...existing, note: "Chapter wins" }));
    await expect(chapterNavigation).resolves.toBe(true);

    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(viewerControl.navigateToChapter).toHaveBeenCalledExactlyOnceWith("chapter");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("lets a later direct book route replace a blocked controlled return", async () => {
    const first = highlight("reader-exit-direct");
    const second = highlight("reader-direct-target");
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    setTextareaValue(editor, "Direct route wins");

    act(() => button("Back to Library").click());
    await flush();
    const directNavigation = requestNavigation(router, "/reader/book-2");
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");

    await act(async () => pendingSave.resolve({ ...first, note: "Direct route wins" }));
    await act(async () => directNavigation);
    await waitForRoute(router, "/reader/book-2");
    await waitForHighlights([second.id]);

    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
    expect(harness.storage.loadBookFile).toHaveBeenCalledWith("book-2");
  });

  it("releases a failed controlled return so the user can retry", async () => {
    const existing = highlight("reader-exit-retry");
    const harness = createStorageHarness({ "book-1": [existing] });
    harness.updateAnnotation.mockRejectedValueOnce(new Error("disk unavailable"));
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    setTextareaValue(editor, "Retry exit");

    act(() => button("Back to Library").click());
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(container?.querySelector(".reader-note-editor")).toBe(editor);

    act(() => button("Back to Library").click());
    await waitForRoute(router, "/");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(2);
  });

  it("keeps a controlled return owned while confirmed note deletion is pending", async () => {
    const existing = highlight("reader-exit-delete", { note: "Delete before leaving" });
    const harness = createStorageHarness({ "book-1": [existing] });
    const pendingDelete = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingDelete.promise);
    const router = await renderReader(harness);
    await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );
    act(() => button("Delete note").click());
    act(() => button("Delete").click());
    await flush();

    act(() => {
      button("Back to Library").click();
      button("Back to Library").click();
    });
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => pendingDelete.resolve({ ...existing, note: undefined }));
    await waitForRoute(router, "/");
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("keeps TOC, settings, and annotation surfaces mutually exclusive", async () => {
    const harness = createStorageHarness();
    await renderReader(harness);
    const reader = container?.querySelector<HTMLElement>(".reader-page");
    const viewer = container?.querySelector<HTMLElement>('[data-testid="epub-viewer-mock"]');
    if (!reader || !viewer) throw new Error("Reader and viewer must be mounted");
    const readerBounds = new DOMRect(0, 0, 1200, 800);
    const viewerBounds = new DOMRect(0, 54, 1200, 746);
    reader.getBoundingClientRect = () => readerBounds;
    viewer.getBoundingClientRect = () => viewerBounds;

    const expectStableReader = () => {
      expect(container?.querySelector(".reader-page")).toBe(reader);
      expect(container?.querySelector('[data-testid="epub-viewer-mock"]')).toBe(viewer);
      expect(reader.getBoundingClientRect()).toEqual(readerBounds);
      expect(viewer.getBoundingClientRect()).toEqual(viewerBounds);
      expect(container?.querySelectorAll(".reader-side-panel")).toHaveLength(1);
      expect(container?.querySelector(".reader-side-panel__header")).not.toBeNull();
    };

    act(() => button("Reader settings").click());
    await waitForElement('aside[aria-label="Reader settings"]');
    expectStableReader();

    act(() => button("Annotations").click());
    await waitForElement('aside[aria-label="Annotations"]');
    expect(container?.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
    expectStableReader();

    act(() => button("Table of contents").click());
    await waitForElement('aside[aria-label="Table of contents"]');
    expect(container?.querySelector('aside[aria-label="Annotations"]')).toBeNull();
    expectStableReader();
  });

  it("backs out of the note subview before closing the annotation surface on Escape", async () => {
    const consoleError = vi.spyOn(console, "error");
    const existing = highlight("escape-order", { note: "Keep this" });
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);
    await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );

    const hostControl = button("Annotations");
    act(() => {
      hostControl.focus();
      hostControl.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });
    await waitForEditorToClose();
    const panel = await waitForElement<HTMLElement>('aside[aria-label="Annotations"]');
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(
      panel.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]'),
    );

    act(() => {
      panel.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });
    await flush();
    expect(container?.querySelector('aside[aria-label="Annotations"]')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("creates a default highlight before opening a fresh empty note and keeps it on close", async () => {
    const harness = createStorageHarness();
    await renderReader(harness);
    const selection = {
      cfiRange: "epubcfi(/6/4!/4/2,/1:4,/1:18)",
      chapterHref: "Text/chapter-2.xhtml",
      selectedText: "A fresh selection",
    };

    const editor = await openNote(selection);

    expect(viewerControl.paletteOpen).toBe(false);
    expect(harness.createAnnotation).toHaveBeenCalledWith("book-1", {
      type: "highlight",
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
      selectedText: selection.selectedText,
      color: "yellow",
    });
    expect(viewerControl.props?.highlights).toEqual([
      expect.objectContaining({
        id: "created-1",
        type: "highlight",
        cfiRange: selection.cfiRange,
        chapterHref: selection.chapterHref,
        selectedText: selection.selectedText,
        color: "yellow",
      }),
    ]);
    expect(editor.textContent).toContain("Closing without a note keeps the highlight.");

    await closeEditor();

    expect(harness.deleteAnnotation).not.toHaveBeenCalled();
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(harness.createAnnotation).toHaveBeenCalledTimes(1);
    expect(viewerControl.props?.highlights).toHaveLength(1);
  });

  it("saves a note onto the same existing highlight without changing its rendered anchor", async () => {
    const existing = highlight("existing-save", { color: "blue" });
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );

    setTextareaValue(editor, "Attached thought");
    await closeEditor();

    expect(harness.createAnnotation).not.toHaveBeenCalled();
    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", existing.id, {
      note: "Attached thought",
    });
    expect(viewerControl.props?.highlights).toEqual([
      expect.objectContaining({
        id: existing.id,
        cfiRange: existing.cfiRange,
        color: "blue",
        note: "Attached thought",
      }),
    ]);
  });

  it("requires explicit deletion, retries failure, and preserves the highlight record", async () => {
    const existing = {
      ...highlight("existing-delete", {
        chapterHref: "Text/notes.xhtml",
        color: "green",
        note: "Original note",
      }),
      futureMetadata: { source: "future-version" },
    } as HighlightAnnotation & { futureMetadata: { source: string } };
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);
    let editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      existing,
    );

    setTextareaValue(editor, "");
    await closeEditor();
    expect(harness.updateAnnotation).not.toHaveBeenCalled();
    expect(viewerControl.props?.highlights[0]?.note).toBe("Original note");

    editor = await openNote(
      {
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
        selectedText: existing.selectedText,
      },
      viewerControl.props?.highlights[0],
    );
    harness.updateAnnotation.mockRejectedValueOnce(new Error("disk unavailable"));
    await confirmDeleteNote();

    expect(container?.querySelector(".reader-note-editor")).toBe(editor);
    expect(editor.querySelector("[role=status]")?.textContent).toContain(
      "Note could not be deleted.",
    );
    expect(viewerControl.props?.highlights[0]?.note).toBe("Original note");

    await act(async () => {
      button("Delete").click();
      await Promise.resolve();
    });
    await waitForEditorToClose();

    expect(harness.updateAnnotation).toHaveBeenLastCalledWith("book-1", existing.id, {
      note: undefined,
    });
    const remaining = viewerControl.props?.highlights[0] as typeof existing;
    expect(remaining).toMatchObject({
      id: existing.id,
      cfiRange: existing.cfiRange,
      selectedText: existing.selectedText,
      color: existing.color,
      chapterHref: existing.chapterHref,
      createdAt: existing.createdAt,
      updatedAt: nextTimestamp,
      futureMetadata: existing.futureMetadata,
    });
    expect(remaining).not.toHaveProperty("note");
    expect(harness.createAnnotation).not.toHaveBeenCalled();
  });

  it("removes a complete noted highlight and restores its exact snapshot with Undo", async () => {
    const existing = {
      ...highlight("remove-undo", { note: "Restore this note", color: "yellow" }),
      futureMetadata: { nested: ["keep"] },
    } as HighlightAnnotation & { futureMetadata: { nested: string[] } };
    const harness = createStorageHarness({ "book-1": [existing] });
    await renderReader(harness);

    let removed = false;
    await act(async () => {
      removed = (await viewerControl.props?.onRemoveHighlight?.(existing.id)) ?? false;
    });

    expect(removed).toBe(true);
    expect(harness.deleteAnnotation).toHaveBeenCalledWith("book-1", existing.id);
    expect(viewerControl.props?.highlights).toEqual([]);
    expect(container?.querySelector(".reader-annotation-feedback")?.textContent).toContain(
      "Highlight and attached note removed.",
    );

    await act(async () => button("Undo").click());
    await waitForHighlights([existing.id]);

    expect(harness.restoreAnnotation).toHaveBeenCalledWith("book-1", existing);
    expect(viewerControl.props?.highlights[0]).toEqual(existing);
    expect(harness.createAnnotation).not.toHaveBeenCalled();
  });

  it("leaves a highlight and its note unchanged when complete removal fails", async () => {
    const existing = highlight("remove-failure", { note: "Still attached" });
    const harness = createStorageHarness({ "book-1": [existing] });
    harness.deleteAnnotation.mockRejectedValueOnce(new Error("disk unavailable"));
    await renderReader(harness);

    let removed = true;
    await act(async () => {
      removed = (await viewerControl.props?.onRemoveHighlight?.(existing.id)) ?? true;
    });

    expect(removed).toBe(false);
    expect(viewerControl.props?.highlights).toEqual([existing]);
    expect(container?.querySelector(".reader-annotation-feedback")?.textContent).toContain(
      "Highlight could not be removed.",
    );
    expect(harness.restoreAnnotation).not.toHaveBeenCalled();
    expect(harness.createAnnotation).not.toHaveBeenCalled();
  });

  it("blocks direct book navigation until the active note settles without duplicate writes", async () => {
    const first = highlight("book-1-save");
    const second = highlight("book-2-save", { note: "Second book note" });
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    setTextareaValue(editor, "Late note");

    const firstNavigation = requestNavigation(router, "/reader/book-2");
    const repeatedNavigation = requestNavigation(router, "/reader/book-2");
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(container?.querySelector(".reader-note-editor")).toBe(editor);
    expect(viewerControl.props?.highlights).toEqual([first]);
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => pendingSave.resolve({ ...first, note: "Late note" }));
    await act(async () => Promise.all([firstNavigation, repeatedNavigation]));
    await waitForRoute(router, "/reader/book-2");
    await waitForHighlights([second.id]);

    expect(viewerControl.props?.highlights).toEqual([second]);
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
  });

  it("cancels a failed book switch and succeeds once after a retry", async () => {
    const first = highlight("book-1-retry");
    const second = highlight("book-2-retry");
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    harness.updateAnnotation.mockRejectedValueOnce(new Error("disk unavailable"));
    const router = await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    setTextareaValue(editor, "Retry this draft");

    await act(async () => requestNavigation(router, "/reader/book-2"));
    await flush();

    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(container?.querySelector(".reader-note-editor")).toBe(editor);
    expect(textarea(editor).value).toBe("Retry this draft");
    expect(editor.querySelector('[role="status"]')?.textContent).toContain("Not saved");

    await act(async () => requestNavigation(router, "/reader/book-2"));
    await waitForRoute(router, "/reader/book-2");
    await waitForHighlights([second.id]);

    expect(harness.updateAnnotation).toHaveBeenCalledTimes(2);
    expect(harness.storage.loadBookFile).toHaveBeenCalledWith("book-2");
  });

  it("awaits a pending confirmed note deletion before book navigation", async () => {
    const first = highlight("book-1-delete", { note: "Delete later" });
    const second = highlight("book-2-delete", { note: "Keep open" });
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    const pendingDelete = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingDelete.promise);
    const router = await renderReader(harness);
    await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    act(() => button("Delete note").click());
    act(() => button("Delete").click());
    await flush();

    const navigation = requestNavigation(router, "/reader/book-2");
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");
    expect(container?.querySelector(".reader-note-editor")).toBeInstanceOf(HTMLElement);

    await act(async () => pendingDelete.resolve({ ...first, note: undefined }));
    await act(async () => navigation);
    await waitForRoute(router, "/reader/book-2");
    await waitForHighlights([second.id]);

    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", first.id, {
      note: undefined,
    });
    expect(viewerControl.props?.highlights).toEqual([second]);
  });

  it("guards browser-history navigation while an active note is unsettled", async () => {
    const first = highlight("history-save");
    const harness = createStorageHarness({ "book-1": [first] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    const router = await renderReader(harness, "book-1", ["/", "/reader/book-1"]);
    const editor = await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    setTextareaValue(editor, "Save before history Back");

    const navigation = requestNavigation(router, -1);
    await flush();
    expect(router.state.location.pathname).toBe("/reader/book-1");

    await act(async () => pendingSave.resolve({ ...first, note: "Save before history Back" }));
    await act(async () => navigation);
    await waitForRoute(router, "/");

    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="library-route"]')).toBeInstanceOf(HTMLElement);
  });

  it("registers an archive guard that settles against the current book and unregisters on unmount", async () => {
    const first = highlight("archive-guard");
    const harness = createStorageHarness({ "book-1": [first] });
    const pendingSave = deferred<Annotation | undefined>();
    harness.updateAnnotation.mockImplementationOnce(() => pendingSave.promise);
    let registeredGuard: ArchiveTransitionGuard | undefined;
    const unregister = vi.fn();
    vi.spyOn(archiveStore, "registerTransitionGuard").mockImplementation((guard) => {
      registeredGuard = guard;
      return unregister;
    });
    await renderReader(harness);
    const editor = await openNote(
      {
        cfiRange: first.cfiRange,
        chapterHref: first.chapterHref,
        selectedText: first.selectedText,
      },
      first,
    );
    setTextareaValue(editor, "Old archive save");

    let settlement: Promise<boolean>;
    act(() => {
      settlement = Promise.resolve(registeredGuard?.() ?? false);
    });
    await flush();
    expect(harness.updateAnnotation).toHaveBeenCalledWith("book-1", first.id, {
      note: "Old archive save",
    });

    let settled = false;
    await act(async () => {
      pendingSave.resolve({ ...first, note: "Old archive save" });
      settled = await settlement;
    });
    expect(settled).toBe(true);
    act(() => root?.unmount());
    root = null;

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("suppresses stale removal feedback after an annotation-session switch", async () => {
    const first = highlight("book-1-removal", { note: "First note" });
    const second = highlight("book-2-removal", { note: "Second note" });
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    const pendingRemoval = deferred<boolean>();
    harness.deleteAnnotation.mockImplementationOnce(async (bookId, annotationId) => {
      const removed = await pendingRemoval.promise;
      if (removed) {
        harness.records.set(
          bookId,
          (harness.records.get(bookId) ?? []).filter(
            (annotation) => annotation.id !== annotationId,
          ),
        );
      }
      return removed;
    });
    const router = await renderReader(harness);
    let removal: Promise<boolean> | undefined;
    act(() => {
      removal = viewerControl.props?.onRemoveHighlight?.(first.id);
    });

    await switchBook(router, "book-2", [second.id]);
    await act(async () => pendingRemoval.resolve(true));
    await act(async () => removal);
    expect(container?.querySelector(".reader-annotation-feedback")).toBeNull();
    expect(viewerControl.props?.highlights).toEqual([second]);
    expect(harness.records.get("book-1")).toEqual([]);
  });

  it("suppresses stale undo feedback after an annotation-session switch", async () => {
    const first = highlight("book-1-undo", { note: "First note" });
    const second = highlight("book-2-undo", { note: "Second note" });
    const harness = createStorageHarness({ "book-1": [first], "book-2": [second] });
    const router = await renderReader(harness);
    await act(async () => viewerControl.props?.onRemoveHighlight?.(first.id));
    const pendingUndo = deferred<Annotation>();
    harness.restoreAnnotation.mockImplementationOnce(async (bookId) => {
      const restored = await pendingUndo.promise;
      harness.records.set(bookId, [structuredClone(restored)]);
      return restored;
    });
    act(() => button("Undo").click());
    await flush();

    await switchBook(router, "book-2", [second.id]);
    await act(async () => pendingUndo.resolve(first));
    await flush();

    expect(container?.querySelector(".reader-annotation-feedback")).toBeNull();
    expect(viewerControl.props?.highlights).toEqual([second]);
  });
});
