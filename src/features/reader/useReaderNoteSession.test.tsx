// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderTextSelection } from "./EpubViewer";
import { ReaderNoteEditor, type ReaderNoteEditorHandle } from "./ReaderNoteEditor";
import { useReaderNoteSession, type ReaderNoteTarget } from "./useReaderNoteSession";

type NoteSessionApi = ReturnType<typeof useReaderNoteSession>;

function highlight(id: string, changes: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    cfiRange: `epubcfi(/6/2!/4/2,/1:1,/1:${id.length + 4})`,
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: `Quote ${id}`,
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...changes,
  };
}

function selection(id: string): ReaderTextSelection {
  return {
    cfiRange: `epubcfi(/6/2!/4/2,/1:1,/1:${id.length + 4})`,
    chapterHref: "chapter.xhtml",
    selectedText: `Quote ${id}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

type HarnessProps = {
  apiRef: MutableRefObject<NoteSessionApi | undefined>;
  archiveId: string;
  bookId: string;
  editor: ReaderNoteEditorHandle;
  ensureHighlight: (selection: ReaderTextSelection) => Promise<HighlightAnnotation | undefined>;
  storage: LibraryStorage;
  syncAnnotation: (annotation: Annotation) => void;
  targetRef: MutableRefObject<ReaderNoteTarget | null>;
};

function Harness({
  apiRef,
  archiveId,
  bookId,
  editor,
  ensureHighlight,
  storage,
  syncAnnotation,
  targetRef,
}: HarnessProps) {
  const [targetState, setTargetState] = useState<{
    sessionKey: string;
    target: ReaderNoteTarget;
  } | null>(null);
  const sessionKey = `${archiveId}:${bookId}`;
  const visibleTarget = targetState?.sessionKey === sessionKey ? targetState.target : null;
  const visibleTargetRef = useRef(visibleTarget);

  const session = useReaderNoteSession({
    archiveId,
    bookId,
    ensureHighlight,
    storage,
    syncAnnotation,
  });

  useLayoutEffect(() => {
    visibleTargetRef.current = visibleTarget;
    targetRef.current = visibleTarget;
    session.editorHandleRef(editor);
    const disconnect = session.connectSurface({
      getTarget: () => visibleTargetRef.current,
      showTarget: (target) => {
        visibleTargetRef.current = target;
        targetRef.current = target;
        setTargetState({ sessionKey, target });
      },
      updateTarget: (target) => {
        visibleTargetRef.current = target;
        targetRef.current = target;
        setTargetState({ sessionKey, target });
      },
    });
    return () => {
      disconnect();
      session.editorHandleRef(null);
    };
  }, [editor, session, sessionKey, targetRef, visibleTarget]);

  useLayoutEffect(() => {
    apiRef.current = session;
  }, [apiRef, session]);

  return <span data-testid="target">{visibleTarget?.annotation.id}</span>;
}

type IntegratedHarnessProps = Omit<HarnessProps, "editor" | "targetRef"> & {
  onTargetUpdate?: (target: ReaderNoteTarget) => void;
};

function IntegratedHarness({
  apiRef,
  archiveId,
  bookId,
  ensureHighlight,
  onTargetUpdate,
  storage,
  syncAnnotation,
}: IntegratedHarnessProps) {
  const [target, setTarget] = useState<ReaderNoteTarget | null>(null);
  const targetRef = useRef(target);
  const session = useReaderNoteSession({
    archiveId,
    bookId,
    ensureHighlight,
    storage,
    syncAnnotation,
  });
  const { connectSurface, deleteNote, editorHandleRef, saveNote } = session;

  useLayoutEffect(() => {
    targetRef.current = target;
    return connectSurface({
      getTarget: () => targetRef.current,
      showTarget: (nextTarget) => {
        targetRef.current = nextTarget;
        setTarget(nextTarget);
      },
      updateTarget: (nextTarget) => {
        onTargetUpdate?.(nextTarget);
        targetRef.current = nextTarget;
        setTarget(nextTarget);
      },
    });
  }, [connectSurface, onTargetUpdate, target]);

  useLayoutEffect(() => {
    apiRef.current = session;
  }, [apiRef, session]);

  return target ? (
    <ReaderNoteEditor
      annotation={target.annotation}
      keepsHighlightOnEmptyClose={target.keepsHighlightOnEmptyClose}
      key={target.editorKey}
      onBack={() => setTarget(null)}
      onDelete={(persistedAnnotation) => deleteNote(target, persistedAnnotation)}
      onSave={(note, persistedAnnotation) => saveNote(target, note, persistedAnnotation)}
      ref={editorHandleRef}
    />
  ) : null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(props: HarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

async function renderIntegratedHarness(props: IntegratedHarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<IntegratedHarness {...props} />);
  });
}

async function unmountHarness() {
  const mountedRoot = root;
  root = null;
  await act(async () => mountedRoot?.unmount());
}

function setDraft(value: string) {
  const field = container?.querySelector<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("Expected a note textarea.");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function storageWithUpdate(
  updateHighlightAnnotation: LibraryStorage["updateHighlightAnnotation"],
): LibraryStorage {
  return { updateHighlightAnnotation } as LibraryStorage;
}

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

describe("useReaderNoteSession", () => {
  it("creates a highlight before opening a fresh note target and keeps the target highlight-owned", async () => {
    const created = highlight("created");
    const ensureHighlight = vi.fn(async () => created);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight,
      storage: storageWithUpdate(vi.fn()),
      syncAnnotation: vi.fn(),
      targetRef,
    });

    await act(async () => {
      apiRef.current?.openSelectionNote(selection("created"));
    });

    expect(ensureHighlight).toHaveBeenCalledWith(selection("created"));
    expect(targetRef.current?.annotation).toBe(created);
    expect(targetRef.current?.keepsHighlightOnEmptyClose).toBe(true);
    expect(targetRef.current?.targetIdentity).toBe("annotation:created");
  });

  it("opens an existing highlight without creating another annotation", async () => {
    const existing = highlight("existing", { color: "rose", note: "Existing note" });
    const ensureHighlight = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight,
      storage: storageWithUpdate(vi.fn()),
      syncAnnotation: vi.fn(),
      targetRef,
    });

    let opened = false;
    await act(async () => {
      opened = (await apiRef.current?.openAnnotationNote(existing)) ?? false;
    });

    expect(opened).toBe(true);
    expect(ensureHighlight).not.toHaveBeenCalled();
    expect(targetRef.current?.annotation).toBe(existing);
    expect(targetRef.current?.keepsHighlightOnEmptyClose).toBe(false);
  });

  it("saves and deletes through the latest persisted highlight snapshot", async () => {
    const original = highlight("note", { note: "Old" });
    const latest = { ...original, color: "blue", updatedAt: "2026-07-14T01:00:00.000Z" };
    const saved = {
      ...latest,
      note: "  New note\r\nline  ",
      updatedAt: "2026-07-14T02:00:00.000Z",
    };
    const deleted = { ...saved, note: undefined, updatedAt: "2026-07-14T03:00:00.000Z" };
    const update = vi.fn().mockResolvedValueOnce(saved).mockResolvedValueOnce(deleted);
    const syncAnnotation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation,
      targetRef,
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    const target = targetRef.current!;

    await act(async () => {
      await apiRef.current?.saveNote(target, "  New note\r\nline  ", latest);
    });
    expect(update).toHaveBeenNthCalledWith(1, "book-a", latest.id, {
      note: "  New note\r\nline  ",
    });
    expect(targetRef.current?.annotation).toBe(saved);
    expect(syncAnnotation).toHaveBeenCalledWith(saved);

    await act(async () => {
      expect(await apiRef.current?.deleteNote(targetRef.current!, saved)).toBe(true);
    });
    expect(update).toHaveBeenNthCalledWith(2, "book-a", saved.id, { note: undefined });
    expect(syncAnnotation).toHaveBeenLastCalledWith(deleted);
  });

  it("invalidates a pending open when the book or archive session changes", async () => {
    const pending = deferred<HighlightAnnotation | undefined>();
    const ensureHighlight = vi.fn(() => pending.promise);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const common = {
      apiRef,
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight,
      storage: storageWithUpdate(vi.fn()),
      syncAnnotation: vi.fn(),
      targetRef,
    };
    await renderHarness({ ...common, archiveId: "archive-a", bookId: "book-a" });
    await act(async () => apiRef.current?.openSelectionNote(selection("stale")));

    await renderHarness({ ...common, archiveId: "archive-b", bookId: "book-b" });
    await act(async () => pending.resolve(highlight("stale")));

    expect(targetRef.current).toBeNull();
  });

  it("rejects stale save and delete completions from another editor or session", async () => {
    const original = highlight("original", { note: "Old" });
    const other = highlight("other", { note: "Other" });
    const pendingSave = deferred<HighlightAnnotation | undefined>();
    const pendingDelete = deferred<HighlightAnnotation | undefined>();
    const update = vi
      .fn()
      .mockImplementationOnce(() => pendingSave.promise)
      .mockImplementationOnce(() => pendingDelete.promise);
    const syncAnnotation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const common = {
      apiRef,
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation,
      targetRef,
    };
    await renderHarness({ ...common, archiveId: "archive-a", bookId: "book-a" });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    const staleTarget = targetRef.current!;
    let saveResult: HighlightAnnotation | undefined;
    await act(async () => {
      const promise = apiRef.current?.saveNote(staleTarget, "New", original);
      await apiRef.current?.openAnnotationNote(other);
      pendingSave.resolve({ ...original, note: "New" });
      saveResult = await promise;
    });
    expect(saveResult).toBeUndefined();
    expect(syncAnnotation).not.toHaveBeenCalled();
    expect(targetRef.current?.annotation.id).toBe("other");

    const activeTarget = targetRef.current!;
    let deleteResult = true;
    let deletePromise: Promise<boolean> | undefined;
    await act(async () => {
      deletePromise = apiRef.current?.deleteNote(activeTarget, other);
    });
    await renderHarness({ ...common, archiveId: "archive-b", bookId: "book-b" });
    await act(async () => {
      pendingDelete.resolve({ ...other, note: undefined });
      deleteResult = (await deletePromise) ?? true;
    });
    expect(deleteResult).toBe(false);
    expect(syncAnnotation).not.toHaveBeenCalled();
    expect(targetRef.current).toBeNull();
  });

  it("persists a dirty draft exactly once when the real editor and note session unmount", async () => {
    const original = highlight("unmount-draft", { note: "Previous note" });
    const draft = "  Final draft\r\nwith exact spacing  ";
    const update = vi.fn(
      async (_bookId: string, _annotationId: string, changes: { note?: string }) => ({
        ...original,
        note: changes.note,
      }),
    );
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    await renderIntegratedHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation: vi.fn(),
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    setDraft(draft);

    await unmountHarness();
    await act(async () => Promise.resolve());

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith("book-a", original.id, { note: draft });
  });

  it("allows teardown durability to finish without publishing after unmount", async () => {
    const original = highlight("deferred-unmount");
    const persisted = deferred<HighlightAnnotation | undefined>();
    const update = vi.fn(() => persisted.promise);
    const syncAnnotation = vi.fn();
    const targetUpdate = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    await renderIntegratedHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      ensureHighlight: vi.fn(),
      onTargetUpdate: targetUpdate,
      storage: storageWithUpdate(update),
      syncAnnotation,
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    targetUpdate.mockClear();
    setDraft("Pending at teardown");

    await unmountHarness();
    expect(update).toHaveBeenCalledOnce();
    await act(async () => {
      persisted.resolve({ ...original, note: "Pending at teardown" });
      await persisted.promise;
    });

    expect(syncAnnotation).not.toHaveBeenCalled();
    expect(targetUpdate).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not duplicate an explicitly settled draft during later unmount", async () => {
    const original = highlight("settled-unmount");
    const update = vi.fn(async () => ({ ...original, note: "Already settled" }));
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    await renderIntegratedHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation: vi.fn(),
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    setDraft("Already settled");

    await act(async () => {
      expect(await apiRef.current?.settle()).toBe(true);
    });
    expect(update).toHaveBeenCalledOnce();
    await unmountHarness();
    await act(async () => Promise.resolve());

    expect(update).toHaveBeenCalledOnce();
  });

  it("does not grant a replaced editor a new persistence write", async () => {
    const first = highlight("replaced-a");
    const second = highlight("replaced-b");
    const update = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation: vi.fn(),
      targetRef,
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(first);
    });
    const staleTarget = targetRef.current!;
    await act(async () => {
      await apiRef.current?.openAnnotationNote(second);
    });

    expect(await apiRef.current?.saveNote(staleTarget, "Stale draft", first)).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(targetRef.current?.annotation.id).toBe(second.id);
  });

  it("rejects an old archive session even when the book ID is unchanged", async () => {
    const original = highlight("archive-session");
    const archiveAUpdate = vi.fn();
    const archiveBUpdate = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const common = {
      apiRef,
      bookId: "book-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight: vi.fn(),
      syncAnnotation: vi.fn(),
      targetRef,
    };
    await renderHarness({
      ...common,
      archiveId: "archive-a",
      storage: storageWithUpdate(archiveAUpdate),
    });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    const staleTarget = targetRef.current!;

    await renderHarness({
      ...common,
      archiveId: "archive-b",
      storage: storageWithUpdate(archiveBUpdate),
    });
    expect(await apiRef.current?.saveNote(staleTarget, "Stale archive", original)).toBeUndefined();
    expect(archiveAUpdate).not.toHaveBeenCalled();
    expect(archiveBUpdate).not.toHaveBeenCalled();
  });

  it("rejects an old book session even when the archive ID is unchanged", async () => {
    const original = highlight("book-session");
    const update = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const common = {
      apiRef,
      archiveId: "archive-a",
      editor: { settle: vi.fn(async () => true) },
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(update),
      syncAnnotation: vi.fn(),
      targetRef,
    };
    await renderHarness({ ...common, bookId: "book-a" });
    await act(async () => {
      await apiRef.current?.openAnnotationNote(original);
    });
    const staleTarget = targetRef.current!;

    await renderHarness({ ...common, bookId: "book-b" });
    expect(await apiRef.current?.saveNote(staleTarget, "Stale book", original)).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("exposes one final settlement path and cancels superseded opens", async () => {
    const settlement = deferred<boolean>();
    const settle = vi.fn(() => settlement.promise);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      archiveId: "archive-a",
      bookId: "book-a",
      editor: { settle },
      ensureHighlight: vi.fn(),
      storage: storageWithUpdate(vi.fn()),
      syncAnnotation: vi.fn(),
      targetRef,
    });

    const first = highlight("first");
    const second = highlight("second");
    let firstResult = true;
    let secondResult = false;
    await act(async () => {
      const firstOpen = apiRef.current?.openAnnotationNote(first);
      const secondOpen = apiRef.current?.openAnnotationNote(second);
      settlement.resolve(true);
      firstResult = (await firstOpen) ?? true;
      secondResult = (await secondOpen) ?? false;
    });

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(true);
    expect(targetRef.current?.annotation.id).toBe("second");
    expect(settle).toHaveBeenCalledTimes(2);
    expect(await apiRef.current?.settle()).toBe(true);
    expect(settle).toHaveBeenCalledTimes(3);
  });
});
