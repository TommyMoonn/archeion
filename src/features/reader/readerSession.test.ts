import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  createReaderSessionInitialState,
  createReaderSessionKey,
  createReaderSessionLifecycle,
  transitionReaderSession,
  type ReaderSessionIdentity,
  type ReaderSessionLifecycle,
  type ReaderSessionTransition,
} from "./readerSession";

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  originalTitle: "Volume 01",
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  progressCfi: "epubcfi(/6/2)",
  progressPercent: 38.5,
};

describe("reader session initial state", () => {
  it("captures the stored progress location when opening normally", () => {
    const session = createReaderSessionInitialState(book, false);

    expect(session).toEqual({
      bookId: "book-1",
      initialCfi: "epubcfi(/6/2)",
      initialLocation: {
        cfi: "epubcfi(/6/2)",
        percentage: 38.5,
        atStart: false,
        atEnd: false,
      },
      startFromBeginning: false,
    });
  });

  it("uses an empty starting location when starting from beginning", () => {
    const session = createReaderSessionInitialState(book, true);

    expect(session.initialCfi).toBeUndefined();
    expect(session.initialLocation).toEqual({
      cfi: "",
      percentage: 0,
      atStart: true,
      atEnd: false,
    });
  });

  it("keys reader route sessions by book and start mode only", () => {
    const normalKey = createReaderSessionKey(book.id, "resume");
    const progressOnlyUpdateKey = createReaderSessionKey(
      { ...book, progressCfi: "epubcfi(/6/8)", progressPercent: 54 }.id,
      "resume",
    );

    expect(progressOnlyUpdateKey).toBe(normalKey);
    expect(createReaderSessionKey(book.id, "beginning")).not.toBe(normalKey);
    expect(createReaderSessionKey("book-2", "resume")).not.toBe(normalKey);
  });
});

function accepted(transition: ReaderSessionTransition): ReaderSessionLifecycle {
  if (transition.kind !== "accepted") {
    throw new Error(`Expected an accepted transition, received ${transition.kind}.`);
  }
  return transition.state;
}

function identity(state: ReaderSessionLifecycle): ReaderSessionIdentity {
  if (!state.identity) throw new Error("Expected the lifecycle to own a session identity.");
  return state.identity;
}

describe("reader session lifecycle", () => {
  it("describes startup, ready, route leave, and closed terminal state", () => {
    const idle = createReaderSessionLifecycle();
    const acquiring = accepted(transitionReaderSession(idle, { bookId: "book-1", type: "open" }));
    const session = identity(acquiring);
    const starting = accepted(
      transitionReaderSession(acquiring, { identity: session, type: "source-acquired" }),
    );
    const ready = accepted(transitionReaderSession(starting, { identity: session, type: "ready" }));
    const closing = accepted(transitionReaderSession(ready, { identity: session, type: "close" }));
    const closed = accepted(
      transitionReaderSession(closing, { identity: session, type: "closed" }),
    );

    expect([
      idle.phase,
      acquiring.phase,
      starting.phase,
      ready.phase,
      closing.phase,
      closed.phase,
    ]).toEqual(["idle", "acquiring", "starting", "ready", "closing", "closed"]);
  });

  it("gives retry a new identity and retires completions from the failed attempt", () => {
    const acquiring = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );
    const failedIdentity = identity(acquiring);
    const failed = accepted(
      transitionReaderSession(acquiring, { identity: failedIdentity, type: "failed" }),
    );
    const recovering = accepted(
      transitionReaderSession(failed, { identity: failedIdentity, type: "retry" }),
    );
    const recoveryIdentity = identity(recovering);

    expect(recovering.phase).toBe("recovering");
    expect(recoveryIdentity.bookId).toBe(failedIdentity.bookId);
    expect(recoveryIdentity.revision).toBeGreaterThan(failedIdentity.revision);

    const staleReady = transitionReaderSession(recovering, {
      identity: failedIdentity,
      type: "ready",
    });
    expect(staleReady).toMatchObject({
      kind: "retired",
      reason: "identity-mismatch",
      state: recovering,
    });

    const starting = accepted(
      transitionReaderSession(recovering, {
        identity: recoveryIdentity,
        type: "source-acquired",
      }),
    );
    expect(
      accepted(transitionReaderSession(starting, { identity: recoveryIdentity, type: "ready" }))
        .phase,
    ).toBe("ready");
  });

  it("replaces an active book with a new identity and ignores the retired book", () => {
    const first = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );
    const firstIdentity = identity(first);
    const replacement = accepted(
      transitionReaderSession(first, {
        bookId: "book-2",
        identity: firstIdentity,
        type: "replace",
      }),
    );

    expect(replacement.phase).toBe("acquiring");
    expect(identity(replacement)).toMatchObject({ bookId: "book-2", revision: 2 });
    expect(identity(replacement)).not.toBe(firstIdentity);
    expect(
      transitionReaderSession(replacement, {
        identity: firstIdentity,
        type: "source-acquired",
      }),
    ).toMatchObject({ kind: "retired", reason: "identity-mismatch", state: replacement });
  });

  it("does not confuse a retired lifecycle with a new lifecycle for the same book", () => {
    const retired = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );
    const current = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );

    expect(identity(current)).toMatchObject({ bookId: "book-1", revision: 1 });
    expect(identity(retired)).toMatchObject({ bookId: "book-1", revision: 1 });
    expect(identity(current)).not.toBe(identity(retired));
    expect(
      transitionReaderSession(current, { identity: identity(retired), type: "source-acquired" }),
    ).toMatchObject({ kind: "retired", reason: "identity-mismatch", state: current });
  });

  it("does not allow callers to reconstruct an owned session identity structurally", () => {
    // @ts-expect-error Reader session identities are created and owned by the lifecycle.
    const reconstructed: ReaderSessionIdentity = { bookId: "book-1", revision: 1 };

    expect(reconstructed).toEqual({ bookId: "book-1", revision: 1 });
  });

  it("reopens a closed book with a new identity and retires the closed session", () => {
    const first = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );
    const firstIdentity = identity(first);
    const closing = accepted(
      transitionReaderSession(first, { identity: firstIdentity, type: "close" }),
    );
    const closed = accepted(
      transitionReaderSession(closing, { identity: firstIdentity, type: "closed" }),
    );
    const reopened = accepted(transitionReaderSession(closed, { bookId: "book-1", type: "open" }));

    expect(identity(reopened)).toMatchObject({ bookId: "book-1", revision: 2 });
    expect(identity(reopened)).not.toBe(firstIdentity);
    expect(
      transitionReaderSession(reopened, { identity: firstIdentity, type: "source-acquired" }),
    ).toMatchObject({ kind: "retired", reason: "identity-mismatch", state: reopened });
  });

  it("treats completions after failure or unmount closure as retired", () => {
    const acquiring = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );
    const session = identity(acquiring);
    const failed = accepted(
      transitionReaderSession(acquiring, { identity: session, type: "failed" }),
    );

    expect(
      transitionReaderSession(failed, { identity: session, type: "source-acquired" }),
    ).toMatchObject({ kind: "retired", reason: "attempt-retired", state: failed });
    expect(transitionReaderSession(failed, { identity: session, type: "ready" })).toMatchObject({
      kind: "retired",
      reason: "attempt-retired",
      state: failed,
    });

    const closing = accepted(transitionReaderSession(failed, { identity: session, type: "close" }));
    expect(
      transitionReaderSession(closing, { identity: session, type: "source-acquired" }),
    ).toMatchObject({ kind: "retired", reason: "session-terminal", state: closing });
    expect(
      transitionReaderSession(closing, {
        bookId: "book-2",
        identity: session,
        type: "replace",
      }),
    ).toMatchObject({ kind: "retired", reason: "session-terminal", state: closing });

    const closed = accepted(
      transitionReaderSession(closing, { identity: session, type: "closed" }),
    );
    expect(transitionReaderSession(closed, { identity: session, type: "ready" })).toMatchObject({
      kind: "retired",
      reason: "session-terminal",
      state: closed,
    });
  });

  it("rejects out-of-order events from the current identity without mutating state", () => {
    const acquiring = accepted(
      transitionReaderSession(createReaderSessionLifecycle(), {
        bookId: "book-1",
        type: "open",
      }),
    );

    expect(
      transitionReaderSession(acquiring, { identity: identity(acquiring), type: "ready" }),
    ).toEqual({ kind: "rejected", reason: "invalid-transition", state: acquiring });
  });
});
