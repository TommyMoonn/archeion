import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

const docsScript = fs.readFileSync(
  path.join(process.cwd(), "docs/documentation/assets/docs.js"),
  "utf8",
);

function createDocsSearchWindow(
  indexScript = `window.ArcheionDocumentationIndex = {entries: [
  {title: "Library", pageHeading: "Library", route: "/library/", sectionId: "", sectionHeading: "", text: "manage books", aliases: [], groupTitle: "Documentation"},
  {title: "Reader and annotations", pageHeading: "Reader and annotations", route: "/reader/", sectionId: "", sectionHeading: "", text: "read books notes", aliases: [], groupTitle: "Documentation"},
  {title: "Archive storage", pageHeading: "Archive storage", route: "/storage/", sectionId: "", sectionHeading: "", text: "backup archive", aliases: [], groupTitle: "Documentation"}
]};`,
  assetURL = "/documentation/assets/docs-search-index.js",
) {
  const window = new Window({ url: "https://archeion.test/documentation/" });
  windows.push(window);

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
    <script data-doc-search-index src="${assetURL}"></script>
    <button type="button" data-search-trigger>Search documentation</button>
    <dialog data-search-dialog>
      <button type="button" data-search-close>Close search</button>
      <label>
        <span>Search documentation content</span>
        <input type="search" data-search-input />
      </label>
      <nav data-search-results aria-label="Documentation search results"></nav>
      <p data-search-empty hidden>No matching results.</p>
    </dialog>
    <aside data-sidebar>
      <a href="/library/" data-doc-link data-search="manage books">Library</a>
      <a href="/reader/" data-doc-link data-search="read books notes">Reader and annotations</a>
      <a href="/storage/" data-doc-link data-search="backup archive">Archive storage</a>
    </aside>
  `;

  window.eval(indexScript);
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
    expect(status?.textContent).toBe("1 result found.");

    search(window, input, "books");
    expect(status?.textContent).toBe("2 results found.");
  });

  it("announces zero matches and keeps the result list outside the live region", async () => {
    const { window, trigger, dialog, input, results, empty } = createDocsSearchWindow();
    await openSearch(window, trigger);
    const status = dialog.querySelector<HTMLElement>('[role="status"]');

    search(window, input, "missing-query");

    expect(status?.textContent).toBe("No matching results.");
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
    expect(status?.textContent).toBe("1 result found.");

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

  it("ranks title, heading, alias, and body matches with canonical-order ties", async () => {
    const entries = [
      { title: "A", sectionId: "body-first", sectionHeading: "Body first", text: "palette" },
      { title: "B", sectionId: "body-second", sectionHeading: "Body second", text: "palette" },
      { title: "C", sectionId: "alias", sectionHeading: "Alias", aliases: ["palette"] },
      { title: "D", sectionId: "heading", sectionHeading: "Palette heading" },
      { title: "Palette title", sectionId: "", sectionHeading: "" },
    ].map((entry) => ({
      pageHeading: "",
      text: "",
      aliases: [],
      groupTitle: "Reference",
      route: "/guide/",
      ...entry,
    }));
    const { window, trigger, input, results } = createDocsSearchWindow(
      `window.ArcheionDocumentationIndex = ${JSON.stringify({ entries })};`,
    );
    await openSearch(window, trigger);
    search(window, input, "  PALETTE  ");
    expect([...results.querySelectorAll("strong")].map((title) => title.textContent)).toEqual([
      "Palette title",
      "Palette heading",
      "Alias",
      "Body first",
      "Body second",
    ]);
    expect([...results.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://archeion.test/documentation/guide/",
      "https://archeion.test/documentation/guide/#heading",
      "https://archeion.test/documentation/guide/#alias",
      "https://archeion.test/documentation/guide/#body-first",
      "https://archeion.test/documentation/guide/#body-second",
    ]);
    search(window, input, "");
    expect(results.children).toHaveLength(1);
  });

  it("finds an actual body-only term at its owning section, not sidebar metadata", async () => {
    const index = fs.readFileSync("docs/documentation/assets/docs-search-index.js", "utf8");
    const { window, trigger, input, results } = createDocsSearchWindow(index);
    await openSearch(window, trigger);
    search(window, input, "matching digest");
    expect(results.children).toHaveLength(1);
    const link = results.querySelector("a")!;
    expect(link.href).toBe("https://archeion.test/documentation/guides/archive-health/#duplicates");
    expect(link.textContent).toContain("Compare duplicate groups before changing files");
    expect(link.textContent).toContain("Archive health");
    expect(window.document.activeElement).toBe(input);
  });

  it("resolves nested routes under a deployment prefix and renders authored text safely", async () => {
    const index = `window.ArcheionDocumentationIndex = ${JSON.stringify({ entries: [{ title: "Example <img src=x>", pageHeading: "Example", sectionHeading: "Nested <script> section", sectionId: "nested", route: "/reference/example/", text: "safe needle", aliases: [], groupTitle: "Reference" }] })};`;
    const { window, trigger, input, results } = createDocsSearchWindow(
      index,
      "/archeion/documentation/assets/docs-search-index.js",
    );
    await openSearch(window, trigger);
    search(window, input, "needle");
    expect(results.querySelector("a")?.href).toBe(
      "https://archeion.test/archeion/documentation/reference/example/#nested",
    );
    expect(results.querySelector("strong")?.textContent).toBe("Nested <script> section");
    expect(results.querySelector("img, script")).toBeNull();
  });
});
