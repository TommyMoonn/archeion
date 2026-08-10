import { describe, expect, it } from "vitest";

import {
  createReaderNavigationHistory,
  type ReaderNavigationHistoryEntry,
} from "./readerNavigationHistory";

function location(target: string): ReaderNavigationHistoryEntry {
  return { target };
}

describe("Reader navigation history", () => {
  it("records successful jumps as ordered Back targets", () => {
    const history = createReaderNavigationHistory(10);

    expect(history.recordJump(location("epubcfi(/6/2)"), "succeeded")).toBe(true);
    expect(history.recordJump(location("epubcfi(/6/4)"), "succeeded")).toBe(true);
    expect(history.recordJump(location("epubcfi(/6/6)"), "succeeded")).toBe(true);

    expect(history.getSnapshot()).toEqual({
      backCount: 3,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
    const third = location("epubcfi(/6/6)");
    const current = location("epubcfi(/6/8)");

    expect(history.getBackTarget()).toEqual(third);
    expect(history.completeBackReplay(current, third, "succeeded")).toBe(true);
    expect(history.getBackTarget()).toEqual(location("epubcfi(/6/4)"));
    expect(history.completeBackReplay(third, location("epubcfi(/6/4)"), "succeeded")).toBe(true);
    expect(history.getBackTarget()).toEqual(location("epubcfi(/6/2)"));
  });

  it("moves return targets between Back and Forward only after successful replay", () => {
    const history = createReaderNavigationHistory(10);
    const first = location("epubcfi(/6/2)");
    const second = location("epubcfi(/6/4)");
    const current = location("epubcfi(/6/6)");

    history.recordJump(first, "succeeded");
    history.recordJump(second, "succeeded");

    expect(history.getBackTarget()).toEqual(second);
    expect(history.completeBackReplay(current, second, "succeeded")).toBe(true);
    expect(history.getBackTarget()).toEqual(first);
    expect(history.getForwardTarget()).toEqual(current);
    expect(history.getSnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });

    expect(history.completeForwardReplay(second, current, "succeeded")).toBe(true);
    expect(history.getBackTarget()).toEqual(second);
    expect(history.getForwardTarget()).toBeUndefined();
  });

  it("clears the Forward branch when a new successful jump follows Back", () => {
    const history = createReaderNavigationHistory(10);
    const first = location("epubcfi(/6/2)");
    const second = location("epubcfi(/6/4)");
    const current = location("epubcfi(/6/6)");

    history.recordJump(first, "succeeded");
    history.recordJump(second, "succeeded");
    history.completeBackReplay(current, second, "succeeded");

    expect(history.getForwardTarget()).toEqual(current);
    expect(history.recordJump(second, "succeeded")).toBe(true);
    expect(history.getForwardTarget()).toBeUndefined();
    expect(history.getBackTarget()).toEqual(second);
  });

  it("leaves history unchanged after failed ordinary or replay navigation", () => {
    const history = createReaderNavigationHistory(10);
    const first = location("epubcfi(/6/2)");
    const second = location("epubcfi(/6/4)");

    history.recordJump(first, "succeeded");
    const beforeFailure = history.getSnapshot();

    expect(history.recordJump(second, "failed")).toBe(false);
    expect(history.completeBackReplay(second, first, "failed")).toBe(false);
    expect(history.completeBackReplay(second, location("epubcfi(/6/999)"), "succeeded")).toBe(
      false,
    );
    expect(history.getSnapshot()).toEqual(beforeFailure);
    expect(history.getBackTarget()).toEqual(first);
    expect(history.getForwardTarget()).toBeUndefined();
  });

  it("coalesces identical consecutive return locations by target", () => {
    const history = createReaderNavigationHistory(10);
    const first = location("epubcfi(/6/2)");

    expect(history.recordJump(first, "succeeded")).toBe(true);
    expect(history.recordJump(location(first.target), "succeeded")).toBe(false);
    expect(history.getSnapshot().backCount).toBe(1);
  });

  it("drops the oldest retained Back targets at the configured bound", () => {
    const history = createReaderNavigationHistory(2);
    const first = location("epubcfi(/6/2)");
    const second = location("epubcfi(/6/4)");
    const third = location("epubcfi(/6/6)");
    const current = location("epubcfi(/6/8)");

    history.recordJump(first, "succeeded");
    history.recordJump(second, "succeeded");
    history.recordJump(third, "succeeded");

    expect(history.getSnapshot().backCount).toBe(2);
    expect(history.getBackTarget()).toEqual(third);
    expect(history.completeBackReplay(current, third, "succeeded")).toBe(true);
    expect(history.getBackTarget()).toEqual(second);
    expect(history.completeBackReplay(third, second, "succeeded")).toBe(true);
    expect(history.getBackTarget()).toBeUndefined();
  });

  it("resets all session-local history", () => {
    const history = createReaderNavigationHistory(10);
    const first = location("epubcfi(/6/2)");
    const second = location("epubcfi(/6/4)");

    history.recordJump(first, "succeeded");
    history.recordJump(second, "succeeded");
    history.completeBackReplay(location("epubcfi(/6/6)"), second, "succeeded");

    history.reset();

    expect(history.getSnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
    expect(history.getBackTarget()).toBeUndefined();
    expect(history.getForwardTarget()).toBeUndefined();
  });
});
