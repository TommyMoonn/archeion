// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { Book } from "../../types/book";
import { ReaderRoute } from "./ReaderPage";

type TextSelection = {
  cfiRange: string;
  chapterHref?: string;
  selectedText: string;
};

type MockViewerProps = {
  fileBlob: Blob;
  highlights: readonly HighlightAnnotation[];
  onNavigationChange?: (navigation: {
    chapters: Array<{ depth: number; href: string; id: string; label: string }>;
    currentChapterId: string;
    status: "ready";
  }) => void;
  onOpenNote?: (selection: TextSelection, existingHighlight?: HighlightAnnotation) => void;
  onReady: () => void;
  onRemoveHighlight?: (annotationId: string) => Promise<boolean>;
};

const viewerControl = vi.hoisted(() => ({
  paletteOpen: false,
  props: null as MockViewerProps | null,
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
        navigateToChapter: vi.fn(async () => true),
        navigateToLocation: vi.fn(async () => true),
        next: vi.fn(async () => undefined),
        previous: vi.fn(async () => undefined),
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

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({
    status: "ready",
    archive: { id: "archive-books" },
  }),
}));

vi.mock("../quick-actions/QuickActionsContext", () => ({
  useQuickActions: () => ({ openPalette: vi.fn() }),
  useRegisterQuickActions: () => undefined,
}));

vi.mock("./useReaderSeriesContinuation", () => ({
  useReaderSeriesContinuation: () => undefined,
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
    updateAnnotation,
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

async function renderReader(harness: StorageHarness, initialBookId = "book-1") {
  const router = createMemoryRouter(
    [
      {
        HydrateFallback: () => null,
        path: "/reader/:bookId",
        element: <ReaderRoute />,
        loader: ({ params }) => books[params.bookId ?? ""],
      },
    ],
    { initialEntries: [`/reader/${initialBookId}`] },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={harness.storage}>
        <RouterProvider router={router} />
      </LibraryStorageContext.Provider>,
    );
  });
  await waitForHighlights((harness.records.get(initialBookId) ?? []).map(({ id }) => id));
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
    button("Close note").click();
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

beforeEach(() => {
  viewerControl.paletteOpen = false;
  viewerControl.props = null;
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
      "Highlight removed.",
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

  it("does not synchronize a late note save into a newly opened book", async () => {
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
    act(() => button("Close note").click());
    await flush();
    expect(harness.updateAnnotation).toHaveBeenCalledTimes(1);

    await switchBook(router, "book-2", [second.id]);
    await act(async () => pendingSave.resolve({ ...first, note: "Late note" }));
    await flush();

    expect(viewerControl.props?.highlights).toEqual([second]);
    expect(container?.querySelector(".reader-annotation-feedback")).toBeNull();
  });

  it("does not let a late deletion close or alter the new book's note editor", async () => {
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

    await switchBook(router, "book-2", [second.id]);
    const secondEditor = await openNote(
      {
        cfiRange: second.cfiRange,
        chapterHref: second.chapterHref,
        selectedText: second.selectedText,
      },
      second,
    );
    await act(async () => pendingDelete.resolve({ ...first, note: undefined }));
    await flush();

    expect(container?.querySelector(".reader-note-editor")).toBe(secondEditor);
    expect(textarea(secondEditor).value).toBe("Keep open");
    expect(viewerControl.props?.highlights).toEqual([second]);
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
