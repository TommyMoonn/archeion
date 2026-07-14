// @vitest-environment happy-dom

import { open } from "@tauri-apps/plugin-dialog";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Book,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
} from "../../types/book";
import { BookCoverWritebackDialog } from "./BookCoverWritebackDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./BookCover", () => ({
  BookCover: ({ className }: { className?: string }) => <div className={className}>Cover</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };
type PrepareCover = (
  book: Book,
  imagePath: string,
  framing: EpubCoverFraming,
) => Promise<EpubCoverPreparation>;
type WriteCover = (book: Book, input: EpubCoverWritebackInput) => Promise<EpubCoverWritebackResult>;

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  relativePath: "Series/Volume_01.epub",
  originalTitle: "Volume 01",
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const preparation: EpubCoverPreparation = {
  fileName: "replacement.png",
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
  previewBytes: [1, 2, 3],
};

const writebackResult: EpubCoverWritebackResult = {
  backupPath: null,
  sourceMetadata: { title: "Volume 01" },
  fileStat: {
    relativePath: "Series/Volume_01.epub",
    fileName: "Volume_01.epub",
    folderPath: "Series",
    size: 5000,
    modifiedAt: 300,
  },
  coverCacheWarning: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installDialogPolyfill() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
}

function renderDialog(
  options: {
    renderedBook?: Book;
    onPrepareCover?: PrepareCover;
    onWriteCover?: WriteCover;
  } = {},
) {
  installDialogPolyfill();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onPrepareCover = options.onPrepareCover ?? vi.fn().mockResolvedValue(preparation);
  const onWriteCover = options.onWriteCover ?? vi.fn().mockResolvedValue(writebackResult);

  act(() => {
    root?.render(
      <BookCoverWritebackDialog
        book={options.renderedBook ?? book}
        onClose={vi.fn()}
        onPrepareCover={onPrepareCover}
        onWriteCover={onWriteCover}
      />,
    );
  });

  return { container, onPrepareCover, onWriteCover };
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent?.trim() === text,
  );
}

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("BookCoverWritebackDialog", () => {
  it("prepares the selected image and requires explicit confirmation before writeback", async () => {
    vi.mocked(open).mockResolvedValue("C:/covers/replacement.png");
    const { onPrepareCover, onWriteCover } = renderDialog();

    await act(async () => {
      buttonByText("Choose image")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPrepareCover).toHaveBeenCalledWith(book, "C:/covers/replacement.png", "crop");
    expect(container?.textContent).toContain("900 × 1200 · PNG");
    expect(container?.textContent).toContain("800 × 1200 · JPEG");
    expect(
      container?.querySelector<HTMLImageElement>('img[alt="Final replacement cover preview"]'),
    ).toHaveProperty("src", "blob:preview");
    expect(container?.textContent).toContain("Preview — not yet saved");
    const explainedWriteButton = buttonByText("Write cover to EPUB")!;
    expect(explainedWriteButton.disabled).toBe(false);
    expect(explainedWriteButton.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(explainedWriteButton.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Confirm the EPUB modification first.");
    act(() => explainedWriteButton.click());
    expect(onWriteCover).not.toHaveBeenCalled();

    act(() => {
      container
        ?.querySelector<HTMLInputElement>('.cover-writeback__confirmation input[type="checkbox"]')
        ?.click();
    });

    expect(buttonByText("Write cover to EPUB")?.disabled).toBe(false);
    await act(async () => {
      buttonByText("Write cover to EPUB")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onWriteCover).toHaveBeenCalledWith(book, {
      imagePath: "C:/covers/replacement.png",
      framing: "crop",
      expectedImageSize: 2048,
      expectedImageModifiedAt: 100,
      expectedEpubSize: 4096,
      expectedEpubModifiedAt: 200,
    });
    expect(container?.textContent).toContain("Cover written to EPUB.");
    expect(container?.textContent).toContain("Saved embedded cover");
  });

  it("focuses a preparation error so recovery feedback is announced in context", async () => {
    vi.mocked(open).mockResolvedValue("C:/covers/broken.png");
    renderDialog({ onPrepareCover: vi.fn().mockRejectedValue(new Error("Unsupported image.")) });

    await act(async () => {
      buttonByText("Choose image")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    const alert = container?.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Unsupported image.");
    expect(document.activeElement).toBe(buttonByText("Choose another image"));
  });

  it("regenerates the exact preview when framing changes", async () => {
    vi.mocked(open).mockResolvedValue("C:/covers/replacement.png");
    const onPrepareCover = vi.fn().mockResolvedValue(preparation);
    renderDialog({ onPrepareCover });

    await act(async () => {
      buttonByText("Choose image")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      buttonByText("Fit")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPrepareCover).toHaveBeenNthCalledWith(2, book, "C:/covers/replacement.png", "fit");
    expect(container?.textContent).toContain(
      "Keeps the full image and adds transparent or white padding.",
    );
  });

  it("disables selection and writeback when the EPUB is missing", () => {
    renderDialog({ renderedBook: { ...book, isFileMissing: true } });

    expect(buttonByText("Choose image")?.disabled).toBe(true);
    const writeButton = buttonByText("Write cover to EPUB")!;
    expect(writeButton.disabled).toBe(false);
    expect(writeButton.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(writeButton.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("The EPUB file is missing.");
    expect(container?.textContent).toContain("Cover writeback is unavailable");
  });
});
