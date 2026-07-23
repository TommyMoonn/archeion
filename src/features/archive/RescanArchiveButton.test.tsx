// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RescanArchiveButton } from "./RescanArchiveButton";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderButton(onRescan: () => Promise<void>) {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(<RescanArchiveButton isRescanning={false} onRescan={onRescan} />);
  });

  return { container, root };
}

let activeRoot: Root | null = null;

describe("RescanArchiveButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("runs the owned manual rescan operation", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const session = await renderButton(rescan);
    activeRoot = session.root;

    await act(async () => {
      session.container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const trigger = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rescan archive"]',
    );
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const confirm = [...session.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rescan archive",
    );
    await act(async () => {
      confirm?.click();
    });

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});
