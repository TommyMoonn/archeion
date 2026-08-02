import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const baseStyles = readFileSync("src/styles/base.css", "utf8");
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const collectionStyles = readFileSync("src/styles/layout/collection-content.css", "utf8");
const dialogStyles = readFileSync("src/styles/components/dialogs.css", "utf8");
const folderStyles = readFileSync("src/styles/features/folders.css", "utf8");
const libraryStyles = readFileSync("src/styles/features/library.css", "utf8");
const quickActionsStyles = readFileSync("src/styles/features/quick-actions.css", "utf8");
const settingsStyles = readFileSync("src/styles/features/settings.css", "utf8");
const archiveStyles = readFileSync("src/styles/features/archive.css", "utf8");
const readerStyles = readFileSync("src/styles/features/reader.css", "utf8");
const bookGridSource = readFileSync("src/features/library/BookGrid.tsx", "utf8");
const bookListSource = readFileSync("src/features/library/BookList.tsx", "utf8");
const folderBrowserSource = readFileSync("src/features/folders/FolderBrowser.tsx", "utf8");
const seriesOverviewSource = readFileSync("src/features/series/SeriesOverview.tsx", "utf8");

describe("application motion language", () => {
  it("keeps purpose-specific motion primitives without a heading entrance", () => {
    expect(baseStyles).not.toContain("app-motion-enter");
    expect(baseStyles).not.toContain("app-motion-fade-in");
    expect(baseStyles).not.toContain("app-motion-view-header-in");
    expect(baseStyles).toContain("@keyframes app-motion-view-content-in");
    expect(baseStyles).toContain("@keyframes app-motion-settings-section-in");
    expect(baseStyles).toContain("@keyframes app-motion-scale-in");
    expect(baseStyles).toContain("@keyframes app-motion-notice-in");
    expect(baseStyles).toContain("@keyframes app-motion-disclosure-in");
    expect(baseStyles).toContain("@keyframes app-motion-slide-in-right");
    expect(baseStyles).toContain("@keyframes app-motion-pulse");
  });

  it("animates collection items without moving headings or whole content surfaces", () => {
    const viewContentKeyframes = baseStyles.slice(
      baseStyles.indexOf("@keyframes app-motion-view-content-in"),
      baseStyles.indexOf("@keyframes app-motion-settings-section-in"),
    );

    expect(viewContentKeyframes).toContain("transform: translateY(8px)");
    expect(viewContentKeyframes).toContain("transform: none");
    expect(viewContentKeyframes).not.toContain("scale(");
    expect(viewContentKeyframes).not.toContain("filter:");
    expect(libraryStyles).not.toMatch(
      /html\[data-motion="on"\] \.library-header\s*\{[^}]*animation:/s,
    );
    expect(collectionStyles).toMatch(
      /html\[data-motion="on"\] \.collection-content__items\s*\{[^}]*animation:\s*app-motion-view-content-in var\(--motion-duration-view\) var\(--motion-ease-view\);/s,
    );
    expect(collectionStyles).not.toMatch(
      /html\[data-motion="on"\] \.collection-content\s*\{[^}]*animation:/s,
    );
    expect(bookGridSource).toContain('className="book-grid collection-content__items"');
    expect(bookListSource).toContain('className="book-list collection-content__items"');
    expect(folderBrowserSource).toContain(
      "folder-browser__items--${view} collection-content__items",
    );
    expect(seriesOverviewSource).toContain("series-grid--${view} collection-content__items");
  });

  it("keeps Settings static on open and reserves a minimal fade for later section switches", () => {
    const settingsSectionKeyframes = baseStyles.slice(
      baseStyles.indexOf("@keyframes app-motion-settings-section-in"),
      baseStyles.indexOf("@keyframes app-motion-scale-in"),
    );

    expect(settingsSectionKeyframes).toContain("opacity: 0.86");
    expect(settingsSectionKeyframes).toContain("opacity: 1");
    expect(settingsSectionKeyframes).not.toContain("transform:");
    expect(settingsSectionKeyframes).not.toContain("scale(");
    expect(settingsSectionKeyframes).not.toContain("filter:");
    expect(settingsStyles).toMatch(
      /html\[data-motion="on"\] \.settings-section-transition\[data-transition="section-change"\]\s*\{[^}]*animation:\s*app-motion-settings-section-in var\(--motion-duration-fast\) var\(--motion-ease-standard\);/s,
    );
    expect(settingsStyles).not.toMatch(
      /html\[data-motion="on"\] \.settings-section\s*\{[^}]*animation:/s,
    );
    expect(settingsStyles).not.toMatch(
      /html\[data-motion="on"\] \.settings-content\s*\{[^}]*animation:/s,
    );
  });

  it("uses bounded overlay entrances and compact notice motion for feedback", () => {
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] \.dialog\[open\]\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\)/s,
    );
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] dialog\[open\] > \.modal-surface\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\)/s,
    );
    expect(quickActionsStyles).toMatch(
      /html\[data-motion="on"\] \.quick-actions\[open\]\s*\{[^}]*animation:\s*quick-actions-enter var\(--motion-duration-fast\) var\(--motion-ease-standard\);/s,
    );
    const quickActionsEntrance = quickActionsStyles.slice(
      quickActionsStyles.indexOf("@keyframes quick-actions-enter"),
      quickActionsStyles.indexOf("@media (max-height: 560px)"),
    );
    expect(quickActionsEntrance).toContain("transform: translateY(-4px)");
    expect(quickActionsEntrance).not.toContain("scale(");
    expect(quickActionsStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?html\[data-motion="on"\] \.quick-actions\[open\]\s*\{[^}]*animation:\s*none;[^}]*transform:\s*none;/s,
    );
    expect(settingsStyles).toMatch(
      /html\[data-motion="on"\] \.settings-status\s*\{[^}]*animation:\s*app-motion-notice-in var\(--motion-duration-fast\)/s,
    );
    expect(libraryStyles).toMatch(
      /html\[data-motion="on"\] \.library-feedback__token\s*\{[^}]*animation:\s*app-motion-notice-in var\(--motion-duration-fast\)/s,
    );
  });

  it("keeps directional movement only where it preserves spatial context", () => {
    expect(folderStyles).toMatch(
      /html\[data-motion="on"\] \.folder-tree__children\s*\{[^}]*animation:\s*app-motion-disclosure-in var\(--motion-duration-standard\)/s,
    );
    expect(libraryStyles).toMatch(
      /html\[data-motion="on"\] \.details-drawer\[open\]\s*\{[^}]*animation:\s*app-motion-slide-in-right var\(--motion-duration-standard\)/s,
    );
    expect(archiveStyles).toContain("archive-manager-slide-from-right");
    expect(archiveStyles).toContain("archive-manager-slide-from-left");
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-side-panel\s*\{[^}]*animation:\s*reader-side-panel-enter var\(--motion-duration-standard\)/s,
    );
  });

  it("keeps every expressive duration inert unless motion is effectively enabled", () => {
    expect(tokens).toMatch(
      /:root\s*\{[\s\S]*?--motion-duration-fast:\s*0ms;[\s\S]*?--motion-duration-emphasized:\s*0ms;[\s\S]*?--motion-duration-view:\s*0ms;[\s\S]*?--motion-duration-loop:\s*0ms;/,
    );
    expect(tokens).toMatch(
      /html\[data-motion="on"\]\s*\{[^}]*--motion-duration-fast:\s*120ms;[^}]*--motion-duration-emphasized:\s*180ms;[^}]*--motion-duration-view:\s*200ms;[^}]*--motion-duration-loop:\s*900ms;/s,
    );
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-emphasized:\s*0ms;[\s\S]*?--motion-duration-view:\s*0ms;[\s\S]*?--motion-duration-loop:\s*0ms;/,
    );
    expect(tokens).not.toContain("--motion-delay-view-content");
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] \.dialog-loading-fallback__indicator\s*\{[^}]*animation:\s*app-motion-pulse var\(--motion-duration-loop\)/s,
    );
  });
});
