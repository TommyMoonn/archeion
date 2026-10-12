type Passage = {
  element: Element;
  frame: HTMLIFrameElement;
  range: Range | null;
  y: number;
};

const PASSAGE_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img, svg, video";

function scrollerScale(scroller: HTMLElement): number {
  return scroller.getBoundingClientRect().height / scroller.offsetHeight || 1;
}

function passageY(scroller: HTMLElement, passage: Passage): number {
  const frameBox = passage.frame.getBoundingClientRect();
  const frameScale = frameBox.height / passage.frame.offsetHeight || 1;
  const box = passage.range?.getBoundingClientRect() ?? passage.element.getBoundingClientRect();
  return (
    (frameBox.top + box.top * frameScale - scroller.getBoundingClientRect().top) /
    scrollerScale(scroller)
  );
}

/** A live DOM range preserves text identity without rewriting publication/CFI nodes. */
export function captureContinuousAnchor(scroller: HTMLElement): Passage | null {
  const viewport = scroller.getBoundingClientRect();
  for (const frame of scroller.querySelectorAll("iframe")) {
    const frameBox = frame.getBoundingClientRect();
    const doc = frame.contentDocument;
    if (
      !doc ||
      frameBox.bottom <= viewport.top ||
      frameBox.top >= viewport.bottom ||
      getComputedStyle(frame).visibility === "hidden"
    )
      continue;
    const scale = frameBox.height / frame.offsetHeight || 1;
    for (const element of [...doc.querySelectorAll(PASSAGE_SELECTOR), doc.body]) {
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const top = frameBox.top + box.top * scale;
      const bottom = frameBox.top + box.bottom * scale;
      if (box.height <= 0 || bottom <= viewport.top || top >= viewport.bottom) continue;
      if (doc.defaultView?.getComputedStyle(element).visibility === "hidden") continue;

      // Prefer the first visible text line, including when a paragraph starts above
      // the viewport. An element-only anchor would drift within a long paragraph
      // when a late font changes its line wrapping.
      let range: Range | null = null;
      const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        if (text.trim()) {
          const candidate = doc.createRange();
          candidate.selectNodeContents(node);
          const visibleLine = [...candidate.getClientRects()].find(
            (line) => frameBox.top + line.bottom * scale > viewport.top && line.height > 0,
          );
          if (visibleLine) {
            let low = 0;
            let high = text.length - 1;
            while (low < high) {
              const middle = Math.floor((low + high) / 2);
              candidate.setStart(node, middle);
              candidate.setEnd(node, middle + 1);
              if (candidate.getBoundingClientRect().bottom < visibleLine.bottom - 1)
                low = middle + 1;
              else high = middle;
            }
            candidate.setStart(node, low);
            candidate.setEnd(node, low + 1);
            range = candidate;
            break;
          }
        }
        node = walker.nextNode();
      }
      const passage: Passage = { element, frame, range, y: 0 };
      passage.y = passageY(scroller, passage);
      return passage;
    }
  }
  return null;
}

export function continuousAnchorDelta(scroller: HTMLElement, passage: Passage): number | null {
  if (!passage.frame.isConnected || !passage.element.isConnected) return null;
  return passageY(scroller, passage) - passage.y;
}
