import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultState } from "../../stores/vaultStore";
import { ArchiveManagerDialog } from "./ArchiveManagerDialog";
import { useVault } from "../vault/useVault";

vi.mock("../vault/useVault", () => ({
  useVault: vi.fn(),
}));

const useVaultMock = vi.mocked(useVault);

const activeArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "1",
};

const readyState: VaultState = {
  status: "ready",
  path: activeArchive.rootPath,
  archive: activeArchive,
  error: null,
  watcherError: null,
  archives: [activeArchive],
};

describe("ArchiveManagerDialog", () => {
  beforeEach(() => {
    useVaultMock.mockReturnValue(readyState);
  });

  it("exposes the open-another-archive action", () => {
    const markup = renderToStaticMarkup(
      <ArchiveManagerDialog onClose={() => undefined} />,
    );

    expect(markup).toContain("Open another archive");
  });
});
