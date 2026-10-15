import JSZip from "jszip";

export type ReaderFixtureId =
  | "short-cover"
  | "reverse-prepend"
  | "image-only"
  | "nested-prose"
  | "conditional-prose"
  | "semantic-structures"
  | "structural-columns"
  | "long-spine"
  | "fixed-layout";
type Section = Readonly<{ id: string; href: string; body: string }>;
export type ReaderFixture = Readonly<{
  id: ReaderFixtureId;
  layout: "reflowable" | "pre-paginated";
  epubVersion?: 2;
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
const image = (id: string, className = "") =>
  `<img id="${id}"${className ? ` class="${className}"` : ""} src="art.svg" width="420" height="560" alt="Original circles and triangle illustration"/>`;

export const readerFixtures: readonly ReaderFixture[] = [
  {
    id: "structural-columns",
    layout: "reflowable",
    epubVersion: 2,
    css: `${baseCss}
      h1 { text-align: start; text-indent: 20pt; }
      .chapter-links { margin: 0; padding: 0; list-style: none; }
      .chapter-links a { display: block; padding-inline-start: 2em; text-indent: -2em; }
      .chapter-links ol { margin-inline-start: 2em; }
      aside p { margin-block: 1.25em; text-indent: 1em; }
      .proportional { text-align: center; margin-inline: auto; }
      .proportional p { width: 75%; margin-inline: auto; text-align: justify; }
      .proportional header img { width: 80px; height: auto; }
      .fixed { width: 240px; margin-inline-start: 80px; }
      .columns { column-count: 2; }
      .sidebar { float: right; width: 200px; }
    `,
    sections: [
      section(
        "legacy-toc",
        `<h1 id="legacy-title">Survey route</h1><ol id="legacy-list" class="chapter-links"><li><a id="legacy-link" href="note-chapter.xhtml#note-anchor">Opening notebook</a><ol id="legacy-nested"><li><a id="legacy-long" href="note-chapter.xhtml#note-late">An original long chapter title describing several carefully recorded observations beside a reservoir and the route followed by the survey team after sunset</a></li></ol></li><li><a href="proportional-section.xhtml#proportional-first">Publication record</a></li></ol>`,
      ),
      section(
        "note-chapter",
        `<h1>Notebook</h1><p id="note-anchor">An original reading passage includes a note <a id="note-return" href="#linked-note">[1]</a>.</p>${passages("note-chapter", 8)}<hr id="note-separator"/><aside id="linked-note"><p id="note-text"><a id="note-backlink" href="#note-return">[1]</a>: <span id="note-copy">This original note explains a measurement without becoming ordinary running prose.</span></p></aside><p id="note-late">The last original reading passage follows the note.</p>`,
      ),
      section(
        "proportional-section",
        `<section id="proportional-root" class="proportional"><header id="proportional-header"><h1>Publication record</h1><img id="proportional-logo" src="art.svg" alt="Original geometric mark"/></header><p id="proportional-first">This original record uses a narrower proportional paragraph inside an otherwise fluid section.</p><p id="proportional-second">The authored width and centered margins remain relative to the containing reading column.</p></section>`,
      ),
      section(
        "structural-negatives",
        `<section id="ordinary-list"><h1>Field equipment</h1><ol><li>Notebook and pencil</li><li><a href="note-chapter.xhtml">A reference</a> accompanies an ordinary explanatory list entry.</li></ol></section><section id="bibliography" epub:type="bibliography"><h1>References</h1><ol><li><a href="proportional-section.xhtml">An original source</a></li><li><a href="note-chapter.xhtml">An internal source</a></li></ol></section><section class="fixed" id="fixed-legacy"><h1>Authored navigation</h1><ol><li><a href="note-chapter.xhtml">Notebook</a></li><li><a href="proportional-section.xhtml">Record</a></li></ol></section><section id="composed-proportional" class="proportional fixed"><header><h1>Fixed record</h1></header><p>Original narrower composed paragraph.</p></section><hr id="unrelated-rule"/><aside id="ordinary-aside"><p>Original sidebar prose without note evidence.</p></aside><aside id="composed-note" class="sidebar" role="doc-footnote"><p>Original floated note.</p></aside><aside id="column-note" class="columns" epub:type="footnote"><p>Original multi-column note.</p></aside>`,
      ),
      section(
        "legacy-rtl",
        `<section dir="rtl" id="rtl-legacy"><h1>Survey direction</h1><ol class="chapter-links" id="rtl-legacy-list"><li><a href="note-chapter.xhtml">Notebook</a><ol><li><a href="proportional-section.xhtml">Record</a></li></ol></li></ol></section>`,
      ),
      ...Array.from({ length: 40 }, (_, index) =>
        section(`column-tail-${index + 1}`, passages(`column-tail-${index + 1}`, 9)),
      ),
    ],
    sizeChanges: [],
  },
  {
    id: "semantic-structures",
    layout: "reflowable",
    css: `${baseCss}
      h1 { text-indent: 20pt; }
      .toc-title { text-align: center; text-indent: 0; }
      .toc-list { list-style: none; margin: 0; padding: 0; text-align: start; }
      .toc-list a { display: block; padding-inline-start: 2em; text-indent: -2em; }
      .toc-list ol { margin-inline-start: 1.5em; padding-inline-start: 1em; }
      .composed-toc { width: 240px; margin-inline-start: 96px; }
      .column-toc { column-count: 2; }
      .offset-toc { margin-inline-start: 80px; }
      .imprint { width: 80%; margin-inline: auto; text-align: center; }
      .imprint header svg { display: block; width: 128px; height: 128px; margin-inline: auto; }
      .imprint p { width: 75%; margin-inline: auto; text-align: justify; }
    `,
    sections: [
      section(
        "structural-toc",
        `<nav epub:type="toc" id="semantic-toc"><h1 class="toc-title">Survey contents</h1><ol class="toc-list" id="toc-list"><li><a id="toc-chapter-link" href="structural-chapter.xhtml#chapter-anchor">1. A field notebook beside the reservoir</a><ol id="toc-nested"><li><a id="toc-long-link" href="structural-chapter.xhtml#chapter-late">1.1 A deliberately long original chapter title describing the quiet trail, a sequence of measurements, and the route back to the reservoir after the observation is recorded</a></li></ol></li><li><a href="structural-imprint.xhtml#imprint-first">2. Publication information</a></li></ol></nav><p id="toc-measure">An original measurement reference beneath the structural navigation.</p>`,
      ),
      section(
        "structural-chapter",
        `<section id="chapter-root"><div class="main"><h1 id="chapter-title">Opening observation</h1><p id="chapter-anchor">An original chapter starts beside the reservoir.</p>${passages("structural-chapter", 28)}<p id="chapter-late">The final observation identifies the return trail.</p></div></section>`,
      ),
      section(
        "structural-imprint",
        `<section epub:type="imprint" class="imprint" id="imprint-section"><header id="imprint-header"><svg id="imprint-logo" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Original geometric publisher mark</title><circle cx="64" cy="64" r="50" fill="#53778c"/></svg></header><p id="imprint-first">This original sample publication was prepared for structural layout measurements. Its narrower paragraphs use justified text inside a centered block.</p><p id="imprint-second">The geometric mark and all sentences were authored for this fixture. No text or artwork from a published book is included.</p></section>`,
      ),
      section(
        "structural-composed",
        `<nav epub:type="toc" id="composed-toc" class="composed-toc"><h1 class="toc-title">Fixed composition</h1><ol class="toc-list"><li><a href="structural-chapter.xhtml#chapter-anchor">A fixed column with an authored offset</a></li></ol></nav><nav role="doc-toc" id="offset-toc" class="offset-toc"><ol class="toc-list"><li><a href="structural-chapter.xhtml#chapter-anchor">An intentionally offset fluid column</a></li></ol></nav><nav epub:type="toc" id="column-toc" class="column-toc"><ol><li><a href="structural-chapter.xhtml#chapter-anchor">A multi-column composition</a></li><li>A second entry</li></ol></nav><nav id="ordinary-nav" aria-label="Publisher utility links"><a href="structural-chapter.xhtml#chapter-anchor">A non-TOC landmark</a></nav>`,
      ),
      section(
        "structural-rtl",
        `<nav role="doc-toc" dir="rtl" id="rtl-toc"><h1 class="toc-title">RTL survey contents</h1><ol class="toc-list" id="rtl-list"><li><a id="rtl-link" href="structural-chapter.xhtml#chapter-anchor">An original directionality test entry</a><ol><li>A nested directionality entry</li></ol></li></ol></nav><p id="rtl-measure">An original reference beneath the RTL navigation.</p>`,
      ),
      ...Array.from({ length: 40 }, (_, index) =>
        section(`structural-tail-${index + 1}`, passages(`structural-tail-${index + 1}`, 9)),
      ),
    ],
    sizeChanges: [],
  },
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
    css: `${baseCss} div { text-align: left; } #center { text-align: center; } .float-example img { float: left; width: 100px; } .grid-example { display: grid; grid-template-columns: 120px 1fr; } .flex-example { display: flex; gap: 16px; } .grid-example img, .flex-example img { width: 100px; } figure { margin: 16px 40px; }
      .opening-art { display: block; width: 559pt; height: 744pt; }
      .opening-auto { margin-left: auto; }
      .opening-fixed-offset { margin-left: 24px; margin-right: 0; }
      .opening-mixed-offset { margin-left: auto; margin-right: 24px; }
      .opening-rtl { direction: rtl; }
      .opening-rtl img { margin-inline-start: auto; }
    `,
    sections: [
      section("isolated", `<div class="center">${image("isolated-image")}</div>`),
      section(
        "composition",
        `<div class="float-example">${image("float-image")}<p>Text intentionally wraps around this floated illustration.</p></div><div class="grid-example">${image("grid-image")}<p>A deliberate two-column composition.</p></div><div class="flex-example">${image("flex-image")}<p>Image and text share a flex row.</p></div><figure id="captioned">${image("caption-image")}<figcaption id="caption">Caption attached to its illustration.</figcaption></figure><img id="mapped-image" src="art.svg" width="420" height="560" usemap="#fixture-map" alt="Linked geometric diagram"/><map name="fixture-map" id="fixture-map"><area shape="rect" coords="0,0,420,560" href="#caption" alt="Read the caption"/></map>`,
      ),
      section(
        "nested-media",
        `<article><section><div><p><span>${image("nested-plate")}</span></p></div></section></article>`,
      ),
      section(
        "linked-media",
        `<div><a id="plate-link" href="composition.xhtml#caption"><picture><source srcset="data:image/svg+xml,${encodeURIComponent(art)}" type="image/svg+xml"/>${image("linked-plate")}</picture></a></div>`,
      ),
      section(
        "vector-media",
        `<section><svg id="vector-plate" xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560" aria-label="Original vector illustration"><rect width="420" height="560" fill="#53778c"/></svg></section>`,
      ),
      section(
        "oversize-media",
        `<div><img id="oversize-plate" style="width: 1600px !important; height: 2100px !important; max-width: none !important; max-height: none !important;" src="art.svg" alt="Original oversized illustration"/></div>`,
      ),
      section(
        "small-media",
        `<img id="small-plate" src="art.svg" width="96" height="128" alt="Original small illustration"/>`,
      ),
      section(
        "intentional-media",
        `<div style="position: relative; left: 24px;">${image("offset-plate")}</div><h1><img id="heading-ornament" src="art.svg" width="30" height="40" alt=""/>Illustration heading</h1><p>Inline symbol <img id="inline-symbol" src="art.svg" width="15" height="20" alt=""/> stays in its sentence.</p><div style="display: grid; grid-template-columns: 120px 1fr;"><div>${image("deep-grid-plate")}</div><p>Grid caption.</p></div>`,
      ),
      section("media-passage", `<div>${image("late-plate")}</div>${passages("media-passage", 24)}`),
      section(
        "wide-media",
        `<svg id="wide-plate" xmlns="http://www.w3.org/2000/svg" width="1600" height="300" viewBox="0 0 1600 300" aria-label="Original wide illustration"><rect width="1600" height="300" fill="#53778c"/></svg>`,
      ),
      section(
        "heading-art",
        `<h1 id="heading-art-owner">${image("heading-plate", "opening-art")}<!-- Original pagination marker --><br id="heading-page-break"/></h1>`,
      ),
      section(
        "pagination-art",
        `<p id="pagination-art-owner">${image("pagination-plate", "opening-art")} \n<!-- Original pagination marker --><br id="paragraph-page-break"/> \n</p>`,
      ),
      section(
        "auto-margin-art",
        `<p id="auto-art-owner">${image("auto-plate", "opening-art opening-auto")}</p>`,
      ),
      section(
        "rtl-auto-art",
        `<p class="opening-rtl">${image("rtl-auto-plate", "opening-art")}</p>`,
      ),
      section(
        "opening-art-controls",
        `<h2><img id="solitary-ornament" src="art.svg" width="30" height="40" alt="Original ornament"/></h2><h2>${image("mixed-heading-plate")}A meaningful heading</h2><p>${image("caption-sibling-plate")}A text caption remains attached.</p><p>${image("double-break-plate")}<br/><br/></p><p><br/>${image("leading-break-plate")}</p><p>${image("fixed-offset-plate", "opening-art opening-fixed-offset")}</p><p>${image("mixed-offset-plate", "opening-art opening-mixed-offset")}</p><nav epub:type="toc" role="doc-toc"><h2>Contents</h2><ol><li><a id="opening-toc-link" href="heading-art.xhtml#heading-plate">Original illustration</a></li></ol></nav>`,
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
        `${index === 0 ? '<article id="long-nested-root"><section><div>' : ""}<h1>${id}</h1><p id="${id}-anchor">Bookmark anchor ${id}: the reservoir survey continues.</p>${passages(id, 9)}${index === 0 ? '<p><a id="long-note-link" href="#long-note" epub:type="noteref">Read the survey note</a></p><aside id="long-note" epub:type="footnote"><p>Original long-spine survey note.</p></aside></div></section></article>' : ""}${index === 20 ? `<figure>${image("long-media")}<figcaption>Survey illustration at section 21.</figcaption></figure>` : ""}`,
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
  const legacy = fixture.epubVersion === 2;
  const navigationItem = legacy
    ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';
  const metadata = legacy
    ? ""
    : `<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta><meta property="rendition:layout">${fixture.layout}</meta>${fixed ? '<meta property="rendition:spread">none</meta><meta property="rendition:orientation">portrait</meta>' : ""}`;
  add(
    "EPUB/package.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${legacy ? "2.0" : "3.0"}" unique-identifier="fixture-id"${legacy ? "" : ' prefix="rendition: http://www.idpf.org/vocab/rendition/#"'}><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixture-id">urn:archeion:synthetic:${id}</dc:identifier><dc:title>Synthetic ${id}</dc:title><dc:language>en</dc:language>${metadata}</metadata><manifest>${navigationItem}<item id="css" href="style.css" media-type="text/css"/><item id="art" href="art.svg" media-type="image/svg+xml"/>${fixture.sections.map((entry) => `<item id="${entry.id}" href="${entry.href}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine${legacy ? ' toc="ncx"' : ""}>${fixture.sections.map((entry) => `<itemref idref="${entry.id}"/>`).join("")}</spine></package>`,
  );
  if (legacy) {
    add(
      "EPUB/toc.ncx",
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:archeion:synthetic:${id}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>Synthetic ${id}</text></docTitle><navMap>${fixture.sections.map((entry, index) => `<navPoint id="point-${index + 1}" playOrder="${index + 1}"><navLabel><text>${entry.id}</text></navLabel><content src="${entry.href}"/></navPoint>`).join("")}</navMap></ncx>`,
    );
  } else {
    add(
      "EPUB/nav.xhtml",
      document(
        `${id} contents`,
        `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${fixture.sections.map((entry) => `<li><a href="${entry.href}">${entry.id}</a></li>`).join("")}</ol></nav>`,
        false,
      ),
    );
  }
  add("EPUB/style.css", fixture.css);
  add("EPUB/art.svg", art);
  for (const entry of fixture.sections)
    add(`EPUB/${entry.href}`, document(entry.id, entry.body, fixed));
  return new Uint8Array(
    await zip.generateAsync({ type: "arraybuffer", platform: "DOS", compression: "STORE" }),
  );
}
