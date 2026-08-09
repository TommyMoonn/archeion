import type { HighlightAnnotation } from "../../types/annotation";
import {
  readerAnnotationIdentity,
  sameReaderAnnotationSession,
  type ReaderAnnotationIdentity,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";

export type ReaderAnnotationUndoEntry = Readonly<{
  annotation: HighlightAnnotation;
  id: number;
  identity: ReaderAnnotationIdentity;
  kind: "highlight-removal" | "note-removal";
  session: ReaderAnnotationSession;
}>;

export class ReaderAnnotationUndoQueue {
  private entries: ReaderAnnotationUndoEntry[] = [];
  private inFlight?: Readonly<{
    entry: ReaderAnnotationUndoEntry;
    promise: Promise<void>;
  }>;
  private sequence = 0;

  recordCommitted(
    session: ReaderAnnotationSession,
    kind: ReaderAnnotationUndoEntry["kind"],
    annotation: HighlightAnnotation,
  ): ReaderAnnotationUndoEntry {
    const entry = {
      annotation,
      id: ++this.sequence,
      identity: readerAnnotationIdentity(annotation),
      kind,
      session,
    } as const;
    this.entries.push(entry);
    return entry;
  }

  retire(entryId: number): void {
    this.entries = this.entries.filter((entry) => entry.id !== entryId);
  }

  retireOtherSessions(session: ReaderAnnotationSession): void {
    this.entries = this.entries.filter((entry) =>
      sameReaderAnnotationSession(entry.session, session),
    );
  }

  isRunningFor(annotationId: string, session: ReaderAnnotationSession): boolean {
    const entry = this.inFlight?.entry;
    return Boolean(
      entry &&
      entry.annotation.id === annotationId &&
      sameReaderAnnotationSession(entry.session, session),
    );
  }

  run(
    entryId: number,
    session: ReaderAnnotationSession,
    execute: (entry: ReaderAnnotationUndoEntry) => Promise<void>,
  ): Promise<void> {
    if (this.inFlight?.entry.id === entryId) return this.inFlight.promise;
    if (this.inFlight) return Promise.resolve();

    const entry = this.entries.at(-1);
    if (!entry || entry.id !== entryId || !sameReaderAnnotationSession(entry.session, session)) {
      return Promise.resolve();
    }

    const promise = execute(entry).finally(() => {
      this.retire(entry.id);
      if (this.inFlight?.entry.id === entry.id) this.inFlight = undefined;
    });
    this.inFlight = { entry, promise };
    return promise;
  }
}
