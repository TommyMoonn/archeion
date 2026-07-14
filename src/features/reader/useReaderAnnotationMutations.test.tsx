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
  apiRef,
  bookId,
  cancel,
  drain,
  initial,
  projections,
  sessionKey,
  storage,
}: {
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
    () => ({ bookId, token: Symbol(`mutation-test-${sessionKey}`) }),
    [bookId, sessionKey],
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
      <span data-testid="ids">{annotations.map(({ id }) => id).join(",")}</span>
      <span data-testid="busy">{String(mutations.busy)}</span>
      <span data-testid="feedback">{mutations.feedback?.message}</span>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness({
  apiRef,
  bookId = "book-a",
  cancel = vi.fn(),
  drain = vi.fn(),
  initial,
  projections,
  sessionKey = bookId,
  storage,
}: {
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

  it.each([
    [bookmark(), "Bookmark removed."],
    [highlight(), "Highlight and attached note removed."],
  ])("removes %s annotations with type-appropriate feedback", async (original, message) => {
    const storage = { deleteAnnotation: vi.fn(async () => true) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<MutationApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, initial: [original], storage });

    await act(async () => expect(apiRef.current!.remove(original)).resolves.toBe(true));
    expect(text("ids")).toBe("");
    expect(text("feedback")).toBe(message);
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

  it("reports restore collision failure without rebuilding the removed annotation locally", async () => {
    const original = bookmark();
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
    expect(text("feedback")).toBe("Bookmark could not be restored.");
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
    const removed = bookmark("removed");
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
    expect(text("feedback")).toBe("Bookmark removed.");
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
    const original = bookmark("old");
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

    await renderHarness({ apiRef, bookId: "book-a", initial: [original], storage });
    const staleAnchorApi = apiRef.current!;
    let result!: Promise<Annotation | undefined>;
    act(() => {
      result = staleAnchorApi.updateAnchor(original, { chapterHref: "stale.xhtml" });
    });
    await renderHarness({ apiRef, bookId: "book-c", initial: [bookmark("book-c")], storage });
    await act(async () => anchor.resolve({ ...original, chapterHref: "stale.xhtml" }));
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
