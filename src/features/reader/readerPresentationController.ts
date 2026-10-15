import type { LibraryStorage } from "../../storage/LibraryStorage";
import { resolveReaderPresentation, type ReaderPresentation } from "../../types/reader";

type PresentationSnapshot = Readonly<{
  presentation: ReaderPresentation;
  status: "idle" | "saving" | "failed";
}>;

// The library snapshot owns saved state. Only uncommitted intent and feedback live here.
export function createReaderPresentationController(storage: LibraryStorage, bookId: string | null) {
  const listeners = new Set<() => void>();
  let active = false;
  let revision = 0;
  let stop: (() => void) | null = null;
  let observed = storage.getLibrarySnapshot();
  let pending: ReaderPresentation | null = null;
  let failed: ReaderPresentation | null = null;
  const saved = () =>
    resolveReaderPresentation(
      observed.books.find((book) => book.id === bookId)?.readerPresentation,
    );
  let snapshot: PresentationSnapshot = { presentation: saved(), status: "idle" };

  function publish() {
    const next: PresentationSnapshot = {
      presentation: pending ?? saved(),
      status: pending ? "saving" : failed ? "failed" : "idle",
    };
    if (snapshot.presentation === next.presentation && snapshot.status === next.status) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function observe() {
    const next = storage.getLibrarySnapshot();
    if (
      observed.archiveGeneration !== next.archiveGeneration ||
      observed.archiveRootPath !== next.archiveRootPath
    ) {
      revision += 1;
      pending = null;
      failed = null;
    }
    observed = next;
    publish();
  }

  async function commit(presentation: ReaderPresentation): Promise<boolean> {
    if (!active || !bookId || !observed.books.some((book) => book.id === bookId)) return false;
    const request = ++revision;
    pending = presentation;
    failed = null;
    publish();
    try {
      const result = await storage.updateBook(bookId, { readerPresentation: presentation });
      if (!active || request !== revision) return false;
      observe();
      if (request !== revision) return false;
      pending = null;
      failed = result ? null : presentation;
      publish();
      return Boolean(result);
    } catch {
      if (!active || request !== revision) return false;
      pending = null;
      failed = presentation;
      publish();
      return false;
    }
  }

  return {
    activate() {
      if (active) return;
      active = true;
      observe();
      stop = storage.observeLibrarySnapshot({ next: observe });
    },
    commit,
    retry: () => (failed ? commit(failed) : Promise.resolve(false)),
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    teardown() {
      active = false;
      revision += 1;
      stop?.();
      stop = null;
      pending = null;
      failed = null;
    },
  };
}
