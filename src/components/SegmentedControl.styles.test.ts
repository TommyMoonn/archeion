import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const segmentedControlStyles = readFileSync(
  new URL("../styles/components/segmented-control.css", import.meta.url),
  "utf8",
);
const baseStyles = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const libraryStyles = readFileSync(
  new URL("../styles/features/library.css", import.meta.url),
  "utf8",
);
const folderStyles = readFileSync(
  new URL("../styles/features/folders.css", import.meta.url),
  "utf8",
);

describe("icon-only SegmentedControl appearance", () => {
  it("owns one fixed ghost-control geometry and unsquashed icon box", () => {
    expect(segmentedControlStyles).toMatch(
      /\.segmented-control--icon-only\s*\{[^}]*--segmented-icon-option-size:\s*38px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    expect(segmentedControlStyles).toMatch(
      /\.segmented-control--icon-only \.segmented-control__option\s*\{[^}]*width:\s*var\(--segmented-icon-option-size\);[^}]*height:\s*var\(--segmented-icon-option-size\);/s,
    );
    expect(segmentedControlStyles).toMatch(
      /\.segmented-control--icon-only \.segmented-control__icon\s*\{[^}]*--icon-slot-size:\s*18px;[^}]*--icon-glyph-size:\s*18px;/s,
    );
    expect(segmentedControlStyles).toMatch(
      /html\[data-density="compact"\] \.segmented-control--icon-only\s*\{[^}]*--segmented-icon-option-size:\s*36px;/s,
    );
  });

  it("keeps hover, selected, disabled, and focus-visible states distinguishable", () => {
    const normalizedBaseStyles = baseStyles
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const focusableControls =
      ':root[data-focus-presentation="keyboard-navigation"] :where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]))';

    expect(segmentedControlStyles).toMatch(
      /\.segmented-control--icon-only \.segmented-control__option:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(segmentedControlStyles).toMatch(
      /\.segmented-control--icon-only \.segmented-control__option\[aria-checked="true"\]\s*\{[^}]*border-color:\s*var\(--line-strong\);[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(baseStyles).toMatch(/button:disabled[^}]*opacity:\s*0\.55;/s);
    expect(normalizedBaseStyles).toContain(`${focusableControls}:focus-visible { outline:`);
    expect(normalizedBaseStyles).not.toContain(`${focusableControls} :focus-visible`);
  });

  it("leaves collection-specific toggle styling out of Library and Folder CSS", () => {
    expect(libraryStyles).not.toContain("library-view-toggle");
    expect(folderStyles).not.toContain("folder-view-toggle");
  });
});
