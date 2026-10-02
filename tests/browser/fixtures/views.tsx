import { useEffect, useRef, useState } from "react";

import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { Dialog } from "../../../src/components/Dialog";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { LibrarySidebar } from "../../../src/features/library/LibrarySidebar";
import { useLibrarySidebarState } from "../../../src/features/library/useLibrarySidebarState";
import { ReaderProgressBar } from "../../../src/features/reader/ReaderProgressBar";
import type { KnownArchive } from "../../../src/types/archive";
import type { LibraryLocation } from "../../../src/types/library";
import { LibraryConfirmationFixture, ReaderNoteConfirmationFixture } from "./confirmation-views";
import { DictionaryToggleFixture, LibraryToggleFixture, ReaderToggleFixture } from "./toggle-views";

const archive: KnownArchive = {
  id: "browser-fixture",
  displayName: "Fixture archive",
  rootPath: "fixture-only",
  createdAt: "1",
  lastOpenedAt: "1",
};

function ReaderFixture() {
  const [progress, setProgress] = useState(32);

  return (
    <main className="reader-page" style={{ height: 180, margin: 24 }}>
      <ReaderProgressBar
        percentage={progress}
        placement="top"
        seekable
        resolveSeekPreview={(percentage) => ({ percentage, chapterLabel: "Chapter One" })}
        onSeek={async (percentage) => {
          setProgress(percentage);
          return true;
        }}
      />
      <button type="button" style={{ marginTop: 80 }}>
        After progress
      </button>
    </main>
  );
}

function LibraryFixture() {
  const { collapseAvailable, collapsed, setCollapsed } = useLibrarySidebarState();
  const [location, setLocation] = useState<LibraryLocation>({ type: "library" });
  const expandedContentRef = useRef<HTMLDivElement>(null);

  return (
    <TooltipProvider>
      <div className="app-shell" data-sidebar-collapsed={collapsed || undefined}>
        <LibrarySidebar
          activeArchive={archive}
          archives={[archive]}
          collapsed={collapsed}
          expandedContentRef={expandedContentRef}
          folderEntries={[]}
          folderSort="name"
          location={location}
          smartViewPreferences={{ enabled: false, visible: [] }}
          onCreateFolder={() => undefined}
          onDeleteFolder={() => undefined}
          onFolderSortChange={() => undefined}
          onLocationChange={setLocation}
          onManageArchives={() => undefined}
          onMoveFolder={() => undefined}
          onOpenAbout={() => undefined}
          onOpenSettings={() => undefined}
          onRenameFolder={() => undefined}
          onSwitchArchive={() => undefined}
        />
        <main className="page-shell">
          <h1>Library fixture</h1>
          {collapseAvailable ? (
            <button type="button" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </button>
          ) : null}
        </main>
      </div>
    </TooltipProvider>
  );
}

function DialogFixture() {
  const [open, setOpen] = useState(false);

  return (
    <main style={{ padding: 24 }}>
      <button type="button" onClick={() => setOpen(true)}>
        Open sample dialog
      </button>
      {open ? (
        <Dialog
          title="Sample dialog"
          onClose={() => setOpen(false)}
          footer={
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          }
        >
          <p>Dialog content</p>
        </Dialog>
      ) : null}
    </main>
  );
}

export function BrowserFixture() {
  useEffect(() => focusPresentationRuntime.start(document), []);

  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "reader") return <ReaderFixture />;
  if (view === "library") return <LibraryFixture />;
  if (view === "dialog") return <DialogFixture />;
  if (view === "note-confirmation") return <ReaderNoteConfirmationFixture />;
  if (view === "library-confirmations") return <LibraryConfirmationFixture />;
  if (view === "reader-toggles") return <ReaderToggleFixture />;
  if (view === "library-toggles") return <LibraryToggleFixture />;
  if (view === "details-toggle") return <LibraryToggleFixture details />;
  if (view === "dictionary-toggle") return <DictionaryToggleFixture />;
  return <main>Unknown browser fixture</main>;
}
