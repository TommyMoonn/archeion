import type { ReaderSessionIdentity } from "./readerSession";
import {
  createReaderNavigationHistory,
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
  unbindDisplay: (owner: object) => boolean;
}>;

const EMPTY_HISTORY_SNAPSHOT: ReaderNavigationHistorySnapshot = Object.freeze({
  backCount: 0,
  canGoBack: false,
  canGoForward: false,
  forwardCount: 0,
});

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
      return complete(returnTarget ? historyEntry(returnTarget) : undefined);
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
      return true;
    },
    forward: () => replay("forward"),
    getCurrentTarget: () => activeSession?.currentTarget,
    getHistorySnapshot: () => activeSession?.history.getSnapshot() ?? EMPTY_HISTORY_SNAPSHOT,
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
