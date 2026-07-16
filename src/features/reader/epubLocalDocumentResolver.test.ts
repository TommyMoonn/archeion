// @vitest-environment happy-dom

import type { Book as EpubBook } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import type { EpubLocalTarget } from "./epubContentActions";
import { resolveEpubLocalDocument } from "./epubLocalDocumentResolver";

const target: EpubLocalTarget = {
  displayTarget: "Text/notes.xhtml#note-1",
  documentHref: "Text/notes.xhtml",
  fragment: "note-1",
  resourceKind: "document",
};

function noteDocument(): Document {
  return new DOMParser().parseFromString(
    '<html><body><aside id="note-1" role="doc-footnote">Note</aside></body></html>',
    "text/html",
  );
}

describe("resolveEpubLocalDocument", () => {
  it("reuses the mounted current document without loading or releasing it", async () => {
    const document = noteDocument();
    const book = { spine: {} } as unknown as EpubBook;

    const resolution = await resolveEpubLocalDocument(book, target, {
      document,
      href: "Text/notes.xhtml",
    });

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.value.document).toBe(document);
    expect(resolution.value.element?.id).toBe("note-1");
    expect(() => resolution.value.release()).not.toThrow();
  });

  it("loads an off-screen spine document and releases the section lease", async () => {
    const document = noteDocument();
    const unload = vi.fn();
    const section = {
      href: "Text/notes.xhtml",
      load: vi.fn(async function (this: { document?: Document }) {
        this.document = document;
        return document;
      }),
      unload,
    };
    const book = {
      load: vi.fn(),
      spine: { get: vi.fn(() => section) },
    } as unknown as EpubBook;

    const resolution = await resolveEpubLocalDocument(book, target, null);

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(section.load).toHaveBeenCalledOnce();
    resolution.value.release();
    expect(unload).toHaveBeenCalledOnce();
  });

  it("cancels a stale load and releases the loaded section", async () => {
    const document = noteDocument();
    const unload = vi.fn();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const section = {
      href: "Text/notes.xhtml",
      load: vi.fn(async function (this: { document?: Document }) {
        await pending;
        this.document = document;
        return document;
      }),
      unload,
    };
    const book = { spine: { get: () => section } } as unknown as EpubBook;
    const controller = new AbortController();
    const resolutionPromise = resolveEpubLocalDocument(book, target, null, controller.signal);

    controller.abort();
    finish();
    const resolution = await resolutionPromise;

    expect(resolution).toEqual({ kind: "cancelled" });
    expect(unload).toHaveBeenCalledOnce();
  });
});
