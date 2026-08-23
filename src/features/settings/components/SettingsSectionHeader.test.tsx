import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsSectionHeader } from "./SettingsSectionHeader";

describe("SettingsSectionHeader", () => {
  it("renders a semantic section heading with its description", () => {
    const markup = renderToStaticMarkup(
      <SettingsSectionHeader description="Section context." title="Example" />,
    );

    expect(markup).toContain("<header");
    expect(markup).toContain("<h2>Example</h2>");
    expect(markup).toContain("<p>Section context.</p>");
  });

  it("omits description markup when no description is defined", () => {
    const markup = renderToStaticMarkup(<SettingsSectionHeader title="Keyboard" />);

    expect(markup).toContain("<h2>Keyboard</h2>");
    expect(markup).not.toContain("<p");
  });
});
