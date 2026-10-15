import type { LibrarySnapshot, StorageObserver } from "../../storage/LibraryStorage";
import type { Book } from "../../types/book";

export function createReaderLibrarySnapshotFixture(books: readonly Book[]) {
  const observers = new Set<StorageObserver<LibrarySnapshot>>();
  let snapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: "/archive",
    books,
    folders: [],
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  return {
    getLibrarySnapshot: () => snapshot,
    observeLibrarySnapshot(observer: StorageObserver<LibrarySnapshot>) {
      observers.add(observer);
      observer.next(snapshot);
      return () => {
        observers.delete(observer);
      };
    },
    publishBooks(next: readonly Book[]) {
      snapshot = { ...snapshot, books: next, revision: snapshot.revision + 1 };
      for (const observer of observers) observer.next(snapshot);
    },
  };
}
