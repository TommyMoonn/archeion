import ePub from "epubjs";
import JSZip from "jszip";
import { createReaderAppearanceController } from "../../../src/features/reader/readerAppearanceController";
import { ReaderContentDocumentRegistry } from "../../../src/features/reader/readerContentDocumentRegistry";
import { createInstalledFontCatalog } from "../../../src/storage/installedFontCatalog";
import { AppPreferencesStore } from "../../../src/stores/appPreferencesStore";
import { AppearanceRuntime } from "../../../src/themes/AppearanceRuntime";
import type { AppPreferencesChanges } from "../../../src/types/appSettings";
import type { ReaderFontSelection } from "../../../src/types/reader";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    readerFontFixture: {
      ready: boolean;
      completeCatalog: () => Promise<void>;
      select: (selection: ReaderFontSelection) => Promise<boolean>;
      updateApplication: (changes: AppPreferencesChanges) => Promise<void>;
      snapshot: () => {
        selection: ReaderFontSelection;
        catalogCalls: number;
        mountedDocuments: number;
        sameFrame: boolean;
        sameChrome: boolean;
      };
    };
  }
}

const oddFamily = 'Odd, "Name" \\ ; } body { color: red';
let complete!: (families: readonly string[]) => void;
let catalogCalls = 0;
const fontCatalog = createInstalledFontCatalog(() => {
  catalogCalls += 1;
  return new Promise<readonly string[]>((resolve) => {
    complete = resolve;
  });
});
const store = new AppPreferencesStore();
const runtime = new AppearanceRuntime({ globalPreferences: store, fontCatalog });
runtime.start();
await store.initialize();
const controller = createReaderAppearanceController({ preferences: store, runtime, fontCatalog });
controller.activate();
const registry = new ReaderContentDocumentRegistry();
const stage = document.getElementById("publication")!;
const chrome = document.getElementById("reader-chrome")!;

// A real, minimal EPUB exercises epub.js theme insertion in a publication iframe.
const zip = new JSZip();
zip.file("mimetype", "application/epub+zip");
zip.file(
  "META-INF/container.xml",
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
);
zip.file(
  "OEBPS/package.opf",
  '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">reader-font-fixture</dc:identifier><dc:title>Reader font fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-07T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
);
zip.file(
  "OEBPS/nav.xhtml",
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>',
);
zip.file(
  "OEBPS/chapter.xhtml",
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Publication typography</h1><p>Publication text keeps its own Reader family while application controls retain the interface family. <strong>Bold emphasis</strong> and <em>italic emphasis</em> remain available.</p><p>Changing an installed family updates this same document without reopening the book.</p></body></html>',
);
const book = ePub(await zip.generateAsync({ type: "arraybuffer" }));
const rendition = book.renderTo(stage, { width: "100%", height: "100%", flow: "paginated" });
let mountedDocuments = 0;
rendition.hooks.content.register((contents: { document: Document; window: Window }) => {
  if (registry.bind(contents)) mountedDocuments += 1;
});
let theme = controller.getSnapshot().contentTheme;
registry.applyTheme(rendition, theme, stage);
controller.subscribe(() => {
  const next = controller.getSnapshot().contentTheme;
  if (next === theme) return;
  theme = next;
  registry.applyTheme(rendition, theme, stage);
});
await rendition.display();
const initialFrame = stage.querySelector("iframe");
const initialDocument = initialFrame?.contentDocument;
window.readerFontFixture = {
  ready: true,
  async completeCatalog() {
    complete(["Arial", "Georgia", oddFamily]);
    await fontCatalog.load();
  },
  select: (selection) =>
    controller.commitSettings({ ...controller.getSnapshot().settings, fontFamily: selection }),
  async updateApplication(changes) {
    await store.update(changes);
  },
  snapshot: () => ({
    selection: store.getSnapshot().reader.fontFamily,
    catalogCalls,
    mountedDocuments,
    sameFrame:
      stage.querySelector("iframe") === initialFrame &&
      initialFrame?.contentDocument === initialDocument,
    sameChrome: document.getElementById("reader-chrome") === chrome,
  }),
};
