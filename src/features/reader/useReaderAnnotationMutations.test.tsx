// @vitest-environment happy-dom

import {
  act,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  upsertReaderAnnotation,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";
import { useReaderAnnotationMutations } from "./useReaderAnnotationMutations";

type MutationApi = ReturnType<typeof useReaderAnnotationMutations>;
type MutationProjection = {
  bookId: string;
  busy: boolean;
  feedback?: string;
  sessionKey: string;
};

function bookmark(id = "bookmark"): BookmarkAnnotation {
  return {
    cfiRange: "epubcfi(/6/2)",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    label: "Chapter",
    type: "bookmark",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function highlight(id = "highlight"): HighlightAnnotation {
  return {
    cfiRange: "epubcfi(/6/2!/4/2,/1:1,/1:8)",
    color: "rose",
    createdAt: "2026-07-14T00:00:00.000Z",
    futureField: { preserve: true },
    id,
    note: "Attached note",
    selectedText: "Passage",
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
  } as HighlightAnnotation;
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

function Harness({
  activeArchiveId,
  apiRef,
  bookId,
  cancel,
  drain,
  initial,
  projections,
  sessionKey,
  storage,
}: {
  activeArchiveId: string;
  apiRef: MutableRefObject<MutationApi | undefined>;
  bookId: string;
  cancel: (annotationId: string) => void;
  drain: () => void;
  initial: Annotation[];
  projections?: MutationProjection[];
  sessionKey: string;
  storage: LibraryStorage;
}) {
  const session = useMemo<ReaderAnnotationSession>(
    () => ({ archiveId: activeArchiveId, bookId, token: Symbol(`mutation-test-${sessionKey}`) }),
    [activeArchiveId, bookId, sessionKey],
  );
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const [collection, setCollection] = useState({ items: initial, session });
  const cancelRef = useRef(cancel);
  const drainRef = useRef(drain);
  useLayoutEffect(() => {
    sessionRef.current = session;
    cancelRef.current = cancel;
    drainRef.current = drain;
  }, [cancel, drain, session]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const annotations = sameReaderAnnotationSession(collection.session, session)
    ? collection.items
    : initial;
  const mutations = useReaderAnnotationMutations({
    cancelQueuedAnchorUpdateRef: cancelRef,
    drainAnchorMaintenanceRef: drainRef,
    forget: (annotationId) =>
      setCollection((current) => ({
        items: (sameReaderAnnotationSession(current.session, session)
          ? current.items
          : initial
        ).filter(({ id }) => id !== annotationId),
        session,
      })),
    isCurrentSession: (candidate) =>
      mountedRef.current && sameReaderAnnotationSession(sessionRef.current, candidate),
    session,
    storage,
    sync: (annotation) =>
      setCollection((current) => ({
        items: upsertReaderAnnotation(
          sameReaderAnnotationSession(current.session, session) ? current.items : initial,
          annotation,
        ),
        session,
      })),
  });
  projections?.push({
    bookId,
    busy: mutations.busy,
    feedback: mutations.feedback?.message,
    sessionKey,
  });
  useLayoutEffect(() => {
    apiRef.current = mutations;
  }, [apiRef, mutations]);
  return (
    <div>
      <span data-testid="annotations">{JSON.stringify(annotations)}</span>
      <span data-testid="ids">{annotations.map(({ id }) => id).join(",")}</span>
      <span data-testid="busy">{String(mutations.busy)}</span>
      <span data-testid="feedback">{mutations.feedback?.message}</span>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness({
  activeArchiveId = "archive-a",
  apiRef,
  bookId = "book-a",
  cancel = vi.fn(),
  drain = vi.fn(),
  initial,
  projections,
  sessionKey = bookId,
  storage,
}: {
  activeArchiveId?: string;
  apiRef: MutableRefObject<MutationApi | undefined>;
  bookId?: string;
  cancel?: (annotationId: string) => void;
  drain?: () => void;
  initial: Annotation[];
  projections?: MutationProjection[];
  sessionKey?: string;
  storage: LibraryStorage;
}) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Harness
        activeArchiveId={activeArchiveId}
        apiRef={apiRef}
        bookId={bookId}
        cancel={cancel}
        drain={drain}
        initial={initial}
        projections={projections}
        sessionKey={sessionKey}
        storage={storage}
      />,
    );
  });
  return container;
}

function text(testId: string) {
  return container?.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderAnnotationMutations", () => {
  it("publishes one accepted state for create, update, and delete commands", async () => {
    const created = bookmark("command-bookmark");
    const updated = { ...created, label: "Updated chapter" };
    const storage = {
      createAnnotation: vi.fn(async () => created),
      deleteAnnotation: vi.fn(async () => true),
      updateBookmarkAnnotation: vi.fn(async () => updated),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [], storage });

    let createOutcome: Awaited<ReturnType<MutationApi["create"]>> | undefined;
    await act(async () => {
      createOutcome = await apiRef.current?.create({
        cfiRange: created.cfiRange,
        label: created.label,
        type: "bookmark",
      });
    });
    expect(createOutcome).toEqual({ annotation: created, status: "accepted" });
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([created]);

    let updateOutcome: Awaited<ReturnType<MutationApi["update"]>> | undefined;
    await act(async () => {
      updateOutcome = await apiRef.current?.update({
        annotation: created,
        annotationType: "bookmark",
        changes: { label: updated.label },
      });
    });
    expect(updateOutcome).toEqual({ annotation: updated, status: "accepted" });
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([updated]);

    let deleteOutcome: Awaited<ReturnType<MutationApi["delete"]>> | undefined;
    await act(async () => {
      deleteOutcome = await apiRef.current?.delete(updated);
    });
    expect(deleteOutcome).toEqual({ annotation: updated, status: "accepted" });
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([]);
    expect(storage.createAnnotation).toHaveBeenCalledOnce();
    expect(storage.updateBookmarkAnnotation).toHaveBeenCalledOnce();
    expect(storage.deleteAnnotation).toHaveBeenCalledOnce();
  });

  it("keeps the prior accepted state when persistence fails", async () => {
    const original = highlight("accepted-highlight");
    const storage = {
      updateHighlightAnnotation: vi.fn(async () => {
        throw new Error("disk unavailable");
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    let outcome: Awaited<ReturnType<MutationApi["update"]>> | undefined;
    await act(async () => {
      outcome = await apiRef.current?.update({
        annotation: original,
        annotationType: "highlight",
        changes: { color: "blue" },
      });
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([original]);
  });

  it("rejects a competing edit before it can publish out of order", async () => {
    const original = highlight("serialized-highlight");
    const firstResult = { ...original, color: "blue" };
    const firstWrite = deferred<HighlightAnnotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => firstWrite.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    let first!: Promise<Awaited<ReturnType<MutationApi["update"]>>>;
    act(() => {
      first = apiRef.current!.update({
        annotation: original,
        annotationType: "highlight",
        changes: { color: "blue" },
      });
    });
    const competing = await apiRef.current!.update({
      annotation: original,
      annotationType: "highlight",
      changes: { color: "green" },
    });
    expect(competing).toEqual({ status: "rejected" });
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();

    await act(async () => firstWrite.resolve(firstResult));
    await expect(first).resolves.toEqual({ annotation: firstResult, status: "accepted" });
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([firstResult]);
  });

  it("rejects an archive A completion after the same book becomes archive B state", async () => {
    const archiveA = bookmark("archive-a");
    const archiveB = bookmark("archive-b");
    const removal = deferred<boolean>();
    const storage = { deleteAnnotation: vi.fn(() => removal.promise) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      activeArchiveId: "archive-a",
      apiRef,
      initial: [archiveA],
      storage,
    });
    let staleRemoval!: Promise<boolean>;
    act(() => {
      staleRemoval = apiRef.current!.remove(archiveA);
    });
    expect(text("busy")).toBe("true");

    await renderHarness({
      activeArchiveId: "archive-b",
      apiRef,
      initial: [archiveB],
      storage,
    });
    expect(text("ids")).toBe(archiveB.id);
    expect(text("busy")).toBe("false");
    await act(async () => removal.resolve(true));
    await expect(staleRemoval).resolves.toBe(false);
    expect(text("ids")).toBe(archiveB.id);
    expect(text("feedback")).toBe("");
  });

  it("keeps one interactive busy owner until its mutation settles", async () => {
    const original = bookmark();
    const removal = deferred<boolean>();
    const storage = { deleteAnnotation: vi.fn(() => removal.promise) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    let first!: Promise<boolean>;
    act(() => {
      first = apiRef.current!.remove(original);
    });
    expect(text("busy")).toBe("true");
    await expect(apiRef.current!.remove(original)).resolves.toBe(false);
    expect(storage.deleteAnnotation).toHaveBeenCalledOnce();
    await act(async () => removal.resolve(true));
    await expect(first).resolves.toBe(true);
    expect(text("busy")).toBe("false");
  });

  it("removes bookmarks quietly and does not expose them through Undo", async () => {
    const original = bookmark();
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      restoreAnnotation: vi.fn(),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => expect(apiRef.current!.remove(original)).resolves.toBe(true));
    expect(text("ids")).toBe("");
    expect(text("feedback")).toBe("");

    await act(async () => void (await apiRef.current!.undoRemove()));
    expect(storage.restoreAnnotation).not.toHaveBeenCalled();
  });

  it("removes highlights with note-aware Undo feedback", async () => {
    const original = highlight();
    const storage = { deleteAnnotation: vi.fn(async () => true) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => expect(apiRef.current!.remove(original)).resolves.toBe(true));
    expect(text("ids")).toBe("");
    expect(text("feedback")).toBe("Highlight and attached note removed.");
  });

  it("restores a plain removed highlight through full annotation restoration", async () => {
    const original = { ...highlight("plain-highlight"), note: undefined } as HighlightAnnotation;
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      restoreAnnotation: vi.fn(async () => original),
      updateHighlightAnnotation: vi.fn(),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    expect(text("feedback")).toBe("Highlight removed.");
    await act(async () => void (await apiRef.current!.undoRemove()));

    expect(storage.restoreAnnotation).toHaveBeenCalledWith("book-a", original);
    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();
    expect(text("ids")).toBe(original.id);
    expect(text("feedback")).toBe("Highlight restored.");
  });

  it("restores the complete removed annotation and clears feedback explicitly", async () => {
    const original = highlight();
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      restoreAnnotation: vi.fn(async (_bookId: string, annotation: Annotation) => annotation),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    await act(async () => void (await apiRef.current!.undoRemove()));
    expect(storage.restoreAnnotation).toHaveBeenCalledWith("book-a", original);
    expect(text("ids")).toBe(original.id);
    expect(text("feedback")).toBe("Highlight restored.");
    act(() => apiRef.current?.clearFeedback());
    expect(text("feedback")).toBe("");
  });

  it("synchronizes a pending full-highlight Undo after its feedback is dismissed", async () => {
    const original = highlight("dismissed-highlight-undo");
    const restore = deferred<void>();
    let stored: Annotation | undefined = structuredClone(original);
    const storage = {
      deleteAnnotation: vi.fn(async () => {
        stored = undefined;
        return true;
      }),
      restoreAnnotation: vi.fn(async (_bookId: string, annotation: Annotation) => {
        await restore.promise;
        stored = structuredClone(annotation);
        return structuredClone(annotation);
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    let pendingUndo!: Promise<void>;
    act(() => {
      pendingUndo = apiRef.current!.undoRemove();
    });
    act(() => apiRef.current!.clearFeedback());

    await act(async () => {
      restore.resolve();
      await pendingUndo;
    });

    expect(stored).toEqual(original);
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([original]);
    expect(text("feedback")).toBe("");
    expect(text("busy")).toBe("false");
  });

  it("synchronizes a pending full-highlight Undo without replacing newer feedback", async () => {
    const original = highlight("superseded-highlight-undo");
    const newer = highlight("newer-note-feedback");
    const restore = deferred<void>();
    let stored: Annotation | undefined = structuredClone(original);
    const storage = {
      deleteAnnotation: vi.fn(async () => {
        stored = undefined;
        return true;
      }),
      restoreAnnotation: vi.fn(async (_bookId: string, annotation: Annotation) => {
        await restore.promise;
        stored = structuredClone(annotation);
        return structuredClone(annotation);
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    let pendingUndo!: Promise<void>;
    act(() => {
      pendingUndo = apiRef.current!.undoRemove();
    });
    act(() => apiRef.current!.publishNoteRemoved(newer));

    await act(async () => {
      restore.resolve();
      await pendingUndo;
    });

    expect(stored).toEqual(original);
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([original]);
    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: newer.id },
      kind: "removed",
      message: "Note removed.",
      removalKind: "note",
    });
    expect(text("feedback")).toBe("Note removed.");
    expect(text("busy")).toBe("false");
  });

  it.each(["undefined", "rejection"] as const)(
    "does not publish a retired full-highlight Undo %s failure",
    async (outcome) => {
      const original = highlight(`retired-highlight-${outcome}`);
      const restore = deferred<Annotation | undefined>();
      let stored: Annotation | undefined = structuredClone(original);
      const storage = {
        deleteAnnotation: vi.fn(async () => {
          stored = undefined;
          return true;
        }),
        restoreAnnotation: vi.fn(() => restore.promise),
      } as unknown as LibraryStorage;
      const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
      await renderHarness({ apiRef, initial: [original], storage });

      await act(async () => void (await apiRef.current!.remove(original)));
      let pendingUndo!: Promise<void>;
      act(() => {
        pendingUndo = apiRef.current!.undoRemove();
      });
      act(() => apiRef.current!.clearFeedback());

      await act(async () => {
        if (outcome === "undefined") {
          restore.resolve(undefined);
        } else {
          restore.reject(new Error("restore failed"));
        }
        await pendingUndo;
      });

      expect(stored).toBeUndefined();
      expect(JSON.parse(text("annotations") ?? "[]")).toEqual([]);
      expect(text("feedback")).toBe("");
      expect(text("busy")).toBe("false");
    },
  );

  it("restores a deleted note on the existing highlight without recreating it", async () => {
    const original = highlight("note-only");
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    const restored = { ...original, updatedAt: "2026-07-14T01:00:00.000Z" };
    const storage = {
      restoreAnnotation: vi.fn(),
      updateHighlightAnnotation: vi.fn(async () => restored),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    expect(text("feedback")).toBe("Note removed.");
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([withoutNote]);

    await act(async () => void (await apiRef.current!.undoRemove()));

    expect(storage.updateHighlightAnnotation).toHaveBeenCalledWith("book-a", original.id, {
      note: "Attached note",
    });
    expect(storage.restoreAnnotation).not.toHaveBeenCalled();
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([restored]);
    expect(text("feedback")).toBe("Note restored.");
  });

  it("retires note-removal feedback only for its exact highlight", async () => {
    const first = highlight("note-first");
    const second = highlight("note-second");
    const storage = {} as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [], storage });

    act(() => apiRef.current!.publishNoteRemoved(first));
    act(() => apiRef.current!.retireNoteRemoval(second.id));
    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: first.id },
      kind: "removed",
      removalKind: "note",
    });

    act(() => apiRef.current!.retireNoteRemoval(first.id));
    expect(apiRef.current?.feedback).toBeUndefined();

    act(() => apiRef.current!.publishNoteRemoved(second));
    act(() => apiRef.current!.retireNoteRemoval(first.id));
    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: second.id },
      kind: "removed",
      removalKind: "note",
    });
  });

  it("claims note editing only for an available exact target", async () => {
    const first = highlight("claim-first");
    const second = highlight("claim-second");
    const storage = {} as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [], storage });

    act(() => apiRef.current!.publishNoteRemoved(first));
    expect(apiRef.current!.claimNoteEditing(second.id)).toBe(true);
    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: first.id },
      kind: "removed",
      removalKind: "note",
    });

    let claimed = false;
    act(() => {
      claimed = apiRef.current!.claimNoteEditing(first.id);
    });
    expect(claimed).toBe(true);
    expect(apiRef.current?.feedback).toBeUndefined();
  });

  it("rejects same-highlight editing while note Undo owns the storage write", async () => {
    const original = highlight("pending-edit-claim");
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    let stored = structuredClone(withoutNote);
    const write = deferred<void>();
    const storage = {
      updateHighlightAnnotation: vi.fn(
        async (...args: Parameters<LibraryStorage["updateHighlightAnnotation"]>) => {
          await write.promise;
          stored = { ...stored, ...args[2] };
          return structuredClone(stored);
        },
      ),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    let pendingUndo!: Promise<void>;
    act(() => {
      pendingUndo = apiRef.current!.undoRemove();
    });

    expect(apiRef.current!.claimNoteEditing(original.id)).toBe(false);
    expect(apiRef.current!.claimNoteEditing("other-highlight")).toBe(true);
    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: original.id },
      kind: "removed",
      removalKind: "note",
    });

    await act(async () => write.resolve());
    await pendingUndo;

    expect(stored.note).toBe(original.note);
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([stored]);
    expect(text("feedback")).toBe("Note restored.");
  });

  it("does not retire complete-highlight removal feedback for the same annotation", async () => {
    const original = highlight("complete-removal");
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    expect(apiRef.current!.claimNoteEditing(original.id)).toBe(true);

    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: original.id },
      kind: "removed",
      removalKind: "highlight",
    });
  });

  it.each([
    {
      expectedMessage: "Note restored.",
      kind: "restored",
      update: async (annotation: HighlightAnnotation) => annotation,
    },
    {
      expectedMessage: "Note could not be restored.",
      kind: "error",
      update: async () => undefined,
    },
  ])("does not retire $kind feedback", async ({ expectedMessage, kind, update }) => {
    const original = highlight(`note-${kind}`);
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update(original)),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    await act(async () => void (await apiRef.current!.undoRemove()));

    expect(apiRef.current!.claimNoteEditing(original.id)).toBe(true);
    act(() => apiRef.current!.retireNoteRemoval(original.id));

    expect(text("feedback")).toBe(expectedMessage);
  });

  it("does not let an older Reader session retire current feedback", async () => {
    const old = highlight("old-session-note");
    const current = highlight("current-session-note");
    const storage = {} as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [],
      sessionKey: "old-session",
      storage,
    });
    act(() => apiRef.current!.publishNoteRemoved(old));
    const staleClaim = apiRef.current!.claimNoteEditing;
    const staleRetire = apiRef.current!.retireNoteRemoval;

    await renderHarness({
      apiRef,
      bookId: "book-b",
      initial: [],
      sessionKey: "current-session",
      storage,
    });
    act(() => apiRef.current!.publishNoteRemoved(current));
    expect(staleClaim(current.id)).toBe(false);
    act(() => staleRetire(current.id));

    expect(apiRef.current?.feedback).toMatchObject({
      annotation: { id: current.id },
      kind: "removed",
      removalKind: "note",
    });
  });

  it("prevents a captured note Undo handler from starting after editing is claimed", async () => {
    const original = highlight("captured-undo");
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    const storage = {
      updateHighlightAnnotation: vi.fn(),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    const staleUndo = apiRef.current!.undoRemove;
    let claimed = false;
    act(() => {
      claimed = apiRef.current!.claimNoteEditing(original.id);
    });
    expect(claimed).toBe(true);
    await act(async () => void (await staleUndo()));

    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();
    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([withoutNote]);
    expect(text("feedback")).toBe("");
  });

  it.each(["success", "failure"] as const)(
    "does not republish stale %s feedback after a pending note Undo is retired",
    async (outcome) => {
      const original = highlight("pending-retired");
      const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
      const update = deferred<HighlightAnnotation | undefined>();
      const storage = {
        updateHighlightAnnotation: vi.fn(() => update.promise),
      } as unknown as LibraryStorage;
      const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
      await renderHarness({ apiRef, initial: [withoutNote], storage });

      act(() => apiRef.current!.publishNoteRemoved(original));
      let pendingUndo!: Promise<void>;
      act(() => {
        pendingUndo = apiRef.current!.undoRemove();
      });
      act(() => apiRef.current!.retireNoteRemoval(original.id));

      if (outcome === "success") {
        await act(async () => update.resolve(original));
      } else {
        await act(async () => update.reject(new Error("write failed")));
      }
      await pendingUndo;

      expect(JSON.parse(text("annotations") ?? "[]")).toEqual([
        outcome === "success" ? original : withoutNote,
      ]);
      expect(text("feedback")).toBe("");
      expect(text("busy")).toBe("false");
    },
  );

  it.each(["success", "failure"] as const)(
    "does not publish stale %s feedback after a pending note Undo is superseded",
    async (outcome) => {
      const original = highlight("pending-old");
      const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
      const newer = highlight("newer-feedback");
      const update = deferred<HighlightAnnotation | undefined>();
      const storage = {
        updateHighlightAnnotation: vi.fn(() => update.promise),
      } as unknown as LibraryStorage;
      const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
      await renderHarness({ apiRef, initial: [withoutNote], storage });

      act(() => apiRef.current!.publishNoteRemoved(original));
      let pendingUndo!: Promise<void>;
      act(() => {
        pendingUndo = apiRef.current!.undoRemove();
      });
      act(() => apiRef.current!.publishNoteRemoved(newer));

      if (outcome === "success") {
        await act(async () => update.resolve(original));
      } else {
        await act(async () => update.reject(new Error("write failed")));
      }
      await pendingUndo;

      expect(apiRef.current?.feedback).toMatchObject({
        annotation: { id: newer.id },
        kind: "removed",
        message: "Note removed.",
        removalKind: "note",
      });
      expect(JSON.parse(text("annotations") ?? "[]")).toEqual([
        outcome === "success" ? original : withoutNote,
      ]);
      expect(text("feedback")).toBe("Note removed.");
    },
  );

  it.each([
    ["an undefined result", async () => undefined],
    ["a rejected write", async () => Promise.reject(new Error("disk unavailable"))],
  ])("keeps the note absent when note Undo receives %s", async (_case, update) => {
    const original = highlight("note-failure");
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    const storage = {
      restoreAnnotation: vi.fn(),
      updateHighlightAnnotation: vi.fn(update),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    await act(async () => void (await apiRef.current!.undoRemove()));

    expect(JSON.parse(text("annotations") ?? "[]")).toEqual([withoutNote]);
    expect(text("feedback")).toBe("Note could not be restored.");
    expect(storage.restoreAnnotation).not.toHaveBeenCalled();
    act(() => apiRef.current!.clearFeedback());
    expect(text("feedback")).toBe("");
  });

  it("allows only one note Undo mutation while the first write is pending", async () => {
    const original = highlight("note-busy");
    const withoutNote = { ...original, note: undefined } as HighlightAnnotation;
    const update = deferred<HighlightAnnotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [withoutNote], storage });

    act(() => apiRef.current!.publishNoteRemoved(original));
    let first!: Promise<void>;
    act(() => {
      first = apiRef.current!.undoRemove();
      void apiRef.current!.undoRemove();
    });

    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();
    expect(text("busy")).toBe("true");
    await act(async () => update.resolve(original));
    await first;
    expect(text("busy")).toBe("false");
  });

  it("rejects a note Undo completion after another Reader session becomes authoritative", async () => {
    const old = highlight("old-note");
    const oldWithoutNote = { ...old, note: undefined } as HighlightAnnotation;
    const current = highlight("current-note");
    const noteUndo = deferred<HighlightAnnotation | undefined>();
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      updateHighlightAnnotation: vi.fn(() => noteUndo.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [oldWithoutNote],
      sessionKey: "session-a",
      storage,
    });
    act(() => apiRef.current!.publishNoteRemoved(old));
    const staleApi = apiRef.current!;
    act(() => void staleApi.undoRemove());

    await renderHarness({
      apiRef,
      bookId: "book-b",
      initial: [current],
      sessionKey: "session-b",
      storage,
    });
    await act(async () => void (await apiRef.current!.remove(current)));
    expect(text("feedback")).toBe("Highlight and attached note removed.");

    await act(async () => noteUndo.resolve(old));

    expect(text("ids")).toBe("");
    expect(text("feedback")).toBe("Highlight and attached note removed.");
  });

  it("rejects a note Undo completion from an older token for the same book", async () => {
    const old = highlight("old-token");
    const oldWithoutNote = { ...old, note: undefined } as HighlightAnnotation;
    const current = highlight("current-token");
    const noteUndo = deferred<HighlightAnnotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => noteUndo.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [oldWithoutNote],
      sessionKey: "token-a",
      storage,
    });
    act(() => apiRef.current!.publishNoteRemoved(old));
    act(() => void apiRef.current!.undoRemove());

    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [current],
      sessionKey: "token-b",
      storage,
    });
    await act(async () => noteUndo.resolve(old));

    expect(text("ids")).toBe(current.id);
    expect(text("feedback")).toBe("");
  });

  it("reports restore collision failure without rebuilding the removed annotation locally", async () => {
    const original = highlight();
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      restoreAnnotation: vi.fn(async () => {
        throw new Error("collision");
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => void (await apiRef.current!.remove(original)));
    await act(async () => void (await apiRef.current!.undoRemove()));
    expect(text("ids")).toBe("");
    expect(text("feedback")).toBe("Highlight could not be restored.");
  });

  it("leaves the authoritative collection intact when removal fails", async () => {
    const original = highlight();
    const storage = {
      deleteAnnotation: vi.fn(async () => {
        throw new Error("disk unavailable");
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => expect(apiRef.current!.remove(original)).resolves.toBe(false));
    expect(text("ids")).toBe(original.id);
    expect(text("feedback")).toBe("Highlight could not be removed.");
  });

  it("treats an authoritative false removal result as visible failure", async () => {
    const original = bookmark();
    const storage = {
      deleteAnnotation: vi.fn(async () => false),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => expect(apiRef.current!.remove(original)).resolves.toBe(false));
    expect(text("ids")).toBe(original.id);
    expect(text("feedback")).toBe("Bookmark could not be removed.");
  });

  it("cancels queued maintenance before an explicit anchor update and drains afterward", async () => {
    const original = highlight();
    const updated = { ...original, anchorStatus: "detached" } as HighlightAnnotation;
    const cancel = vi.fn();
    const drain = vi.fn();
    const storage = {
      updateHighlightAnnotation: vi.fn(async () => updated),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, cancel, drain, initial: [original], storage });

    await act(async () =>
      expect(apiRef.current!.updateAnchor(original, { anchorStatus: "detached" })).resolves.toBe(
        updated,
      ),
    );
    await act(async () => Promise.resolve());
    expect(cancel).toHaveBeenCalledWith(original.id);
    expect(drain).toHaveBeenCalledOnce();
  });

  it("publishes retryable feedback when an explicit anchor update fails", async () => {
    const original = highlight();
    const storage = {
      updateHighlightAnnotation: vi.fn(async () => {
        throw new Error("write failed");
      }),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () =>
      expect(apiRef.current!.updateAnchor(original, { anchorStatus: "detached" })).resolves.toBe(
        undefined,
      ),
    );
    expect(text("ids")).toBe(original.id);
    expect(text("feedback")).toBe("The annotation location could not be updated.");
  });

  it("projects no stale feedback or busy state on the first render of a new session", async () => {
    const removed = highlight("removed");
    const pending = highlight("pending");
    const anchorWrite = deferred<HighlightAnnotation | undefined>();
    const projections: MutationProjection[] = [];
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      updateHighlightAnnotation: vi.fn(() => anchorWrite.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [removed, pending],
      projections,
      sessionKey: "session-a",
      storage,
    });
    await act(async () => void (await apiRef.current!.remove(removed)));
    let staleAnchor!: Promise<Annotation | undefined>;
    act(() => {
      staleAnchor = apiRef.current!.updateAnchor(pending, { anchorStatus: "detached" });
    });
    expect(text("feedback")).toBe("Highlight and attached note removed.");
    expect(text("busy")).toBe("true");

    await renderHarness({
      apiRef,
      bookId: "book-b",
      initial: [bookmark("book-b")],
      projections,
      sessionKey: "session-b",
      storage,
    });
    expect(projections.find(({ sessionKey }) => sessionKey === "session-b")).toEqual({
      bookId: "book-b",
      busy: false,
      feedback: undefined,
      sessionKey: "session-b",
    });
    expect(text("feedback")).toBe("");
    expect(text("busy")).toBe("false");

    await act(async () => anchorWrite.resolve({ ...pending, anchorStatus: "detached" }));
    await expect(staleAnchor).resolves.toBeUndefined();
  });

  it("rejects stale remove completion and preserves newer-session busy ownership", async () => {
    const oldRemoval = deferred<boolean>();
    const newUpdate = deferred<BookmarkAnnotation | undefined>();
    const old = bookmark("old");
    const current = bookmark("current");
    const storage = {
      deleteAnnotation: vi.fn(() => oldRemoval.promise),
      updateBookmarkAnnotation: vi.fn(() => newUpdate.promise),
    } as unknown as LibraryStorage;
    const projections: MutationProjection[] = [];
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [old],
      projections,
      sessionKey: "session-a",
      storage,
    });
    act(() => void apiRef.current!.remove(old));
    await renderHarness({
      apiRef,
      bookId: "book-b",
      initial: [current],
      projections,
      sessionKey: "session-b",
      storage,
    });
    expect(projections.find(({ sessionKey }) => sessionKey === "session-b")).toMatchObject({
      busy: false,
      feedback: undefined,
    });
    const currentApi = apiRef.current!;
    let update!: Promise<Annotation | undefined>;
    act(() => {
      update = currentApi.updateAnchor(current, { chapterHref: "chapter.xhtml" });
    });

    await act(async () => oldRemoval.resolve(true));
    expect(text("ids")).toBe(current.id);
    expect(text("busy")).toBe("true");
    expect(text("feedback")).toBe("");
    await act(async () => newUpdate.resolve({ ...current, chapterHref: "chapter.xhtml" }));
    await expect(update).resolves.toBeDefined();
    expect(text("busy")).toBe("false");
  });

  it("rejects stale restore and anchor-update completions", async () => {
    const original = highlight("old");
    const anchorBookmark = bookmark("anchor-old");
    const restore = deferred<Annotation>();
    const anchor = deferred<BookmarkAnnotation | undefined>();
    const storage = {
      deleteAnnotation: vi.fn(async () => true),
      restoreAnnotation: vi.fn(() => restore.promise),
      updateBookmarkAnnotation: vi.fn(() => anchor.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, bookId: "book-a", initial: [original], storage });
    await act(async () => void (await apiRef.current!.remove(original)));
    const staleApi = apiRef.current!;
    act(() => void staleApi.undoRemove());
    await renderHarness({ apiRef, bookId: "book-b", initial: [bookmark("book-b")], storage });
    await act(async () => restore.resolve(original));
    expect(text("ids")).toBe("book-b");
    expect(text("feedback")).toBe("");

    await renderHarness({ apiRef, bookId: "book-a", initial: [anchorBookmark], storage });
    const staleAnchorApi = apiRef.current!;
    let result!: Promise<Annotation | undefined>;
    act(() => {
      result = staleAnchorApi.updateAnchor(anchorBookmark, { chapterHref: "stale.xhtml" });
    });
    await renderHarness({ apiRef, bookId: "book-c", initial: [bookmark("book-c")], storage });
    await act(async () => anchor.resolve({ ...anchorBookmark, chapterHref: "stale.xhtml" }));
    await expect(result).resolves.toBeUndefined();
    expect(text("ids")).toBe("book-c");
    expect(text("feedback")).toBe("");
  });

  it("rejects a stale completion for the same book with a new session token", async () => {
    const old = bookmark("token-one");
    const current = bookmark("token-two");
    const removal = deferred<boolean>();
    const projections: MutationProjection[] = [];
    const storage = { deleteAnnotation: vi.fn(() => removal.promise) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [old],
      projections,
      sessionKey: "token-1",
      storage,
    });
    let staleRemoval!: Promise<boolean>;
    act(() => {
      staleRemoval = apiRef.current!.remove(old);
    });

    await renderHarness({
      apiRef,
      bookId: "book-a",
      initial: [current],
      projections,
      sessionKey: "token-2",
      storage,
    });
    expect(projections.find(({ sessionKey }) => sessionKey === "token-2")).toEqual({
      bookId: "book-a",
      busy: false,
      feedback: undefined,
      sessionKey: "token-2",
    });
    await act(async () => removal.resolve(true));
    await expect(staleRemoval).resolves.toBe(false);
    expect(text("ids")).toBe(current.id);
    expect(text("feedback")).toBe("");
    expect(text("busy")).toBe("false");
  });
});
