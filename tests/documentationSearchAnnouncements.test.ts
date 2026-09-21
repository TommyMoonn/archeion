import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const docsScript = fs.readFileSync(
  path.join(process.cwd(), "docs/documentation/assets/docs.js"),
  "utf8",
);

function createDocsSearchWindow() {
  const window = new Window({ url: "https://archeion.test/documentation/" });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });

  window.document.body.innerHTML = `
    <button type="button" data-search-trigger>Search documentation</button>
    <dialog data-search-dialog>
      <button type="button" data-search-close>Close search</button>
      <label>
        <span>Search documentation pages</span>
        <input type="search" data-search-input />
      </label>
      <nav data-search-results aria-label="Documentation search results"></nav>
      <p data-search-empty hidden>No matching pages.</p>
    </dialog>
    <aside data-sidebar>
      <a href="/library/" data-doc-link data-search="manage books">Library</a>
      <a href="/reader/" data-doc-link data-search="read books notes">Reader and annotations</a>
      <a href="/storage/" data-doc-link data-search="backup archive">Archive storage</a>
    </aside>
  `;

  window.eval(docsScript);

  const trigger = window.document.querySelector<HTMLButtonElement>("[data-search-trigger]");
  const dialog = window.document.querySelector<HTMLDialogElement>("[data-search-dialog]");
  const input = window.document.querySelector<HTMLInputElement>("[data-search-input]");
  const results = window.document.querySelector<HTMLElement>("[data-search-results]");
  const empty = window.document.querySelector<HTMLElement>("[data-search-empty]");

  if (!trigger || !dialog || !input || !results || !empty) {
    throw new Error("Documentation search fixture did not initialize correctly.");
  }

  return { window, trigger, dialog, input, results, empty };
}

async function openSearch(window: Window, trigger: HTMLButtonElement) {
  trigger.click();
  await window.happyDOM.waitUntilComplete();
}

function search(window: Window, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("documentation search result announcements", () => {
  it("exposes one stable polite status node when search opens", async () => {
    const { window, trigger, dialog } = createDocsSearchWindow();

    await openSearch(window, trigger);

    const status = dialog.querySelector<HTMLElement>('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.classList.contains("sr-only")).toBe(true);
    expect(status?.textContent).toBe("");

    search(window, dialog.querySelector<HTMLInputElement>("[data-search-input]")!, "reader");
    expect(dialog.querySelector('[role="status"]')).toBe(status);
  });

  it("announces concise singular and plural result counts", async () => {
    const { window, trigger, dialog, input } = createDocsSearchWindow();
    await openSearch(window, trigger);
    const status = dialog.querySelector<HTMLElement>('[role="status"]');

    search(window, input, "reader");
    expect(status?.textContent).toBe("1 page found.");

    search(window, input, "books");
    expect(status?.textContent).toBe("2 pages found.");
  });

  it("announces zero matches and keeps the result list outside the live region", async () => {
    const { window, trigger, dialog, input, results, empty } = createDocsSearchWindow();
    await openSearch(window, trigger);
    const status = dialog.querySelector<HTMLElement>('[role="status"]');

    search(window, input, "missing-query");

    expect(status?.textContent).toBe("No matching pages.");
    expect(empty.hidden).toBe(false);
    expect(results.children).toHaveLength(0);
    expect(status?.contains(results)).toBe(false);
    expect(results.closest('[role="status"]')).toBeNull();
  });

  it("clears the announcement when the query is cleared", async () => {
    const { window, trigger, dialog, input, results } = createDocsSearchWindow();
    await openSearch(window, trigger);
    const status = dialog.querySelector<HTMLElement>('[role="status"]');

    search(window, input, "reader");
    expect(status?.textContent).toBe("1 page found.");

    search(window, input, "");
    expect(status?.textContent).toBe("");
    expect(results.children).toHaveLength(3);
  });

  it("keeps keyboard focus in the search input while result status changes", async () => {
    const { window, trigger, input } = createDocsSearchWindow();

    await openSearch(window, trigger);
    expect(window.document.activeElement).toBe(input);

    search(window, input, "books");
    expect(window.document.activeElement).toBe(input);

    search(window, input, "missing-query");
    expect(window.document.activeElement).toBe(input);
  });
});
