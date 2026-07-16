// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  classifyEpubLink,
  epubSemanticsFromElement,
  resolveEpubLocalTarget,
  targetSemanticsForElement,
} from "./epubContentActions";

function element(markup: string): Element {
  const document = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  return document.body.firstElementChild!;
}

describe("EPUB content action classification", () => {
  it("recognizes source and target footnote semantics without treating every fragment as a note", () => {
    const noteref = element('<a epub:type="noteref" href="#note-1">1</a>');
    const note = element('<aside role="doc-footnote"><p id="note-1">Note</p></aside>');

    expect(
      classifyEpubLink({
        currentDocumentHref: "Text/chapter.xhtml",
        href: "#note-1",
        sourceSemantics: epubSemanticsFromElement(noteref),
      }).kind,
    ).toBe("footnote");
    expect(
      classifyEpubLink({
        currentDocumentHref: "Text/chapter.xhtml",
        href: "#note-1",
        targetSemantics: targetSemanticsForElement(note.querySelector("p")),
      }).kind,
    ).toBe("footnote");
    expect(
      classifyEpubLink({ currentDocumentHref: "Text/chapter.xhtml", href: "#section-2" }).kind,
    ).toBe("internal");
  });

  it("resolves document-relative chapters and local illustrations", () => {
    expect(
      classifyEpubLink({
        currentDocumentHref: "OPS/Text/chapter-1.xhtml",
        href: "../Text/chapter-2.xhtml#part-2",
      }),
    ).toEqual({
      kind: "internal",
      target: {
        displayTarget: "OPS/Text/chapter-2.xhtml#part-2",
        documentHref: "OPS/Text/chapter-2.xhtml",
        fragment: "part-2",
        resourceKind: "document",
      },
    });
    expect(
      classifyEpubLink({
        currentDocumentHref: "OPS/Text/chapter.xhtml",
        href: "../Images/plate.webp",
      }).kind,
    ).toBe("illustration");
    expect(
      classifyEpubLink({
        currentDocumentHref: "OPS/Text/chapter.xhtml",
        href: "../Images/vector.svg",
      }).kind,
    ).toBe("illustration");
  });

  it("accepts normalized credential-free HTTP and HTTPS destinations", () => {
    for (const href of [
      "https://example.com/path/to/source?q=reader#note",
      "http://example.com:8080/source",
      "https://192.0.2.1/resource",
      "https://[2001:db8::1]:8443/resource",
      "https://例え.テスト/資料?q=読書#注",
      "https://example.com/path/%0A%09%7Fsource",
    ]) {
      const expected = new URL(href);
      expect(
        classifyEpubLink({
          currentDocumentHref: "Text/chapter.xhtml",
          href,
        }),
      ).toEqual({ host: expected.host, kind: "external", url: expected.toString() });
    }
  });

  it("rejects malformed network authorities before URL normalization", () => {
    for (const href of [
      "https:example.com",
      "http:foo.com",
      String.raw`https:\example.com`,
      String.raw`https:\\example.com`,
      "https:///missing-host",
      "https://",
    ]) {
      expect(classifyEpubLink({ currentDocumentHref: "Text/chapter.xhtml", href })).toEqual({
        kind: "unsupported",
        reason: "malformed",
      });
    }
  });

  it("rejects raw ASCII controls before URL preprocessing", () => {
    for (const href of [
      "https://exa\tmple.com",
      "https://exa\nmple.com",
      "https://exa\rmple.com",
      "https://example.com/\nsource",
      `https://example.com/${String.fromCharCode(0x7f)}source`,
    ]) {
      expect(classifyEpubLink({ currentDocumentHref: "Text/chapter.xhtml", href })).toEqual({
        kind: "unsupported",
        reason: "malformed",
      });
    }
  });

  it("rejects controls in local targets and their current document identity", () => {
    expect(resolveEpubLocalTarget("Text/chapter.xhtml", "\n../Images/plate.png")).toEqual({
      kind: "unsupported",
      reason: "malformed",
    });
    expect(resolveEpubLocalTarget("Text/chapter.xhtml\t", "../Images/plate.png")).toEqual({
      kind: "unsupported",
      reason: "malformed",
    });
    expect(
      classifyEpubLink({
        currentDocumentHref: `Text/${String.fromCharCode(0x7f)}chapter.xhtml`,
        href: "../Images/plate.png",
      }),
    ).toEqual({ kind: "unsupported", reason: "malformed" });
  });

  it.each([
    "%0A../Images/plate.png",
    "%09../Images/plate.png",
    "%0D../Images/plate.png",
    "../Images/%7Fplate.png",
    "../Images/pla%00te.png",
    "chapter.xhtml#note%0A1",
    "chapter.xhtml#note%7F1",
  ])("rejects decoded controls in local target %s", (href) => {
    expect(classifyEpubLink({ currentDocumentHref: "Text/chapter.xhtml", href })).toEqual({
      kind: "unsupported",
      reason: "malformed",
    });
  });

  it.each(["Text/chapter.xhtml%09", "Text/%7Fchapter.xhtml"])(
    "rejects decoded controls in current document identity %s",
    (currentDocumentHref) => {
      expect(classifyEpubLink({ currentDocumentHref, href: "../Images/plate.png" })).toEqual({
        kind: "unsupported",
        reason: "malformed",
      });
    },
  );

  it("preserves valid percent-encoded Unicode in local paths and fragments", () => {
    expect(
      classifyEpubLink({
        currentDocumentHref: "Text/chapter.xhtml",
        href: "../Images/%E5%9B%B3%E7%89%88.png",
      }),
    ).toEqual({
      kind: "illustration",
      target: {
        displayTarget: "Images/図版.png",
        documentHref: "Images/図版.png",
        resourceKind: "illustration",
      },
    });
    expect(
      classifyEpubLink({
        currentDocumentHref: "Text/chapter.xhtml",
        href: "chapter.xhtml#note%E2%80%941",
      }),
    ).toEqual({
      kind: "internal",
      target: {
        displayTarget: "Text/chapter.xhtml#note%E2%80%941",
        documentHref: "Text/chapter.xhtml",
        fragment: "note—1",
        resourceKind: "document",
      },
    });
  });

  it("rejects credentials and unsupported or unsafe schemes", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "file:///tmp/book.xhtml",
      "mailto:reader@example.com",
      "https://user:secret@example.com",
    ]) {
      expect(classifyEpubLink({ currentDocumentHref: "Text/chapter.xhtml", href }).kind).toBe(
        "unsupported",
      );
    }
  });

  it("rejects traversal, protocol-relative content, malformed escapes, and unsupported resources", () => {
    for (const href of [
      "../../../outside.xhtml",
      "//example.com/remote.xhtml",
      "%E0%A4%A.xhtml",
      "../media/video.mp4",
      "chapter.xhtml?mode=unsafe",
    ]) {
      expect(resolveEpubLocalTarget("OPS/Text/chapter.xhtml", href)).toHaveProperty(
        "kind",
        "unsupported",
      );
    }
  });
});
