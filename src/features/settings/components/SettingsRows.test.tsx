// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CompactSettingsRow,
  FeatureSettingsRow,
  SettingsActionRow,
  SettingsSliderRow,
  StandardSettingsRow,
} from "./SettingsRows";

describe("Settings row primitives", () => {
  it("associates a standard row label and description with its control group", () => {
    const markup = renderToStaticMarkup(
      <StandardSettingsRow description="Controls automatic scans." label="Watch archive">
        <button type="button">Change</button>
      </StandardSettingsRow>,
    );

    const content = new DOMParser().parseFromString(markup, "text/html");
    const group = content.querySelector('[role="group"]');
    expect(content.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Watch archive",
    );
    expect(content.getElementById(group?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Controls automatic scans.",
    );
  });

  it("renders a compact one-line row without reserving description metadata", () => {
    const markup = renderToStaticMarkup(
      <CompactSettingsRow label="Restore default shortcuts">
        <button disabled type="button">
          Reset
        </button>
      </CompactSettingsRow>,
    );

    const content = new DOMParser().parseFromString(markup, "text/html");
    expect(content.querySelector('[role="group"]')?.hasAttribute("aria-describedby")).toBe(false);
    expect(content.querySelector("button")?.disabled).toBe(true);
    expect(content.querySelector("button")?.textContent).toBe("Reset");
  });

  it("preserves action status and control state", () => {
    const markup = renderToStaticMarkup(
      <SettingsActionRow label="Repair archive metadata" note="Repair in progress.">
        <button aria-busy="true" disabled type="button">
          Repairing…
        </button>
      </SettingsActionRow>,
    );

    const content = new DOMParser().parseFromString(markup, "text/html");
    const group = content.querySelector('[role="group"]');
    expect(content.getElementById(group?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Repair in progress.",
    );
    const button = content.querySelector("button");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.disabled).toBe(true);
  });

  it("preserves the specialized control and its group label", () => {
    const markup = renderToStaticMarkup(
      <FeatureSettingsRow description="Changes book cover size." label="Book card size">
        <input aria-label="Book card size" type="range" />
      </FeatureSettingsRow>,
    );

    const content = new DOMParser().parseFromString(markup, "text/html");
    expect(content.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe(
      "Book card size",
    );
    const group = content.querySelector('[role="group"]');
    expect(content.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Book card size",
    );
  });

  it("exposes the current value, range, step and accessible label through the native input", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          <SettingsSliderRow
            description="Sets the default text size."
            label="Font size"
            max={28}
            min={12}
            step={2}
            onChange={vi.fn()}
            value={16}
            suffix="px"
          />,
        ),
      );
      const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
      expect(slider?.getAttribute("aria-label")).toBe("Font size");
      expect(slider?.getAttribute("aria-valuetext")).toBe("16px");
      expect(slider?.min).toBe("12");
      expect(slider?.max).toBe("28");
      expect(slider?.step).toBe("2");
      expect(slider?.value).toBe("16");
    } finally {
      act(() => root.unmount());
    }
  });
});
