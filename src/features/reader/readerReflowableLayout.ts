import type { ReaderMode, ReaderReadingWidth } from "../../types/reader";
import type { ReaderStageSize } from "./readerStageGeometry";
import {
  applyReaderReflowableMedia,
  READER_REFLOWABLE_MEDIA_FLOW_SELECTOR,
} from "./readerReflowableMedia";

const READER_REFLOWABLE_LAYOUT_STYLE_ID = "archeion-reader-reflowable-layout";
const READER_CONTENT_BLOCK_INSET_PX = 64;
const READER_CONTENT_INLINE_GUTTER = "clamp(16px, 3vw, 32px)";
const READER_READING_MEASURES: Record<Exclude<ReaderReadingWidth, "full">, string> = {
  narrow: "58ch",
  comfortable: "72ch",
  wide: "90ch",
};

export type ReaderReflowableLayout = Readonly<{
  mode: ReaderMode;
  readingWidth: ReaderReadingWidth;
  stageSize?: ReaderStageSize | null;
}>;

export function applyReaderReflowableLayout(
  document: Document | null | undefined,
  layout: ReaderReflowableLayout,
): void {
  if (!document?.head) return;

  applyReaderReflowableMedia(document, layout);

  const existingStyle = document.getElementById(READER_REFLOWABLE_LAYOUT_STYLE_ID);
  const style = existingStyle ?? document.createElement("style");
  style.id = READER_REFLOWABLE_LAYOUT_STYLE_ID;
  style.dataset.readerMode = layout.mode;
  style.dataset.readerWidth = layout.readingWidth;
  style.textContent = readerReflowableLayoutCss(layout);

  if (!existingStyle) document.head.appendChild(style);
}

function readerReflowableLayoutCss(layout: ReaderReflowableLayout): string {
  const measure =
    layout.readingWidth === "full" ? "none" : READER_READING_MEASURES[layout.readingWidth];

  if (layout.mode === "continuous") {
    const stageMetrics = layout.stageSize
      ? `
  --archeion-reader-stage-width: ${layout.stageSize.width}px;
  --archeion-reader-stage-height: ${layout.stageSize.height}px;`
      : "";

    return `
:root {${stageMetrics}
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: none !important;
  min-inline-size: 0 !important;
  margin: 0 !important;
  margin-block: 0 !important;
  margin-inline: 0 !important;
  padding: 0 !important;
}

html:root > body {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: none !important;
  min-inline-size: 0 !important;
  margin: 0 !important;
  margin-block: 0 !important;
  margin-inline: 0 !important;
  padding-block: ${READER_CONTENT_BLOCK_INSET_PX}px !important;
  padding-inline: ${READER_CONTENT_INLINE_GUTTER} !important;
}

body > :not(script):not(style):not(link):not(${READER_REFLOWABLE_MEDIA_FLOW_SELECTOR}) {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: ${measure} !important;
  margin-inline: auto !important;
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}

body > p[data-archeion-running-prose=""] {
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}
`.trim();
  }

  return `
body > :not(script):not(style):not(link):not(${READER_REFLOWABLE_MEDIA_FLOW_SELECTOR}) {
  box-sizing: border-box;
  inline-size: calc(100% - (2 * ${READER_CONTENT_INLINE_GUTTER})) !important;
  max-inline-size: ${measure} !important;
  margin-inline: auto !important;
}

body > p[data-archeion-running-prose=""] {
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}
`.trim();
}
