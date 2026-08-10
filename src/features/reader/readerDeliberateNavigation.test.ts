import { describe, expect, it, vi } from "vitest";

import { createReaderDeliberateNavigationController } from "./readerDeliberateNavigation";
import { createReaderSessionController, type ReaderSessionIdentity } from "./readerSession";

function identity(bookId: string): ReaderSessionIdentity {
  const value = createReaderSessionController(bookId).getSnapshot().lifecycle.identity;
  if (!value) throw new Error("Expected an active Reader session identity.");
  return value;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("Reader deliberate navigation", () => {
  it("records the current canonical location only after a successful deliberate jump", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const rendition = {};
    const display = vi.fn(async () => true);
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, rendition, display);
    controller.relocate(rendition, "epubcfi(/6/2!/4/2:4)");

    await expect(controller.jump("Text/chapter-2.xhtml#part")).resolves.toBe(true);

    expect(display).toHaveBeenCalledWith("Text/chapter-2.xhtml#part", {
      requireUsableLocation: false,
    });
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("leaves history unchanged when target display fails", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const rendition = {};
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, rendition, async () => false);
    controller.relocate(rendition, "epubcfi(/6/2!/4/2:4)");

    await expect(controller.jump("epubcfi(/6/4!/4/2:2)")).resolves.toBe(false);

    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("replays Back and Forward through the same display owner without recursive recording", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const rendition = {};
    const display = vi.fn(async () => true);
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, rendition, display);
    controller.relocate(rendition, "epubcfi(/6/2!/4/2:2)");

    await controller.jump("Text/chapter-2.xhtml");
    await controller.jump("Text/chapter-3.xhtml");

    await expect(controller.back()).resolves.toBe(true);
    expect(display).toHaveBeenLastCalledWith("Text/chapter-2.xhtml", {
      requireUsableLocation: false,
    });
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });

    await expect(controller.forward()).resolves.toBe(true);
    expect(display).toHaveBeenLastCalledWith("Text/chapter-3.xhtml", {
      requireUsableLocation: false,
    });
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 2,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("updates the canonical return location from ordinary relocation without recording history", () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const rendition = {};
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, rendition, async () => true);

    controller.relocate(rendition, "epubcfi(/6/2!/4/2:2)");
    controller.relocate(rendition, "epubcfi(/6/2!/4/8:8)");

    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("retires stale display completion and resets history when the Reader session is replaced", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionA = identity("book-a");
    const sessionB = identity("book-b");
    const renditionA = {};
    const pendingDisplay = deferred<boolean>();
    controller.startSession(sessionA);
    controller.bindDisplay(sessionA, renditionA, () => pendingDisplay.promise);
    controller.relocate(renditionA, "epubcfi(/6/2!/4/2:2)");

    const staleJump = controller.jump("epubcfi(/6/4!/4/2:2)");
    controller.endSession(sessionA);
    controller.startSession(sessionB);
    controller.bindDisplay(sessionB, {}, async () => true);
    pendingDisplay.resolve(true);

    await expect(staleJump).resolves.toBe(false);
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("publishes history availability changes from the deliberate navigation owner", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const rendition = {};
    const listener = vi.fn();
    controller.subscribeHistory(listener);
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, rendition, async () => true);
    controller.relocate(rendition, "epubcfi(/6/2!/4/2:2)");

    await controller.jump("Text/chapter-2.xhtml");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });

    await controller.back();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: true,
      forwardCount: 1,
    });

    controller.endSession(sessionIdentity);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("preserves session history when only the active rendition binding is replaced", async () => {
    const controller = createReaderDeliberateNavigationController(10);
    const sessionIdentity = identity("book-a");
    const pagedRendition = {};
    const continuousRendition = {};
    controller.startSession(sessionIdentity);
    controller.bindDisplay(sessionIdentity, pagedRendition, async () => true);
    controller.relocate(pagedRendition, "epubcfi(/6/2!/4/2:2)");
    await controller.jump("Text/chapter-2.xhtml");

    controller.unbindDisplay(pagedRendition);
    controller.bindDisplay(sessionIdentity, continuousRendition, async () => true);
    controller.relocate(continuousRendition, "epubcfi(/6/4!/4/2:2)");

    expect(controller.getHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });
});
