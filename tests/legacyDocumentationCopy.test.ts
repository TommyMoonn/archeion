import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import registry from "../docs/documentation/page-registry.json";
import {
  installDocumentationCopy,
  serializeArticle,
} from "../docs/documentation/assets/docs-copy.js";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function fixture(content: string) {
  const window = new Window({
    url: "https://example.test/archeion/documentation/guides/reading/",
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
  });
  windows.push(window);
  window.document.body.innerHTML = `<header>Site header</header><main>
    <article data-doc-article><header class="article-header"><h1>Reading</h1>
    <p>Read <em>your</em> books.</p></header>${content}</article>
    <nav>Previous Next</nav><footer>Edit this page Report a documentation issue</footer>
    </main><aside>Outline</aside>`;
  return { window, article: window.document.querySelector("article")! };
}

describe("article Markdown serialization", () => {
  it("preserves the controlled article vocabulary without navigation or generated chrome", () => {
    const { article } =
      fixture(`<details class="mobile-outline"><summary>On this page</summary></details>
      <div class="article-heading"><h2 id="start">Start <code>here</code></h2>
      <a class="heading-permalink" href="#start">#</a></div>
      <p>Use <strong>Library</strong>, <em>then</em> <a href="../library/#books">your books</a>.<br>Keep reading.</p>
      <div class="notice" role="note"><strong>Local files</strong><p>Keep a backup.</p></div>
      <blockquote><p>Quoted advice.</p></blockquote>
      <table><thead><tr><th>Key</th><th>Value</th></tr></thead>
      <tbody><tr><td><code>A|B</code></td><td><strong>Bold</strong><br>Two lines</td></tr></tbody></table>
      <pre><code class="language-json">{\n  "theme": "dark"\n}\n</code><button>Copy code</button></pre>
      <span class="sr-only">Hidden helper</span><p hidden>Hidden content</p>
      <p aria-hidden="true">Decorative content</p><div data-doc-copy-controls>Copy page</div>`);
    expect(serializeArticle(article)).toBe(
      '# Reading\n\nRead *your* books.\n\n## Start `here`\n\nUse **Library**, *then* [your books](<https://example.test/archeion/documentation/guides/library/#books>).  \nKeep reading.\n\n> **Local files**\n>\n> Keep a backup.\n\n> Quoted advice.\n\n| Key | Value |\n| --- | --- |\n| `A\\|B` | **Bold**<br>Two lines |\n\n```json\n{\n  "theme": "dark"\n}\n```\n',
    );
  });

  it("keeps nested lists, ordered starts, item values, and multi-paragraph items", () => {
    const { article } = fixture(`<ol start="3"><li>Third<ul><li>Nested <em>detail</em></li>
      <li>More<ol><li>Inner</li></ol></li></ul><p>Continue this item.</p></li>
      <li value="7">Seventh</li><li>Eighth</li></ol>`);
    expect(serializeArticle(article)).toContain(
      "3. Third\n\n   - Nested *detail*\n   - More\n\n     1. Inner\n\n   Continue this item.\n7. Seventh\n8. Eighth",
    );
  });

  it("escapes authored Markdown syntax and uses safe code delimiters without altering code", () => {
    const { article } = fixture(
      '<p>*literal* [label] &lt;tag&gt; <code>`tick`</code></p><pre><code class="language-text">```\n  keep spaces\n\n</code></pre>',
    );
    expect(serializeArticle(article)).toContain("\\*literal\\* \\[label\\] \\<tag\\> `` `tick` ``");
    expect(serializeArticle(article)).toContain("````text\n```\n  keep spaces\n\n````\n");
  });

  it("does not discard prose inside wrappers or quote/list/table structures", () => {
    const { article } = fixture(
      '<section><h3>Details</h3><p>Read <a href="#start">this section</a>.</p><hr><ul><li>One</li><li>Two</li></ul></section>',
    );
    expect(serializeArticle(article)).toContain(
      "### Details\n\nRead [this section](<https://example.test/archeion/documentation/guides/reading/#start>).\n\n---\n\n- One\n- Two",
    );
  });

  it("preserves word boundaries in inline formatting and literal paragraph markers", () => {
    const { article } = fixture(
      '<p><strong>Save </strong>changes<em> now</em>.</p><p><a href="#start">Read </a>more.</p><p>1) Literal marker</p><p>- Not a list</p>',
    );
    expect(serializeArticle(article)).toContain(
      "**Save** changes *now*.\n\n[Read](<https://example.test/archeion/documentation/guides/reading/#start>) more.\n\n1\\) Literal marker\n\n\\- Not a list",
    );
  });

  it.each(registry.pages)(
    "copies the authored title and body of $id after controls are installed",
    (page) => {
      const { window } = fixture("");
      window.document.write(fs.readFileSync(path.resolve(page.sourcePath), "utf8"));
      const article = window.document.querySelector("[data-doc-article]")!;
      const before = serializeArticle(article);
      installDocumentationCopy(window.document);
      expect(serializeArticle(article)).toBe(before);
      expect(before).toMatch(/^# .+\n\n/);
      expect(before).not.toMatch(
        /Copy page|Copy code|Link to section:|Edit this page|Report a documentation issue|On this page/,
      );
      expect(before.length).toBeGreaterThan(500);
      expect(window.document.querySelectorAll("[data-doc-copy-page]")).toHaveLength(1);
      const module = window.document.querySelector('script[type="module"][src$="docs-copy.js"]');
      expect(module).not.toBeNull();
      expect(window.document.querySelectorAll('script[src$="docs-copy.js"]')).toHaveLength(1);
      expect(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(page.sourcePath), module!.getAttribute("src")!),
        ),
      ).toBe("docs/documentation/assets/docs-copy.js");
    },
  );
});

describe("shared documentation clipboard feedback", () => {
  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("keeps stable controls and one status region through success, failure, and retry without focus movement", async () => {
    const { window, article } = fixture("<pre><code>exact code\n</code></pre>");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    installDocumentationCopy(window.document);
    const pageButton = window.document.querySelector<HTMLButtonElement>("[data-doc-copy-page]")!;
    const codeButton = window.document.querySelector<HTMLButtonElement>(".copy-button")!;
    const status = window.document.querySelector("[data-doc-copy-status]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    pageButton.focus();
    pageButton.click();
    expect(status.textContent).toBe("Copying page…");
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(serializeArticle(article));
    expect(status.textContent).toBe("Page copied as Markdown.");
    expect(pageButton.textContent).toContain("Copy page");
    expect(window.document.activeElement).toBe(pageButton);
    writeText.mockRejectedValueOnce(new Error("Denied"));
    codeButton.focus();
    codeButton.click();
    await flush();
    expect(status.textContent).toBe("Unable to copy code. Allow clipboard access and try again.");
    expect(codeButton.getAttribute("aria-label")).toBe("Copy code");
    expect(window.document.activeElement).toBe(codeButton);
    codeButton.click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("exact code\n");
    expect(status.textContent).toBe("Code copied.");
    expect(window.document.querySelector("[data-doc-copy-status]")).toBe(status);
    expect(window.document.querySelectorAll("[data-doc-copy-status]")).toHaveLength(1);
  });

  it("retains the newest operation's feedback when an older write finishes later", async () => {
    const { window } = fixture("<pre><code>code</code></pre>");
    let finishOld!: () => void;
    const writeText = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error("Denied"));
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText } });
    installDocumentationCopy(window.document);
    window.document.querySelector<HTMLButtonElement>("[data-doc-copy-page]")!.click();
    window.document.querySelector<HTMLButtonElement>(".copy-button")!.click();
    await flush();
    const status = window.document.querySelector("[data-doc-copy-status]")!;
    const latest = status.textContent;
    finishOld();
    await flush();
    expect(status.textContent).toBe(latest);
    expect(latest).toContain("Unable to copy code");
  });

  it("reports unavailable clipboard access and ignores settlements after page disposal", async () => {
    const { window } = fixture("");
    Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });
    installDocumentationCopy(window.document);
    const button = window.document.querySelector<HTMLButtonElement>("[data-doc-copy-page]")!;
    const status = window.document.querySelector("[data-doc-copy-status]")!;
    button.click();
    await flush();
    expect(status.textContent).toContain("Unable to copy page");
    let finish!: () => void;
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      },
    });
    button.click();
    window.dispatchEvent(new window.Event("pagehide"));
    finish();
    await flush();
    expect(status.textContent).toBe("");
  });

  it("dismisses pending feedback, restores its originating control, and permits another copy", async () => {
    const { window } = fixture("<pre><code>example</code></pre>");
    let finish!: () => void;
    const writeText = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText } });
    installDocumentationCopy(window.document);
    installDocumentationCopy(window.document);
    expect(window.document.querySelectorAll(".copy-button")).toHaveLength(1);
    const copy = window.document.querySelector<HTMLButtonElement>(".copy-button")!;
    const status = window.document.querySelector("[data-doc-copy-status]")!;
    const dismiss = window.document.querySelector<HTMLButtonElement>(".doc-copy-dismiss")!;
    copy.click();
    dismiss.focus();
    dismiss.click();
    expect(window.document.activeElement).toBe(copy);
    expect(status.textContent).toBe("");
    expect(dismiss.hidden).toBe(true);
    finish();
    await flush();
    expect(status.textContent).toBe("");
    copy.click();
    await flush();
    expect(status.textContent).toBe("Code copied.");
  });
});
