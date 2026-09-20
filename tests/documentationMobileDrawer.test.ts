import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const docsScript = fs.readFileSync(
  path.join(process.cwd(), "docs/documentation/assets/docs.js"),
  "utf8",
);

type MediaListener = (event: { matches: boolean; media: string }) => void;

function createDocsWindow({ mobile = true }: { mobile?: boolean } = {}) {
  const window = new Window({ url: "https://archeion.test/documentation/" });
  let mobileMatches = mobile;
  const mobileListeners = new Set<MediaListener>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const isMobileQuery = query === "(max-width: 780px)";
      return {
        get matches() {
          return isMobileQuery ? mobileMatches : false;
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
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="docs-header">
      <button
        type="button"
        data-nav-open
        aria-controls="docs-sidebar"
        aria-expanded="false"
      >Open navigation</button>
      <button type="button" data-search-trigger>Search</button>
    </header>
    <dialog data-search-dialog>
      <button type="button" data-search-close>Close search</button>
      <input data-search-input />
      <nav data-search-results></nav>
      <p data-search-empty hidden>No matching pages.</p>
    </dialog>
    <div data-nav-backdrop hidden></div>
    <aside id="docs-sidebar" data-sidebar aria-label="Documentation navigation">
      <div class="docs-sidebar__mobile-header">
        <button type="button" data-nav-close>Close navigation</button>
      </div>
      <nav>
        <a href="#overview" data-doc-link>Overview</a>
        <a href="#reading" data-doc-link>Reading</a>
      </nav>
    </aside>
    <div class="docs-layout">
      <main id="main-content"><div id="outside">Outside</div></main>
    </div>
  `;

  window.eval(docsScript);

  const opener = window.document.querySelector<HTMLButtonElement>("[data-nav-open]");
  const close = window.document.querySelector<HTMLButtonElement>("[data-nav-close]");
  const backdrop = window.document.querySelector<HTMLElement>("[data-nav-backdrop]");
  const sidebar = window.document.querySelector<HTMLElement>("[data-sidebar]");
  const header = window.document.querySelector<HTMLElement>(".docs-header");
  const layout = window.document.querySelector<HTMLElement>(".docs-layout");
  const searchDialog = window.document.querySelector<HTMLDialogElement>("[data-search-dialog]");
  const links = Array.from(window.document.querySelectorAll<HTMLAnchorElement>("[data-doc-link]"));

  if (
    !opener ||
    !close ||
    !backdrop ||
    !sidebar ||
    !header ||
    !layout ||
    !searchDialog ||
    links.length !== 2
  ) {
    throw new Error("Documentation drawer fixture did not initialize correctly.");
  }

  return {
    window,
    opener,
    close,
    backdrop,
    sidebar,
    header,
    layout,
    searchDialog,
    links,
    setMobile(nextMobile: boolean) {
      mobileMatches = nextMobile;
      for (const listener of mobileListeners) {
        listener({ matches: nextMobile, media: "(max-width: 780px)" });
      }
    },
  };
}

describe("documentation mobile drawer", () => {
  it("keeps the closed mobile drawer out of sequential focus", () => {
    const { window, sidebar, links } = createDocsWindow();

    expect(sidebar.inert).toBe(true);
    links[0].focus();
    expect(window.document.activeElement).not.toBe(links[0]);
  });

  it("opens as the modal surface and moves focus into the drawer", () => {
    const { window, opener, close, backdrop, sidebar, header, layout, searchDialog } =
      createDocsWindow();

    opener.focus();
    opener.click();

    expect(window.document.body.classList.contains("nav-open")).toBe(true);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.inert).toBe(false);
    expect(backdrop.hidden).toBe(false);
    expect(header.inert).toBe(true);
    expect(layout.inert).toBe(true);
    expect(searchDialog.inert).toBe(true);
    expect(window.document.activeElement).toBe(close);
  });

  it("keeps the global search shortcut inactive while the drawer owns the modal surface", () => {
    const { window, opener, close, searchDialog } = createDocsWindow();

    opener.click();
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
    );

    expect(searchDialog.open).toBe(false);
    expect(window.document.activeElement).toBe(close);
  });

  it("closes on Escape, restores the opener, and re-enables the background", () => {
    const { window, opener, sidebar, header, layout } = createDocsWindow();

    opener.click();
    window.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));

    expect(window.document.body.classList.contains("nav-open")).toBe(false);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.inert).toBe(true);
    expect(header.inert).toBe(false);
    expect(layout.inert).toBe(false);
    expect(window.document.activeElement).toBe(opener);
  });

  it("closes from the backdrop and restores focus to the opener", () => {
    const { window, opener, backdrop, sidebar } = createDocsWindow();

    opener.click();
    backdrop.click();

    expect(sidebar.inert).toBe(true);
    expect(backdrop.hidden).toBe(true);
    expect(window.document.activeElement).toBe(opener);
  });

  it("always re-enters at the drawer owner instead of a formerly focused descendant", () => {
    const { window, opener, close, backdrop, links } = createDocsWindow();

    opener.click();
    links[1].focus();
    expect(window.document.activeElement).toBe(links[1]);

    backdrop.click();
    opener.click();

    expect(window.document.activeElement).toBe(close);
  });

  it("keeps the desktop sidebar interactive across responsive changes", () => {
    const { window, opener, sidebar, header, links, setMobile } = createDocsWindow({
      mobile: false,
    });

    expect(sidebar.inert).toBe(false);
    links[0].focus();
    expect(window.document.activeElement).toBe(links[0]);

    setMobile(true);
    expect(sidebar.inert).toBe(true);
    expect(window.document.activeElement).toBe(opener);

    setMobile(false);
    expect(sidebar.inert).toBe(false);
    expect(header.inert).toBe(false);
    links[1].focus();
    expect(window.document.activeElement).toBe(links[1]);
  });
});
