import ePub from "epubjs";
import { buildReaderFixture, readerFixtures } from "../../fixtures/reader/readerFixtures";
import { resolveReaderPublicationLayoutCapability } from "../../../src/features/reader/readerSession";

declare global {
  interface Window {
    readerFixture: {
      ready: boolean;
      layout: "fixed-layout" | "reflowable";
      metadataLayout: string;
      spineCount: number;
      display: (index: number) => Promise<void>;
      changeImageSize: (height?: number) => Promise<void>;
    };
  }
}

const params = new URLSearchParams(location.search);
const fixture = readerFixtures.find((candidate) => candidate.id === params.get("fixture"));
if (!fixture) throw new Error("Select a known synthetic EPUB fixture");
const stage = document.getElementById("publication")!;
const status = document.getElementById("status")!;
const book = ePub((await buildReaderFixture(fixture.id)).buffer);
await book.ready;
const metadata = await book.loaded.metadata;
const spine = await book.loaded.spine;
const layout = resolveReaderPublicationLayoutCapability(metadata.layout);
const continuous = params.get("flow") === "continuous" && layout === "reflowable";
const rendition = book.renderTo(stage, {
  width: 1050,
  height: 750,
  spread: "none",
  manager: continuous ? "continuous" : "default",
  flow: continuous ? "scrolled-continuous" : "paginated",
  allowScriptedContent: false,
});
window.readerFixture = {
  ready: false,
  layout,
  metadataLayout: metadata.layout,
  spineCount: spine.length,
  display: (index) => rendition.display(index),
  async changeImageSize(height) {
    const change = fixture.sizeChanges[0];
    if (!change) throw new Error("This fixture has no delayed image");
    const element = [...stage.querySelectorAll("iframe")]
      .map((frame) => frame.contentDocument?.getElementById(change.elementId))
      .find((candidate) => candidate);
    if (!element || element.tagName.toLowerCase() !== "img")
      throw new Error("Display the image section before changing its height");
    // A controlled post-display style change models delayed sizing. No timer, script in
    // the publication, network request, or manual private manager check is involved.
    element.style.setProperty("height", `${height ?? change.settledHeight}px`, "important");
    element.style.setProperty("max-height", "none", "important");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  },
};
await rendition.display(Number(params.get("section") ?? 0));
window.readerFixture.ready = true;
status.textContent = `Loaded synthetic ${fixture.id}`;
window.addEventListener("pagehide", () => book.destroy(), { once: true });
