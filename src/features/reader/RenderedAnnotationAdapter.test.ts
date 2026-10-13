// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type Section from "epubjs/types/section";
import type { HighlightAnnotation } from "../../types/annotation";
import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";
import { RenderedAnnotationAdapter } from "./RenderedAnnotationAdapter";

function deferredRange() {
  let resolve!: (range: Range) => void;
  const promise = new Promise<Range>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function session(getRange: () => Promise<Range>) {
  const chapter = document.implementation.createHTMLDocument("Synthetic chapter");
  chapter.body.innerHTML = "<p>Fixture</p>";
  const range = chapter.createRange();
  range.selectNodeContents(chapter.querySelector("p")!.firstChild!);
  const section = {
    document: chapter,
    contents: chapter.documentElement,
    href: "chapter.xhtml",
    index: 0,
  } as unknown as Section;
  const access = {
    getRange: vi.fn(getRange),
    getSection: () => section,
    highlight: vi.fn(),
    underline: vi.fn(),
    removeAnnotation: vi.fn(),
    isSectionRendered: () => false,
    listSections: () => [section],
    loadSection: vi.fn(),
  } satisfies EpubAnnotationSessionAccess;
  return { access, range };
}
const highlight: HighlightAnnotation = {
  id: "same-id",
  type: "highlight",
  cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:7)",
  selectedText: "Fixture",
  color: "yellow",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("RenderedAnnotationAdapter retirement", () => {
  it("does not let an old validation release a replacement session's identical pending anchor", async () => {
    const pendingA = deferredRange();
    const pendingB = deferredRange();
    const first = session(() => pendingA.promise);
    const second = session(() => pendingB.promise);
    const adapter = new RenderedAnnotationAdapter({
      highlights: [highlight],
      onCancelHighlightGesture: vi.fn(),
      onHighlightEvent: vi.fn(),
    });
    adapter.setSession(first.access);
    adapter.reconcile();
    await vi.waitFor(() => expect(first.access.getRange).toHaveBeenCalledOnce());
    adapter.setSession(second.access);
    adapter.reconcile();
    await vi.waitFor(() => expect(second.access.getRange).toHaveBeenCalledOnce());
    pendingA.resolve(first.range);
    // Drain the cancelled lifecycle and its validation completion before reconciling.
    await new Promise((resolve) => setTimeout(resolve, 0));
    adapter.reconcile();
    pendingB.resolve(second.range);
    await vi.waitFor(() => expect(second.access.highlight).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.access.getRange).toHaveBeenCalledOnce();
    expect(first.access.highlight).not.toHaveBeenCalled();
    adapter.setSession(null);
  });

  it("rejects a captured event from a detached mark while the durable annotation survives remount", async () => {
    const current = session(async () => current.range);
    const activate = vi.fn();
    const adapter = new RenderedAnnotationAdapter({
      highlights: [highlight],
      onCancelHighlightGesture: vi.fn(),
      onHighlightEvent: activate,
    });
    adapter.setSession(current.access);
    adapter.reconcile();
    await vi.waitFor(() => expect(current.access.highlight).toHaveBeenCalledOnce());
    const callback = current.access.highlight.mock.calls[0][2]!;
    const mark = document.body.appendChild(document.createElement("button"));
    const event = new MouseEvent("click");
    Object.defineProperty(event, "target", { value: mark });
    callback(event);
    expect(activate).toHaveBeenCalledOnce();
    mark.remove();
    callback(event);
    expect(activate).toHaveBeenCalledOnce();
    adapter.reconcile();
    expect(current.access.highlight).toHaveBeenCalledOnce();
    adapter.setSession(null);
    document.body.append(mark);
    callback(event);
    expect(activate).toHaveBeenCalledOnce();
    mark.remove();
  });
});
