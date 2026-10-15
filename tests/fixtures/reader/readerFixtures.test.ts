import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { buildReaderFixture, readerFixtures } from "./readerFixtures";
import { validateReaderFixture } from "./validateReaderFixture";

const parseXml = (text: string) =>
  new DOMParser({
    onError(level, message) {
      throw new Error(`${level}: ${message}`);
    },
  }).parseFromString(text, "application/xml");

describe("synthetic Reader EPUB archives", () => {
  it("authors legacy structural columns as EPUB 2 with NCX and rejects missing NCX targets", async () => {
    const bytes = await buildReaderFixture("structural-columns");
    const zip = await JSZip.loadAsync(bytes);
    const packageXml = await zip.file("EPUB/package.opf")!.async("string");
    expect(packageXml).toContain('version="2.0"');
    expect(packageXml).not.toContain("rendition:layout");
    expect(zip.file("EPUB/nav.xhtml")).toBeNull();
    const contents = await zip.file("EPUB/legacy-toc.xhtml")!.async("string");
    expect(contents).not.toContain("<nav");
    zip.file(
      "EPUB/toc.ncx",
      (await zip.file("EPUB/toc.ncx")!.async("string")).replace(
        "legacy-toc.xhtml",
        "missing.xhtml",
      ),
    );
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 45, parseXml),
    ).rejects.toThrow(/Unmanifested asset/);
  });
  for (const fixture of readerFixtures) {
    it(`${fixture.id} has deterministic, lightweight, linked EPUB resources`, async () => {
      const first = await buildReaderFixture(fixture.id);
      expect(await buildReaderFixture(fixture.id)).toEqual(first);
      expect(first.byteLength).toBeLessThan(50_000);
      await validateReaderFixture(first, fixture.sections.length, parseXml);
    });
  }

  it.each([
    ["mimetype", "text/plain"],
    [
      "META-INF/container.xml",
      '<container><rootfiles><rootfile full-path="missing.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
    ["EPUB/package.opf", '<package><manifest/><spine><itemref idref="absent"/></spine></package>'],
    [
      "EPUB/cover.xhtml",
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Broken</title></head><body><img src="missing.svg" alt="Broken"/></body></html>',
    ],
    ["EPUB/style.css", 'body { background-image: url("missing.svg"); }'],
  ])("rejects a broken %s", async (path, content) => {
    const zip = await JSZip.loadAsync(await buildReaderFixture("short-cover"));
    zip.file(path, content);
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow();
  });

  it("rejects missing assets and invalid fragment targets", async () => {
    const zip = await JSZip.loadAsync(await buildReaderFixture("nested-prose"));
    zip.remove("EPUB/art.svg");
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 1, parseXml),
    ).rejects.toThrow();
    const linked = await JSZip.loadAsync(await buildReaderFixture("nested-prose"));
    linked.file(
      "EPUB/nav.xhtml",
      (await linked.file("EPUB/nav.xhtml")!.async("string")).replace(
        "nested.xhtml",
        "nested.xhtml#absent",
      ),
    );
    await expect(
      validateReaderFixture(await linked.generateAsync({ type: "uint8array" }), 1, parseXml),
    ).rejects.toThrow(/fragment/);
  });

  it("rejects a broken spine reference, wrong count, and malformed XHTML", async () => {
    const bytes = await buildReaderFixture("short-cover");
    await expect(validateReaderFixture(bytes, 4, parseXml)).rejects.toThrow(/spine count/);
    const zip = await JSZip.loadAsync(bytes);
    zip.file(
      "EPUB/package.opf",
      (await zip.file("EPUB/package.opf")!.async("string")).replace(
        'idref="cover"',
        'idref="absent"',
      ),
    );
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow(/spine link/);
    const malformed = await JSZip.loadAsync(bytes);
    malformed.file(
      "EPUB/cover.xhtml",
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Unclosed</body></html>',
    );
    await expect(
      validateReaderFixture(await malformed.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow();
  });

  it("rejects compressed or reordered mimetype and wrong manifest media type", async () => {
    const bytes = await buildReaderFixture("short-cover");
    const zip = await JSZip.loadAsync(bytes);
    zip.file("mimetype", "application/epub+zip", { compression: "DEFLATE" });
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow(/mimetype/);
    zip.remove("mimetype");
    zip.file("mimetype", "application/epub+zip");
    await expect(
      validateReaderFixture(await zip.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow(/mimetype/);
    const typed = await JSZip.loadAsync(bytes);
    typed.file(
      "EPUB/package.opf",
      (await typed.file("EPUB/package.opf")!.async("string")).replace(
        'media-type="image/svg+xml"',
        'media-type="image/png"',
      ),
    );
    await expect(
      validateReaderFixture(await typed.generateAsync({ type: "uint8array" }), 3, parseXml),
    ).rejects.toThrow(/media type/);
  });

  it("retains scenario triggers and semantic counterexamples in authored inputs", () => {
    const get = (id: string) => readerFixtures.find((fixture) => fixture.id === id)!;
    expect(get("short-cover").sections).toHaveLength(3);
    expect(get("short-cover").sections[0].body).toContain('id="cover-image"');
    expect(get("short-cover").sizeChanges).toEqual([
      { section: "cover.xhtml", elementId: "cover-image", initialHeight: 1317, settledHeight: 933 },
    ]);
    expect(get("reverse-prepend").sections.map((section) => section.id)).toEqual([
      "previous-tall",
      "previous-medium",
      "current",
      "following",
    ]);
    expect(get("reverse-prepend").sizeChanges[0].initialHeight).toBeGreaterThan(750);
    expect(get("image-only").css).toContain("#center");
    expect(get("image-only").sections[0].body).toContain('class="center"');
    for (const selector of [
      "float-example",
      "grid-example",
      "flex-example",
      "mapped-image",
      "caption",
    ]) {
      expect(get("image-only").sections[1].body).toContain(selector);
    }
    const nested = parseXml(
      `<root xmlns:epub="http://www.idpf.org/2007/ops">${get("nested-prose").sections[0].body}</root>`,
    );
    for (const tag of [
      "section",
      "div",
      "p",
      "ul",
      "blockquote",
      "figure",
      "figcaption",
      "aside",
      "ruby",
      "table",
      "pre",
    ]) {
      expect(nested.getElementsByTagName(tag).length).toBeGreaterThan(0);
    }
    expect(get("nested-prose").sections[0].body).toContain('dir="rtl"');
    const long = get("long-spine");
    expect(long.sections).toHaveLength(42);
    expect(new Set(long.sections.map((section) => section.id)).size).toBe(42);
    expect(long.sections[20].body).toContain("art.svg");
    for (const section of long.sections)
      expect(section.body).toContain(`id="${section.id}-anchor"`);
    expect(get("fixed-layout").layout).toBe("pre-paginated");
    expect(get("fixed-layout").sections).toHaveLength(2);
    expect(get("fixed-layout").css).toContain("position: absolute");
  });
});
