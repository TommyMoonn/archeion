import type { LibrarySnapshot, LibraryStorage } from "../../storage/LibraryStorage";
import type { ReaderPresentation } from "../../types/reader";

const EMPTY_SNAPSHOT: LibrarySnapshot = Object.freeze({
  archiveGeneration: 0,
  archiveRootPath: null,
  books: Object.freeze([]),
  folders: Object.freeze([]),
  loadState: "ready",
  revision: 0,
  scanStatus: Object.freeze({ status: "idle" }),
});

// Reader hooks share their presentation and annotation controllers. A temporary session
// has no book identity, so those hooks cannot perform library operations. Any attempted
// storage access other than the empty snapshot fails closed instead of writing sidecars.
export const temporaryReaderStorage: LibraryStorage = new Proxy(
  {
    getLibrarySnapshot: () => EMPTY_SNAPSHOT,
    observeLibrarySnapshot: () => () => undefined,
  },
  {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      throw new Error(`Temporary Reader cannot access archive storage: ${String(property)}`);
    },
  },
) as unknown as LibraryStorage;

export function createTemporaryReaderPresentationController() {
  let presentation: ReaderPresentation = "archeion";
  let snapshot: Readonly<{ presentation: ReaderPresentation; status: "idle" }> = Object.freeze({
    presentation,
    status: "idle",
  });
  const listeners = new Set<() => void>();
  return {
    activate() {},
    teardown() {
      listeners.clear();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async commit(next: ReaderPresentation) {
      presentation = next;
      snapshot = Object.freeze({ presentation, status: "idle" });
      listeners.forEach((listener) => listener());
      return true;
    },
    async retry() {
      return false;
    },
  };
}
