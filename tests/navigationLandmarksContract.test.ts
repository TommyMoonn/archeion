import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Phase 0.9.0.28 navigation landmarks and focus entry", () => {
  it("mounts one window-owned skip path for the main and Archive Manager windows", () => {
    const app = read("src/app/App.tsx");
    const storage = read("src/storage/LibraryStorageContext.tsx");

    expect(app).toContain("<SkipLink targetId={MAIN_CONTENT_ID} />");
    expect(app).toContain("<SkipLink targetId={ARCHIVE_MANAGER_MAIN_CONTENT_ID} />");
    expect(app).toContain("<AppErrorBoundary mainContentId={ARCHIVE_MANAGER_MAIN_CONTENT_ID}>");
    expect(app).toContain("<Suspense fallback={<ArchiveManagerWindowLoading />}>");
    expect(storage).toContain("id={MAIN_CONTENT_ID}");
    expect(storage).toContain("tabIndex={-1}");
  });

  it("keeps the skip control offscreen until keyboard focus and visible in forced colors", () => {
    const base = read("src/styles/base.css");
    const forcedColors = read("src/styles/forced-colors.css");

    expect(base).toMatch(
      /\.skip-link\s*\{[^}]*position:\s*fixed;[^}]*transform:\s*translateY\(calc\(-100% - 12px\)\);/s,
    );
    expect(base).toMatch(/\.skip-link:focus-visible\s*\{[^}]*transform:\s*translateY\(0\);/s);
    expect(forcedColors).toMatch(
      /\.skip-link\s*\{[^}]*border-color:\s*CanvasText;[^}]*background:\s*Canvas;[^}]*box-shadow:\s*none;/s,
    );
  });

  it("names collection and Settings search and navigation landmarks", () => {
    const librarySidebar = read("src/features/library/LibrarySidebar.tsx");
    const series = read("src/features/series/SeriesOverview.tsx");
    const settings = read("src/features/settings/SettingsSidebar.tsx");

    expect(librarySidebar).toContain('aria-label="Library navigation"');
    expect(series).toContain('aria-label="Series search"');
    expect(series).toContain('role="search"');
    expect(settings).toContain('aria-label="Settings navigation"');
    expect(settings).toContain('aria-label="Settings search"');
    expect(settings).toContain('aria-label="Settings sections"');
  });

  it("keeps the shared Settings surface free of a competing main landmark", () => {
    const settings = read("src/features/settings/SettingsSurface.tsx");

    expect(settings).toContain('<section aria-label="Settings content"');
    expect(settings).not.toContain('<main className="settings-content"');
  });
});
