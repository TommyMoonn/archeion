export type ReaderNavigationHistoryEntry = Readonly<{
  target: string;
}>;

export type ReaderNavigationHistoryOutcome = "failed" | "succeeded";

export type ReaderNavigationHistorySnapshot = Readonly<{
  backCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  forwardCount: number;
}>;

export type ReaderNavigationHistory = Readonly<{
  completeBackReplay: (
    returnEntry: ReaderNavigationHistoryEntry,
    replayedEntry: ReaderNavigationHistoryEntry,
    outcome: ReaderNavigationHistoryOutcome,
  ) => boolean;
  completeForwardReplay: (
    returnEntry: ReaderNavigationHistoryEntry,
    replayedEntry: ReaderNavigationHistoryEntry,
    outcome: ReaderNavigationHistoryOutcome,
  ) => boolean;
  getBackTarget: () => ReaderNavigationHistoryEntry | undefined;
  getForwardTarget: () => ReaderNavigationHistoryEntry | undefined;
  getSnapshot: () => ReaderNavigationHistorySnapshot;
  recordJump: (
    returnEntry: ReaderNavigationHistoryEntry,
    outcome: ReaderNavigationHistoryOutcome,
  ) => boolean;
  reset: () => void;
}>;

export function createReaderNavigationHistory(maxEntries: number): ReaderNavigationHistory {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError("Reader navigation history maxEntries must be a positive safe integer.");
  }

  let backEntries: ReaderNavigationHistoryEntry[] = [];
  let forwardEntries: ReaderNavigationHistoryEntry[] = [];

  function snapshotEntry(entry: ReaderNavigationHistoryEntry): ReaderNavigationHistoryEntry {
    return Object.freeze({ target: entry.target });
  }

  function sameLocation(
    left: ReaderNavigationHistoryEntry | undefined,
    right: ReaderNavigationHistoryEntry,
  ): boolean {
    return left?.target === right.target;
  }

  function appendBounded(
    entries: ReaderNavigationHistoryEntry[],
    entry: ReaderNavigationHistoryEntry,
  ): boolean {
    if (sameLocation(entries.at(-1), entry)) return false;

    entries.push(snapshotEntry(entry));
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    return true;
  }

  function getSnapshot(): ReaderNavigationHistorySnapshot {
    return Object.freeze({
      backCount: backEntries.length,
      canGoBack: backEntries.length > 0,
      canGoForward: forwardEntries.length > 0,
      forwardCount: forwardEntries.length,
    });
  }

  function completeReplay(
    source: ReaderNavigationHistoryEntry[],
    destination: ReaderNavigationHistoryEntry[],
    returnEntry: ReaderNavigationHistoryEntry,
    replayedEntry: ReaderNavigationHistoryEntry,
    outcome: ReaderNavigationHistoryOutcome,
  ): boolean {
    if (outcome !== "succeeded" || !sameLocation(source.at(-1), replayedEntry)) {
      return false;
    }

    source.pop();
    appendBounded(destination, returnEntry);
    return true;
  }

  return Object.freeze({
    completeBackReplay(returnEntry, replayedEntry, outcome) {
      return completeReplay(backEntries, forwardEntries, returnEntry, replayedEntry, outcome);
    },
    completeForwardReplay(returnEntry, replayedEntry, outcome) {
      return completeReplay(forwardEntries, backEntries, returnEntry, replayedEntry, outcome);
    },
    getBackTarget: () => backEntries.at(-1),
    getForwardTarget: () => forwardEntries.at(-1),
    getSnapshot,
    recordJump(returnEntry, outcome) {
      if (outcome !== "succeeded") return false;

      const changed = appendBounded(backEntries, returnEntry);
      if (forwardEntries.length > 0) {
        forwardEntries = [];
        return true;
      }
      return changed;
    },
    reset() {
      backEntries = [];
      forwardEntries = [];
    },
  });
}
