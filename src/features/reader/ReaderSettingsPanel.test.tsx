// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function renderPanel(persistenceFailed = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onClose = vi.fn();
  const onReaderThemeChange = vi.fn();

  act(() => {
    root?.render(
      <ReaderSettingsPanel
        onChange={vi.fn()}
        onClose={onClose}
        onReaderThemeChange={onReaderThemeChange}
        persistenceFailed={persistenceFailed}
        readerThemeEntries={[]}
        readerThemeSelection={{ kind: "builtin", id: "dark" }}
        settings={{ ...defaultReaderSettings }}
      />,
    );
  });

  return { container, onClose, onReaderThemeChange };
}

describe("ReaderSettingsPanel", () => {
  it("focuses the close control when the panel opens", () => {
    const rendered = renderPanel();
    const close = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close reader settings"]',
    );

    expect(document.activeElement).toBe(close);
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      "Saved automatically",
    );
  });

  it("announces persistence failures as an alert", () => {
    const rendered = renderPanel(true);

    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Settings could not be saved",
    );
  });

  it("uses the shared archive reader-theme selection", () => {
    const rendered = renderPanel();
    const select = rendered.container.querySelector<HTMLButtonElement>('[role="combobox"]')!;

    act(() => select.click());
    const sepia = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Sepia",
    )!;
    act(() => sepia.click());

    expect(rendered.onReaderThemeChange).toHaveBeenCalledWith({ kind: "builtin", id: "sepia" });
    expect(rendered.container.textContent?.match(/Reader theme/g)).toHaveLength(1);
  });
});
