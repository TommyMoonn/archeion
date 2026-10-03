import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

const script = fs.readFileSync(path.resolve("docs/documentation/assets/docs.js"), "utf8");
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function createOutline(positions = [300, 500, 540, 1500]) {
  const window = new Window({ url: "https://archeion.test/documentation/" });
  windows.push(window);
  const frames: FrameRequestCallback[] = [];
  const reflows: (() => void)[] = [];
  Object.defineProperty(window, "ResizeObserver", {
    value: class {
      constructor(callback: () => void) {
        reflows.push(callback);
      }
      observe() {}
    },
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => frames.push(callback),
  });
  Object.defineProperty(window, "innerHeight", { value: 600 });
  Object.defineProperty(window.document.documentElement, "scrollHeight", { value: 2200 });
  window.document.documentElement.style.scrollPaddingTop = "88px";
  window.document.body.innerHTML = `<header class="docs-header"></header>
    <article data-doc-article>${positions
      .map((_, index) => {
        const tag = index === 2 ? "h3" : "h2";
        return `<${tag} id="section-${index}">Section ${index}</${tag}>`;
      })
      .join("")}</article>
    <aside class="docs-outline"><nav data-toc></nav></aside>
    <details data-mobile-outline><nav data-mobile-toc></nav></details>`;
  let scrollY = 0;
  const headings = [...window.document.querySelectorAll("article h2, article h3")];
  headings.forEach((heading, index) => {
    heading.getBoundingClientRect = () => ({ top: positions[index] - scrollY }) as DOMRect;
  });
  window.document.querySelector("header")!.getBoundingClientRect = () =>
    ({ bottom: 64 }) as DOMRect;
  Object.defineProperty(window, "scrollY", { get: () => scrollY });
  window.eval(script);
  const flush = () => frames.splice(0).forEach((callback) => callback(0));
  const move = (position: number, event = "scroll") => {
    scrollY = position;
    window.dispatchEvent(new window.Event(event));
    flush();
  };
  const current = (selector = "[data-toc]") =>
    window.document.querySelector(`${selector} [aria-current="location"]`)?.getAttribute("href");
  flush();
  return { window, headings, frames, flush, move, current, reflows };
}

describe("documentation outline section ownership", () => {
  it("selects the first section above the first heading without observer support", () => {
    const { current } = createOutline();
    expect(current()).toBe("#section-0");
  });

  it("advances through dense adjacent headings in document order and reverses on upward scroll", () => {
    const { move, current } = createOutline();
    for (const [position, id] of [
      [410, 0],
      [412, 1],
      [451, 1],
      [452, 2],
      [1412, 3],
      [0, 0],
    ]) {
      move(position);
      expect(current()).toBe(`#section-${id}`);
      expect(current("[data-mobile-toc]")).toBe(`#section-${id}`);
    }
  });

  it("owns sparse sections until the next heading reaches the viewport anchor", () => {
    const { move, current } = createOutline();
    move(1100);
    expect(current()).toBe("#section-2");
  });

  it("matches native fragment rounding at fractional heading positions", () => {
    const { current, headings, move } = createOutline();
    headings[0].getBoundingClientRect = () => ({ top: -19.3125 }) as DOMRect;
    headings[1].getBoundingClientRect = () => ({ top: 88.171875 }) as DOMRect;
    move(0);
    expect(current()).toBe("#section-1");
    headings[1].getBoundingClientRect = () => ({ top: 88.75 }) as DOMRect;
    move(0);
    expect(current()).toBe("#section-0");
  });

  it("selects the last heading at document bottom even when it never reaches the anchor", () => {
    const { move, current } = createOutline([300, 500, 540, 2050]);
    move(1598);
    expect(current()).toBe("#section-2");
    move(1599);
    expect(current()).toBe("#section-3");
  });

  it("recalculates on resize, hash navigation, and restored-page position", () => {
    const { move, current } = createOutline();
    for (const event of ["resize", "hashchange", "pageshow"]) {
      move(452, event);
      expect(current()).toBe("#section-2");
      move(0, event);
      expect(current()).toBe("#section-0");
    }
  });

  it("coalesces rapid scroll events into one animation frame", () => {
    const { window, frames, flush } = createOutline();
    for (let index = 0; index < 10; index++) window.dispatchEvent(new window.Event("scroll"));
    expect(frames).toHaveLength(1);
    flush();
    expect(frames).toHaveLength(0);
  });

  it("keeps native heading links and h3 subordination in both outlines", () => {
    const { window } = createOutline();
    for (const selector of ["[data-toc]", "[data-mobile-toc]"]) {
      const links = [...window.document.querySelectorAll(`${selector} a`)];
      expect(links.map((link) => link.getAttribute("href"))).toEqual(
        [0, 1, 2, 3].map((id) => `#section-${id}`),
      );
      expect(links.map((link) => link.getAttribute("data-level"))).toEqual(["2", "2", "3", "2"]);
      const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
      links[2].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("moves and resizes one decorative desktop indicator rather than creating per-link bars", () => {
    const { window, move } = createOutline();
    const links = [...window.document.querySelectorAll("[data-toc] a")];
    links.forEach((link, index) => {
      Object.defineProperty(link, "offsetTop", { value: index * 30 });
      Object.defineProperty(link, "offsetHeight", { value: index === 2 ? 48 : 30 });
    });
    move(452);
    const indicators = window.document.querySelectorAll(".docs-outline-indicator");
    expect(indicators).toHaveLength(1);
    expect(indicators[0].getAttribute("aria-hidden")).toBe("true");
    expect((indicators[0] as HTMLElement).style.transform).toBe("translateY(60px)");
    expect((indicators[0] as HTMLElement).style.height).toBe("48px");
    move(412);
    expect(window.document.querySelector(".docs-outline-indicator")).toBe(indicators[0]);
    expect((indicators[0] as HTMLElement).style.transform).toBe("translateY(30px)");
  });

  it("refreshes geometry after article reflow without requiring a scroll event", () => {
    const { headings, flush, current, reflows } = createOutline();
    expect(reflows).toHaveLength(1);
    headings[0].getBoundingClientRect = () => ({ top: 30 }) as DOMRect;
    headings[1].getBoundingClientRect = () => ({ top: 80 }) as DOMRect;
    reflows[0]();
    flush();
    expect(current()).toBe("#section-1");
  });

  it("hides empty outlines and does not create an indicator without sections", () => {
    const { window } = createOutline([]);
    expect(window.document.querySelector("[data-mobile-outline]")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(window.document.querySelector(".docs-outline-indicator")).toBeNull();
  });
});
