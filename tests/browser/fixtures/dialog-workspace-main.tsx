import { mockIPC } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { BookAdvancedMetadataDialog } from "../../../src/features/library/BookAdvancedMetadataDialog";
import { BookCoverWritebackDialog } from "../../../src/features/library/BookCoverWritebackDialog";
import { LibraryStorageProvider } from "../../../src/storage/LibraryStorageContext";
import { TauriArchiveLibraryStorage } from "../../../src/storage/TauriArchiveLibraryStorage";
import type { Book, EpubCoverFraming, EpubCoverPreparation } from "../../../src/types/book";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    workspaceFixture: { release: (message?: string) => void };
  }
}

const book: Book = {
  id: "workspace-book",
  fileName: "A_long_multilingual_書籍_Ελληνικά_landscape_cover.epub",
  relativePath: "Books/A_long_multilingual_書籍_Ελληνικά_landscape_cover.epub",
  originalTitle: "A long book title 日本語 Ελληνικά العربية ".repeat(4),
  sourceMetadata: {
    title: "A long book title 日本語 Ελληνικά العربية ".repeat(4),
    description: "Description 日本語 Ελληνικά العربية ".repeat(200),
  },
  isFavorite: false,
  addedAt: "2026-10-23",
  updatedAt: "2026-10-23",
};
const fileStat = {
  fileName: book.fileName,
  relativePath: book.relativePath!,
  folderPath: "Books",
  size: 4096,
  modifiedAt: 200,
};
window.workspaceFixture = { release: () => {} };
async function operation() {
  document.body.dataset.operation = "pending";
  await new Promise<void>((resolve, reject) => {
    window.workspaceFixture.release = (message) => {
      document.body.dataset.operation = message ? "failed" : "succeeded";
      if (message) reject(new Error(message));
      else resolve();
    };
  });
}

// Generated landscape art and representative prepared output; no real EPUB or image picker I/O.
function preview(framing: EpubCoverFraming): EpubCoverPreparation {
  const source = document.createElement("canvas");
  source.width = 1200;
  source.height = 800;
  const scene = source.getContext("2d")!;
  scene.fillStyle = "#8bb8cf";
  scene.fillRect(0, 0, 1200, 800);
  scene.fillStyle = "#344958";
  scene.beginPath();
  scene.moveTo(0, 800);
  scene.lineTo(300, 200);
  scene.lineTo(750, 650);
  scene.lineTo(1000, 350);
  scene.lineTo(1200, 800);
  scene.fill();
  const output = document.createElement("canvas");
  output.width = 800;
  output.height = 1200;
  const context = output.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(0, 0, 800, 1200);
  if (framing === "crop") context.drawImage(source, 333, 0, 534, 800, 0, 0, 800, 1200);
  else context.drawImage(source, 0, 333, 800, 534);
  return {
    fileName: "A_long_landscape_source_image_1200x800_書籍_Ελληνικά.png",
    sourceFormat: "PNG",
    outputFormat: "PNG",
    sourceWidth: 1200,
    sourceHeight: 800,
    outputWidth: 800,
    outputHeight: 1200,
    imageSize: 2048,
    imageModifiedAt: 100,
    epubSize: 4096,
    epubModifiedAt: 200,
    replacingExistingCover: true,
    previewMimeType: "image/png",
    previewBytes: Array.from(atob(output.toDataURL("image/png").split(",")[1]), (character) =>
      character.charCodeAt(0),
    ),
  };
}
mockIPC((command) => {
  if (command === "plugin:dialog|open") return "C:/fixture/landscape.png";
  throw new Error(`Unexpected fixture command: ${command}`);
});
focusPresentationRuntime.start(document);
const storage = new TauriArchiveLibraryStorage();
storage.loadBookCover = async () => undefined;

export function WorkspaceFixture() {
  const [open, setOpen] = useState(false);
  const surface = new URLSearchParams(location.search).get("surface");
  return (
    <TooltipProvider>
      <p>Production components; generated landscape image and mocked writeback.</p>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <button type="button">Background action</button>
      {open && surface === "cover" ? (
        <BookCoverWritebackDialog
          book={book}
          onClose={() => setOpen(false)}
          onPrepareCover={async (_, __, framing) => {
            await operation();
            return preview(framing);
          }}
          onWriteCover={async () => {
            await operation();
            return {
              sourceMetadata: {},
              fileStat,
              coverCacheWarning: "Cover written; refresh the preview if needed.",
            };
          }}
        />
      ) : null}
      {open && surface === "metadata" ? (
        <BookAdvancedMetadataDialog
          book={book}
          onClose={() => setOpen(false)}
          onWriteMetadata={async (_, metadata) => {
            await operation();
            return { sourceMetadata: metadata, fileStat };
          }}
        />
      ) : null}
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <LibraryStorageProvider storage={storage}>
    <WorkspaceFixture />
  </LibraryStorageProvider>,
);
