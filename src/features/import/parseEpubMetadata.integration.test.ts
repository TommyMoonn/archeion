// @vitest-environment happy-dom

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEpubMetadata } from "./parseEpubMetadata";

async function createMinimalEpub() {
  const archive = new JSZip();

  archive.file("mimetype", "application/epub+zip", {
    compression: "STORE",
  });
  archive.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <container version="1.0"
        xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf"
            media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`,
  );
  archive.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
      <package version="3.0"
        xmlns="http://www.idpf.org/2007/opf"
        unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">minimal-book</dc:identifier>
          <dc:title>Minimal EPUB</dc:title>
          <dc:creator>Test Author</dc:creator>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="chapter" href="chapter.xhtml"
            media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="chapter"/>
        </spine>
      </package>`,
  );
  archive.file(
    "OEBPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Chapter</title></head>
        <body><p>Test content.</p></body>
      </html>`,
  );

  const contents = await archive.generateAsync({ type: "arraybuffer" });

  return new File([contents], "minimal.epub", {
    type: "application/epub+zip",
  });
}

describe("EPUB.js integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses metadata from a valid EPUB archive", async () => {
    vi.stubGlobal("DOMParser", undefined);

    const file = await createMinimalEpub();

    await expect(parseEpubMetadata(file)).resolves.toEqual({
      title: "Minimal EPUB",
      author: "Test Author",
    });
  });
});
