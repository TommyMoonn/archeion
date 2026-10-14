// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyReaderProseFlow, prepareReaderRunningProse } from "./readerProseClassification";

afterEach(() => document.body.replaceChildren());

function chapter(html: string, css = "") {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.head.innerHTML = `<style>${css}</style>`;
  doc.body.innerHTML = html;
  return doc;
}

describe("Reader prose classification", () => {
  it("protects authored narrow paragraph blocks without excluding generic percentage wrappers", () => {
    const doc = chapter(
      '<section style="width:80%;margin-inline:auto"><p id="narrow" style="width:75%;margin-inline:auto">Authored narrow block.</p><p id="full">Ordinary running prose.</p></section>',
      "#full { width:100%; }",
    );
    prepareReaderRunningProse(doc);
    expect(doc.getElementById("narrow")?.hasAttribute("data-archeion-running-prose")).toBe(false);
    expect(doc.getElementById("full")?.hasAttribute("data-archeion-running-prose")).toBe(true);
    expect((doc.getElementById("narrow") as HTMLElement).style.marginInline).toBe("auto");
  });
  it("removes optional policy attributes and rebuilds classification when re-enabled", () => {
    const doc = chapter(
      "<article><div><p>First passage.</p><p>Second passage.</p></div></article>",
    );
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll("[data-archeion-running-prose]")).toHaveLength(2);
    expect(doc.querySelectorAll("[data-archeion-prose-continuation]")).toHaveLength(1);
    applyReaderProseFlow(doc, false);
    expect(
      doc.querySelectorAll(
        "[data-archeion-running-prose], [data-archeion-prose-continuation], [data-archeion-prose-flow]",
      ),
    ).toHaveLength(0);
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll("[data-archeion-running-prose]")).toHaveLength(2);
    expect(doc.querySelectorAll("[data-archeion-prose-continuation]")).toHaveLength(1);
    expect(doc.querySelectorAll("[data-archeion-prose-flow]")).toHaveLength(2);
  });
  it("ignores inactive media dimensions and retains active dimensions", () => {
    const doc = chapter(
      '<article class="chapter"><p id="prose">Ordinary</p></article>',
      ".chapter p { text-indent: 2em; } @media (max-width: 2px) { .chapter { width: 24em; } }",
    );
    vi.spyOn(doc.defaultView!, "matchMedia").mockImplementation(
      (media) => ({ media, matches: false }) as MediaQueryList,
    );
    prepareReaderRunningProse(doc);
    expect(doc.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(true);
    const active = chapter(
      '<article class="chapter"><p id="prose">Ordinary</p></article>',
      "@media (min-width: 800px) { .chapter { width: 24em; } }",
    );
    vi.spyOn(active.defaultView!, "matchMedia").mockImplementation(
      (media) => ({ media, matches: true }) as MediaQueryList,
    );
    prepareReaderRunningProse(active);
    expect(active.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(false);
  });
  it("reclassifies a reused document only when conditional applicability changes", () => {
    const doc = chapter(
      '<article class="chapter"><p id="first">First</p><p id="second">Second</p></article>',
      "@media (min-width: 800px) { .chapter { width: 24em; } }",
    );
    let active = false;
    vi.spyOn(doc.defaultView!, "matchMedia").mockImplementation(
      (media) =>
        ({
          media,
          get matches() {
            return active;
          },
        }) as MediaQueryList,
    );
    const computed = vi.spyOn(doc.defaultView!, "getComputedStyle");
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll("[data-archeion-running-prose]")).toHaveLength(2);
    expect(doc.getElementById("second")?.hasAttribute("data-archeion-prose-continuation")).toBe(
      true,
    );
    const initialCalls = computed.mock.calls.length;
    applyReaderProseFlow(doc, true);
    expect(computed.mock.calls.length).toBe(initialCalls);
    active = true;
    applyReaderProseFlow(doc, true);
    expect(
      doc.querySelectorAll(
        "[data-archeion-running-prose], [data-archeion-prose-continuation], [data-archeion-prose-flow]",
      ),
    ).toHaveLength(0);
    active = false;
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll("[data-archeion-running-prose]")).toHaveLength(2);
    expect(doc.getElementById("second")?.hasAttribute("data-archeion-prose-continuation")).toBe(
      true,
    );
  });

  it("keeps disabled sheets and nested inactive media out of dimension eligibility", () => {
    const doc = chapter(
      '<article class="chapter"><p id="prose">Ordinary</p></article>',
      "@media print { @media (min-width: 1px) { .chapter { width: 24em; } } }",
    );
    vi.spyOn(doc.defaultView!, "matchMedia").mockImplementation(
      (media) => ({ media, matches: media !== "print" }) as MediaQueryList,
    );
    prepareReaderRunningProse(doc);
    expect(doc.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(true);
    const disabled = chapter(
      '<article class="chapter"><p id="prose">Ordinary</p></article>',
      ".chapter { width: 24em; }",
    );
    disabled.styleSheets[0].disabled = true;
    prepareReaderRunningProse(disabled);
    expect(disabled.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(
      true,
    );
    disabled.styleSheets[0].disabled = false;
    prepareReaderRunningProse(disabled);
    expect(disabled.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(
      false,
    );
  });

  it("preserves conservative rejection when active publisher CSS cannot be inspected", () => {
    const doc = chapter(
      '<article><p id="prose">Ordinary</p></article>',
      "article { width: 24em; }",
    );
    vi.spyOn(doc.styleSheets[0], "cssRules", "get").mockImplementation(() => {
      throw new DOMException("Unavailable stylesheet", "SecurityError");
    });
    applyReaderProseFlow(doc, true);
    expect(doc.getElementById("prose")?.hasAttribute("data-archeion-running-prose")).toBe(false);
    expect(doc.querySelectorAll("[data-archeion-prose-flow]")).toHaveLength(0);
  });

  it("identifies one root and only transparent ancestors on ordinary prose paths", () => {
    const doc = chapter(
      '<article id="root"><div id="wrapper"><section id="section"><div id="inner"><p id="first">First</p><div id="second-wrap"><p id="second">Second</p></div><div><p id="third">Third</p></div><p class="scene-break">* * *</p><p id="after">After the break</p></div></section></div><figure id="figure"><figcaption><p>Caption</p></figcaption></figure></article>',
      "#wrapper { width: 78%; margin-left: 42px; }",
    );
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll('[data-archeion-prose-flow="root"]')).toHaveLength(1);
    expect(doc.getElementById("root")?.getAttribute("data-archeion-prose-flow")).toBe("root");
    for (const id of ["wrapper", "section", "inner", "second-wrap"])
      expect(doc.getElementById(id)?.getAttribute("data-archeion-prose-flow")).toBe("nested");
    for (const id of ["second", "third"])
      expect(doc.getElementById(id)?.hasAttribute("data-archeion-prose-continuation")).toBe(true);
    expect(doc.getElementById("first")?.hasAttribute("data-archeion-prose-continuation")).toBe(
      false,
    );
    expect(doc.getElementById("after")?.hasAttribute("data-archeion-prose-continuation")).toBe(
      false,
    );
    expect(doc.getElementById("figure")?.hasAttribute("data-archeion-prose-flow")).toBe(false);
  });

  it("preserves intentional sizing and publisher composition from inline and stylesheet rules", () => {
    const doc = chapter(
      '<div class="fixed"><p>Fixed</p></div><div style="inline-size: 20rem"><p>Inline fixed</p></div><div class="float"><p>Float</p></div><div class="columns"><p>Columns</p></div><div class="grid"><p>Grid</p></div><div style="white-space: pre-wrap"><p>Whitespace</p></div><p epub:type="subtitle">Subtitle</p><div role="doc-footnote"><p>Footnote</p></div><p></p><p>* * *</p><p id="ordinary">Ordinary</p>',
      ".fixed { width: 240px; } .float { float: left; } .columns { column-count: 2; } .grid { display: grid; }",
    );
    prepareReaderRunningProse(doc);
    expect([...doc.querySelectorAll("[data-archeion-running-prose]")].map((p) => p.id)).toEqual([
      "ordinary",
    ]);
  });

  it("rebuilds cleared classification without changing publisher structure", () => {
    const doc = chapter(
      '<main><div style="width: 80%; margin-left: 24px"><p>Text <em>with emphasis</em></p></div></main>',
    );
    const sourceStyle = doc.querySelector("div")?.getAttribute("style");
    const computed = vi.spyOn(doc.defaultView!, "getComputedStyle");
    applyReaderProseFlow(doc, true);
    const firstCalls = computed.mock.calls.length;
    applyReaderProseFlow(doc, false);
    expect(doc.querySelectorAll("[data-archeion-prose-flow]")).toHaveLength(0);
    applyReaderProseFlow(doc, true);
    expect(doc.querySelectorAll("[data-archeion-prose-flow]")).toHaveLength(2);
    expect(computed.mock.calls.length).toBeGreaterThan(firstCalls);
    expect(doc.querySelector("div")?.getAttribute("style")).toBe(sourceStyle);
    expect(doc.querySelector("em")?.textContent).toBe("with emphasis");
  });
});
