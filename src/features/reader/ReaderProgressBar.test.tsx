// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderProgressBar } from "./ReaderProgressBar";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function renderProgress(overrides: Partial<React.ComponentProps<typeof ReaderProgressBar>> = {}) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const onSeek = vi.fn().mockResolvedValue(true);
  const resolveSeekPreview = vi.fn((percentage: number) => ({
    chapterLabel: percentage >= 50 ? "Chapter Two" : "Chapter One",
    percentage,
  }));

  act(() => {
    root?.render(
      <ReaderProgressBar
        onSeek={onSeek}
        percentage={32}
        placement="top"
        resolveSeekPreview={resolveSeekPreview}
        seekable
        {...overrides}
      />,
    );
  });

  return {
    onSeek,
    progress: container.querySelector<HTMLElement>(".reader-progress")!,
    resolveSeekPreview,
  };
}

function mockProgressRect(progress: HTMLElement, placement: "top" | "side" = "top") {
  return vi.spyOn(progress, "getBoundingClientRect").mockReturnValue(
    placement === "side"
      ? {
          bottom: 200,
          height: 200,
          left: 0,
          right: 3,
          top: 0,
          width: 3,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }
      : {
          bottom: 2,
          height: 2,
          left: 0,
          right: 200,
          top: 0,
          width: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
  );
}

function pointerEvent(
  type: string,
  init: PointerEventInit & { pointerType?: "mouse" | "pen" | "touch" } = {},
) {
  return new PointerEvent(type, { bubbles: true, pointerType: "mouse", ...init });
}

function previewPosition(progress: HTMLElement, selector: string) {
  return progress
    .querySelector<HTMLElement>(selector)
    ?.style.getPropertyValue("--reader-progress-preview-position");
}

describe("ReaderProgressBar", () => {
  it("keeps pending or unavailable progress noninteractive", () => {
    const { onSeek, progress } = renderProgress({ seekable: false });
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 150, pointerId: 1 }));
      progress.focus();
    });

    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.hasAttribute("tabindex")).toBe(false);
    expect(progress.hasAttribute("data-seekable")).toBe(false);
    expect(progress.getAttribute("aria-valuenow")).toBe("32");
    expect(progress.querySelector<HTMLElement>(".reader-progress__fill")?.style.width).toBe("32%");
    expect(progress.querySelector(".reader-progress__preview")).toBeNull();
    expect(progress.querySelector(".reader-progress__handle")).toBeNull();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("exposes slider semantics and committed-position preview when keyboard focused", () => {
    const { progress } = renderProgress();

    expect(progress.getAttribute("role")).toBe("slider");
    expect(progress.getAttribute("tabindex")).toBe("0");
    expect(progress.hasAttribute("data-reader-ignore-shortcuts")).toBe(true);
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-orientation")).toBe("horizontal");
    expect(progress.getAttribute("aria-valuenow")).toBe("32");
    expect(progress.getAttribute("aria-valuetext")).toBe("32% · Chapter One");

    act(() => progress.focus());

    expect(container?.textContent).toContain("32%");
    expect(container?.textContent).toContain("Chapter One");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("32%");
  });

  it("shows top hover preview and handle without navigating or moving committed fill", () => {
    const { onSeek, progress } = renderProgress();
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 50, pointerId: 1 }));
    });

    expect(onSeek).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("25%");
    expect(container?.textContent).toContain("Chapter One");
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    expect(progress.getAttribute("aria-valuetext")).toBe("25% · Chapter One");
    expect(previewPosition(progress, ".reader-progress__preview")).toBe("25%");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("25%");
    expect(progress.querySelector<HTMLElement>(".reader-progress__fill")?.style.width).toBe("32%");
  });

  it("maps side hover preview and handle through the vertical axis without navigating", () => {
    const { onSeek, progress } = renderProgress({ placement: "side" });
    mockProgressRect(progress, "side");

    act(() => {
      progress.dispatchEvent(pointerEvent("pointermove", { clientY: 120, pointerId: 2 }));
    });

    expect(progress.getAttribute("aria-orientation")).toBe("vertical");
    expect(onSeek).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("60%");
    expect(container?.textContent).toContain("Chapter Two");
    expect(previewPosition(progress, ".reader-progress__preview")).toBe("60%");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("60%");
  });

  it("clears hover-only preview on leave and restores the keyboard-focus preview when present", () => {
    const { progress } = renderProgress();
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 150, pointerId: 3 }));
    });
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("75%");

    act(() => {
      progress.dispatchEvent(pointerEvent("pointerout", { clientX: 150, pointerId: 3 }));
    });
    expect(progress.querySelector(".reader-progress__preview")).toBeNull();
    expect(progress.querySelector(".reader-progress__handle")).toBeNull();

    act(() => {
      progress.focus();
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 150, pointerId: 3 }));
    });
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("75%");

    act(() => {
      progress.dispatchEvent(pointerEvent("pointerout", { clientX: 150, pointerId: 3 }));
    });
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("32%");
    expect(progress.getAttribute("aria-valuenow")).toBe("32");
  });

  it("keeps drag preview through pointer leave and clears it when the drag is cancelled", () => {
    const { progress } = renderProgress();
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(
        pointerEvent("pointerdown", { button: 0, clientX: 100, pointerId: 4 }),
      );
      progress.dispatchEvent(pointerEvent("pointerout", { clientX: 100, pointerId: 4 }));
    });

    expect(previewPosition(progress, ".reader-progress__handle")).toBe("50%");

    act(() => {
      progress.dispatchEvent(pointerEvent("pointercancel", { pointerId: 4 }));
    });

    expect(progress.querySelector(".reader-progress__preview")).toBeNull();
    expect(progress.querySelector(".reader-progress__handle")).toBeNull();
  });

  it("transitions from hover into drag and commits exactly one final pointer seek", async () => {
    const { onSeek, progress } = renderProgress();
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 50, pointerId: 5 }));
      progress.dispatchEvent(pointerEvent("pointerdown", { button: 0, clientX: 50, pointerId: 5 }));
      progress.dispatchEvent(pointerEvent("pointermove", { clientX: 150, pointerId: 5 }));
    });

    expect(onSeek).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("75%");
    expect(container?.textContent).toContain("Chapter Two");
    expect(progress.getAttribute("aria-valuenow")).toBe("75");
    expect(progress.getAttribute("aria-valuetext")).toBe("75% · Chapter Two");
    expect(progress.querySelector<HTMLElement>(".reader-progress__fill")?.style.width).toBe("32%");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("75%");

    await act(async () => {
      progress.dispatchEvent(pointerEvent("pointerup", { clientX: 150, pointerId: 5 }));
      await Promise.resolve();
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(75);
  });

  it("does not depend on hover support for touch seeking", async () => {
    const { onSeek, progress } = renderProgress();
    mockProgressRect(progress);

    act(() => {
      progress.dispatchEvent(
        pointerEvent("pointermove", { clientX: 120, pointerId: 6, pointerType: "touch" }),
      );
    });
    expect(progress.querySelector(".reader-progress__preview")).toBeNull();

    await act(async () => {
      progress.dispatchEvent(
        pointerEvent("pointerdown", {
          button: 0,
          clientX: 120,
          pointerId: 6,
          pointerType: "touch",
        }),
      );
      progress.dispatchEvent(
        pointerEvent("pointerup", { clientX: 120, pointerId: 6, pointerType: "touch" }),
      );
      await Promise.resolve();
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(60);
    expect(progress.querySelector(".reader-progress__preview")).toBeNull();
    expect(progress.querySelector(".reader-progress__handle")).toBeNull();
  });

  it("commits directional and boundary keyboard targets while owning the key event", async () => {
    const { onSeek, progress } = renderProgress({ percentage: 40 });
    act(() => progress.focus());

    const keys = ["ArrowRight", "ArrowDown", "Home", "End"];
    for (const key of keys) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
      });
      await act(async () => {
        progress.dispatchEvent(event);
        await Promise.resolve();
      });
      expect(event.defaultPrevented).toBe(true);
    }

    expect(onSeek.mock.calls.map(([percentage]) => percentage)).toEqual([41, 40, 0, 100]);
  });

  it("moves vertical keyboard preview in the pressed direction for the side placement", async () => {
    const { onSeek, progress } = renderProgress({ percentage: 40, placement: "side" });
    act(() => progress.focus());

    const arrowDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    await act(async () => {
      progress.dispatchEvent(arrowDown);
      await Promise.resolve();
    });

    expect(arrowDown.defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(41);
    expect(previewPosition(progress, ".reader-progress__preview")).toBe("41%");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("41%");

    act(() => {
      progress.blur();
      progress.focus();
    });

    const arrowUp = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    await act(async () => {
      progress.dispatchEvent(arrowUp);
      await Promise.resolve();
    });

    expect(arrowUp.defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(39);
    expect(previewPosition(progress, ".reader-progress__preview")).toBe("39%");
    expect(previewPosition(progress, ".reader-progress__handle")).toBe("39%");

    for (const [key, expected] of [
      ["Home", 0],
      ["End", 100],
    ] as const) {
      await act(async () => {
        progress.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
        );
        await Promise.resolve();
      });
      expect(onSeek).toHaveBeenLastCalledWith(expected);
    }
  });

  it("uses vertical pointer position for the side placement", async () => {
    const { onSeek, progress } = renderProgress({ placement: "side" });
    mockProgressRect(progress, "side");

    await act(async () => {
      progress.dispatchEvent(
        pointerEvent("pointerdown", { button: 0, clientY: 120, pointerId: 7 }),
      );
      progress.dispatchEvent(pointerEvent("pointerup", { clientY: 120, pointerId: 7 }));
      await Promise.resolve();
    });

    expect(onSeek).toHaveBeenCalledWith(60);
  });
});
