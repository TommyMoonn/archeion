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

describe("ReaderProgressBar", () => {
  it("keeps pending or unavailable progress noninteractive", () => {
    const { progress } = renderProgress({ seekable: false });

    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.hasAttribute("tabindex")).toBe(false);
    expect(progress.hasAttribute("data-seekable")).toBe(false);
    expect(progress.getAttribute("aria-valuenow")).toBe("32");
    expect(progress.querySelector<HTMLElement>(".reader-progress__fill")?.style.width).toBe("32%");
  });

  it("exposes slider semantics and chapter-aware value text only when seekable", () => {
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
  });

  it("updates pointer preview without navigating until release", async () => {
    const { onSeek, progress } = renderProgress();
    vi.spyOn(progress, "getBoundingClientRect").mockReturnValue({
      bottom: 2,
      height: 2,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      progress.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 50,
          pointerId: 1,
        }),
      );
      progress.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 150,
          pointerId: 1,
        }),
      );
    });

    expect(onSeek).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("75%");
    expect(container?.textContent).toContain("Chapter Two");
    expect(progress.getAttribute("aria-valuenow")).toBe("75");
    expect(progress.getAttribute("aria-valuetext")).toBe("75% · Chapter Two");
    expect(progress.querySelector<HTMLElement>(".reader-progress__fill")?.style.width).toBe("32%");

    await act(async () => {
      progress.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 150,
          pointerId: 1,
        }),
      );
      await Promise.resolve();
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(75);
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
    expect(
      progress
        .querySelector<HTMLElement>(".reader-progress__preview")
        ?.style.getPropertyValue("--reader-progress-preview-position"),
    ).toBe("41%");

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
    expect(
      progress
        .querySelector<HTMLElement>(".reader-progress__preview")
        ?.style.getPropertyValue("--reader-progress-preview-position"),
    ).toBe("39%");

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
    expect(progress.getAttribute("aria-orientation")).toBe("vertical");
    vi.spyOn(progress, "getBoundingClientRect").mockReturnValue({
      bottom: 200,
      height: 200,
      left: 0,
      right: 3,
      top: 0,
      width: 3,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      progress.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientY: 120,
          pointerId: 2,
        }),
      );
      progress.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientY: 120,
          pointerId: 2,
        }),
      );
      await Promise.resolve();
    });

    expect(onSeek).toHaveBeenCalledWith(60);
  });
});
