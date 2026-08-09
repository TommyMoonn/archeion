import type { LibraryStorage } from "../../storage/LibraryStorage";
import { CoalescedWriteQueue } from "../../storage/CoalescedWriteQueue";
import type { Book, UpdateBookInput } from "../../types/book";
import {
  createReaderProgressInitialState,
  normalizeReaderLocation,
  type ReaderLocation,
  type ReaderRelocation,
} from "./readerLocation";
import type { ReaderSessionIdentity } from "./readerSession";

type ReaderProgressPersistence = Pick<LibraryStorage, "flushPendingWrites" | "updateBook">;

type ReaderProgressControllerOptions = Readonly<{
  book: Pick<Book, "id" | "progressCfi" | "progressPercent">;
  identity: ReaderSessionIdentity;
  onPersistenceFailureChange: (failed: boolean) => void;
  persistence: ReaderProgressPersistence;
  startFromBeginning: boolean;
}>;

export type ReaderProgressController = Readonly<{
  acceptRelocation: (
    identity: ReaderSessionIdentity,
    relocation: ReaderRelocation,
  ) => ReaderLocation | null;
  activate: () => void;
  flush: () => Promise<boolean>;
  getInitialCfi: () => string | undefined;
  getLocation: () => ReaderLocation;
  recordOpened: (identity: ReaderSessionIdentity, openedAt?: string) => boolean;
  replaceIdentity: (
    currentIdentity: ReaderSessionIdentity,
    replacementIdentity: ReaderSessionIdentity,
  ) => boolean;
  teardown: () => Promise<void>;
}>;

export function createReaderProgressController({
  book,
  identity,
  onPersistenceFailureChange,
  persistence,
  startFromBeginning,
}: ReaderProgressControllerOptions): ReaderProgressController {
  const initialState = createReaderProgressInitialState(book, startFromBeginning);
  let active = true;
  let desiredChanges: UpdateBookInput = {};
  let location = initialState.location;
  let ownedIdentity = identity;
  let persistenceRevision = 0;
  let teardownPromise: Promise<void> | null = null;

  // Batch same-turn Reader events; storage remains the owner of durable write timing and retries.
  const writes = new CoalescedWriteQueue<UpdateBookInput>({
    delayMs: 0,
    write: (changes) => {
      const revision = ++persistenceRevision;
      void persistence.updateBook(book.id, changes).then(
        () => {
          if (active && revision === persistenceRevision) onPersistenceFailureChange(false);
        },
        () => {
          if (active && revision === persistenceRevision) onPersistenceFailureChange(true);
        },
      );
      return Promise.resolve();
    },
  });

  function owns(candidate: ReaderSessionIdentity): boolean {
    return active && candidate === ownedIdentity;
  }

  function schedule(changes: UpdateBookInput): void {
    desiredChanges = { ...desiredChanges, ...changes };
    void writes.schedule({ ...desiredChanges }).catch(() => undefined);
  }

  async function flush(): Promise<boolean> {
    try {
      await writes.flush();
      await persistence.flushPendingWrites();
      if (active) onPersistenceFailureChange(false);
      return true;
    } catch {
      if (active) onPersistenceFailureChange(true);
      return false;
    }
  }

  return Object.freeze({
    acceptRelocation(candidate, relocation) {
      if (!owns(candidate)) return null;
      const nextLocation = normalizeReaderLocation(relocation);
      location = nextLocation;
      schedule({ progressCfi: nextLocation.cfi, progressPercent: nextLocation.percentage });
      return nextLocation;
    },
    activate() {
      active = true;
      teardownPromise = null;
    },
    flush,
    getInitialCfi: () => initialState.initialCfi,
    getLocation: () => location,
    recordOpened(candidate, openedAt = new Date().toISOString()) {
      if (!owns(candidate)) return false;
      schedule({ lastOpenedAt: openedAt });
      return true;
    },
    replaceIdentity(currentIdentity, replacementIdentity) {
      if (!owns(currentIdentity) || replacementIdentity.bookId !== book.id) return false;
      ownedIdentity = replacementIdentity;
      return true;
    },
    teardown() {
      if (teardownPromise) return teardownPromise;
      active = false;
      teardownPromise = flush().then(() => undefined);
      return teardownPromise;
    },
  });
}
