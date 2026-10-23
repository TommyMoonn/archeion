import { mockIPC } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { AddEpubDialog } from "../../../src/features/filesystem/AddEpubDialog";
import { MoveToFolderDialog } from "../../../src/features/filesystem/MoveToFolderDialog";
import { RenameFileDialog } from "../../../src/features/filesystem/RenameFileDialog";
import { FolderNameDialog } from "../../../src/features/folders/FolderNameDialog";
import { BookAdvancedMetadataDialog } from "../../../src/features/library/BookAdvancedMetadataDialog";
import { BookCoverWritebackDialog } from "../../../src/features/library/BookCoverWritebackDialog";
import { BulkMetadataDialog } from "../../../src/features/library/BulkMetadataDialog";
import { LibraryStorageProvider } from "../../../src/storage/LibraryStorageContext";
import { TauriArchiveLibraryStorage } from "../../../src/storage/TauriArchiveLibraryStorage";
import type { Book, EpubCoverPreparation } from "../../../src/types/book";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    dialogGeometryFixture: { release: (fail?: boolean) => void };
  }
}

const book: Book = {
  id: "geometry-book",
  fileName: "A_very_long_multilingual_book_filename.epub",
  originalTitle: "日本語 Ελληνικά العربية A long book title ".repeat(5),
  sourceMetadata: {
    title: "日本語 Ελληνικά العربية A long book title ".repeat(5),
    description: "Long description. ".repeat(300),
  },
  isFavorite: false,
  addedAt: "2026-10-23",
  updatedAt: "2026-10-23",
};
const fileStat = {
  fileName: book.fileName,
  relativePath: book.fileName,
  folderPath: "",
  size: 4096,
  modifiedAt: 200,
};
const preparation: EpubCoverPreparation = {
  fileName: "A_very_long_selected_image_filename.png",
  sourceFormat: "PNG",
  outputFormat: "JPEG",
  sourceWidth: 900,
  sourceHeight: 1200,
  outputWidth: 800,
  outputHeight: 1200,
  imageSize: 2048,
  imageModifiedAt: 100,
  epubSize: 4096,
  epubModifiedAt: 200,
  replacingExistingCover: true,
  previewMimeType: "image/png",
  // Valid generated 1px preview, no external image dependency.
  previewBytes: Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  ),
};
window.dialogGeometryFixture = { release: () => {} };
async function operation() {
  document.body.dataset.operation = "pending";
  await new Promise<void>((resolve, reject) => {
    window.dialogGeometryFixture.release = (fail = false) => {
      document.body.dataset.operation = fail ? "failed" : "succeeded";
      if (fail) reject(new Error("Synthetic operation failure. ".repeat(30)));
      else resolve();
    };
  });
}
mockIPC((command) => {
  if (command === "plugin:dialog|open") return "C:/fixture/cover.png";
  throw new Error(`Unexpected dialog fixture command: ${command}`);
});
focusPresentationRuntime.start(document);
const storage = new TauriArchiveLibraryStorage();
storage.loadBookCover = async () => undefined;

export function DialogGeometryFixture() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const surface = new URLSearchParams(location.search).get("surface") ?? "metadata";
  const onClose = () => setOpen(false);
  async function apply() {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  }
  const props = { onClose };
  return (
    <TooltipProvider>
      <button onClick={() => setOpen(true)} type="button">
        Open dialog
      </button>
      <button type="button">Background action</button>
      {open && surface === "metadata" ? (
        <BookAdvancedMetadataDialog
          {...props}
          book={book}
          onWriteMetadata={async (_, metadata) => {
            await operation();
            return { sourceMetadata: metadata, fileStat };
          }}
        />
      ) : null}
      {open && surface === "cover" ? (
        <BookCoverWritebackDialog
          {...props}
          book={book}
          onPrepareCover={async () => {
            await operation();
            return preparation;
          }}
          onWriteCover={async () => {
            await operation();
            return {
              sourceMetadata: {},
              fileStat,
              coverCacheWarning: "Synthetic cache warning. ".repeat(30),
            };
          }}
        />
      ) : null}
      {open && (surface === "add" || surface === "add-empty") ? (
        <AddEpubDialog
          {...props}
          folders={[]}
          initialSourcePaths={surface === "add-empty" ? [] : ["C:/fixture/book.epub"]}
          isImporting={busy}
          onImport={apply}
        />
      ) : null}
      {open && surface === "move" ? (
        <MoveToFolderDialog
          {...props}
          folders={[]}
          disableUnchanged={false}
          title="Move EPUB"
          onMove={apply}
        />
      ) : null}
      {open && surface === "rename" ? (
        <RenameFileDialog {...props} book={book} onRename={apply} />
      ) : null}
      {open && (surface === "folder" || surface === "folder-create") ? (
        <FolderNameDialog
          {...props}
          mode={surface === "folder-create" ? "create" : "rename"}
          initialName={surface === "folder-create" ? "" : "Folder"}
          onSubmit={apply}
        />
      ) : null}
      {open && surface === "bulk" ? (
        <BulkMetadataDialog {...props} books={[book]} isWriting={busy} onApply={apply} />
      ) : null}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <LibraryStorageProvider storage={storage}>
    <DialogGeometryFixture />
  </LibraryStorageProvider>,
);
