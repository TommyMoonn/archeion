import type { ReaderSessionIdentity } from "./readerSession";
import {
  createReaderNavigationHistory,
  EMPTY_READER_NAVIGATION_HISTORY_SNAPSHOT,
  type ReaderNavigationHistoryEntry,
  type ReaderNavigationHistorySnapshot,
} from "./readerNavigationHistory";

export const READER_NAVIGATION_HISTORY_LIMIT = 100;

export type ReaderDeliberateNavigationDisplayOptions = Readonly<{
  requireUsableLocation: boolean;
}>;

type ReaderDeliberateNavigationDisplay = (
  target: string,
  options: ReaderDeliberateNavigationDisplayOptions,
) => Promise<boolean>;

type ReaderDeliberateNavigationBinding = Readonly<{
  display: ReaderDeliberateNavigationDisplay;
  owner: object;
}>;

type ReaderDeliberateNavigationSession = {
  binding?: ReaderDeliberateNavigationBinding;
  currentTarget?: string;
  history: ReturnType<typeof createReaderNavigationHistory>;
  identity: ReaderSessionIdentity;
  operation?: symbol;
};

export type ReaderDeliberateNavigationController = Readonly<{
  back: () => Promise<boolean>;
  bindDisplay: (
    identity: ReaderSessionIdentity,
    owner: object,
    display: ReaderDeliberateNavigationDisplay,
    currentTarget?: string,
  ) => boolean;
  endSession: (identity: ReaderSessionIdentity) => boolean;
  forward: () => Promise<boolean>;
  getCurrentTarget: () => string | undefined;
  getHistorySnapshot: () => ReaderNavigationHistorySnapshot;
  jump: (
    target: string,
    options?: Partial<ReaderDeliberateNavigationDisplayOptions>,
  ) => Promise<boolean>;
  relocate: (owner: object, target: string) => boolean;
  startSession: (identity: ReaderSessionIdentity, initialTarget?: string) => void;
  subscribeHistory: (listener: () => void) => () => void;
  unbindDisplay: (owner: object) => boolean;
}>;

function normalizedTarget(target: string | undefined): string | undefined {
  const normalized = target?.trim();
  return normalized || undefined;
}

function historyEntry(target: string): ReaderNavigationHistoryEntry {
  return Object.freeze({ target });
}

export function createReaderDeliberateNavigationController(
  maxHistoryEntries: number,
): ReaderDeliberateNavigationController {
  let activeSession: ReaderDeliberateNavigationSession | null = null;
  let historySnapshot = EMPTY_READER_NAVIGATION_HISTORY_SNAPSHOT;
  const historyListeners = new Set<() => void>();

  const publishHistory = (session: ReaderDeliberateNavigationSession | null) => {
    const next = session?.history.getSnapshot() ?? EMPTY_READER_NAVIGATION_HISTORY_SNAPSHOT;
    if (
      next.backCount === historySnapshot.backCount &&
      next.canGoBack === historySnapshot.canGoBack &&
      next.canGoForward === historySnapshot.canGoForward &&
      next.forwardCount === historySnapshot.forwardCount
    ) {
      return;
    }

    historySnapshot = next;
    for (const listener of historyListeners) listener();
  };

  const ownsBinding = (
    session: ReaderDeliberateNavigationSession,
    binding: ReaderDeliberateNavigationBinding,
    operation: symbol,
  ) => activeSession === session && session.binding === binding && session.operation === operation;

  const runDisplay = async (
    session: ReaderDeliberateNavigationSession,
    binding: ReaderDeliberateNavigationBinding,
    target: string,
    options: ReaderDeliberateNavigationDisplayOptions,
    requireReturnTarget: boolean,
    complete: (returnEntry: ReaderNavigationHistoryEntry | undefined) => boolean,
  ): Promise<boolean> => {
    const returnTarget = normalizedTarget(session.currentTarget);
    if ((requireReturnTarget && !returnTarget) || session.operation) return false;

    const operation = Symbol("reader-deliberate-navigation");
    session.operation = operation;
    try {
      const displayed = await binding.display(target, options);
      if (!displayed || !ownsBinding(session, binding, operation)) return false;
      if (session.currentTarget === returnTarget) session.currentTarget = target;
      const completed = complete(returnTarget ? historyEntry(returnTarget) : undefined);
      if (completed) publishHistory(session);
      return completed;
    } catch {
      return false;
    } finally {
      if (ownsBinding(session, binding, operation)) session.operation = undefined;
    }
  };

  const replay = async (direction: "back" | "forward"): Promise<boolean> => {
    const session = activeSession;
    const binding = session?.binding;
    if (!session || !binding) return false;

    const replayEntry =
      direction === "back" ? session.history.getBackTarget() : session.history.getForwardTarget();
    if (!replayEntry) return false;

    return runDisplay(
      session,
      binding,
      replayEntry.target,
      { requireUsableLocation: false },
      true,
      (returnEntry) =>
        returnEntry
          ? direction === "back"
            ? session.history.completeBackReplay(returnEntry, replayEntry, "succeeded")
            : session.history.completeForwardReplay(returnEntry, replayEntry, "succeeded")
          : false,
    );
  };

  return Object.freeze({
    back: () => replay("back"),
    bindDisplay(identity, owner, display, currentTarget) {
      const session = activeSession;
      if (!session || session.identity !== identity) return false;
      session.binding = Object.freeze({ display, owner });
      session.currentTarget = normalizedTarget(currentTarget);
      session.operation = undefined;
      return true;
    },
    endSession(identity) {
      const session = activeSession;
      if (!session || session.identity !== identity) return false;
      session.history.reset();
      session.binding = undefined;
      session.operation = undefined;
      activeSession = null;
      publishHistory(null);
      return true;
    },
    forward: () => replay("forward"),
    getCurrentTarget: () => activeSession?.currentTarget,
    getHistorySnapshot: () => historySnapshot,
    async jump(rawTarget, options = {}) {
      const session = activeSession;
      const binding = session?.binding;
      const target = normalizedTarget(rawTarget);
      if (!session || !binding || !target) return false;

      return runDisplay(
        session,
        binding,
        target,
        { requireUsableLocation: options.requireUsableLocation ?? false },
        false,
        (returnEntry) => {
          if (returnEntry) session.history.recordJump(returnEntry, "succeeded");
          return true;
        },
      );
    },
    relocate(owner, rawTarget) {
      const session = activeSession;
      const target = normalizedTarget(rawTarget);
      if (!session || session.binding?.owner !== owner || !target) return false;
      session.currentTarget = target;
      return true;
    },
    startSession(identity, initialTarget) {
      if (activeSession?.identity === identity) {
        activeSession.currentTarget ??= normalizedTarget(initialTarget);
        return;
      }
      activeSession = {
        currentTarget: normalizedTarget(initialTarget),
        history: createReaderNavigationHistory(maxHistoryEntries),
        identity,
      };
      publishHistory(activeSession);
    },
    subscribeHistory(listener) {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },
    unbindDisplay(owner) {
      const session = activeSession;
      if (!session || session.binding?.owner !== owner) return false;
      session.binding = undefined;
      session.operation = undefined;
      return true;
    },
  });
}
