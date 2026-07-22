// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { folderMutationOwnerAttributes } from "../folders/folderMutationFocus";
import { useLibraryMutationFocus, type BookMutationFocusClaim } from "./useLibraryMutationFocus";

function book(id: string): Book {
  return {
    addedAt: "1",
    fileName: `${id}.epub`,
    id,
    isFavorite: false,
    originalTitle: id,
    updatedAt: "1",
  };
}

function folder(id: string, relativePath: string): Folder {
  return {
    createdAt: "1",
    id,
    name: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    updatedAt: "1",
  };
}

type FocusApi = ReturnType<typeof useLibraryMutationFocus>;

type HarnessProps = {
  activeArchiveId?: string;
  books: readonly Book[];
  dialogOpen?: boolean;
  folders?: readonly Folder[];
  locationKey?: string;
  onApi: (api: FocusApi) => void;
};

function Harness({
  activeArchiveId = "archive-a",
  books,
  dialogOpen = false,
  folders = [],
  locationKey = "library",
  onApi,
}: HarnessProps) {
  const fallbackRef = useRef<HTMLButtonElement>(null);
  const api = useLibraryMutationFocus({
    activeArchiveId,
    dialogOpen,
    fallbackRef,
    folders,
    locationKey,
    visibleBooks: books,
  });

  useLayoutEffect(() => onApi(api), [api, onApi]);

  return (
    <div>
      <button ref={fallbackRef} type="button">
        Search
      </button>
      <button data-library-folder-collection-entry type="button">
        Folders
      </button>
      {folders.map((item) => (
        <div {...folderMutationOwnerAttributes(item, "browser")} key={item.id}>
          <button data-library-folder-primary-action type="button">
            {item.name}
          </button>
        </div>
      ))}
      {books.map((item, index) => (
        <div data-library-index={index} data-reader-book-id={item.id} key={item.id}>
          <button type="button">{item.originalTitle}</button>
        </div>
      ))}
    </div>
  );
}

describe("library mutation focus ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: FocusApi;
  const onApi = (nextApi: FocusApi) => {
    api = nextApi;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function render(props: Omit<HarnessProps, "onApi">) {
    act(() => root.render(<Harness {...props} onApi={onApi} />));
  }

  function reportCollectionTarget() {
    const request = api.collectionRequest;
    if (!request) return;
    const owner = container.querySelector<HTMLElement>(`[data-reader-book-id="${request.bookId}"]`);
    const target = owner?.querySelector<HTMLButtonElement>("button");
    if (target) act(() => request.onTargetReady(request.bookId, request.index, target));
  }

  it("focuses the next surviving book after deletion and the previous book at the end", () => {
    const books = [book("a"), book("b"), book("c")];
    render({ books });
    const middle = container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!;
    middle.focus();
    act(() => {
      api.captureBook(books[1]!);
      const claim = api.beginBookMutation("b");
      api.completeBookMutation(claim, "deleted");
    });
    render({ books: [books[0]!, books[2]!] });
    reportCollectionTarget();
    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="c"] button'),
    );

    const last = container.querySelector<HTMLButtonElement>('[data-reader-book-id="c"] button')!;
    last.focus();
    act(() => {
      api.captureBook(books[2]!);
      const claim = api.beginBookMutation("c");
      api.completeBookMutation(claim, "deleted");
    });
    render({ books: [books[0]!] });
    reportCollectionTarget();
    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="a"] button'),
    );
  });

  it("returns to the same surviving book after an update", () => {
    const books = [book("a"), book("b")];
    render({ books });
    const target = container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!;
    target.focus();
    act(() => {
      api.captureBook(books[1]!);
      const claim = api.beginBookMutation("b");
      api.completeBookMutation(claim, "updated");
    });
    render({ books: [books[0]!, { ...books[1]!, isFavorite: true }] });
    reportCollectionTarget();
    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });

  it("does not apply stale focus after the route or archive changes", () => {
    const books = [book("a"), book("b")];
    render({ books });
    container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!.focus();
    let claim: BookMutationFocusClaim | null = null;
    act(() => {
      api.captureBook(books[1]!);
      claim = api.beginBookMutation("b");
    });

    render({ books, locationKey: "favorites" });
    act(() => api.completeBookMutation(claim, "updated"));
    expect(api.collectionRequest).toBeNull();

    container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!.focus();
    act(() => {
      api.captureBook(books[1]!);
      claim = api.beginBookMutation("b");
    });
    render({ activeArchiveId: "archive-b", books, locationKey: "favorites" });
    act(() => api.completeBookMutation(claim, "updated"));
    expect(api.collectionRequest).toBeNull();
  });

  it("restores folder deletion to the next folder, then the collection entry", () => {
    const folders = [folder("a", "A"), folder("b", "B")];
    render({ books: [], folders });
    const first = container.querySelector<HTMLButtonElement>(
      '[data-library-folder-path="A"] button',
    )!;
    first.focus();
    act(() => {
      api.captureFolderDeletion(folders[0]!);
      const claim = api.beginFolderDeletion("a");
      api.completeFolderDeletion(claim);
    });
    render({ books: [], folders: [folders[1]!] });
    expect(document.activeElement).toBe(
      container.querySelector('[data-library-folder-path="B"] button'),
    );

    const finalFolder = container.querySelector<HTMLButtonElement>(
      '[data-library-folder-path="B"] button',
    )!;
    finalFolder.focus();
    act(() => {
      api.captureFolderDeletion(folders[1]!);
      const claim = api.beginFolderDeletion("b");
      api.completeFolderDeletion(claim);
    });
    render({ books: [], folders: [] });
    expect(document.activeElement).toBe(
      container.querySelector("[data-library-folder-collection-entry]"),
    );
  });

  it("does not restore folder deletion focus after an unrelated route takes ownership", () => {
    const folders = [folder("a", "A"), folder("b", "B")];
    render({ books: [], folders, locationKey: "folders" });
    const first = container.querySelector<HTMLButtonElement>(
      '[data-library-folder-path="A"] button',
    )!;
    first.focus();
    act(() => {
      api.captureFolderDeletion(folders[0]!);
      const claim = api.beginFolderDeletion("a");
      api.completeFolderDeletion(claim);
    });

    render({ books: [], folders: [folders[1]!], locationKey: "series" });

    expect(document.activeElement).not.toBe(
      container.querySelector('[data-library-folder-path="B"] button'),
    );
    expect(document.activeElement).not.toBe(
      container.querySelector("[data-library-folder-collection-entry]"),
    );
  });

  it("does not restore a deleted folder after an unrelated route takes ownership", () => {
    const folders = [folder("a", "A"), folder("b", "B")];
    render({ books: [], folders, locationKey: "folders" });
    const first = container.querySelector<HTMLButtonElement>(
      '[data-library-folder-path="A"] button',
    )!;
    first.focus();
    act(() => {
      api.captureFolderDeletion(folders[0]!);
      const claim = api.beginFolderDeletion("a");
      api.completeFolderDeletion(claim);
    });

    render({ books: [], folders: [folders[1]!], locationKey: "favorites" });

    expect(document.activeElement).not.toBe(
      container.querySelector('[data-library-folder-path="B"] button'),
    );
    expect(document.activeElement).not.toBe(
      container.querySelector("[data-library-folder-collection-entry]"),
    );
  });

  it("ignores an older operation after a newer focus claim supersedes it", () => {
    const books = [book("a"), book("b")];
    render({ books });
    const target = container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!;
    target.focus();

    let olderClaim: BookMutationFocusClaim | null = null;
    let newerClaim: BookMutationFocusClaim | null = null;
    act(() => {
      api.captureBook(books[1]!);
      olderClaim = api.beginBookMutation("b");
      api.captureBook(books[1]!);
      newerClaim = api.beginBookMutation("b");
      api.completeBookMutation(olderClaim, "updated");
    });
    expect(api.collectionRequest).toBeNull();

    act(() => api.completeBookMutation(newerClaim, "updated"));
    render({ books: [books[0]!, { ...books[1]!, updatedAt: "2" }] });
    reportCollectionTarget();
    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });

  it("does not steal focus for background collection updates", () => {
    const books = [book("a"), book("b")];
    render({ books });
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    render({ books: [{ ...books[0]!, updatedAt: "2" }, books[1]!] });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
