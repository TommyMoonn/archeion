import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsStatus } from "./SettingsStatus";

describe("SettingsStatus", () => {
  it("renders non-error messages as status updates", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus persistenceStatus={{ status: "idle" }} status="Saved." />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Saved.");
  });

  it("renders persistence errors as alerts", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus
        persistenceStatus={{ status: "error", error: "Failed." }}
        status={null}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Failed.");
  });

  it("renders nothing when there is no local or persistence status", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus persistenceStatus={{ status: "idle" }} status={null} />,
    );

    expect(markup).toBe("");
  });
});
