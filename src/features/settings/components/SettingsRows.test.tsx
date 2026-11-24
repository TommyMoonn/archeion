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

    expect(markup).toContain('class="settings-row settings-row--standard"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-labelledby="settings-row-label-');
    expect(markup).toContain('aria-describedby="settings-row-description-');
    expect(markup).toContain("Controls automatic scans.");
  });

  it("renders a compact one-line row without reserving description metadata", () => {
    const markup = renderToStaticMarkup(
      <CompactSettingsRow label="Restore default shortcuts">
        <button disabled type="button">
          Reset
        </button>
      </CompactSettingsRow>,
    );

    expect(markup).toContain('class="settings-row settings-row--compact"');
    expect(markup).not.toContain("settings-row__description");
    expect(markup).not.toContain("aria-describedby");
    expect(markup).toContain('<button disabled="" type="button">Reset</button>');
  });

  it("preserves action status and control state", () => {
    const markup = renderToStaticMarkup(
      <SettingsActionRow label="Repair archive metadata" note="Repair in progress.">
        <button aria-busy="true" disabled type="button">
          Repairing…
        </button>
      </SettingsActionRow>,
    );

    expect(markup).toContain('class="settings-row settings-row--action"');
    expect(markup).toContain('aria-describedby="settings-row-note-');
    expect(markup).toContain("Repair in progress.");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("gives specialized controls an explicit feature-row geometry", () => {
    const markup = renderToStaticMarkup(
      <FeatureSettingsRow description="Changes book cover size." label="Book card size">
        <input aria-label="Book card size" type="range" />
      </FeatureSettingsRow>,
    );

    expect(markup).toContain('class="settings-row settings-row--feature"');
    expect(markup).toContain('type="range"');
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
