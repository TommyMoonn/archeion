import { describe, expect, it } from "vitest";

import { findSettingsSearchResults } from "./settingsSearch";

describe("settingsSearch", () => {
  it("finds current labels and group terms", () => {
    expect(
      findSettingsSearchResults("display density").map((result) => result.item.id),
    ).toContain("appearance.display-density");
    expect(
      findSettingsSearchResults("animations").map((result) => result.item.id),
    ).toContain("appearance.animations");
    expect(
      findSettingsSearchResults("scan preferences").map(
        (result) => result.item.id,
      ),
    ).toContain("storage.scan-on-startup");
    expect(
      findSettingsSearchResults("archive maintenance").map(
        (result) => result.item.id,
      ),
    ).toContain("storage.rescan-archive");
  });

  it("supports useful row-level searches", () => {
    expect(
      findSettingsSearchResults("scan startup").map((result) => result.item.id),
    ).toEqual(["storage.scan-on-startup"]);
  });

  it("keeps removed composite labels out of search", () => {
    expect(findSettingsSearchResults("appearance and window")).toHaveLength(0);
    expect(findSettingsSearchResults("files and maintenance")).toHaveLength(0);
    expect(findSettingsSearchResults("interface")).toHaveLength(0);
  });
});
