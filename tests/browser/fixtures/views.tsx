import { useEffect, useRef, useState, type CSSProperties } from "react";

import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { Dialog } from "../../../src/components/Dialog";
import { PageShell } from "../../../src/components/PageShell";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { WindowTitlebarAppActionsHost } from "../../../src/components/WindowTitlebar";
import { LibrarySidebar } from "../../../src/features/library/LibrarySidebar";
import { LibraryTitlebarComposition } from "../../../src/features/library/LibraryTitlebarComposition";
import { useLibrarySidebarState } from "../../../src/features/library/useLibrarySidebarState";
import { ReaderProgressBar } from "../../../src/features/reader/ReaderProgressBar";
import type { KnownArchive } from "../../../src/types/archive";
import type { LibraryLocation } from "../../../src/types/library";
import { LibraryConfirmationFixture, ReaderNoteConfirmationFixture } from "./confirmation-views";
import { DictionaryToggleFixture, LibraryToggleFixture, ReaderToggleFixture } from "./toggle-views";
import { ArchiveShellFixture } from "./archive-shell-view";
import { ThemeManagerFixture } from "./theme-manager-view";
import { TypographyFixture } from "./typography-view";
import { UpdateToast } from "../../../src/features/updates/UpdateToast";
import { createUpdateToastFixture } from "./update-toast-backend";
import { AboutUpdateFixture } from "./about-update-view";

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

function LibraryFixture({ updates = false }: { updates?: boolean }) {
  const [updateFixture] = useState(() => {
    if (!updates) return null;
    const completed = new URLSearchParams(window.location.search).has("completed");
    return createUpdateToastFixture(
      completed
        ? {
            currentVersion: "1.6.1",
            prompt: {
              snoozedVersion: null,
              snoozedUntil: null,
              restartDeferred: false,
              completedVersion: "1.6.1",
            },
          }
        : {},
    );
  });
  useEffect(() => {
    if (!updateFixture) return;
    window.updateToastFixture = updateFixture;
    return () => {
      delete window.updateToastFixture;
      updateFixture.client.dispose();
    };
  }, [updateFixture]);
  const { collapseAvailable, collapsed, setCollapsed } = useLibrarySidebarState();
  const [location, setLocation] = useState<LibraryLocation>({ type: "library" });
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const sidebarNavigationRef = useRef<HTMLElement>(null);
  const [readerOpen, setReaderOpen] = useState(
    () => updates && new URLSearchParams(window.location.search).has("readerStartup"),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const shellColors = new URLSearchParams(window.location.search).get("shellColors");
  const style =
    shellColors === "equal"
      ? {
          "--surface-app-frame": "#202020",
          "--surface-sidebar": "#202020",
          "--surface-main": "#202020",
          "--line-strong": "#aaaaaa",
          "--line-subtle": "#555555",
        }
      : shellColors === "distinct"
        ? {
            "--surface-app-frame": "#481830",
            "--surface-sidebar": "#123c38",
            "--surface-main": "#22284e",
            "--line-strong": "#aaaaaa",
            "--line-subtle": "#555555",
          }
        : undefined;

  return (
    <TooltipProvider>
      <div className="window-app window-app--main-shell" style={style as CSSProperties}>
        <header aria-label="Window titlebar" className="window-titlebar">
          <WindowTitlebarAppActionsHost />
          <div className="window-titlebar__drag-region" data-tauri-drag-region />
          <div className="window-titlebar__controls" role="group" aria-label="Window controls">
            <button type="button" aria-label="Fixture window control">
              ×
            </button>
          </div>
        </header>
        <div className="window-app__content">
          {readerOpen ? (
            <main className="reader-page">
              <h1>Reader fixture</h1>
              <button type="button" onClick={() => setReaderOpen(false)}>
                Return to Library
              </button>
            </main>
          ) : (
            <PageShell
              notice={updateFixture ? <UpdateToast client={updateFixture.client} /> : undefined}
              sidebarCollapsed={collapsed}
              sidebar={
                <>
                  <LibraryTitlebarComposition
                    collapseAvailable={collapseAvailable}
                    collapsed={collapsed}
                    expandedSidebarContentRef={expandedContentRef}
                    sidebarNavigationRef={sidebarNavigationRef}
                    onCollapsedChange={setCollapsed}
                  />
                  <LibrarySidebar
                    activeArchive={archive}
                    archives={[archive]}
                    collapsed={collapsed}
                    expandedContentRef={expandedContentRef}
                    navigationRef={sidebarNavigationRef}
                    folderEntries={[]}
                    folderSort="name"
                    location={location}
                    smartViewPreferences={{ enabled: false, visible: [] }}
                    onCreateFolder={() => undefined}
                    onDeleteFolder={() => undefined}
                    onFolderSortChange={() => undefined}
                    onLocationChange={setLocation}
                    onManageArchives={() => undefined}
                    onRevealArchive={() => undefined}
                    onMoveFolder={() => undefined}
                    onOpenAbout={() => undefined}
                    onOpenSettings={() => undefined}
                    onRenameFolder={() => undefined}
                    onSwitchArchive={() => undefined}
                  />
                </>
              }
            >
              <h1>Library fixture</h1>
              <button type="button" onClick={() => setReaderOpen(true)}>
                Enter Reader
              </button>
              {updates ? (
                <>
                  <button type="button" onClick={() => setDialogOpen(true)}>
                    Open Library overlay
                  </button>
                  <div style={{ height: 1400 }} />
                  <button type="button">Last Library action</button>
                </>
              ) : null}
            </PageShell>
          )}
          {dialogOpen ? (
            <Dialog title="Library overlay" onClose={() => setDialogOpen(false)}>
              <p>Overlay content</p>
            </Dialog>
          ) : null}
        </div>
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
  if (view === "archive-shell") return <ArchiveShellFixture />;
  if (view === "theme-manager") return <ThemeManagerFixture />;
  if (view === "typography") return <TypographyFixture />;
  if (view === "reader") return <ReaderFixture />;
  if (view === "library") return <LibraryFixture />;
  if (view === "library-updates") return <LibraryFixture updates />;
  if (view === "about-updates") return <AboutUpdateFixture />;
  if (view === "dialog") return <DialogFixture />;
  if (view === "note-confirmation") return <ReaderNoteConfirmationFixture />;
  if (view === "library-confirmations") return <LibraryConfirmationFixture />;
  if (view === "reader-toggles") return <ReaderToggleFixture />;
  if (view === "library-toggles") return <LibraryToggleFixture />;
  if (view === "details-toggle") return <LibraryToggleFixture details />;
  if (view === "dictionary-toggle") return <DictionaryToggleFixture />;
  return <main>Unknown browser fixture</main>;
}
