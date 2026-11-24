// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsSectionHeader } from "./SettingsSectionHeader";

describe("SettingsSectionHeader", () => {
  it("renders a semantic section heading with its description", () => {
    const markup = renderToStaticMarkup(
      <SettingsSectionHeader description="Section context." title="Example" />,
    );

    const content = new DOMParser().parseFromString(markup, "text/html");
    expect(content.querySelector("header h2")?.textContent).toBe("Example");
    expect(content.querySelector("header p")?.textContent).toBe("Section context.");
  });

  it("omits description markup when no description is defined", () => {
    const markup = renderToStaticMarkup(<SettingsSectionHeader title="Keyboard" />);

    const content = new DOMParser().parseFromString(markup, "text/html");
    expect(content.querySelector("header h2")?.textContent).toBe("Keyboard");
    expect(content.querySelector("header p")).toBeNull();
  });
});
