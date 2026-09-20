// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { applyReaderReflowableLayout } from "./readerReflowableLayout";

const STANDALONE_MEDIA_ATTRIBUTE = "data-archeion-media-fit";
const MEDIA_FLOW_ATTRIBUTE = "data-archeion-media-flow";
const MEDIA_CENTER_ATTRIBUTE = "data-archeion-media-center";
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

  it.each(["narrow", "comfortable", "wide", "full"] as const)(
    "centers media-only paragraph flow on the paged stage at %s width without changing its size",
    (readingWidth) => {
      const { chapter, view } = mountedChapter(
        `<p id="flow" class="ordinary-prose"><span><img id="paged-plate" class="publisher-size" src="plate.jpg" alt="" width="420" height="630"></span></p>`,
        `.ordinary-prose {
          text-align: left;
          text-indent: 1.5em;
          margin-inline-start: 24px;
          margin-inline-end: 12px;
        }
        .publisher-size { width: 420px !important; max-width: 420px !important; }`,
      );

      applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth });

      const flow = chapter.getElementById("flow")!;
      const plate = chapter.getElementById("paged-plate")!;
      const flowStyle = view.getComputedStyle(flow);
      const plateStyle = view.getComputedStyle(plate);

      expect(flow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
      expect(flow.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
      expect(plate.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
      expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
      expect(flowStyle.textIndent).toBe("0px");
      expect(flowStyle.marginInlineStart).toBe("auto");
      expect(flowStyle.marginInlineEnd).toBe("auto");
      expect(plateStyle.display).toBe("block");
      expect(plateStyle.marginInlineStart).toBe("auto");
      expect(plateStyle.marginInlineEnd).toBe("auto");
      expect(plateStyle.width).toBe("420px");
      expect(plateStyle.maxWidth).toBe("420px");
      expect(plate.getAttribute("width")).toBe("420");
      expect(plate.getAttribute("height")).toBe("630");
      expect(plateStyle.maxInlineSize).not.toBe("58ch");
      expect(chapter.getElementById(MEDIA_STYLE_ID)?.textContent).not.toContain("max-inline-size");
    },
  );

  it("centers equivalent standalone wrapper chains and direct small media without upscaling", () => {
    const { chapter, view } = mountedChapter(`
      <a id="link-flow" href="#"><picture><img id="linked" src="linked.jpg" alt="Plate"></picture></a>
      <div id="nested-flow"><p><span><svg id="nested" viewBox="0 0 800 600" aria-label="Map"></svg></span></p></div>
      <img id="small-paged" src="small.png" alt="Small decoration" width="96" height="64">
    `);

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });

    for (const id of ["link-flow", "nested-flow", "linked", "nested", "small-paged"]) {
      expect(chapter.getElementById(id)?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    }
    const small = chapter.getElementById("small-paged")!;
    expect(view.getComputedStyle(small).width).not.toBe("100%");
    expect(small.getAttribute("width")).toBe("96");
    expect(small.getAttribute("height")).toBe("64");
  });

  it("neutralizes incidental prose geometry across the complete media-only wrapper chain", () => {
    const { chapter, view } = mountedChapter(
      `<div id="paragraph-flow">
        <p id="offset-paragraph"><span id="paragraph-span"><img id="paragraph-plate" src="plate.jpg" alt="Plate" width="320" height="480"></span></p>
      </div>
      <div id="link-flow">
        <a id="offset-link" href="#plate"><picture id="link-picture"><img id="linked-plate" src="linked.jpg" alt="Linked plate" width="300" height="450"></picture></a>
      </div>`,
      `#offset-paragraph {
        margin-inline-start: 96px;
        margin-inline-end: 12px;
        text-align: left;
        text-indent: 2em;
      }
      #offset-link {
        margin-inline-start: 72px;
        margin-inline-end: 8px;
        text-align: right;
        text-indent: 1.5em;
      }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });

    for (const id of [
      "paragraph-flow",
      "offset-paragraph",
      "paragraph-span",
      "paragraph-plate",
      "link-flow",
      "offset-link",
      "link-picture",
      "linked-plate",
    ]) {
      expect(chapter.getElementById(id)?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    }

    for (const id of ["offset-paragraph", "paragraph-span", "offset-link", "link-picture"]) {
      const style = view.getComputedStyle(chapter.getElementById(id)!);
      expect(style.display).toBe("block");
      expect(style.marginInlineStart).toBe("auto");
      expect(style.marginInlineEnd).toBe("auto");
      expect(style.textIndent).toBe("0px");
    }

    for (const id of ["paragraph-plate", "linked-plate"]) {
      const style = view.getComputedStyle(chapter.getElementById(id)!);
      expect(style.display).toBe("block");
      expect(style.marginInlineStart).toBe("auto");
      expect(style.marginInlineEnd).toBe("auto");
    }
  });

  it("leaves mixed-content and strongly positioned wrapper geometry untouched", () => {
    const { chapter, view } = mountedChapter(
      `<p id="mixed-flow">Before <span><img id="mixed-icon" src="icon.png" alt="Menu"></span> after</p>
      <div id="strong-flow"><p id="strong-wrapper"><span id="strong-span"><img id="strong-plate" src="strong.jpg" alt="Composed plate"></span></p></div>`,
      `#mixed-flow {
        margin-inline-start: 64px;
        margin-inline-end: 10px;
        text-indent: 2em;
      }
      #strong-wrapper {
        position: relative;
        inset-inline-start: 18px;
        margin-inline-start: 48px;
        margin-inline-end: 6px;
        text-indent: 1.5em;
      }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "wide" });

    for (const id of [
      "mixed-flow",
      "mixed-icon",
      "strong-flow",
      "strong-wrapper",
      "strong-span",
      "strong-plate",
    ]) {
      expect(chapter.getElementById(id)?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    }

    const mixedStyle = view.getComputedStyle(chapter.getElementById("mixed-flow")!);
    expect(mixedStyle.marginInlineStart).toBe("64px");
    expect(mixedStyle.marginInlineEnd).toBe("10px");
    expect(mixedStyle.textIndent).toBe("32px");

    const strongStyle = view.getComputedStyle(chapter.getElementById("strong-wrapper")!);
    expect(strongStyle.marginInlineStart).toBe("48px");
    expect(strongStyle.marginInlineEnd).toBe("6px");
    expect(strongStyle.textIndent).toBe("24px");
    expect(strongStyle.position).toBe("relative");
  });

  it("preserves strong direct-flow-context composition without treating ordinary prose residue as ownership", () => {
    const { chapter, view } = mountedChapter(
      `<main id="flex-context"><img id="flex-plate" src="flex.jpg" alt="Flex-composed plate"></main>
      <article id="grid-context"><img id="grid-plate" src="grid.jpg" alt="Grid-composed plate"></article>
      <main id="ordinary-context"><img id="ordinary-plate" src="ordinary.jpg" alt="Ordinary plate"></main>`,
      `#flex-context { display: flex; justify-content: flex-end; }
      #grid-context { display: grid; justify-items: end; }
      #ordinary-context {
        text-align: right;
        text-indent: 2em;
        margin-inline-start: 40px;
        margin-inline-end: 12px;
      }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "full" });

    for (const id of ["flex-plate", "grid-plate"]) {
      const media = chapter.getElementById(id)!;
      expect(media.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
      expect(media.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
      expect(media.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    }

    const ordinary = chapter.getElementById("ordinary-plate")!;
    expect(ordinary.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    expect(view.getComputedStyle(ordinary).marginInlineStart).toBe("auto");
    const ordinaryContextStyle = view.getComputedStyle(chapter.getElementById("ordinary-context")!);
    expect(ordinaryContextStyle.textAlign).toBe("right");
    expect(ordinaryContextStyle.textIndent).toBe("32px");
    expect(ordinaryContextStyle.marginInlineStart).toBe("40px");
    expect(ordinaryContextStyle.marginInlineEnd).toBe("12px");
  });

  it("keeps publisher-centered media centered through the single Reader alignment state", () => {
    const { chapter, view } = mountedChapter(
      `<p id="flow" class="publisher-centered"><span><img id="plate" src="plate.jpg" alt="" width="600" height="900"></span></p>`,
      `.publisher-centered { text-align: center; margin: 0; }`,
    );

    const layout = { mode: "paged" as const, readingWidth: "wide" as const };
    applyReaderReflowableLayout(chapter, layout);
    applyReaderReflowableLayout(chapter, layout);

    const plate = chapter.getElementById("plate")!;
    expect(chapter.querySelectorAll(`#${MEDIA_STYLE_ID}`)).toHaveLength(1);
    expect(chapter.querySelectorAll(`[${MEDIA_CENTER_ATTRIBUTE}]`)).toHaveLength(3);
    expect(view.getComputedStyle(plate).marginInlineStart).toBe("auto");
    expect(plate.getAttribute("width")).toBe("600");
    expect(plate.getAttribute("height")).toBe("900");
  });

  it("normalizes an already-centered image-only section without changing publisher dimensions", () => {
    const { chapter, view } = mountedChapter(
      `<section id="image-flow" class="image-class"><img id="plate" class="image-res" src="plate.jpg" alt="Plate" width="629" height="447"></section>`,
      `body { text-align: center; margin: 0; }
      .image-res { height: auto; max-height: 98%; max-width: 100%; width: auto; }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "narrow" });

    const flow = chapter.getElementById("image-flow")!;
    const plate = chapter.getElementById("plate")!;
    expect(flow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(flow.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    expect(view.getComputedStyle(plate).display).toBe("block");
    expect(view.getComputedStyle(plate).marginInlineStart).toBe("auto");
    expect(plate.getAttribute("width")).toBe("629");
    expect(plate.getAttribute("height")).toBe("447");

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "narrow",
      stageSize: { height: 720, width: 960 },
    });

    expect(flow.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(false);
    expect(flow.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    expect(plate.hasAttribute(MEDIA_FLOW_ATTRIBUTE)).toBe(true);
    expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
  });

  it("preserves strong publisher positioning and excludes mixed-content and compact nested flows", () => {
    const { chapter, view } = mountedChapter(
      `<img id="floated" class="floated" src="float.jpg" alt="Floated plate">
      <img id="positioned" class="positioned" src="positioned.jpg" alt="Positioned plate">
      <img id="transformed" class="transformed" src="transformed.jpg" alt="Transformed plate">
      <div id="layout-flow" class="publisher-layout"><img id="layout-media" src="layout.jpg" alt="Composed plate"></div>
      <p id="mixed">Before <img id="icon" src="icon.png" alt="Menu" width="16" height="16"> after</p>
      <div id="compact-group">
        <p id="compact-flow"><span><img id="compact" src="compact.png" alt="" width="96" height="64"></span></p>
        <p>Adjacent publisher content</p>
      </div>`,
      `.floated { float: inline-end; margin-inline-start: 1em; }
      .positioned { position: relative; inset-inline-start: 20px; }
      .transformed { transform: translateX(20px); }
      .publisher-layout { display: flex; justify-content: center; }`,
    );

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "full" });

    const floated = chapter.getElementById("floated")!;
    const positioned = chapter.getElementById("positioned")!;
    const transformed = chapter.getElementById("transformed")!;
    expect(floated.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    expect(positioned.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    expect(transformed.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    expect(view.getComputedStyle(floated).float).not.toBe("none");
    expect(view.getComputedStyle(positioned).position).toBe("relative");
    expect(view.getComputedStyle(transformed).transform).not.toBe("none");
    for (const id of ["layout-flow", "layout-media", "mixed", "icon", "compact-flow", "compact"]) {
      expect(chapter.getElementById(id)?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    }
  });

  it("centers standalone figure media without changing caption alignment", () => {
    const { chapter, view } = mountedChapter(`<figure id="figure">
      <svg id="vector" viewBox="0 0 1600 1200" aria-label="Map"><rect width="1600" height="1200" /></svg>
      <figcaption id="caption" style="text-align: start;">A map caption</figcaption>
    </figure>`);

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "wide" });

    expect(chapter.getElementById("figure")?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    expect(chapter.getElementById("vector")?.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);
    expect(view.getComputedStyle(chapter.getElementById("caption")!).textAlign).toBe("start");
    expect(chapter.getElementById("caption")?.textContent).toBe("A map caption");
  });

  it("removes stale paged alignment when publisher positioning or Reader mode changes", () => {
    const { chapter } = mountedChapter(`<img id="plate" src="plate.jpg" alt="Plate">`);
    const plate = chapter.getElementById("plate") as HTMLElement;

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });
    expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(true);

    plate.style.float = "right";
    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });
    expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);

    plate.style.float = "";
    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { height: 720, width: 960 },
    });
    expect(plate.hasAttribute(MEDIA_CENTER_ATTRIBUTE)).toBe(false);
    expect(plate.hasAttribute(STANDALONE_MEDIA_ATTRIBUTE)).toBe(true);
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
    expect(chapter.getElementById(MEDIA_STYLE_ID)).not.toBeNull();
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
    expect(chapter.getElementById(MEDIA_STYLE_ID)).not.toBeNull();
    expect((flow as HTMLElement).style.height).toBe("100vh");
  });
});
