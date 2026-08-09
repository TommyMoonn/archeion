// @vitest-environment happy-dom

import { act, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation, CreateAnnotationInput } from "../../types/annotation";
import { sameReaderAnnotationSession, type ReaderAnnotationSession } from "./readerAnnotationState";
import type {
  ReaderAnnotationFeedback,
  ReaderAnnotationMutationContext,
} from "./useReaderAnnotationMutations";
import { useReaderBookmarks } from "./useReaderBookmarks";

type BookmarksApi = ReturnType<typeof useReaderBookmarks>;

const location = {
  atEnd: false,
  atStart: false,
  cfi: "epubcfi(/6/2!/4/2:10)",
  percentage: 25,
};

function bookmark(id = "bookmark", anchorStatus?: "detached"): BookmarkAnnotation {
  return {
    anchorStatus,
    cfiRange: location.cfi,
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    label: "Chapter one",
    type: "bookmark",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Harness({
  annotations,
  apiRef,
  bookId,
  busy = false,
  currentLocation = location,
  feedback,
  openingError = false,
  readerReady = true,
  remove,
  storage,
  synced,
}: {
  annotations: Annotation[];
  apiRef: MutableRefObject<BookmarksApi | undefined>;
  bookId: string;
  busy?: boolean;
  currentLocation?: typeof location;
  feedback: ReaderAnnotationFeedback[];
  openingError?: boolean;
  readerReady?: boolean;
  remove: (annotation: Annotation) => Promise<boolean>;
  storage: LibraryStorage;
  synced: Annotation[];
}) {
  const session = useMemo<ReaderAnnotationSession>(
    () => ({ archiveId: "archive-a", bookId, token: Symbol("bookmark-workflow-session") }),
    [bookId],
  );
  const sessionRef = useRef(session);
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const mutations = useMemo(
    () => ({
      create: async (input: CreateAnnotationInput) => {
        const owner = session;
        try {
          const annotation =
            input.type === "bookmark"
              ? await storage.createAnnotation(bookId, input)
              : await storage.createAnnotation(bookId, input);
          if (!sameReaderAnnotationSession(sessionRef.current, owner)) {
            return { status: "retired" } as const;
          }
          synced.push(annotation);
          return { annotation, status: "accepted" } as const;
        } catch {
          return sameReaderAnnotationSession(sessionRef.current, owner)
            ? ({ status: "failed" } as const)
            : ({ status: "retired" } as const);
        }
      },
      publishFeedback: (_session: ReaderAnnotationSession, next?: ReaderAnnotationFeedback) => {
        if (next) feedback.push(next);
      },
      remove,
      update: async (command: Parameters<ReaderAnnotationMutationContext["update"]>[0]) => {
        const owner = session;
        try {
          const annotation =
            command.annotationType === "bookmark"
              ? await storage.updateBookmarkAnnotation(
                  bookId,
                  command.annotation.id,
                  command.changes,
                )
              : await storage.updateHighlightAnnotation(
                  bookId,
                  command.annotation.id,
                  command.changes,
                );
          if (!sameReaderAnnotationSession(sessionRef.current, owner)) {
            return { status: "retired" } as const;
          }
          if (!annotation) return { status: "failed" } as const;
          synced.push(annotation);
          return { annotation, status: "accepted" } as const;
        } catch {
          return sameReaderAnnotationSession(sessionRef.current, owner)
            ? ({ status: "failed" } as const)
            : ({ status: "retired" } as const);
        }
      },
    }),
    [bookId, feedback, remove, session, storage, synced],
  );
  const bookmarks = useReaderBookmarks({
    annotations,
    busy,
    chapterHref: "Text/chapter-1.xhtml",
    chapterLabel: "Chapter one",
    location: currentLocation,
    mutations,
    openingError,
    readerReady,
    session,
  });
  useLayoutEffect(() => {
    apiRef.current = bookmarks;
  }, [apiRef, bookmarks]);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness(props: Parameters<typeof Harness>[0]) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

function baseProps(storage: LibraryStorage, annotations: Annotation[] = []) {
  return {
    annotations,
    apiRef: { current: undefined } as MutableRefObject<BookmarksApi | undefined>,
    bookId: "book-a",
    feedback: [] as ReaderAnnotationFeedback[],
    remove: vi.fn(async () => true),
    storage,
    synced: [] as Annotation[],
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderBookmarks workflows", () => {
  it("adds the current bookmark without publishing visual success feedback", async () => {
    const created = bookmark("created");
    const storage = { createAnnotation: vi.fn(async () => created) } as unknown as LibraryStorage;
    const props = baseProps(storage);
    await renderHarness(props);

    await act(async () => void (await props.apiRef.current?.toggleCurrent()));
    expect(storage.createAnnotation).toHaveBeenCalledWith("book-a", {
      chapterHref: "Text/chapter-1.xhtml",
      cfiRange: location.cfi,
      label: "Chapter one",
      type: "bookmark",
    });
    expect(props.synced).toEqual([created]);
    expect(props.feedback).toEqual([]);
  });

  it("removes the active current bookmark", async () => {
    const current = bookmark();
    const props = baseProps({} as LibraryStorage, [current]);
    await renderHarness(props);

    await act(async () => void (await props.apiRef.current?.toggleCurrent()));
    expect(props.remove).toHaveBeenCalledWith(current);
  });

  it("reattaches a detached current bookmark instead of creating a duplicate", async () => {
    const detached = bookmark("detached", "detached");
    const restored = { ...detached, anchorStatus: undefined };
    const storage = {
      createAnnotation: vi.fn(),
      updateBookmarkAnnotation: vi.fn(async () => restored),
    } as unknown as LibraryStorage;
    const props = baseProps(storage, [detached]);
    await renderHarness(props);

    await act(async () => void (await props.apiRef.current?.toggleCurrent()));
    expect(storage.createAnnotation).not.toHaveBeenCalled();
    expect(storage.updateBookmarkAnnotation).toHaveBeenCalledWith("book-a", detached.id, {
      anchorStatus: undefined,
      chapterHref: "Text/chapter-1.xhtml",
    });
    expect(props.synced).toEqual([restored]);
    expect(props.feedback).toEqual([]);
  });

  it("updates a bookmark label through the stored bookmark mutation path", async () => {
    const current = bookmark();
    const updated = { ...current, label: "Renamed" };
    const storage = {
      updateBookmarkAnnotation: vi.fn(async () => updated),
    } as unknown as LibraryStorage;
    const props = baseProps(storage, [current]);
    await renderHarness(props);

    await act(async () =>
      expect(props.apiRef.current?.updateLabel(current, "Renamed")).resolves.toBe(true),
    );
    expect(storage.updateBookmarkAnnotation).toHaveBeenCalledWith("book-a", current.id, {
      label: "Renamed",
    });
    expect(props.synced).toEqual([updated]);
  });

  it.each([
    ["add", "Bookmark could not be added."],
    ["restore", "Bookmark could not be restored."],
    ["label", "Bookmark label could not be saved."],
  ] as const)("owns %s failure feedback", async (operation, message) => {
    const current = bookmark("current", operation === "restore" ? "detached" : undefined);
    const failure = async () => {
      throw new Error("write failed");
    };
    const storage = {
      createAnnotation: vi.fn(failure),
      updateBookmarkAnnotation: vi.fn(failure),
    } as unknown as LibraryStorage;
    const props = baseProps(storage, operation === "add" ? [] : [current]);
    await renderHarness(props);

    await act(async () => {
      if (operation === "label") await props.apiRef.current?.updateLabel(current, "Renamed");
      else await props.apiRef.current?.toggleCurrent();
    });
    expect(props.feedback.at(-1)).toEqual({ kind: "error", message });
  });

  it("reports an authoritative missing restore result as bookmark failure", async () => {
    const detached = bookmark("detached", "detached");
    const storage = {
      updateBookmarkAnnotation: vi.fn(async () => undefined),
    } as unknown as LibraryStorage;
    const props = baseProps(storage, [detached]);
    await renderHarness(props);

    await act(async () => void (await props.apiRef.current?.toggleCurrent()));

    expect(props.synced).toEqual([]);
    expect(props.feedback.at(-1)).toEqual({
      kind: "error",
      message: "Bookmark could not be restored.",
    });
  });

  it("delegates removal failure feedback to the generic mutation owner", async () => {
    const current = bookmark();
    const props = baseProps({} as LibraryStorage, [current]);
    vi.mocked(props.remove).mockResolvedValueOnce(false);
    await renderHarness(props);

    await act(async () => void (await props.apiRef.current?.toggleCurrent()));
    expect(props.remove).toHaveBeenCalledWith(current);
    expect(props.feedback).toEqual([]);
  });

  it("gates bookmark creation on readiness, current CFI, and busy state", async () => {
    const storage = { createAnnotation: vi.fn() } as unknown as LibraryStorage;
    const props = baseProps(storage);
    await renderHarness({
      ...props,
      busy: true,
      currentLocation: { ...location, cfi: "" },
      readerReady: false,
    });

    expect(props.apiRef.current?.canToggleCurrent).toBe(false);
    expect(props.apiRef.current?.toggleDisabledReason).toBe(
      "Wait for the current bookmark action to finish.",
    );
    await act(async () => void (await props.apiRef.current?.toggleCurrent()));
    expect(storage.createAnnotation).not.toHaveBeenCalled();

    await renderHarness({ ...props, busy: false, currentLocation: { ...location, cfi: "" } });
    expect(props.apiRef.current?.toggleDisabledReason).toBe(
      "Current reading location is still loading.",
    );
  });

  it("rejects a stale bookmark completion after a session change", async () => {
    const creation = deferred<BookmarkAnnotation>();
    const storage = {
      createAnnotation: vi.fn(() => creation.promise),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    await renderHarness(props);
    act(() => void props.apiRef.current?.toggleCurrent());
    await renderHarness({ ...props, bookId: "book-b" });

    await act(async () => creation.resolve(bookmark("stale")));
    expect(props.synced).toEqual([]);
    expect(props.feedback).toEqual([]);
  });
});
