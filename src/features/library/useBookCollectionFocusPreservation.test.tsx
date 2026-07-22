// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import type { Book } from "../../types/book";
import { resetTransientSurfaceOwnershipForTests } from "../../utils/transientSurfaceOwnership";
import { useBookCollectionFocusPreservation } from "./useBookCollectionFocusPreservation";

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

type HarnessProps = {
  active?: boolean;
  books: readonly Book[];
  ownerKey?: string;
  revision: string;
  surface?: "quick-actions" | "settings" | null;
  suspended?: boolean;
};

function Harness({
  active = true,
  books,
  ownerKey = "archive:library",
  revision,
  surface = null,
  suspended = false,
}: HarnessProps) {
  const collectionRootRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  const request = useBookCollectionFocusPreservation({
    active,
    books,
    collectionRootRef,
    fallbackRef,
    ownerKey,
    revision,
    suspended,
  });

  useLayoutEffect(() => {
    if (!request) return;
    const target = collectionRootRef.current?.querySelector<HTMLElement>(
      `[data-reader-book-id="${request.bookId}"] button`,
    );
    if (target) request.onTargetReady(request.bookId, request.index, target);
  }, [request, revision]);

  return (
    <div>
      <button ref={fallbackRef} type="button">
        Search
      </button>
      <div key={revision} ref={collectionRootRef}>
        {books.map((item) => (
          <div data-reader-book-id={item.id} key={item.id}>
            <button type="button">{item.id}</button>
          </div>
        ))}
      </div>
      {surface ? <OwnedDialog kind={surface} /> : null}
    </div>
  );
}

function OwnedDialog({ kind }: { kind: "quick-actions" | "settings" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modal = useModalDialogLifecycle({
    dialogRef,
    onClose: () => undefined,
    surfaceKind: kind,
  });
  return (
    <dialog
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <button type="button">{kind}</button>
    </dialog>
  );
}

describe("book collection focus preservation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
    resetTransientSurfaceOwnershipForTests();
    vi.restoreAllMocks();
  });

  async function render(props: HarnessProps) {
    await act(async () => {
      root.render(<Harness {...props} />);
      await Promise.resolve();
    });
  }

  async function focus(element: HTMLElement) {
    await act(async () => {
      element.focus();
      await Promise.resolve();
    });
  }

  it("preserves the same logical book across collection presentation replacement", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid:medium" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);

    await render({ books, revision: "list:large" });

    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });

  it("uses the nearest surviving book when the focused item disappears", async () => {
    const books = [book("a"), book("b"), book("c")];
    await render({ books, revision: "one" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);

    await render({ books: [books[0]!, books[2]!], revision: "two" });

    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="c"] button'),
    );
  });

  it("does not steal focus from an outside owner or restore after the collection deactivates", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "one" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);
    const outside = document.createElement("button");
    document.body.append(outside);

    await focus(outside);
    await render({ books: [{ ...books[0]!, updatedAt: "2" }, books[1]!], revision: "two" });
    expect(document.activeElement).toBe(outside);

    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);
    await render({ active: false, books, revision: "route-away" });
    expect(document.activeElement).not.toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
    outside.remove();
  });
  it("retains a logical book while Settings replaces its collection element", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid" });
    const original = container.querySelector<HTMLButtonElement>(
      '[data-reader-book-id="b"] button',
    )!;
    await focus(original);

    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await render({ books, revision: "list", surface: "settings" });
    expect(original.isConnected).toBe(false);

    await render({ books, revision: "list" });

    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });

  it("retains the book through Quick Actions opening Settings", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid" });
    const original = container.querySelector<HTMLButtonElement>(
      '[data-reader-book-id="b"] button',
    )!;
    await focus(original);

    await render({ books, revision: "grid", surface: "quick-actions" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await focus(original);
    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await render({ books, revision: "list", surface: "settings" });
    await render({ books, revision: "list" });

    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });

  it("uses the nearest visible successor when the transient hides the original book", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);
    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await render({ books: [books[0]!], revision: "filtered", surface: "settings" });
    await render({ books: [books[0]!], revision: "filtered" });

    expect(document.activeElement).toBe(
      container.querySelector('[data-reader-book-id="a"] button'),
    );
  });

  it("uses the collection fallback after a transient filters out every book", async () => {
    const books = [book("a")];
    await render({ books, revision: "grid" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="a"] button')!);
    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);

    await render({ books: [], revision: "filtered", surface: "settings" });
    expect(document.activeElement).toBe(container.querySelector("dialog button"));
    await render({ books: [], revision: "filtered" });

    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("retires a transient request when a newer persistent control receives focus", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid" });
    const original = container.querySelector<HTMLButtonElement>(
      '[data-reader-book-id="b"] button',
    )!;
    await focus(original);
    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await render({ books, revision: "list", surface: "settings" });
    expect(original.isConnected).toBe(false);

    const outside = document.body.appendChild(document.createElement("button"));
    outside.textContent = "Persistent owner";
    await focus(outside);
    await render({ books, revision: "list" });

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("retires transient restoration after a newer route or archive owner takes over", async () => {
    const books = [book("a"), book("b")];
    await render({ books, revision: "grid" });
    await focus(container.querySelector<HTMLButtonElement>('[data-reader-book-id="b"] button')!);
    await render({ books, revision: "grid", surface: "settings" });
    await focus(container.querySelector<HTMLButtonElement>("dialog button")!);
    await render({ books, ownerKey: "archive-2:library", revision: "list", surface: "settings" });
    await render({ books, ownerKey: "archive-2:library", revision: "list" });

    expect(document.activeElement).not.toBe(
      container.querySelector('[data-reader-book-id="b"] button'),
    );
  });
});
