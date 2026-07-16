// @vitest-environment happy-dom

import type { Book as EpubBook } from "epubjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpubLocalTarget } from "./epubContentActions";
import { resolveEpubFootnote } from "./epubFootnoteResolver";

const target: EpubLocalTarget = {
  displayTarget: "Text/chapter.xhtml#note-1",
  documentHref: "Text/chapter.xhtml",
  fragment: "note-1",
  resourceKind: "document",
};

function documentWith(markup: string): Document {
  return new DOMParser().parseFromString(`<html><body>${markup}</body></html>`, "text/html");
}

afterEach(() => vi.restoreAllMocks());

describe("resolveEpubFootnote", () => {
  it("preserves safe note structure and safe links while dropping executable content", async () => {
    const document = documentWith(`
      <aside id="note-1" role="doc-footnote">
        <p>Read <em>carefully</em> <a href="chapter-2.xhtml#part">next</a>.</p>
        <script>alert(1)</script><form><input value="unsafe"></form><iframe></iframe>
        <ul><li>One</li><li>Two</li></ul>
      </aside>
    `);

    const resolution = await resolveEpubFootnote({
      book: { spine: {} } as unknown as EpubBook,
      currentDocument: { document, href: "Text/chapter.xhtml" },
      forceFootnote: false,
      target,
    });

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(JSON.stringify(resolution.value.nodes)).toContain('"tag":"em"');
    expect(JSON.stringify(resolution.value.nodes)).toContain('"type":"link"');
    expect(JSON.stringify(resolution.value.nodes)).toContain('"tag":"ul"');
    expect(JSON.stringify(resolution.value.nodes)).not.toMatch(/script|form|iframe|unsafe|alert/);
    resolution.value.release();
  });

  it("does not reinterpret an ordinary fragment as a footnote", async () => {
    const document = documentWith('<section id="note-1"><p>Ordinary section</p></section>');
    const resolution = await resolveEpubFootnote({
      book: { spine: {} } as unknown as EpubBook,
      currentDocument: { document, href: "Text/chapter.xhtml" },
      forceFootnote: false,
      target,
    });

    expect(resolution).toEqual({ kind: "not-footnote" });
  });

  it("loads bounded local raster images and revokes their object URLs", async () => {
    const document = documentWith(
      '<aside id="note-1" role="doc-footnote"><p>Plate</p><img src="../Images/plate.png" alt="Plate"></aside>',
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:plate");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const book = {
      archive: { getBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })) },
      spine: {},
    } as unknown as EpubBook;

    const resolution = await resolveEpubFootnote({
      book,
      currentDocument: { document, href: "Text/chapter.xhtml" },
      forceFootnote: true,
      target,
    });

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(JSON.stringify(resolution.value.nodes)).toContain("blob:plate");
    resolution.value.release();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:plate");
  });
});
