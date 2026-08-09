import type { Book } from "../../types/book";
import type { ReaderLocation } from "./readerLocation";

export type ReaderStartMode = "resume" | "beginning";

export type ReaderSessionPhase =
  "idle" | "acquiring" | "starting" | "ready" | "recovering" | "closing" | "failed" | "closed";

const readerSessionIdentityBrand: unique symbol = Symbol("ReaderSessionIdentity");

export type ReaderSessionIdentity = Readonly<{
  [readerSessionIdentityBrand]: true;
  bookId: string;
  revision: number;
}>;

export type ReaderSessionLifecycle = Readonly<{
  identity: ReaderSessionIdentity | null;
  phase: ReaderSessionPhase;
  revision: number;
}>;

export type ReaderSessionEvent =
  | Readonly<{ bookId: string; type: "open" }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "source-acquired" }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "ready" }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "failed" }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "retry" }>
  | Readonly<{
      bookId: string;
      identity: ReaderSessionIdentity;
      type: "replace";
    }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "close" }>
  | Readonly<{ identity: ReaderSessionIdentity; type: "closed" }>;

export type ReaderSessionTransition =
  | Readonly<{ kind: "accepted"; state: ReaderSessionLifecycle }>
  | Readonly<{
      kind: "retired";
      reason: "attempt-retired" | "identity-mismatch" | "session-terminal";
      state: ReaderSessionLifecycle;
    }>
  | Readonly<{
      kind: "rejected";
      reason: "invalid-transition";
      state: ReaderSessionLifecycle;
    }>;

export type ReaderSessionInitialState = {
  bookId: string | null;
  initialCfi?: string;
  initialLocation: ReaderLocation;
  startFromBeginning: boolean;
};

const EMPTY_READER_LOCATION: ReaderLocation = {
  cfi: "",
  percentage: 0,
  atStart: true,
  atEnd: false,
};

const TERMINAL_OR_TERMINATING_PHASES = new Set<ReaderSessionPhase>(["closing", "closed"]);

function createIdentity(bookId: string, revision: number): ReaderSessionIdentity {
  const identity: ReaderSessionIdentity = { [readerSessionIdentityBrand]: true, bookId, revision };
  return Object.freeze(identity);
}

function accept(
  state: ReaderSessionLifecycle,
  phase: ReaderSessionPhase,
  identity = state.identity,
  revision = state.revision,
): ReaderSessionTransition {
  return {
    kind: "accepted",
    state: Object.freeze({ identity, phase, revision }),
  };
}

function beginSession(
  state: ReaderSessionLifecycle,
  bookId: string,
  phase: "acquiring" | "recovering",
): ReaderSessionTransition {
  const revision = state.revision + 1;
  return accept(state, phase, createIdentity(bookId, revision), revision);
}

function reject(state: ReaderSessionLifecycle): ReaderSessionTransition {
  return { kind: "rejected", reason: "invalid-transition", state };
}

function retire(
  state: ReaderSessionLifecycle,
  reason: "attempt-retired" | "identity-mismatch" | "session-terminal",
): ReaderSessionTransition {
  return { kind: "retired", reason, state };
}

function identitiesMatch(
  current: ReaderSessionIdentity | null,
  candidate: ReaderSessionIdentity,
): boolean {
  // Reference ownership prevents separate lifecycles for the same book from sharing events.
  return current === candidate;
}

export function createReaderSessionLifecycle(): ReaderSessionLifecycle {
  return Object.freeze({ identity: null, phase: "idle", revision: 0 });
}

export function transitionReaderSession(
  state: ReaderSessionLifecycle,
  event: ReaderSessionEvent,
): ReaderSessionTransition {
  if (event.type === "open") {
    return state.phase === "idle" || state.phase === "closed"
      ? beginSession(state, event.bookId, "acquiring")
      : reject(state);
  }

  if (!identitiesMatch(state.identity, event.identity)) {
    return retire(state, "identity-mismatch");
  }

  if (event.type === "closed") {
    return state.phase === "closing" ? accept(state, "closed") : reject(state);
  }

  if (event.type === "retry") {
    return state.phase === "failed"
      ? beginSession(state, event.identity.bookId, "recovering")
      : reject(state);
  }

  if (event.type === "replace") {
    if (state.phase === "closing" || state.phase === "closed") {
      return retire(state, "session-terminal");
    }
    return state.phase !== "idle" ? beginSession(state, event.bookId, "acquiring") : reject(state);
  }

  if (event.type === "close") {
    return state.phase !== "idle" && state.phase !== "closed" && state.phase !== "closing"
      ? accept(state, "closing")
      : reject(state);
  }

  if (state.phase === "failed") {
    return retire(state, "attempt-retired");
  }

  if (TERMINAL_OR_TERMINATING_PHASES.has(state.phase)) {
    return retire(state, "session-terminal");
  }

  if (event.type === "source-acquired") {
    return state.phase === "acquiring" || state.phase === "recovering"
      ? accept(state, "starting")
      : reject(state);
  }

  if (event.type === "ready") {
    return state.phase === "starting" ? accept(state, "ready") : reject(state);
  }

  if (event.type === "failed") {
    return state.phase === "acquiring" ||
      state.phase === "starting" ||
      state.phase === "ready" ||
      state.phase === "recovering"
      ? accept(state, "failed")
      : reject(state);
  }

  return reject(state);
}

export function createReaderSessionKey(
  bookId: string | undefined,
  startMode: ReaderStartMode,
): string {
  return `${bookId ?? "missing"}:${startMode}`;
}

export function createReaderSessionInitialState(
  book: Book | undefined,
  startFromBeginning: boolean,
): ReaderSessionInitialState {
  if (!book || startFromBeginning) {
    return {
      bookId: book?.id ?? null,
      initialLocation: EMPTY_READER_LOCATION,
      startFromBeginning,
    };
  }

  const cfi = book.progressCfi ?? "";

  return {
    bookId: book.id,
    initialCfi: cfi || undefined,
    initialLocation: {
      cfi,
      percentage: book.progressPercent ?? 0,
      atStart: !cfi,
      atEnd: false,
    },
    startFromBeginning,
  };
}
