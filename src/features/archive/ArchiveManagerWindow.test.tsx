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
    <ArchiveManagerWindowContent
      mode="manager"
      standalone
      state={state}
    />,
  );
}

describe("ArchiveManagerWindow", () => {
  it("renders the manager surface for the separate window", () => {
    const markup = renderManager();

    expect(markup).toContain("archive-manager-shell--standalone");
    expect(markup).toContain("Archive Manager");
    expect(markup).toContain("Manage archives");
    expect(markup).toContain("Known archives");
    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("D:\\Books");
    expect(markup).toContain("E:\\Comics");
    expect(markup).toContain("Active");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Open folder as archive");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Reveal folder");
    expect(markup).toContain("Forget archive");
    expect(markup).not.toContain("Open another archive");
    expect(markup).not.toContain("Back to Library");
  });

  it("shows a visible fallback when initialization fails", () => {
    const markup = renderToStaticMarkup(
      <ArchiveManagerFallback message="Manager failed to initialize." />,
    );

    expect(markup).toContain("Archive Manager");
    expect(markup).toContain("Manager failed to initialize.");
    expect(markup).toContain("role=\"alert\"");
  });
});
