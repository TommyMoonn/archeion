// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Book } from "../../types/book";
import type { LibraryWorkspaceDialogActions } from "./useLibraryWorkspaceDialogs";
import { useLibraryBookActions } from "./useLibraryBookActions";
import { useLibraryFeedback } from "./useLibraryFeedback";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const book: Book = {
  addedAt: "1",
  fileName: "Book.epub",
  id: "book-1",
  isFavorite: false,
  originalTitle: "Book",
  relativePath: "Book.epub",
  updatedAt: "1",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createStorage(overrides: Partial<LibraryStorage> = {}): LibraryStorage {
  const snapshot = {
    archiveGeneration: 1,
    archiveRootPath: "D:\\Books",
    books: [],
    folders: [],
    loadState: "ready" as const,
    revision: 1,
    scanStatus: { status: "idle" as const },
  };
  return {
    addEpubFilesToArchive: vi.fn().mockResolvedValue([]),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    getLibrarySnapshot: vi.fn(() => snapshot),
    observeLibrarySnapshot: vi.fn(() => () => undefined),
    rescan: vi.fn().mockResolvedValue(undefined),
    revealBookFile: vi.fn().mockResolvedValue(undefined),
    updateBook: vi.fn().mockResolvedValue(book),
    ...overrides,
  } as unknown as LibraryStorage;
}

type Session = {
  actions: ReturnType<typeof useLibraryBookActions>;
  tokens: ReturnType<typeof useLibraryFeedback>["tokens"];
};

let latest: Session;

function Harness({ storage }: Readonly<{ storage: LibraryStorage }>) {
  const feedback = useLibraryFeedback();
  const actions = useLibraryBookActions({
    beginBookMutation: () => null,
    beginFolderDeletion: () => null,
    beginFeedbackOperation: feedback.beginOperation,
    changeLocation: vi.fn(),
    confirmDestructiveFileActions: true,
    currentFolder: undefined,
    dialogs: {
      close: vi.fn(),
      openBookDetailsById: vi.fn(),
    } as unknown as LibraryWorkspaceDialogActions,
    dismissFeedback: feedback.dismiss,
    location: { type: "library" },
    onBookMutationComplete: vi.fn(),
    onFolderDeletionComplete: vi.fn(),
    publishFeedbackOperation: feedback.publishOperation,
    runFolderPathMutation: vi.fn(),
    storage,
  });

  useEffect(() => {
    latest = { actions, tokens: feedback.tokens };
  }, [actions, feedback.tokens]);
  return null;
}

describe("useLibraryBookActions operation ownership", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(storage: LibraryStorage) {
    await act(async () => {
      root.render(<Harness storage={storage} />);
    });
  }

  it("does not let an independent favorite success suppress a pending deletion failure", async () => {
    const pendingDelete = deferred<boolean>();
    const storage = createStorage({
      deleteBook: vi.fn(() => pendingDelete.promise),
    });
    await render(storage);

    let deletion!: Promise<void>;
    await act(async () => {
      deletion = latest.actions.deleteBook(book);
      await latest.actions.toggleFavorite(book);
    });
    expect(latest.tokens).toEqual([]);

    await act(async () => {
      pendingDelete.reject(new Error("delete failed"));
      await deletion;
    });

    expect(latest.tokens).toEqual([
      expect.objectContaining({
        id: "library-delete-book:book-1",
        title: "This book could not be deleted.",
      }),
    ]);
  });

  it("does not dismiss a persistent reveal error when an unrelated operation starts", async () => {
    const storage = createStorage({
      revealBookFile: vi.fn().mockRejectedValue(new Error("reveal failed")),
    });
    await render(storage);

    await act(async () => latest.actions.revealBookFile(book));
    await act(async () => latest.actions.toggleFavorite(book));

    expect(latest.tokens).toEqual([
      expect.objectContaining({
        id: "library-reveal-book:book-1",
        title: "The EPUB could not be revealed in its folder.",
      }),
    ]);
  });

  it("owns one synchronous rescan lock across repeated invocations", async () => {
    const pendingRescan = deferred<void>();
    const rescan = vi.fn(() => pendingRescan.promise);
    await render(createStorage({ rescan }));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = latest.actions.rescanLibrary();
      second = latest.actions.rescanLibrary();
    });

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(latest.actions.isRescanning).toBe(true);

    await act(async () => {
      pendingRescan.resolve();
      await Promise.all([first, second]);
    });
    expect(latest.actions.isRescanning).toBe(false);
  });

  it("leaves thrown import submissions to the dialog without global feedback", async () => {
    const failure = new Error("native import failed");
    await render(
      createStorage({
        addEpubFilesToArchive: vi.fn().mockRejectedValue(failure),
      }),
    );

    await expect(
      act(async () => {
        await latest.actions.importEpubs({
          conflictAction: "skip",
          mode: "copy",
          sourcePaths: ["D:\\Incoming\\Book.epub"],
        });
      }),
    ).rejects.toBe(failure);
    expect(latest.tokens).toEqual([]);
  });

  it("retains completed partial import results as global feedback", async () => {
    await render(
      createStorage({
        addEpubFilesToArchive: vi.fn().mockResolvedValue([
          {
            fileName: "Book.epub",
            message: "Already exists.",
            sourcePath: "D:\\Incoming\\Book.epub",
            status: "skipped",
          },
        ]),
      }),
    );

    await act(async () => {
      await latest.actions.importEpubs({
        conflictAction: "skip",
        mode: "copy",
        sourcePaths: ["D:\\Incoming\\Book.epub"],
      });
    });

    expect(latest.tokens).toEqual([
      expect.objectContaining({
        id: "archive-import",
        title: "Some EPUBs were skipped.",
      }),
    ]);
  });
});
