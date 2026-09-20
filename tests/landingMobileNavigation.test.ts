import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const landingScript = fs.readFileSync(path.join(process.cwd(), "docs/js/main.js"), "utf8");

type MediaListener = (event: { matches: boolean; media: string }) => void;

function createLandingWindow({ mobile = true }: { mobile?: boolean } = {}) {
  const window = new Window({ url: "https://archeion.test/" });
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

  it("restores focus when navigation activation closes the mobile menu", () => {
    const { window, toggle, nav, links } = createLandingWindow();

    toggle.focus();
    toggle.click();
    links[0].click();

    expect(nav.classList.contains("is-open")).toBe(false);
    expect(nav.inert).toBe(true);
    expect(window.document.activeElement).toBe(toggle);
  });

  it("does not leave focus inside the navigation after outside-pointer dismissal", () => {
    const { window, toggle, nav, outside } = createLandingWindow();

    toggle.focus();
    toggle.click();
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
