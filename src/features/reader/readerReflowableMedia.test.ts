// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { applyReaderReflowableLayout } from "./readerReflowableLayout";

const STANDALONE_MEDIA_ATTRIBUTE = "data-archeion-media-fit";
const MEDIA_FLOW_ATTRIBUTE = "data-archeion-media-flow";
const FORCE_INLINE_ATTRIBUTE = "data-archeion-media-force-inline-fit";
const FORCE_BLOCK_ATTRIBUTE = "data-archeion-media-force-block-fit";
const FORCE_FLOW_BLOCK_ATTRIBUTE = "data-archeion-media-force-flow-block-fit";
const MEDIA_STYLE_ID = "archeion-reader-reflowable-media";

function mountedChapter(markup: string, publisherCss = "") {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const chapter = frame.contentDocument!;
  chapter.head.innerHTML = `<style>${publisherCss}</style><style>
    img, svg {
      max-width: 100% !important;
      max-height: 5000px !important;
      object-fit: contain;
      box-sizing: border-box;
    }
  </style>`;
  chapter.body.innerHTML = markup;
  return { chapter, frame, view: frame.contentWindow! };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("reader reflowable media fit", () => {
  it.each(["narrow", "comfortable", "wide", "full"] as const)(
    "bounds hostile standalone raster media to the visible continuous Reader stage at %s width",
    (readingWidth) => {
      const { chapter, view } = mountedChapter(
        `<img id="plate" class="oversized" src="plate.jpg" alt="Plate">`,
        `.oversized {
          width: 1600px !important;
          height: 1200px !important;
          max-width: none !important;
          max-height: none !important;
          margin-inline-start: 48px !important;
        }`,
      );

      applyReaderReflowableLayout(chapter, {
        mode: "continuous",
        readingWidth,
        stageSize: { height: 760, width: 1180 },
      });

      const plate = chapter.getElementById("plate")!;
      const style = view.getComputedStyle(plate);

      expect(plate.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
      expect(plate.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
      expect(plate.hasAttribute(FORCE_INLINE_ATTRIBUTE)).toBe(true);
      expect(plate.hasAttribute(FORCE_BLOCK_ATTRIBUTE)).toBe(true);
      expect(style.maxInlineSize).toBe("min(100%, 1116px)");
      expect(style.maxBlockSize).toBe("608px");
      expect(style.objectFit).toBe("contain");
      expect(style.marginInlineStart).toBe("48px");
      expect(style.width).toBe("1600px");
      expect(style.height).toBe("1200px");
    },
  );

  it("bounds viewport-coupled media-only wrappers to the continuous Reader stage", () => {
    const { chapter, view } = mountedChapter(`
      <div id="cover-flow" style="height: 100vh; text-align: center; padding: 0; margin: 0;">
        <svg id="cover" height="100%" viewBox="0 0 2867 4096" width="100%">
          <image width="2867" height="4096" href="cover.jpg" />
        </svg>
      </div>
    `);

    const layout = {
      mode: "continuous" as const,
      readingWidth: "full" as const,
      stageSize: { height: 760, width: 1180 },
    };

    applyReaderReflowableLayout(chapter, layout);

    const flow = chapter.getElementById("cover-flow")!;
    const cover = chapter.getElementById("cover")!;
    expect(cover.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
    expect(flow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(flow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(true);
    expect(view.getComputedStyle(cover).maxBlockSize).toBe("608px");
    expect(view.getComputedStyle(flow).maxBlockSize).toBe("608px");

    applyReaderReflowableLayout(chapter, layout);

    expect(chapter.querySelectorAll(`#${MEDIA_STYLE_ID}`)).toHaveLength(1);
    expect(flow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(true);
    expect(view.getComputedStyle(flow).maxBlockSize).toBe("608px");

    applyReaderReflowableLayout(chapter, {
      ...layout,
      stageSize: { height: 640, width: 1000 },
    });

    expect(view.getComputedStyle(cover).maxBlockSize).toBe("512px");
    expect(view.getComputedStyle(flow).maxBlockSize).toBe("512px");
  });

  it.each(["block-size: 100dvh", "min-height: 900px", "min-block-size: 900px"])(
    "bounds an unsafe media-flow declaration: %s",
    (declaration) => {
      const { chapter, view } = mountedChapter(`
      <div id="media-flow" style="${declaration}; padding: 0; margin: 0;">
        <svg id="media" viewBox="0 0 1600 1200"><rect width="1600" height="1200" /></svg>
      </div>
    `);

      applyReaderReflowableLayout(chapter, {
        mode: "continuous",
        readingWidth: "full",
        stageSize: { height: 760, width: 1180 },
      });

      const flow = chapter.getElementById("media-flow")!;
      expect(flow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(true);
      expect(view.getComputedStyle(flow).maxBlockSize).toBe("608px");
    },
  );

  it("preserves safe publisher-sized media wrappers and ignores ordinary prose wrappers", () => {
    const { chapter, view } = mountedChapter(`
      <div id="safe-flow" style="height: 320px; margin: 0;">
        <svg id="safe-media" viewBox="0 0 800 600"><rect width="800" height="600" /></svg>
      </div>
      <div id="safe-vh-flow" style="height: 50vh; margin: 0;">
        <svg id="safe-vh-media" viewBox="0 0 800 600"><rect width="800" height="600" /></svg>
      </div>
      <div id="prose-flow" style="height: 100vh;"><p>Ordinary prose without standalone media.</p></div>
    `);

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { height: 760, width: 1180 },
    });

    const safeFlow = chapter.getElementById("safe-flow")!;
    const safeViewportFlow = chapter.getElementById("safe-vh-flow")!;
    const proseFlow = chapter.getElementById("prose-flow")!;
    expect(safeFlow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(safeFlow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(false);
    expect(view.getComputedStyle(safeFlow).height).toBe("320px");
    expect(safeViewportFlow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(safeViewportFlow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(false);
    expect(proseFlow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(false);
    expect(proseFlow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(false);
  });

  it("reduces an oversized wide banner to the stage inline bound without forcing a larger height", () => {
    const { chapter, view } = mountedChapter(
      `<main><img id="wide-banner" class="wide-banner" src="banner.jpg" alt="Chapter banner"></main>`,
      `.wide-banner {
        width: 2000px !important;
        height: 240px !important;
        max-width: none !important;
        max-height: 240px !important;
      }`,
    );

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "full",
      stageSize: { height: 760, width: 1180 },
    });

    const banner = chapter.getElementById("wide-banner")!;
    const style = view.getComputedStyle(banner);

    expect(banner.hasAttribute(FORCE_INLINE_ATTRIBUTE)).toBe(true);
    expect(banner.hasAttribute(FORCE_BLOCK_ATTRIBUTE)).toBe(false);
    expect(style.maxInlineSize).toBe("min(100%, 1116px)");
    expect(style.height).toBe("240px");
  });

  it("preserves safe publisher sizing and alignment while still classifying standalone media", () => {
    const { chapter, view } = mountedChapter(
      `<main><img id="banner" class="publisher-narrow" src="banner.jpg" alt="Banner"></main>`,
      `.publisher-narrow {
        width: 100% !important;
        max-width: 320px !important;
        max-height: 180px !important;
        margin-inline-start: 24px !important;
      }`,
    );

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { height: 760, width: 1180 },
    });

    const banner = chapter.getElementById("banner")!;
    const style = view.getComputedStyle(banner);

    expect(banner.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
    expect(banner.hasAttribute(FORCE_INLINE_ATTRIBUTE)).toBe(false);
    expect(banner.hasAttribute(FORCE_BLOCK_ATTRIBUTE)).toBe(false);
    expect(style.maxWidth).toBe("320px");
    expect(style.maxHeight).toBe("180px");
    expect(style.marginInlineStart).toBe("24px");
  });

  it("does not upscale small media or promote inline icons into standalone illustrations", () => {
    const { chapter, view } = mountedChapter(`
      <img id="small" src="small.png" alt="Small decoration" width="96" height="64">
      <p>Press <img id="icon" src="icon.png" alt="Menu" width="16" height="16"> to continue.</p>
    `);

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { height: 720, width: 960 },
    });

    const small = chapter.getElementById("small")!;
    const icon = chapter.getElementById("icon")!;
    const smallStyle = view.getComputedStyle(small);

    expect(small.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
    expect(smallStyle.width).not.toBe("100%");
    expect(smallStyle.marginInlineStart).not.toBe("auto");
    expect(small.getAttribute("width")).toBe("96");
    expect(small.getAttribute("height")).toBe("64");
    expect(icon.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(false);
    expect(icon.getAttribute("width")).toBe("16");
    expect(icon.getAttribute("height")).toBe("16");
  });

  it("keeps figure/caption structure together and applies the same fit contract to standalone SVG", () => {
    const { chapter } = mountedChapter(`<figure id="figure">
      <svg id="vector" viewBox="0 0 1600 1200" aria-label="Map"><rect width="1600" height="1200" /></svg>
      <figcaption id="caption">A map caption</figcaption>
    </figure>`);

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "wide",
      stageSize: { height: 800, width: 1200 },
    });

    const figure = chapter.getElementById("figure")!;
    const vector = chapter.getElementById("vector")!;

    expect(figure.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(vector.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
    expect(chapter.getElementById("caption")?.textContent).toBe("A map caption");
    expect(chapter.getElementById(MEDIA_STYLE_ID)).not.toBeNull();
  });

  it("leaves paged media sizing to epub.js while excluding standalone media from prose measure ownership", () => {
    const { chapter, view } = mountedChapter(
      `<img id="paged-plate" class="publisher-size" src="plate.jpg" alt="Plate">`,
      `.publisher-size { width: 420px !important; max-width: 420px !important; }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "narrow" });

    const plate = chapter.getElementById("paged-plate")!;
    const style = view.getComputedStyle(plate);

    expect(plate.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
    expect(plate.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(plate.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(false);
    expect(chapter.getElementById(MEDIA_STYLE_ID)).toBeNull();
    expect(style.width).toBe("420px");
    expect(style.maxWidth).toBe("420px");
    expect(style.maxInlineSize).not.toBe("58ch");
  });
  it("does not apply the continuous wrapper bound in paged mode", () => {
    const { chapter } = mountedChapter(`
      <div id="cover-flow" style="height: 100vh; margin: 0;">
        <svg id="cover" height="100%" viewBox="0 0 2867 4096" width="100%">
          <image width="2867" height="4096" href="cover.jpg" />
        </svg>
      </div>
    `);

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "full" });

    const flow = chapter.getElementById("cover-flow")!;
    expect(flow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(flow.hasAttribute(FORCE_FLOW_BLOCK_ATTRIBUTE)).toBe(false);
    expect(chapter.getElementById(MEDIA_STYLE_ID)).toBeNull();
    expect((flow as HTMLElement).style.height).toBe("100vh");
  });
});
