// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import type { ReaderIllustrationExportResult } from "./readerIllustrationExportFile";
import {
  useReaderIllustrationExport,
  type ReaderIllustrationExportState,
} from "./useReaderIllustrationExport";

type IllustrationExporter = (
  resource: ResolvedEpubIllustration,
) => Promise<ReaderIllustrationExportResult>;

function Harness({
  exporter,
  illustration,
  publish,
}: Readonly<{
  exporter: IllustrationExporter;
  illustration: ResolvedEpubIllustration | undefined;
  publish: (value: ReturnType<typeof useReaderIllustrationExport>) => void;
}>) {
  publish(useReaderIllustrationExport(illustration, exporter));
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function resource(href = "Images/plate.jpg"): ResolvedEpubIllustration {
  const blob = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
  return Object.freeze({
    blob,
    byteLength: blob.size,
    height: 100,
    href,
    mediaType: "image/jpeg",
    release: vi.fn(),
    url: `blob:${href}`,
    width: 100,
  });
}

describe("useReaderIllustrationExport", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Readonly<{
    save: () => Promise<void>;
    state: ReaderIllustrationExportState;
  }>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    illustration: ResolvedEpubIllustration | undefined,
    exporter: IllustrationExporter,
  ) {
    act(() =>
      root.render(
        <Harness
          exporter={exporter}
          illustration={illustration}
          publish={(value) => (latest = value)}
        />,
      ),
    );
  }

  it("prevents duplicate operations and reports deterministic success", async () => {
    const operation = deferred<ReaderIllustrationExportResult>();
    const exporter = vi.fn(() => operation.promise);
    const illustration = resource();
    render(illustration, exporter);

    let first!: Promise<void>;
    await act(async () => {
      first = latest.save();
      await latest.save();
    });
    expect(exporter).toHaveBeenCalledOnce();
    expect(exporter).toHaveBeenCalledWith(illustration);
    expect(latest.state).toEqual({ status: "saving" });

    await act(async () => {
      operation.resolve({ path: "C:\\Exports\\plate.jpg", status: "saved" });
      await first;
    });
    expect(latest.state).toEqual({ message: "Image saved.", status: "saved" });
  });

  it("keeps cancellation silent and exposes a retryable failure", async () => {
    const exporter = vi
      .fn<(resource: ResolvedEpubIllustration) => Promise<ReaderIllustrationExportResult>>()
      .mockResolvedValueOnce({ status: "cancelled" })
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValueOnce({ path: "C:\\Exports\\plate.jpg", status: "saved" });
    render(resource(), exporter);

    await act(async () => latest.save());
    expect(latest.state).toEqual({ status: "idle" });
    await act(async () => latest.save());
    expect(latest.state).toEqual({ message: "Image could not be saved.", status: "error" });
    await act(async () => latest.save());
    expect(latest.state.status).toBe("saved");
  });

  it("does not publish completion from a replaced resource while preserving the captured source", async () => {
    const operation = deferred<ReaderIllustrationExportResult>();
    const exporter = vi.fn(() => operation.promise);
    const first = resource("Images/first.jpg");
    const replacement = resource("Images/replacement.jpg");
    render(first, exporter);

    let pending!: Promise<void>;
    act(() => {
      pending = latest.save();
    });
    render(replacement, exporter);
    expect(latest.state.status).toBe("saving");
    await act(async () => latest.save());
    expect(exporter).toHaveBeenCalledOnce();
    expect(exporter).toHaveBeenCalledWith(first);

    await act(async () => {
      operation.resolve({ path: "C:\\Exports\\first.jpg", status: "saved" });
      await pending;
    });
    expect(latest.state).toEqual({ status: "idle" });
  });
});
