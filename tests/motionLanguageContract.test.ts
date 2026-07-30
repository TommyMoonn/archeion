import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const baseStyles = readFileSync("src/styles/base.css", "utf8");
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const collectionStyles = readFileSync("src/styles/layout/collection-content.css", "utf8");
const dialogStyles = readFileSync("src/styles/components/dialogs.css", "utf8");
const folderStyles = readFileSync("src/styles/features/folders.css", "utf8");
const libraryStyles = readFileSync("src/styles/features/library.css", "utf8");
const quickActionsStyles = readFileSync("src/styles/features/quick-actions.css", "utf8");
const seriesStyles = readFileSync("src/styles/features/series.css", "utf8");
const settingsStyles = readFileSync("src/styles/features/settings.css", "utf8");
const archiveStyles = readFileSync("src/styles/features/archive.css", "utf8");
const readerStyles = readFileSync("src/styles/features/reader.css", "utf8");

describe("application motion language", () => {
  it("replaces the repeated vertical entrance with purpose-specific primitives", () => {
    expect(baseStyles).not.toContain("app-motion-enter");
    expect(baseStyles).not.toContain("app-motion-fade-in");
    expect(baseStyles).toContain("@keyframes app-motion-view-header-in");
    expect(baseStyles).toContain("@keyframes app-motion-view-content-in");
    expect(baseStyles).toContain("@keyframes app-motion-scale-in");
    expect(baseStyles).toContain("@keyframes app-motion-notice-in");
    expect(baseStyles).toContain("@keyframes app-motion-disclosure-in");
    expect(baseStyles).toContain("@keyframes app-motion-slide-in-right");
    expect(baseStyles).toContain("@keyframes app-motion-pulse");
  });

  it("gives collection-facing views a clean split settle without scaling text", () => {
    const viewHeaderKeyframes = baseStyles.slice(
      baseStyles.indexOf("@keyframes app-motion-view-header-in"),
      baseStyles.indexOf("@keyframes app-motion-view-content-in"),
    );
    const viewContentKeyframes = baseStyles.slice(
      baseStyles.indexOf("@keyframes app-motion-view-content-in"),
      baseStyles.indexOf("@keyframes app-motion-scale-in"),
    );

    expect(viewHeaderKeyframes).toContain("transform: translateY(-6px)");
    expect(viewHeaderKeyframes).toContain("transform: none");
    expect(viewHeaderKeyframes).not.toContain("scale(");
    expect(viewHeaderKeyframes).not.toContain("filter:");
    expect(viewContentKeyframes).toContain("transform: translateY(8px)");
    expect(viewContentKeyframes).toContain("transform: none");
    expect(viewContentKeyframes).not.toContain("scale(");
    expect(viewContentKeyframes).not.toContain("filter:");
    expect(libraryStyles).toMatch(
      /html\[data-motion="on"\] \.library-header\s*\{[^}]*animation:\s*app-motion-view-header-in var\(--motion-duration-view\) var\(--motion-ease-view\);/s,
    );
    expect(collectionStyles).toMatch(
      /html\[data-motion="on"\] \.collection-content\s*\{[^}]*animation:\s*app-motion-view-content-in var\(--motion-duration-view\) var\(--motion-ease-view\)[^;]*var\(--motion-delay-view-content\) backwards;/s,
    );
    expect(settingsStyles).toMatch(
      /html\[data-motion="on"\] \.settings-section\s*\{[^}]*animation:\s*app-motion-view-content-in var\(--motion-duration-view\) var\(--motion-ease-view\)[^;]*var\(--motion-delay-view-content\) backwards;/s,
    );
    expect(libraryStyles).not.toMatch(
      /html\[data-motion="on"\] \.library-header\s*\{[^}]*transform-origin:/s,
    );
    expect(collectionStyles).not.toMatch(
      /html\[data-motion="on"\] \.collection-content\s*\{[^}]*transform-origin:/s,
    );
    expect(settingsStyles).not.toMatch(
      /html\[data-motion="on"\] \.settings-section\s*\{[^}]*transform-origin:/s,
    );
    expect(folderStyles).not.toMatch(
      /html\[data-motion="on"\] \.folder-browser__items[^}]*animation:/s,
    );
    expect(seriesStyles).not.toMatch(/html\[data-motion="on"\] \.series-grid[^}]*animation:/s);
  });

  it("uses scale for raised overlays and compact notice motion for feedback", () => {
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] \.dialog\[open\]\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\)/s,
    );
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] dialog\[open\] > \.modal-surface\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\)/s,
    );
    expect(quickActionsStyles).toMatch(
      /html\[data-motion="on"\] \.quick-actions\[open\]\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\)/s,
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
      /html\[data-motion="on"\] \.reader-toc\s*\{[^}]*animation:\s*reader-toc-enter var\(--motion-duration-standard\)/s,
    );
  });

  it("keeps every expressive duration inert unless motion is effectively enabled", () => {
    expect(tokens).toMatch(
      /:root\s*\{[\s\S]*?--motion-duration-fast:\s*0ms;[\s\S]*?--motion-duration-emphasized:\s*0ms;[\s\S]*?--motion-duration-view:\s*0ms;[\s\S]*?--motion-duration-loop:\s*0ms;[\s\S]*?--motion-delay-view-content:\s*0ms;/,
    );
    expect(tokens).toMatch(
      /html\[data-motion="on"\]\s*\{[^}]*--motion-duration-fast:\s*120ms;[^}]*--motion-duration-emphasized:\s*180ms;[^}]*--motion-duration-view:\s*200ms;[^}]*--motion-duration-loop:\s*900ms;[^}]*--motion-delay-view-content:\s*42ms;/s,
    );
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-emphasized:\s*0ms;[\s\S]*?--motion-duration-view:\s*0ms;[\s\S]*?--motion-duration-loop:\s*0ms;[\s\S]*?--motion-delay-view-content:\s*0ms;/,
    );
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] \.dialog-loading-fallback__indicator\s*\{[^}]*animation:\s*app-motion-pulse var\(--motion-duration-loop\)/s,
    );
  });
});
