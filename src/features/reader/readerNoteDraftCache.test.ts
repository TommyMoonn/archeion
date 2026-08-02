import { describe, expect, it } from "vitest";

import { ReaderNoteDraftCache, type ReaderNoteDraftKey } from "./readerNoteDraftCache";

function key(sessionToken = Symbol("reader-session")): ReaderNoteDraftKey {
  return {
    bookId: "book-1",
    sessionToken,
    targetIdentity: "annotation:highlight-1",
  };
}

describe("ReaderNoteDraftCache", () => {
  it("restores the latest text for the same Reader session and target", () => {
    const cache = new ReaderNoteDraftCache();
    const target = key();

    cache.update(target, "First draft");
    cache.update(target, "Latest draft");

    expect(cache.read(target)).toEqual({ text: "Latest draft" });
  });

  it("does not let an older save completion erase a newer draft", () => {
    const cache = new ReaderNoteDraftCache();
    const target = key();
    cache.update(target, "Newer draft");

    expect(cache.confirmPersisted(target, "Older draft")).toBe(false);
    expect(cache.read(target)).toEqual({ text: "Newer draft" });
    expect(cache.confirmPersisted(target, "Newer draft")).toBe(true);
    expect(cache.read(target)).toBeUndefined();
  });

  it("retires only the matching target and exact persisted text", () => {
    const cache = new ReaderNoteDraftCache();
    const sessionToken = Symbol("reader-session");
    const target = key(sessionToken);
    const otherTarget = {
      ...key(sessionToken),
      targetIdentity: "annotation:highlight-2",
    };
    cache.update(target, "Newer draft");
    cache.update(otherTarget, "Other annotation draft");

    expect(cache.confirmPersisted(target, "Original note")).toBe(false);
    expect(cache.read(target)).toEqual({ text: "Newer draft" });
    expect(cache.read(otherTarget)).toEqual({ text: "Other annotation draft" });

    expect(cache.confirmPersisted(target, "Newer draft")).toBe(true);
    expect(cache.read(target)).toBeUndefined();
    expect(cache.read(otherTarget)).toEqual({ text: "Other annotation draft" });
  });

  it("clears deletion and expires one session without affecting another", () => {
    const cache = new ReaderNoteDraftCache();
    const firstSession = Symbol("first-session");
    const secondSession = Symbol("second-session");
    const first = key(firstSession);
    const second = key(secondSession);
    cache.update(first, "First session draft");
    cache.update(second, "Second session draft");

    cache.clear(first);
    expect(cache.read(first)).toBeUndefined();
    expect(cache.read(second)).toEqual({ text: "Second session draft" });

    cache.clearSession(secondSession);
    expect(cache.read(second)).toBeUndefined();
  });
});
