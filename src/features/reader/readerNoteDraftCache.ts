export type ReaderNoteDraftKey = {
  bookId: string;
  sessionToken: symbol;
  targetIdentity: string;
};

export type ReaderNoteDraft = Readonly<{
  text: string;
}>;

function targetKey(key: ReaderNoteDraftKey): string {
  return `${key.bookId}\u0000${key.targetIdentity}`;
}

export class ReaderNoteDraftCache {
  private readonly sessions = new Map<symbol, Map<string, ReaderNoteDraft>>();

  read(key: ReaderNoteDraftKey): ReaderNoteDraft | undefined {
    return this.sessions.get(key.sessionToken)?.get(targetKey(key));
  }

  update(key: ReaderNoteDraftKey, text: string): void {
    let drafts = this.sessions.get(key.sessionToken);
    if (!drafts) {
      drafts = new Map();
      this.sessions.set(key.sessionToken, drafts);
    }
    drafts.set(targetKey(key), { text });
  }

  confirmPersisted(key: ReaderNoteDraftKey, text: string): boolean {
    const drafts = this.sessions.get(key.sessionToken);
    const keyValue = targetKey(key);
    if (drafts?.get(keyValue)?.text !== text) return false;
    drafts.delete(keyValue);
    if (drafts.size === 0) this.sessions.delete(key.sessionToken);
    return true;
  }

  clear(key: ReaderNoteDraftKey): void {
    const drafts = this.sessions.get(key.sessionToken);
    if (!drafts) return;
    drafts.delete(targetKey(key));
    if (drafts.size === 0) this.sessions.delete(key.sessionToken);
  }

  clearSession(sessionToken: symbol): void {
    this.sessions.delete(sessionToken);
  }

  clearAll(): void {
    this.sessions.clear();
  }
}
