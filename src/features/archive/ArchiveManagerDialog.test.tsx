import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerDialog } from "./ArchiveManagerDialog";
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
  lastOpenedAt: "1",
};

const readyState: ArchiveState = {
  status: "ready",
  path: activeArchive.rootPath,
  archive: activeArchive,
  error: null,
  watcherError: null,
  archives: [activeArchive],
};

describe("ArchiveManagerDialog", () => {
  beforeEach(() => {
    useArchiveMock.mockReturnValue(readyState);
  });

  it("exposes the open-another-archive action", () => {
    const markup = renderToStaticMarkup(
      <ArchiveManagerDialog onClose={() => undefined} />,
    );

    expect(markup).toContain("Open another archive");
  });
});
