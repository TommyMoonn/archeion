// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import type { HighlightAnnotation } from "../../types/annotation";
import {
  createHighlightActivationGestureController,
  HIGHLIGHT_TAP_MOVEMENT_THRESHOLD_PX,
  resolveHighlightSelection,
} from "./readerHighlightInteraction";

const timestamp = "2026-07-13T00:00:00.000Z";

function highlight(id: string, cfiRange: string): HighlightAnnotation {
  return {
    cfiRange,
    color: "yellow",
    createdAt: timestamp,
    id,
    selectedText: id,
    type: "highlight",
    updatedAt: timestamp,
  };
}

const first = highlight("first", "epubcfi(/6/2!/4/2,/1:10,/1:30)");

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("resolveHighlightSelection", () => {
  it("targets an exact range by stable annotation ID", () => {
    expect(resolveHighlightSelection(first.cfiRange, [first])).toEqual({
      highlight: first,
      kind: "existing",
    });
  });

  it("targets the single existing highlight containing the selection", () => {
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:14,/1:20)", [first])).toEqual({
      highlight: first,
      kind: "existing",
    });
  });

  it("allows a disjoint selection", () => {
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:35,/1:40)", [first])).toEqual({
      kind: "new",
    });
  });

  it("blocks a partial overlap", () => {
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:25,/1:40)", [first])).toEqual({
      kind: "blocked",
    });
  });

  it("blocks overlap with multiple highlights", () => {
    const second = highlight("second", "epubcfi(/6/2!/4/2,/1:35,/1:50)");
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:20,/1:40)", [first, second])).toEqual({
      kind: "blocked",
    });
  });

  it("ignores detached highlights for exact, contained, and overlapping selections", () => {
    const detached = { ...first, anchorStatus: "detached" } as const;

    expect(resolveHighlightSelection(first.cfiRange, [detached])).toEqual({ kind: "new" });
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:14,/1:20)", [detached])).toEqual({
      kind: "new",
    });
    expect(resolveHighlightSelection("epubcfi(/6/2!/4/2,/1:25,/1:40)", [detached])).toEqual({
      kind: "new",
    });
  });
});

function touchEvent(type: string, x: number, y: number): TouchEvent {
  const touch = { clientX: x, clientY: y } as Touch;
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    changedTouches: [touch],
    touches: type === "touchend" ? [] : [touch],
  });
}

function selectText(): void {
  const text = document.createTextNode("selected text");
  document.body.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

describe("highlight activation gestures", () => {
  it("activates a mouse click only with a collapsed selection", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("click", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);

    mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 8 }));
    selectText();
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 8 }));

    expect(activations).toEqual(["highlight-1"]);
  });

  it("activates a touch tap once without depending on its synthetic click", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", (event) => controller.handle("highlight-1", event));
    mark.addEventListener("click", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);

    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    document.dispatchEvent(touchEvent("touchend", 12, 11));
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 11 }));

    expect(activations).toEqual(["highlight-1"]);
  });

  it("cancels touch activation after movement beyond the named threshold", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);

    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    document.dispatchEvent(
      touchEvent("touchmove", 10 + HIGHLIGHT_TAP_MOVEMENT_THRESHOLD_PX + 1, 10),
    );
    document.dispatchEvent(touchEvent("touchend", 12, 10));

    expect(activations).toEqual([]);
  });

  it("activates a pointer tap once and suppresses its compatibility click", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("pointerdown", (event) => controller.handle("highlight-1", event));
    mark.addEventListener("click", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);

    mark.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        pointerId: 7,
        pointerType: "touch",
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 12,
        clientY: 11,
        pointerId: 7,
        pointerType: "touch",
      }),
    );
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 11 }));

    expect(activations).toEqual(["highlight-1"]);
  });

  it("cancels temporary listeners on cancellation and teardown", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);

    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    controller.cancel("highlight-1");
    document.dispatchEvent(touchEvent("touchend", 10, 10));
    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    controller.cancelAll();
    document.dispatchEvent(touchEvent("touchend", 10, 10));

    expect(activations).toEqual([]);
  });

  it("cancels gesture work only for its owning document", () => {
    const activations: string[] = [];
    const controller = createHighlightActivationGestureController(({ annotationId }) =>
      activations.push(annotationId),
    );
    const mark = document.createElement("button");
    mark.addEventListener("touchstart", (event) => controller.handle("highlight-1", event));
    document.body.append(mark);
    const siblingDocument = document.implementation.createHTMLDocument("Sibling");

    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    controller.cancelDocument(siblingDocument);
    document.dispatchEvent(touchEvent("touchend", 10, 10));
    mark.dispatchEvent(touchEvent("touchstart", 10, 10));
    controller.cancelDocument(document);
    document.dispatchEvent(touchEvent("touchend", 10, 10));

    expect(activations).toEqual(["highlight-1"]);
  });
});
