import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

const landingScript = fs.readFileSync(path.join(process.cwd(), "docs/js/main.js"), "utf8");

type MediaListener = (event: { matches: boolean; media: string }) => void;
const windows: Window[] = [];

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function createLandingWindow({ mobile = true }: { mobile?: boolean } = {}) {
  const window = new Window({ url: "https://archeion.test/" });
  windows.push(window);
  let mobileMatches = mobile;
  const mobileListeners = new Set<MediaListener>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const isMobileQuery = query === "(max-width: 900px)";
      return {
        get matches() {
          if (isMobileQuery) return mobileMatches;
          if (query === "(prefers-reduced-motion: reduce)") return true;
          return false;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: MediaListener) => {
          if (isMobileQuery) mobileListeners.add(listener);
        },
        removeEventListener: (_type: string, listener: MediaListener) => {
          if (isMobileQuery) mobileListeners.delete(listener);
        },
        addListener: (listener: MediaListener) => {
          if (isMobileQuery) mobileListeners.add(listener);
        },
        removeListener: (listener: MediaListener) => {
          if (isMobileQuery) mobileListeners.delete(listener);
        },
        dispatchEvent: () => true,
      };
    },
  });

  window.document.body.innerHTML = `
    <header data-header>
      <button
        class="nav-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="site-nav"
        aria-label="Open navigation"
      >
        <svg aria-hidden="true"><use href="#icon-menu"></use></svg>
      </button>
      <nav class="site-nav" id="site-nav" aria-label="Primary navigation">
        <a href="#library">Library</a>
        <a href="#reader">Reader</a>
      </nav>
    </header>
    <main>
      <section id="library"></section>
      <section id="reader"></section>
      <div id="outside">Outside</div>
    </main>
  `;

  window.eval(landingScript);

  const toggle = window.document.querySelector<HTMLButtonElement>(".nav-toggle");
  const nav = window.document.querySelector<HTMLElement>(".site-nav");
  const links = Array.from(window.document.querySelectorAll<HTMLAnchorElement>(".site-nav a"));
  const outside = window.document.querySelector<HTMLElement>("#outside");

  if (!toggle || !nav || links.length !== 2 || !outside) {
    throw new Error("Landing navigation fixture did not initialize correctly.");
  }

  return {
    window,
    toggle,
    nav,
    links,
    outside,
    setMobile(nextMobile: boolean) {
      mobileMatches = nextMobile;
      for (const listener of mobileListeners) {
        listener({ matches: nextMobile, media: "(max-width: 900px)" });
      }
    },
  };
}

describe("landing mobile navigation", () => {
  it("removes closed mobile navigation links from focus", () => {
    const { window, nav, links } = createLandingWindow();

    expect(nav.inert).toBe(true);
    links[0].focus();
    expect(window.document.activeElement).not.toBe(links[0]);
  });

  it("opens from the toggle and moves focus to the first navigation destination", () => {
    const { window, toggle, nav, links } = createLandingWindow();

    toggle.focus();
    toggle.click();

    expect(nav.classList.contains("is-open")).toBe(true);
    expect(nav.inert).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Close navigation");
    expect(window.document.activeElement).toBe(links[0]);
  });

  it("closes on Escape and restores focus to the toggle", () => {
    const { window, toggle, nav } = createLandingWindow();

    toggle.focus();
    toggle.click();
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );

    expect(nav.classList.contains("is-open")).toBe(false);
    expect(nav.inert).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(window.document.activeElement).toBe(toggle);
  });

  it("moves focus to the chosen same-page destination instead of the opener", () => {
    const { window, toggle, nav, links } = createLandingWindow();

    toggle.focus();
    toggle.click();
    links[0].click();

    expect(nav.classList.contains("is-open")).toBe(false);
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).toBe(window.document.getElementById("library"));
    expect(window.document.getElementById("library")?.getAttribute("tabindex")).toBe("-1");
  });

  it("restores opener focus when the toggle explicitly closes navigation", () => {
    const { window, toggle, nav } = createLandingWindow();
    toggle.click();
    toggle.click();
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).toBe(toggle);
  });

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"] as const)(
    "leaves modified %s link activation native without closing navigation",
    (modifier) => {
      const { window, toggle, nav, links } = createLandingWindow();
      toggle.click();
      links[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, [modifier]: true }));
      expect(nav.inert).toBe(false);
      expect(window.document.activeElement).toBe(links[0]);
    },
  );

  it.each(["#missing", "#%invalid"])("closes safely for an unresolved anchor %s", (href) => {
    const { window, toggle, nav, links } = createLandingWindow();
    links[0].href = href;
    toggle.click();
    links[0].click();
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).not.toBe(toggle);
  });

  it.each(["new-tab", "download", "prevented", "middle-button"])(
    "preserves the open navigation for %s activation",
    (mode) => {
      const { window, toggle, nav, links } = createLandingWindow();
      if (mode === "new-tab") links[0].target = "_blank";
      if (mode === "download") links[0].download = "fixture";
      toggle.click();
      const event = new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: mode === "middle-button" ? 1 : 0,
      });
      if (mode === "prevented") event.preventDefault();
      links[0].dispatchEvent(event);
      expect(nav.inert).toBe(false);
      expect(window.document.activeElement).toBe(links[0]);
    },
  );

  it("does not leave focus inside the navigation after outside-pointer dismissal", () => {
    const { window, toggle, nav, outside } = createLandingWindow();

    toggle.focus();
    toggle.click();
    outside.tabIndex = -1;
    outside.focus();
    outside.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(nav.classList.contains("is-open")).toBe(false);
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).toBe(toggle);
  });

  it("keeps desktop navigation interactive across responsive mode changes", () => {
    const { window, toggle, nav, links, setMobile } = createLandingWindow({ mobile: false });

    expect(nav.inert).toBe(false);
    links[0].focus();
    expect(window.document.activeElement).toBe(links[0]);

    setMobile(true);
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).toBe(toggle);

    setMobile(false);
    expect(nav.inert).toBe(false);
    links[1].focus();
    expect(window.document.activeElement).toBe(links[1]);
  });
});
