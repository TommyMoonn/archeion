import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dropdownStyles = readFileSync(
  new URL("../styles/components/dropdowns.css", import.meta.url),
  "utf8",
);
const dialogStyles = readFileSync(
  new URL("../styles/components/dialogs.css", import.meta.url),
  "utf8",
);
const filesystemStyles = readFileSync(
  new URL("../styles/features/filesystem.css", import.meta.url),
  "utf8",
);

describe("AppSelect placement style ownership", () => {
  it("uses one fixed, internally scrollable shared menu", () => {
    expect(dropdownStyles).toMatch(
      /\.app-select__menu\s*\{[^}]*position:\s*fixed;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
    );
    expect(dropdownStyles).not.toMatch(
      /\.app-select__menu\s*\{[^}]*(?:top:\s*calc\(100%|position:\s*absolute|left:\s*0|right:\s*0)/s,
    );
  });

  it("leaves the dialog panel as scroll owner while a select is open", () => {
    expect(dialogStyles).toMatch(/\.dialog__panel\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(dialogStyles).not.toContain(":has(.app-select__menu)");
  });

  it("removes Add EPUB and move-dialog menu height workarounds", () => {
    expect(filesystemStyles).not.toMatch(
      /\.(?:add-epub|move-to-folder)-dialog \.app-select__menu/s,
    );
  });
});
