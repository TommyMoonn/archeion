import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerPage } from "./ArchiveManagerPage";
import { useArchive } from "./useArchive";

vi.mock("./useArchive", () => ({
  useArchive: vi.fn(),
}));

const useArchiveMock = vi.mocked(useArchive);

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

function renderManager() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ArchiveManagerPage />
    </MemoryRouter>,
  );
}

describe("ArchiveManagerPage", () => {
  beforeEach(() => {
    useArchiveMock.mockReturnValue(readyState);
  });

  it("renders a dedicated two-panel archive management surface", () => {
    const markup = renderManager();

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
  });
});
