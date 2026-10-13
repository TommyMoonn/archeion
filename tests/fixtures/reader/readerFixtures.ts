import JSZip from "jszip";

export type ReaderFixtureId =
  | "short-cover"
  | "reverse-prepend"
  | "image-only"
  | "nested-prose"
  | "conditional-prose"
  | "long-spine"
  | "fixed-layout";
type Section = Readonly<{ id: string; href: string; body: string }>;
export type ReaderFixture = Readonly<{
  id: ReaderFixtureId;
  layout: "reflowable" | "pre-paginated";
  sections: readonly Section[];
  css: string;
  sizeChanges: readonly Readonly<{
    section: string;
    elementId: string;
    initialHeight: number;
    settledHeight: number;
  }>[];
}>;

// Original geometric artwork, authored for these tests. No downloaded media or fonts.
const art = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560"><title>Fixture geometric illustration</title><rect width="420" height="560" fill="#d8e5ed"/><circle cx="210" cy="180" r="90" fill="#53778c"/><path d="M50 480 L210 290 L370 480 Z" fill="#365769"/></svg>`;
const baseCss = `html, body { margin: 0; padding: 0; } body { font: 18px/1.5 serif; color: #202020; background: white; } p { margin: 0 0 1em; } img { max-width: 100%; }`;
const paragraph = (id: string, index: number) =>
  `<p id="${id}-p${index}">Fixture ${id}, passage ${index}. The survey team marked a quiet trail beside the reservoir. This original sentence is searchable and suitable for a highlight.</p>`;
const passages = (id: string, count: number) =>
  Array.from({ length: count }, (_, index) => paragraph(id, index + 1)).join("\n");
const section = (id: string, body: string, href = `${id}.xhtml`): Section => ({ id, href, body });
const image = (id: string) =>
  `<img id="${id}" src="art.svg" width="420" height="560" alt="Original circles and triangle illustration"/>`;

export const readerFixtures: readonly ReaderFixture[] = [
  {
    id: "conditional-prose",
    layout: "reflowable",
    css: `${baseCss}
      .conditional-chapter { width: 78%; margin-left: 42px; }
      .conditional-chapter p { text-indent: 2em; margin: 0; }
      @media (max-width: 2px) { .unreachable-chapter { width: 24em; } }
      @media print { .print-chapter { width: 24em; } }
      @supports (display: archeion-unsupported-layout) { .unsupported-chapter { width: 24em; } }
      @media (min-width: 800px) { @supports (display: block) { .responsive-chapter { width: 24em; } } }
    `,
    sections: [
      section(
        "conditional",
        `<article class="conditional-chapter unreachable-chapter"><div><p id="unreachable-first">An unreachable media rule leaves ordinary prose fluid.</p><p id="unreachable-second">The next paragraph retains a known measurement anchor.</p></div></article><article class="conditional-chapter print-chapter"><div><p id="print-first">Print-only composition remains inactive on screen.</p><p id="print-second">Screen prose uses the selected measure.</p></div></article><article class="conditional-chapter unsupported-chapter"><div><p id="unsupported-first">An unsupported layout condition cannot change this prose.</p><p id="unsupported-second">This is another ordinary paragraph.</p></div></article><article class="conditional-chapter responsive-chapter"><div><p id="responsive-first">A responsive publisher composition is protected when active.</p><p id="responsive-second">Its paragraph indentation comes from the publisher.</p></div></article>`,
      ),
    ],
    sizeChanges: [],
  },
  {
    id: "short-cover",
    layout: "reflowable",
    css: `${baseCss} #cover-image { display: block; width: 420px; height: 1317px; }`,
    sections: [
      section("cover", image("cover-image")),
      section("short-first", paragraph("short-first", 1)),
      section("continuation", passages("continuation", 24)),
    ],
    sizeChanges: [
      { section: "cover.xhtml", elementId: "cover-image", initialHeight: 1317, settledHeight: 933 },
    ],
  },
  {
    id: "reverse-prepend",
    layout: "reflowable",
    css: `${baseCss} #previous-tall-image { display: block; width: 420px; height: 1600px; } #previous-tall { min-height: 3200px; } #previous-medium { min-height: 1200px; } #current { min-height: 1800px; }`,
    sections: [
      section(
        "previous-tall",
        `<section id="previous-tall">${image("previous-tall-image")}${passages("previous-tall", 28)}</section>`,
      ),
      section(
        "previous-medium",
        `<section id="previous-medium">${passages("previous-medium", 12)}</section>`,
      ),
      section(
        "current",
        `<section id="current"><p id="current-anchor">Current anchor: the marker beside the reservoir remains identifiable.</p>${passages("current", 18)}</section>`,
      ),
      section("following", passages("following", 16)),
    ],
    sizeChanges: [
      {
        section: "previous-tall.xhtml",
        elementId: "previous-tall-image",
        initialHeight: 1600,
        settledHeight: 2100,
      },
    ],
  },
  {
    id: "image-only",
    layout: "reflowable",
    css: `${baseCss} div { text-align: left; } #center { text-align: center; } .float-example img { float: left; width: 100px; } .grid-example { display: grid; grid-template-columns: 120px 1fr; } .flex-example { display: flex; gap: 16px; } .grid-example img, .flex-example img { width: 100px; } figure { margin: 16px 40px; }`,
    sections: [
      section("isolated", `<div class="center">${image("isolated-image")}</div>`),
      section(
        "composition",
        `<div class="float-example">${image("float-image")}<p>Text intentionally wraps around this floated illustration.</p></div><div class="grid-example">${image("grid-image")}<p>A deliberate two-column composition.</p></div><div class="flex-example">${image("flex-image")}<p>Image and text share a flex row.</p></div><figure id="captioned">${image("caption-image")}<figcaption id="caption">Caption attached to its illustration.</figcaption></figure><img id="mapped-image" src="art.svg" width="420" height="560" usemap="#fixture-map" alt="Linked geometric diagram"/><map name="fixture-map" id="fixture-map"><area shape="rect" coords="0,0,420,560" href="#caption" alt="Read the caption"/></map>`,
      ),
    ],
    sizeChanges: [],
  },
  {
    id: "nested-prose",
    layout: "reflowable",
    css: `${baseCss} .publisher-root { width: 78%; margin-left: 42px; } .ordinary p { text-indent: 1.5em; margin-bottom: 0; } .poetry { white-space: pre-wrap; } .scene-break { text-align: center; margin: 2em 0; } .epigraph { font-style: italic; margin-left: 15%; } .structured p { text-indent: 2em; margin: 1em 0; } .fixed-prose { width: 240px; margin-left: 25px; } .float-prose { float: left; width: 35%; } .columns-prose { column-count: 2; } .grid-prose { display: grid; grid-template-columns: 1fr 1fr; } .justified { text-align: justify; }`,
    sections: [
      section(
        "nested",
        `<article id="nested-root"><div class="publisher-root"><section class="ordinary"><div><h1>Survey notebook</h1><p id="nested-anchor">The team placed a marker beside the reservoir.</p><p id="dialogue">“The trail is clear,” said the surveyor.</p><p id="justified" class="justified">A second observation follows the dialogue.</p></div></section><ul><li>A list entry with <em>emphasis</em>.</li></ul><blockquote><p>A quotation has its own structure.</p></blockquote><figure>${image("nested-image")}<figcaption>Geometric field sketch.</figcaption></figure><p><a id="note-link" href="#note-1" epub:type="noteref">Read the field note</a>.</p><aside id="note-1" epub:type="footnote"><p>Original fixture footnote. <a href="#note-link">Return</a></p></aside><pre class="poetry" id="poem">Still water\n  a measured line\nquiet stones</pre><div class="epigraph"><p>Measure twice before recording.</p></div><p class="scene-break" id="scene-break">* * *</p><p dir="rtl" lang="ar" id="rtl">ماء هادئ</p><p lang="ja" id="ruby"><ruby>水<rt>みず</rt></ruby></p><table><caption>Survey measurements</caption><thead><tr><th>Point</th><th>Distance</th></tr></thead><tbody><tr><td>A</td><td>12</td></tr></tbody></table><p><a href="art.svg">${image("linked-image")}View the original geometric sketch</a>.</p></div></article>
<p id="body-prose-first">Body-only <a id="prose-focus-link" href="#note-1">prose</a> starts without a leading paragraph gap.</p><p id="body-prose-second">Body-only prose continues with the same reading measure.</p>
<section class="ordinary" id="wrapped-flow"><div><p id="wrapped-first">An ordinary paragraph inside its own wrapper.</p></div><div><p id="wrapped-second">A following paragraph inside another wrapper.</p></div></section>
<div class="structured"><div class="poetry"><p id="stanza">A line of verse<br/>  with meaningful whitespace</p></div><div epub:type="footnote"><p id="generic-footnote">A semantic footnote in a generic container.</p></div><div role="doc-subtitle"><p id="subtitle">A structured subtitle.</p></div><blockquote><p id="quote">A quoted observation.</p></blockquote><ul><li><p id="list-paragraph">A paragraph inside a list.</p></li></ul><table><tr><td><p id="table-paragraph">A table cell.</p></td></tr></table><figure><figcaption><p id="caption-paragraph">A figure caption.</p></figcaption></figure><div class="epigraph"><p id="epigraph">A separate epigraph.</p></div><div class="fixed-prose"><p id="fixed-prose">An intentionally fixed-width text composition.</p></div><div class="float-prose"><p id="float-prose">A deliberate float.</p></div><div class="columns-prose"><p id="columns-prose">Multi-column text.</p></div><div class="grid-prose"><p id="grid-prose">A grid cell.</p></div><p id="empty-prose"></p></div>`,
      ),
    ],
    sizeChanges: [],
  },
  {
    id: "long-spine",
    layout: "reflowable",
    css: baseCss,
    sections: Array.from({ length: 42 }, (_, index) => {
      const id = `section-${String(index + 1).padStart(2, "0")}`;
      return section(
        id,
        `<h1>${id}</h1><p id="${id}-anchor">Bookmark anchor ${id}: the reservoir survey continues.</p>${passages(id, 9)}${index === 0 ? '<p><a id="long-note-link" href="#long-note" epub:type="noteref">Read the survey note</a></p><aside id="long-note" epub:type="footnote"><p>Original long-spine survey note.</p></aside>' : ""}${index === 20 ? `<figure>${image("long-media")}<figcaption>Survey illustration at section 21.</figcaption></figure>` : ""}`,
      );
    }),
    sizeChanges: [],
  },
  {
    id: "fixed-layout",
    layout: "pre-paginated",
    css: `${baseCss} body { width: 600px; height: 800px; position: relative; background: #e6edf0; } .page-art { position: absolute; left: 30px; top: 90px; width: 300px; height: 400px; } .page-label { position: absolute; left: 370px; top: 130px; width: 180px; } .page-link { position: absolute; left: 370px; top: 650px; }`,
    sections: [
      section(
        "page-one",
        `<img class="page-art" src="art.svg" width="420" height="560" alt="Composed geometric illustration"/><p class="page-label" id="page-one-anchor">Deliberately offset page-one label.</p><a class="page-link" href="page-two.xhtml#page-two-anchor">Continue to page two</a>`,
      ),
      section(
        "page-two",
        `<p class="page-label" id="page-two-anchor">A linked second composed page.</p><a class="page-link" href="page-one.xhtml#page-one-anchor">Return to page one</a>`,
      ),
    ],
    sizeChanges: [],
  },
];

const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function document(title: string, body: string, fixed: boolean) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/>${fixed ? '<meta name="viewport" content="width=600,height=800"/>' : ""}</head><body>${body}</body></html>`;
}

/** Regenerates from checked-in inputs in Node or the browser, without file or network access. */
export async function buildReaderFixture(id: ReaderFixtureId): Promise<Uint8Array<ArrayBuffer>> {
  const fixture = readerFixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown Reader fixture: ${id}`);
  const zip = new JSZip();
  const add = (path: string, content: string) =>
    zip.file(path, content, {
      date: new Date("2026-01-01T00:00:00Z"),
      createFolders: false,
      compression: path === "mimetype" ? "STORE" : "DEFLATE",
    });
  add("mimetype", "application/epub+zip");
  add(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const fixed = fixture.layout === "pre-paginated";
  add(
    "EPUB/package.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="fixture-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixture-id">urn:archeion:synthetic:${id}</dc:identifier><dc:title>Synthetic ${id}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta><meta property="rendition:layout">${fixture.layout}</meta>${fixed ? '<meta property="rendition:spread">none</meta><meta property="rendition:orientation">portrait</meta>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="art" href="art.svg" media-type="image/svg+xml"/>${fixture.sections.map((entry) => `<item id="${entry.id}" href="${entry.href}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${fixture.sections.map((entry) => `<itemref idref="${entry.id}"/>`).join("")}</spine></package>`,
  );
  add(
    "EPUB/nav.xhtml",
    document(
      `${id} contents`,
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${fixture.sections.map((entry) => `<li><a href="${entry.href}">${entry.id}</a></li>`).join("")}</ol></nav>`,
      false,
    ),
  );
  add("EPUB/style.css", fixture.css);
  add("EPUB/art.svg", art);
  for (const entry of fixture.sections)
    add(`EPUB/${entry.href}`, document(entry.id, entry.body, fixed));
  return new Uint8Array(
    await zip.generateAsync({ type: "arraybuffer", platform: "DOS", compression: "STORE" }),
  );
}
