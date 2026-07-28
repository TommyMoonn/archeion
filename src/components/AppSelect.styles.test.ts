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
const formsStyles = readFileSync(
  new URL("../styles/components/forms.css", import.meta.url),
  "utf8",
);
const libraryStyles = readFileSync(
  new URL("../styles/features/library.css", import.meta.url),
  "utf8",
);
const settingsStyles = readFileSync(
  new URL("../styles/features/settings.css", import.meta.url),
  "utf8",
);
const folderStyles = readFileSync(
  new URL("../styles/features/folders.css", import.meta.url),
  "utf8",
);
const seriesStyles = readFileSync(
  new URL("../styles/features/series.css", import.meta.url),
  "utf8",
);
const readerStyles = readFileSync(
  new URL("../styles/features/reader.css", import.meta.url),
  "utf8",
);
const tokenStyles = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

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

  it("uses the shared surface hierarchy for closed, hovered, and raised select surfaces", () => {
    expect(dropdownStyles).toMatch(
      /\.app-select__trigger\s*\{[^}]*background:\s*var\(--surface\);/s,
    );
    expect(dropdownStyles).toMatch(
      /\.app-select__trigger:hover,\s*\.app-select__trigger\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(dropdownStyles).toMatch(
      /\.app-select__menu\s*\{[^}]*background:\s*var\(--surface-raised\);[^}]*box-shadow:\s*var\(--shadow-popover\);/s,
    );
    expect(dropdownStyles).not.toMatch(
      /\.app-select__trigger\s*\{[^}]*background:\s*var\(--canvas-deep\);/s,
    );
  });

  it("supports a compact icon-only trigger without narrowing the shared menu", () => {
    expect(dropdownStyles).toMatch(/\.app-select--icon-only\s*\{[^}]*min-width:\s*0;/s);
    expect(dropdownStyles).toMatch(
      /\.app-select--icon-only \.app-select__trigger\s*\{[^}]*width:\s*var\(--app-select-height,\s*var\(--control-height-standard\)\);[^}]*justify-content:\s*center;[^}]*padding:\s*0;/s,
    );
    expect(dropdownStyles).toMatch(/\.app-select__menu\s*\{[^}]*position:\s*fixed;/s);
  });

  it("keeps shared consumers on the common tone while preserving Reader-owned contrast", () => {
    for (const styles of [
      filesystemStyles,
      libraryStyles,
      settingsStyles,
      folderStyles,
      seriesStyles,
    ]) {
      expect(styles).not.toMatch(/\.app-select__trigger[^}]*background:/s);
    }
    expect(readerStyles).toMatch(
      /\.reader-settings \.app-select__trigger\s*\{[^}]*background:\s*var\(--reader-surface\);/s,
    );
    expect(readerStyles).toMatch(
      /\.reader-annotations__sort \.app-select__trigger\s*\{[^}]*background:\s*var\(--reader-surface\);/s,
    );
  });

  it("lets native selects inherit the active light or dark theme scheme", () => {
    expect(formsStyles).not.toMatch(/select\s*\{[^}]*color-scheme:\s*dark;/s);
    expect(tokenStyles).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark;/s);
    expect(tokenStyles).toMatch(/html\[data-app-theme="light"\]\s*\{[^}]*color-scheme:\s*light;/s);
    expect(tokenStyles).toMatch(/html\[data-app-theme="system"\]\s*\{[^}]*color-scheme:\s*light;/s);
  });
});
