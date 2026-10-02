import { useState } from "react";

import { TooltipProvider } from "../../../src/components/Tooltip";
import { BookCard } from "../../../src/features/library/BookCard";
import { BookDetailsDrawer } from "../../../src/features/library/BookDetailsDrawer";
import { BookList } from "../../../src/features/library/BookList";
import { LibraryToolbar } from "../../../src/features/library/LibraryToolbar";
import { ReaderNavigationPanel } from "../../../src/features/reader/ReaderNavigationPanel";
import { ReaderSideSurfaceLayer } from "../../../src/features/reader/ReaderSideSurfaceLayer";
import { ReaderToolbar } from "../../../src/features/reader/ReaderToolbar";
import { DictionarySettingsView } from "../../../src/features/settings/sections/DictionarySettingsSection";
import type { DictionarySettingsController } from "../../../src/features/settings/useDictionarySettings";
import type { Book } from "../../../src/types/book";
import type { LibraryStorage } from "../../../src/storage/LibraryStorage";
import { LibraryStorageProvider } from "../../../src/storage/LibraryStorageContext";
import type { InstalledDictionary } from "../../../src/types/dictionary";
import { createDefaultLibraryFilters } from "../../../src/types/library";

function ignore() {}
async function unsupportedOperation(): Promise<never> {
  throw new Error("This operation is outside the toggle fixture.");
}
function unsupportedSynchronousOperation(): never {
  throw new Error("This operation is outside the toggle fixture.");
}

// Only cover reads are supported. No fixture operation reaches the native archive.
const coverStorage: LibraryStorage = {
  loadBookCover: async () => undefined,
  flushPendingWrites: unsupportedOperation,
  reset: unsupportedSynchronousOperation,
  rescan: unsupportedOperation,
  applyArchiveWatcherChanges: unsupportedOperation,
  getLibrarySnapshot: unsupportedSynchronousOperation,
  observeLibrarySnapshot: unsupportedSynchronousOperation,
  addEpubFilesToArchive: unsupportedOperation,
  getBook: unsupportedOperation,
  prepareBookCover: unsupportedOperation,
  loadBookFile: unsupportedOperation,
  revealBookFile: unsupportedOperation,
  listBooks: unsupportedOperation,
  updateBook: unsupportedOperation,
  writeBookMetadata: unsupportedOperation,
  writeBookCover: unsupportedOperation,
  renameBookFile: unsupportedOperation,
  moveBookToFolder: unsupportedOperation,
  deleteBook: unsupportedOperation,
  bulkMoveBooksToFolder: unsupportedOperation,
  bulkSetFavorite: unsupportedOperation,
  bulkDeleteBooks: unsupportedOperation,
  bulkReextractMetadata: unsupportedOperation,
  bulkRegenerateCovers: unsupportedOperation,
  bulkExportBooks: unsupportedOperation,
  bulkWriteBookMetadata: unsupportedOperation,
  listAnnotations: unsupportedOperation,
  getAnnotation: unsupportedOperation,
  createAnnotation: unsupportedOperation,
  restoreAnnotation: unsupportedOperation,
  updateBookmarkAnnotation: unsupportedOperation,
  updateHighlightAnnotation: unsupportedOperation,
  deleteAnnotation: unsupportedOperation,
  createFolder: unsupportedOperation,
  getFolder: unsupportedOperation,
  listFolders: unsupportedOperation,
  updateFolder: unsupportedOperation,
  revealFolder: unsupportedOperation,
  deleteFolder: unsupportedOperation,
  getCoverCacheStatus: unsupportedOperation,
  clearCoverCache: unsupportedOperation,
  getEpubWritebackBackupStatus: unsupportedOperation,
  clearEpubWritebackBackups: unsupportedOperation,
  clearScannerCache: unsupportedOperation,
  repairArchiveMetadata: unsupportedOperation,
  revealMetadataFolder: unsupportedOperation,
};

const initialBook: Book = {
  id: "toggle-book",
  fileName: "Fixture.epub",
  originalTitle: "Fixture",
  isFavorite: false,
  addedAt: "2026-10-02",
  updatedAt: "2026-10-02",
};

export function LibraryToggleFixture({ details = false }: { details?: boolean }) {
  const [book, setBook] = useState(initialBook);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState(false);
  const [open, setOpen] = useState(false);
  const onToggleFavorite = () => setBook((value) => ({ ...value, isFavorite: !value.isFavorite }));
  const callbacks = {
    onDelete: ignore,
    onEditMetadata: ignore,
    onRead: ignore,
    onSelect: ignore,
    onSelectionChange: () => setSelected((value) => !value),
    onToggleFavorite,
  };
  return (
    <LibraryStorageProvider storage={coverStorage}>
      <TooltipProvider>
        <main className="page-shell" style={{ padding: 24 }}>
          {details ? (
            <>
              <button type="button" onClick={() => setOpen(true)}>
                Open book details
              </button>
              {open ? (
                <BookDetailsDrawer
                  book={book}
                  onClose={() => setOpen(false)}
                  onClearProgress={ignore}
                  onDelete={ignore}
                  onRead={ignore}
                  onReadFromBeginning={ignore}
                  onReplaceCover={ignore}
                  onMoveFile={ignore}
                  onRenameFile={ignore}
                  onRevealFile={ignore}
                  onRescan={ignore}
                  onViewMetadata={ignore}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : null}
            </>
          ) : (
            <>
              <LibraryToolbar
                filters={{ ...createDefaultLibraryFilters(), series: ["Fixture series"] }}
                filterOptions={{ languages: [], publishers: [], series: [], subjects: [] }}
                isImporting={false}
                isRescanning={false}
                onClearFilters={ignore}
                onClearSearch={ignore}
                onFilterChange={ignore}
                onOpenAddEpub={ignore}
                onQueryChange={ignore}
                onRescan={unsupportedOperation}
                onSortChange={ignore}
                onViewChange={ignore}
                onToggleSelectionMode={() => setSelectionMode((value) => !value)}
                query=""
                resultCount={1}
                selectionMode={selectionMode}
                sort="title"
                title="Library"
                view="grid"
              />
              <section aria-label="Grid fixture" style={{ width: 200 }}>
                <BookCard
                  {...callbacks}
                  book={book}
                  selected={selected}
                  selectionMode={selectionMode}
                />
              </section>
              <section aria-label="List fixture">
                <BookList
                  {...callbacks}
                  books={[book]}
                  selectedBookIds={new Set(selected ? [book.id] : [])}
                  selectionMode={selectionMode}
                />
              </section>
            </>
          )}
        </main>
      </TooltipProvider>
    </LibraryStorageProvider>
  );
}

export function ReaderToggleFixture() {
  const [bookmarkActive, setBookmarkActive] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  return (
    <TooltipProvider>
      <main className="reader-page" style={{ height: 700 }}>
        <ReaderToolbar
          hasChapterNavigation={false}
          historyBackDisabled
          historyForwardDisabled
          bookmarkActive={bookmarkActive}
          bookmarkBusy={false}
          bookmarkToggleDisabled={false}
          annotationsOpen={false}
          nextChapterDisabled
          previousChapterDisabled
          backLabel="Back to Library"
          onBack={ignore}
          onHistoryBack={ignore}
          onHistoryForward={ignore}
          onAnnotations={ignore}
          onToggleBookmark={() => setBookmarkActive((value) => !value)}
          onNextChapter={ignore}
          onPreviousChapter={ignore}
          onSearch={ignore}
          onSettings={ignore}
          onNavigation={() => setNavigationOpen((value) => !value)}
          percentage={32}
          progressSaveFailed={false}
          title="Fixture"
          navigationOpen={navigationOpen}
          searchOpen={false}
        />
        {navigationOpen ? (
          <ReaderSideSurfaceLayer onDismiss={() => setNavigationOpen(false)}>
            <ReaderNavigationPanel
              onClose={() => setNavigationOpen(false)}
              onNavigate={unsupportedOperation}
              navigation={{
                status: "ready",
                chapters: [
                  {
                    id: "one",
                    label: "Chapter One",
                    href: "one.xhtml",
                    target: "one.xhtml",
                    position: {},
                    depth: 0,
                  },
                ],
                landmarks: [],
                pageReferences: [
                  {
                    id: "page",
                    label: "1",
                    href: "one.xhtml#page",
                    target: "one.xhtml#page",
                    position: {},
                  },
                ],
              }}
            />
          </ReaderSideSurfaceLayer>
        ) : null}
      </main>
    </TooltipProvider>
  );
}

export function DictionaryToggleFixture() {
  const [enabled, setEnabled] = useState(false);
  const dictionary: InstalledDictionary = {
    id: "toggle-dictionary",
    displayName: "English Core",
    sourceLanguage: "en",
    targetLanguage: "en",
    enabled,
    order: 0,
    entryCount: 10,
    installedSizeBytes: 1024,
    sourceKind: "manual-import",
    catalogId: null,
    sourceAttribution: "Fixture",
    licenseName: "Fixture license",
    licenseUrl: null,
    packageVersion: "1",
    indexState: "ready",
    storageRelativePath: "fixture-only",
  };
  const controller: DictionarySettingsController = {
    cancelCatalogRefresh: unsupportedOperation,
    cancelDownload: unsupportedOperation,
    catalog: { schemaVersion: 1, entries: [], source: "cache", cacheWarning: null },
    catalogError: null,
    catalogOperation: null,
    catalogState: "ready",
    importDictionary: unsupportedOperation,
    importError: null,
    importing: false,
    installCatalog: unsupportedOperation,
    managementError: null,
    managementOperation: null,
    move: unsupportedOperation,
    rebuildIndex: unsupportedOperation,
    recoverResources: unsupportedOperation,
    recovering: false,
    refreshCatalog: unsupportedOperation,
    refreshing: false,
    registry: { dictionaries: [dictionary], recovery: null, status: "ready" },
    registryError: null,
    registryState: "ready",
    removeDictionary: unsupportedOperation,
    setEnabled: async (id, value) => {
      if (id !== dictionary.id) throw new Error("Unknown fixture dictionary.");
      setEnabled(value);
      return true;
    },
  };
  return (
    <main style={{ padding: 24 }}>
      <DictionarySettingsView controller={controller} />
    </main>
  );
}
