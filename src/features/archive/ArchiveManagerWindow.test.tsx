import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerFallback } from "./ArchiveManagerWindow";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";

const activeArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "2",
};

const savedArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "1",
  lastOpenedAt: "1",
};

const readyState: ArchiveState = {
  status: "ready",
  path: activeArchive.rootPath,
  archive: activeArchive,
  error: null,
  watcherError: null,
  archives: [activeArchive, savedArchive],
};

function renderManager(state: ArchiveState = readyState) {
  return renderToStaticMarkup(
    <ArchiveManagerWindowContent mode="manager" standalone state={state} />,
  );
}

describe("ArchiveManagerWindow", () => {
  it("renders the manager surface for the separate window", () => {
    const markup = renderManager();

    expect(markup).toContain("archive-manager-shell--standalone");
    expect(markup).toContain("Manage archives");
    expect(markup).toContain('aria-label="Archives"');
    expect(markup).not.toContain("Known archives");
    expect(markup).not.toContain("archive-manager-window__sidebar-header");
    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("D:\\Books");
    expect(markup).toContain("E:\\Comics");
    expect(markup).toContain("archive-row--active");
    expect(markup).toContain("archive-manager-window__icon");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Open folder as archive");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Reveal in folder");
    expect(markup).toContain("Forget");
    expect(markup).not.toContain("archive-manager-window__chrome");
    expect(markup).not.toContain(">Archive Manager<");
    expect(markup).not.toContain("Active");
    expect(markup).not.toContain("Reveal folder");
    expect(markup).not.toContain("Forget archive");
    expect(markup).not.toContain(">2</span>");
    expect(markup).not.toContain("Open another archive");
    expect(markup).not.toContain("Back to Library");
    expect(markup.toLowerCase()).not.toContain("vault");
  });

  it("shows a visible fallback when initialization fails", () => {
    const markup = renderToStaticMarkup(
      <ArchiveManagerFallback message="Manager failed to initialize." />,
    );

    expect(markup).toContain("Archive Manager");
    expect(markup).toContain("Manager failed to initialize.");
    expect(markup).toContain('role="alert"');
  });
});
