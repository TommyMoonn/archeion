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

  act(() => {
    root?.render(
      <ReaderSettingsPanel
        onChange={vi.fn()}
        onClose={onClose}
        persistenceFailed={persistenceFailed}
        settings={{ ...defaultReaderSettings }}
      />,
    );
  });

  return { container, onClose };
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
});
