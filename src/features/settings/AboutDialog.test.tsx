import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AboutDialog } from "./AboutDialog";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "9.9.9"),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
}));

describe("AboutDialog", () => {
  it("renders the branded about content with fallback version and GitHub link", () => {
    const markup = renderToStaticMarkup(<AboutDialog onClose={vi.fn()} />);

    expect(markup).toContain("Archeion");
    expect(markup).toContain("Version 0.1.0");
    expect(markup).not.toContain("Your books and reading data stay on this device.");
    expect(markup).toContain("GitHub");
    expect(markup).toContain("https://github.com/TommyMoonn/archeion");
    expect(markup).toContain("about-window__brand");
    expect(markup).not.toContain("Local EPUB archive");
  });

  it("renders an explicit external GitHub action", () => {
    const markup = renderToStaticMarkup(<AboutDialog onClose={vi.fn()} />);

    expect(markup).toContain("Open");
    expect(markup).toContain('href="https://github.com/TommyMoonn/archeion"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });
});
