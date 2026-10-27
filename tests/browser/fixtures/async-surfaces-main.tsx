import { Suspense, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { Dialog } from "../../../src/components/Dialog";
import { useState } from "react";
import { LibraryWorkspaceDialogs } from "../../../src/features/library/LibraryWorkspaceDialogs";
import { useLibraryWorkspaceDialogs } from "../../../src/features/library/useLibraryWorkspaceDialogs";
import {
  SeriesOverview,
  LibraryEpubIssuesView,
  LibraryDuplicatesView,
} from "../../../src/features/library/libraryLazySurfaces";
import {
  IntegrityViewFallback,
  SeriesOverviewFallback,
} from "../../../src/features/library/LibrarySecondaryViewFallback";
import { defaultAppPreferences } from "../../../src/types/appSettings";
import type { Book } from "../../../src/types/book";
import { LibraryStorageProvider } from "../../../src/storage/LibraryStorageContext";
import { TauriArchiveLibraryStorage } from "../../../src/storage/TauriArchiveLibraryStorage";
import "../../../src/styles/index.css";

const book: Book = {
  id: "async-book",
  fileName: "Example.epub",
  relativePath: "Example.epub",
  originalTitle: "Example",
  isFavorite: false,
  addedAt: "2026-10-23",
  updatedAt: "2026-10-23",
};
const storage = new TauriArchiveLibraryStorage();
storage.loadBookCover = async () => undefined;
const noop = () => {};
const operation = async () => {};
const unused = async (): Promise<never> => {
  throw new Error("No file writes in this fixture");
};
const mode = new URLSearchParams(location.search).get("surface") ?? "add";
document.documentElement.dataset.motion =
  new URLSearchParams(location.search).get("motion") ?? "off";

export function Fixture() {
  const { dialog, actions } = useLibraryWorkspaceDialogs();
  const [replacement, setReplacement] = useState(false);
  Object.assign(window, {
    replaceAsyncSurface: () => {
      actions.close();
      setReplacement(true);
    },
  });
  const props: ComponentProps<typeof LibraryWorkspaceDialogs> = {
    dialog,
    dialogActions: actions,
    books: [book],
    folders: [],
    importDefaults: defaultAppPreferences.import,
    confirmDestructiveFileActions: true,
    isBulkRunning: false,
    isClearingProgress: false,
    isDeleting: false,
    isImporting: false,
    isRescanning: false,
    onConfirmClearProgress: operation,
    onCreateFolder: operation,
    onDeleteBook: operation,
    onDeleteFolder: operation,
    onDeleteSelectedBooks: operation,
    onImport: operation,
    onMoveBook: operation,
    onMoveFolder: operation,
    onMoveSelectedBooks: operation,
    onPrepareBookCover: unused,
    onReadBook: noop,
    onReadBookFromBeginning: noop,
    onRenameBookFile: operation,
    onRenameFolder: operation,
    onRequestClearProgress: noop,
    onRequestDeleteBook: noop,
    onRescan: operation,
    onRevealBookFile: operation,
    onToggleFavorite: operation,
    onWriteBookCover: unused,
    onWriteBookMetadata: unused,
    onWriteSelectedBookMetadata: operation,
    selectedBookIds: new Set([book.id]),
    selectedBooks: [book],
  };
  const seriesProps: ComponentProps<typeof SeriesOverview> = {
    entries: [],
    isLoading: false,
    cardSize: "medium",
    onClearSearch: noop,
    onOpen: noop,
    onQueryChange: noop,
    onSortChange: noop,
    onViewChange: noop,
    query: "",
    sort: "title",
    view: "grid",
  };
  const state = { status: "loading", snapshot: null, error: null } as const;
  const integrityProps = {
    books: [book],
    onOpenDetails: noop,
    onRead: noop,
    onRefresh: async () => true,
    onReveal: noop,
    state,
  };
  if (mode === "series")
    return (
      <Suspense fallback={<SeriesOverviewFallback {...seriesProps} resultLabel="Loading series" />}>
        <SeriesOverview {...seriesProps} />
      </Suspense>
    );
  if (mode === "issues")
    return (
      <Suspense
        fallback={
          <IntegrityViewFallback
            kind="epub-issues"
            refreshing={false}
            onRefresh={integrityProps.onRefresh}
            resultLabel="Checking EPUB files"
          />
        }
      >
        <LibraryEpubIssuesView {...integrityProps} />
      </Suspense>
    );
  if (mode === "duplicates")
    return (
      <Suspense
        fallback={
          <IntegrityViewFallback
            kind="duplicates"
            refreshing={false}
            onRefresh={integrityProps.onRefresh}
            resultLabel="Checking EPUB files"
          />
        }
      >
        <LibraryDuplicatesView {...integrityProps} onDelete={noop} onMove={noop} />
      </Suspense>
    );
  function open() {
    if (mode === "rename") actions.openRenameBook(book);
    else if (mode === "move") actions.openMoveBook(book);
    else if (mode === "folder") actions.openCreateFolder();
    else if (mode === "folder-rename")
      actions.openRenameFolder({
        id: "folder-1",
        name: "Example folder",
        relativePath: "Example folder",
        createdAt: "2026-10-23",
        updatedAt: "2026-10-23",
      });
    else if (mode === "metadata") actions.openBookMetadata(book);
    else if (mode === "cover") actions.openBookCover(book);
    else if (mode === "bulk") actions.openBulkMetadata();
    else if (mode === "details") actions.openBookDetails(book);
    else actions.openAddEpub();
  }
  return (
    <>
      <button onClick={open}>Open action</button>
      <LibraryWorkspaceDialogs {...props} />
      {replacement ? (
        <Dialog title="Replacement action" onClose={() => setReplacement(false)}>
          <button autoFocus>Replacement target</button>
        </Dialog>
      ) : null}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <LibraryStorageProvider storage={storage}>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </LibraryStorageProvider>,
);
