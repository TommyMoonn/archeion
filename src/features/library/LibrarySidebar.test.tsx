import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KnownArchive } from "../../types/archive";
import { LibrarySidebar } from "./LibrarySidebar";

const activeArchive: KnownArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "2",
};

const savedArchive: KnownArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "1",
  lastOpenedAt: "1",
};

function renderSidebar() {
  return renderToStaticMarkup(
    <LibrarySidebar
      activeArchive={activeArchive}
      archives={[activeArchive, savedArchive]}
      bookCount={0}
      continueCount={0}
      favoriteCount={0}
      folders={[]}
      location={{ type: "library" }}
      onCreateFolder={() => undefined}
      onDeleteFolder={() => undefined}
      onLocationChange={() => undefined}
      onManageArchives={() => undefined}
      onMoveFolder={() => undefined}
      onOpenAbout={() => undefined}
      onOpenSettings={() => undefined}
      onRenameFolder={() => undefined}
      onSwitchArchive={() => undefined}
    />,
  );
}

describe("LibrarySidebar", () => {
  it("keeps the archive switcher focused on known archives and management", () => {
    const markup = renderSidebar();

    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("Manage archives");
    expect(markup).not.toContain("Open archive");
    expect(markup).not.toContain("Open folder as archive");
    expect(markup).not.toContain("Create empty archive");
    expect(markup).not.toContain("E:\\Comics");
  });
});
