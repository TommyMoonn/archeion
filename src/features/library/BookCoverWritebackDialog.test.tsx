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
  ReadonlyBook,
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
  book: ReadonlyBook,
  imagePath: string,
  framing: EpubCoverFraming,
) => Promise<EpubCoverPreparation>;
type WriteCover = (
  book: ReadonlyBook,
  input: EpubCoverWritebackInput,
) => Promise<EpubCoverWritebackResult>;

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
    onClose?: () => void;
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
        onClose={options.onClose ?? vi.fn()}
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
  async function chooseImage() {
    vi.mocked(open).mockResolvedValue("C:/covers/replacement.png");
    await act(async () => {
      buttonByText("Choose image")?.click();
    });
  }

  it("does not write on open, picker cancellation, framing changes or close", async () => {
    const onClose = vi.fn();
    const { onWriteCover, onPrepareCover } = renderDialog({ onClose });
    expect(onWriteCover).not.toHaveBeenCalled();
    vi.mocked(open).mockResolvedValue(null);
    await act(async () => buttonByText("Choose image")?.click());
    expect(onPrepareCover).not.toHaveBeenCalled();
    await chooseImage();
    vi.mocked(open).mockResolvedValue("C:/covers/another.png");
    await act(async () => buttonByText("Choose another image")?.click());
    await act(async () => buttonByText("Fit")?.click());
    act(() => buttonByText("Close")?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onWriteCover).not.toHaveBeenCalled();
  });

  it("owns one slow write and blocks framing, repeated clicks and native cancel until it settles", async () => {
    let finish!: (result: EpubCoverWritebackResult) => void;
    const onWriteCover = vi.fn(
      () =>
        new Promise<EpubCoverWritebackResult>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    renderDialog({ onWriteCover, onClose });
    await chooseImage();
    const write = buttonByText("Write cover to EPUB")!;
    act(() => {
      write.click();
      write.click();
    });
    expect(onWriteCover).toHaveBeenCalledOnce();
    expect(buttonByText("Writing cover")?.disabled).toBe(true);
    expect(buttonByText("Fit")?.disabled).toBe(true);
    act(() => {
      buttonByText("Fit")?.click();
      buttonByText("Close")?.click();
      container?.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(writebackResult));
    expect(container?.textContent).toContain("Cover written to EPUB.");
    act(() => write.click());
    expect(onWriteCover).toHaveBeenCalledOnce();
  });

  it.each(["The EPUB changed after preview. Prepare it again.", "The cover could not be written."])(
    "retains write errors and permits deliberate recovery: %s",
    async (message) => {
      const onWriteCover = vi
        .fn()
        .mockRejectedValueOnce(new Error(message))
        .mockResolvedValue(writebackResult);
      renderDialog({ onWriteCover });
      await chooseImage();
      await act(async () => buttonByText("Write cover to EPUB")?.click());
      expect(container?.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(buttonByText("Write cover to EPUB")?.getAttribute("aria-disabled")).not.toBe("true");
      await act(async () => buttonByText("Write cover to EPUB")?.click());
      expect(onWriteCover).toHaveBeenCalledTimes(2);
      expect(container?.querySelector('[role="alert"]')).toBeNull();
      expect(container?.textContent).toContain("Cover written to EPUB.");
    },
  );

  it("cannot write an old preparation while a new framing preview is pending", async () => {
    let finish!: (value: EpubCoverPreparation) => void;
    const onPrepareCover = vi
      .fn()
      .mockResolvedValueOnce(preparation)
      .mockImplementationOnce(
        () =>
          new Promise<EpubCoverPreparation>((resolve) => {
            finish = resolve;
          }),
      );
    const { onWriteCover } = renderDialog({ onPrepareCover });
    await chooseImage();
    act(() => {
      buttonByText("Fit")?.click();
      buttonByText("Write cover to EPUB")?.click();
    });
    expect(onWriteCover).not.toHaveBeenCalled();
    await act(async () => finish({ ...preparation, imageModifiedAt: 101 }));
    await act(async () => buttonByText("Write cover to EPUB")?.click());
    expect(onWriteCover).toHaveBeenCalledWith(
      book,
      expect.objectContaining({ framing: "fit", expectedImageModifiedAt: 101 }),
    );
  });

  it("ignores a picker result delivered after the editor is disposed", async () => {
    let finish!: (path: string) => void;
    vi.mocked(open).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { onPrepareCover, onWriteCover } = renderDialog();
    act(() => buttonByText("Choose image")?.click());
    act(() => root?.unmount());
    root = null;
    await act(async () => finish("C:/covers/late.png"));
    expect(onPrepareCover).not.toHaveBeenCalled();
    expect(onWriteCover).not.toHaveBeenCalled();
  });

  it("keeps the latest framing preparation when earlier work finishes late", async () => {
    let finishFit!: (value: EpubCoverPreparation) => void;
    const onPrepareCover = vi
      .fn()
      .mockResolvedValueOnce(preparation)
      .mockImplementationOnce(
        () =>
          new Promise<EpubCoverPreparation>((resolve) => {
            finishFit = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...preparation, imageModifiedAt: 102 });
    const { onWriteCover } = renderDialog({ onPrepareCover });
    await chooseImage();
    act(() => buttonByText("Fit")?.click());
    await act(async () => buttonByText("Crop")?.click());
    await act(async () => finishFit({ ...preparation, imageModifiedAt: 101 }));
    await act(async () => buttonByText("Write cover to EPUB")?.click());
    expect(onWriteCover).toHaveBeenCalledWith(
      book,
      expect.objectContaining({ framing: "crop", expectedImageModifiedAt: 102 }),
    );
  });

  it("discards a preparation completed after close and releases its existing preview", async () => {
    let finish!: (value: EpubCoverPreparation) => void;
    const onPrepareCover = vi
      .fn()
      .mockResolvedValueOnce(preparation)
      .mockImplementationOnce(
        () =>
          new Promise<EpubCoverPreparation>((resolve) => {
            finish = resolve;
          }),
      );
    const { onWriteCover } = renderDialog({ onPrepareCover });
    await chooseImage();
    act(() => buttonByText("Fit")?.click());
    act(() => root?.unmount());
    root = null;
    await act(async () => finish(preparation));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(onWriteCover).not.toHaveBeenCalled();
  });

  it("explains an unavailable EPUB path and cannot start preparation or writing", () => {
    const { onPrepareCover, onWriteCover } = renderDialog({
      renderedBook: { ...book, relativePath: undefined },
    });
    act(() => {
      buttonByText("Choose image")?.click();
      buttonByText("Write cover to EPUB")?.click();
    });
    const write = buttonByText("Write cover to EPUB")!;
    expect(document.getElementById(write.getAttribute("aria-describedby")!)?.textContent).toBe(
      "The EPUB file path is unavailable.",
    );
    expect(onPrepareCover).not.toHaveBeenCalled();
    expect(onWriteCover).not.toHaveBeenCalled();
  });

  it("prepares without writing and uses the final action as explicit authorization", async () => {
    vi.mocked(open).mockResolvedValue("C:/covers/replacement.png");
    const { onPrepareCover, onWriteCover } = renderDialog();
    const framingGroup = container?.querySelector<HTMLElement>(
      '.cover-writeback__framing[role="group"]',
    );
    const framingHelpId = framingGroup?.getAttribute("aria-describedby");

    expect(framingGroup?.getAttribute("aria-labelledby")).toBe("cover-writeback-framing-label");
    expect(framingHelpId).toBe("cover-writeback-framing-help");
    expect(document.getElementById(framingHelpId!)?.textContent).toContain("Fills the cover frame");
    expect(
      framingGroup?.querySelector('[role="radiogroup"]')?.getAttribute("aria-describedby"),
    ).toBe(framingHelpId);

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
    expect(container?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container?.textContent).not.toContain("EPUB action");
    expect(container?.textContent).not.toContain("Preview — not yet saved");
    expect(container?.textContent).not.toContain(
      "Writing replaces the cover image in this EPUB file.",
    );
    const explainedWriteButton = buttonByText("Write cover to EPUB")!;
    expect(explainedWriteButton.disabled).toBe(false);
    expect(explainedWriteButton.getAttribute("aria-disabled")).not.toBe("true");
    expect(onWriteCover).not.toHaveBeenCalled();

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
    expect(onWriteCover).toHaveBeenCalledTimes(1);
    expect(buttonByText("Write cover to EPUB")?.getAttribute("aria-disabled")).toBe("true");
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
