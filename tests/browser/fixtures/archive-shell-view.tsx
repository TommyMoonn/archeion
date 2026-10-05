import type { CSSProperties } from "react";

import { SkipLink, ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../../src/components/SkipLink";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { WindowTitlebar } from "../../../src/components/WindowTitlebar";
import { ArchiveManagerFallback } from "../../../src/features/archive/ArchiveManagerWindow";
import { ArchiveManagerWindowContent } from "../../../src/features/archive/ArchiveManagerWindowContent";
import { ArchiveManagerWindowLoading } from "../../../src/features/archive/ArchiveManagerWindowLoading";
import type { ArchiveState } from "../../../src/stores/archiveStore";

const archive = {
  id: "archive-shell-fixture",
  displayName: "Fixture archive",
  rootPath: "fixture-only",
  createdAt: "1",
  lastOpenedAt: "1",
};

const state: ArchiveState = {
  status: "ready",
  path: archive.rootPath,
  archive,
  archives: [archive],
  error: null,
  watcherError: null,
};

export function ArchiveShellFixture() {
  const params = new URLSearchParams(window.location.search);
  const equal = params.get("shellColors") === "equal";
  const style = {
    "--surface-app-frame": equal ? "#202020" : "#481830",
    "--surface-sidebar": equal ? "#202020" : "#123c38",
    "--surface-main": equal ? "#202020" : "#22284e",
    "--line-strong": "#aaaaaa",
    "--line-subtle": "#555555",
  } as CSSProperties;
  const view = params.get("state");

  return (
    <TooltipProvider>
      <div className="window-app window-app--archive-manager" style={style}>
        <SkipLink targetId={ARCHIVE_MANAGER_MAIN_CONTENT_ID} />
        <WindowTitlebar canMaximize={false} />
        <div className="window-app__content">
          {view === "fallback" ? (
            <ArchiveManagerFallback message="Fixture initialization failure." />
          ) : view === "loading" ? (
            <ArchiveManagerWindowLoading />
          ) : (
            <ArchiveManagerWindowContent state={state} />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
