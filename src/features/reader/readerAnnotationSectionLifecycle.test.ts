// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { Book as EpubBook, Rendition } from "epubjs";
import type EpubSection from "epubjs/types/section";

import {
  READER_ANNOTATION_SECTION_LOAD_CONCURRENCY,
  ReaderAnnotationSectionLifecycle,
} from "./readerAnnotationSectionLifecycle";
import { createEpubSessionInteractionAccess } from "./epubSessionInteractionAccess";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function section(href: string, initiallyLoaded = false, index = 0) {
  const chapter = document.implementation.createHTMLDocument(href);
  chapter.body.textContent = href;
  const value = {
    cfiFromElement: vi.fn(() => `epubcfi(${href}#start)`),
    cfiFromRange: vi.fn(() => `epubcfi(${href}#range)`),
    contents: initiallyLoaded ? chapter.documentElement : undefined,
    document: initiallyLoaded ? chapter : undefined,
    href,
    index,
    load: vi.fn(async () => {
      value.document = chapter;
      value.contents = chapter.documentElement;
      return chapter.documentElement;
    }),
    unload: vi.fn(() => {
      value.document = undefined;
      value.contents = undefined;
    }),
  };
  return { chapter, value: value as unknown as EpubSection };
}

const book = { load: vi.fn() } as unknown as EpubBook;
const inactiveRendition = { getContents: () => [] } as unknown as Rendition;

function renditionWithContents(contents: () => Array<{ sectionIndex: number }>): Rendition {
  return { getContents: contents } as unknown as Rendition;
}

function sessionAccess(rendition: Rendition) {
  return createEpubSessionInteractionAccess(book, rendition).annotations;
}

describe("ReaderAnnotationSectionLifecycle", () => {
  it("uses one named section-load worker and unloads temporary sections after success", async () => {
    expect(READER_ANNOTATION_SECTION_LOAD_CONCURRENCY).toBe(1);
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const first = section("first.xhtml");
    const second = section("second.xhtml");
    const firstLoad = deferred<Element>();
    vi.mocked(first.value.load).mockImplementationOnce(() => firstLoad.promise as never);

    const firstTask = lifecycle.run(
      sessionAccess(inactiveRendition),
      first.value,
      undefined,
      () => "first",
    );
    const secondTask = lifecycle.run(
      sessionAccess(inactiveRendition),
      second.value,
      undefined,
      () => "second",
    );
    await Promise.resolve();

    expect(first.value.load).toHaveBeenCalledOnce();
    expect(second.value.load).not.toHaveBeenCalled();
    first.chapter.body.dataset.loaded = "true";
    (first.value as unknown as { document?: Document; contents?: Element }).document =
      first.chapter;
    (first.value as unknown as { document?: Document; contents?: Element }).contents =
      first.chapter.documentElement;
    firstLoad.resolve(first.chapter.documentElement);

    await expect(firstTask).resolves.toEqual({ kind: "completed", value: "first" });
    await expect(secondTask).resolves.toEqual({ kind: "completed", value: "second" });
    expect(first.value.unload).toHaveBeenCalledOnce();
    expect(second.value.unload).toHaveBeenCalledOnce();
  });

  it("does not load or unload a section that was already owned", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const loaded = section("loaded.xhtml", true);

    await expect(
      lifecycle.run(sessionAccess(inactiveRendition), loaded.value, undefined, ({ href }) => href),
    ).resolves.toEqual({ kind: "completed", value: "loaded.xhtml" });

    expect(loaded.value.load).not.toHaveBeenCalled();
    expect(loaded.value.unload).not.toHaveBeenCalled();
  });

  it("does not unload a section owned by an active epub.js Contents entry", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const adopted = section("adopted.xhtml", false, 4);
    const rendition = renditionWithContents(() => [{ sectionIndex: 4 }]);

    await lifecycle.run(sessionAccess(rendition), adopted.value, undefined, () => true);

    expect(adopted.value.unload).not.toHaveBeenCalled();
  });

  it("does not unload a section adopted after its lifecycle task starts", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const adopted = section("adopted-late.xhtml", false, 7);
    const activeContents: Array<{ sectionIndex: number }> = [];
    const rendition = renditionWithContents(() => activeContents);
    const taskStarted = deferred<void>();
    const finishTask = deferred<void>();

    const task = lifecycle.run(sessionAccess(rendition), adopted.value, undefined, async () => {
      taskStarted.resolve(undefined);
      await finishTask.promise;
      return true;
    });
    await taskStarted.promise;
    activeContents.push({ sectionIndex: 7 });
    finishTask.resolve(undefined);

    await expect(task).resolves.toEqual({ kind: "completed", value: true });
    expect(adopted.value.unload).not.toHaveBeenCalled();
  });

  it("does not treat a sibling Contents entry as section ownership", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const temporary = section("temporary.xhtml", false, 3);
    const rendition = renditionWithContents(() => [{ sectionIndex: 2 }]);

    await lifecycle.run(sessionAccess(rendition), temporary.value, undefined, () => true);

    expect(temporary.value.unload).toHaveBeenCalledOnce();
  });

  it("preserves only the sections represented by multiple continuous-mode contents", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const first = section("continuous-first.xhtml", false, 1);
    const second = section("continuous-second.xhtml", false, 2);
    const unrelated = section("continuous-unrelated.xhtml", false, 3);
    const rendition = renditionWithContents(() => [{ sectionIndex: 1 }, { sectionIndex: 2 }]);

    await lifecycle.run(sessionAccess(rendition), first.value, undefined, () => true);
    await lifecycle.run(sessionAccess(rendition), second.value, undefined, () => true);
    await lifecycle.run(sessionAccess(rendition), unrelated.value, undefined, () => true);

    expect(first.value.unload).not.toHaveBeenCalled();
    expect(second.value.unload).not.toHaveBeenCalled();
    expect(unrelated.value.unload).toHaveBeenCalledOnce();
  });

  it("unloads temporary ownership after task failure", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const failed = section("failed.xhtml");

    await expect(
      lifecycle.run(sessionAccess(inactiveRendition), failed.value, undefined, () => {
        throw new Error("recovery failed");
      }),
    ).rejects.toThrow("recovery failed");
    expect(failed.value.unload).toHaveBeenCalledOnce();
  });

  it("unloads temporary ownership after cancellation and invalidates queued work", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const active = section("active.xhtml");
    const queued = section("queued.xhtml");
    const load = deferred<Element>();
    vi.mocked(active.value.load).mockImplementationOnce(() => load.promise as never);
    const controller = new AbortController();

    const activeTask = lifecycle.run(
      sessionAccess(inactiveRendition),
      active.value,
      controller.signal,
      () => 1,
    );
    const queuedTask = lifecycle.run(
      sessionAccess(inactiveRendition),
      queued.value,
      undefined,
      () => 2,
    );
    await Promise.resolve();
    controller.abort();
    lifecycle.invalidate();
    (active.value as unknown as { document?: Document; contents?: Element }).document =
      active.chapter;
    (active.value as unknown as { document?: Document; contents?: Element }).contents =
      active.chapter.documentElement;
    load.resolve(active.chapter.documentElement);

    await expect(activeTask).resolves.toEqual({ kind: "cancelled" });
    await expect(queuedTask).resolves.toEqual({ kind: "cancelled" });
    expect(active.value.unload).toHaveBeenCalledOnce();
    expect(queued.value.load).not.toHaveBeenCalled();
  });

  it("unloads temporary ownership when rendition contents cannot be inspected", async () => {
    const lifecycle = new ReaderAnnotationSectionLifecycle();
    const temporary = section("throwing-rendition.xhtml", false, 5);
    const rendition = {
      getContents: () => {
        throw new Error("rendition unavailable");
      },
    } as unknown as Rendition;

    await expect(
      lifecycle.run(sessionAccess(rendition), temporary.value, undefined, () => true),
    ).resolves.toEqual({ kind: "completed", value: true });
    expect(temporary.value.unload).toHaveBeenCalledOnce();
  });
});
