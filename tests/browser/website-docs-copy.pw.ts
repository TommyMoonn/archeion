import { expect, test } from "@playwright/test";
import { documents } from "../documentationMdxTestSupport";

test("copy feedback expires after the latest completion without stealing focus", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } }),
  );
  await page.goto("/archeion/docs/");
  await page.clock.install();
  const copy = page.getByRole("button", { name: "Copy page", exact: true });
  const status = page.locator("main [role=status]");
  await copy.click();
  await expect(status).toHaveText("Page copied as Markdown.");
  await page.clock.fastForward(5000);
  await copy.click();
  await page.clock.fastForward(1500);
  await expect(status).toHaveText("Page copied as Markdown.");
  const search = page.getByRole("button", { name: "Search documentation", exact: true });
  await search.focus();
  await page.clock.fastForward(4500);
  await expect(status).toBeEmpty();
  await expect(search).toBeFocused();
  await copy.click();
  await page.getByRole("button", { name: "Dismiss copy status" }).focus();
  await page.clock.fastForward(6000);
  await expect(status).toBeEmpty();
  await expect(copy).toBeFocused();
});

test("all 24 MDX articles export their title and content without generated chrome", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.markdown = text;
        },
      },
    }),
  );
  for (const doc of documents) {
    await page.goto(`/archeion/docs${doc.metadata.slug}`);
    await page.getByRole("button", { name: "Copy page", exact: true }).click();
    await expect(page.locator("main [role=status]")).toHaveText("Page copied as Markdown.");
    const text = await page.evaluate(() => document.documentElement.dataset.markdown);
    expect(text).toMatch(/^# .+\n\n/);
    expect(text).toContain(doc.metadata.title);
    expect(text?.length).toBeGreaterThan(500);
    expect(text).not.toMatch(
      /Copy page|Copy code|On this page|Edit this page|Report a documentation issue|Link to /,
    );
    if (doc.metadata.id === "overview") {
      expect(text?.match(/^- \[/gm)).toHaveLength(23);
    }
  }
});

test("portable Markdown preserves supported nested structures, escaping, safe links and exact fenced code", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.markdown = text;
        },
      },
    }),
  );
  await page.goto("/archeion/docs/customization/custom-themes/");
  await page.locator("article .text-docs-body").evaluate((body) => {
    body.innerHTML = `<h2 id="start">Start <code>here</code><a data-copy-exclude>permalink poison</a></h2>
      <p>Use <strong>Library </strong>now<em> carefully</em> and <a href="../../guides/library/#books">your books</a>.<br>Keep reading.</p>
      <aside role="note"><strong>Local files</strong><p>Keep a backup.</p></aside>
      <blockquote><p>Quoted advice.</p></blockquote>
      <ol start="3"><li>Third<ul><li>Nested <em>detail</em></li><li>More<ol><li>Inner</li></ol></li></ul><p>Continue this item.</p></li><li value="7">Seventh</li><li>Eighth</li></ol>
      <table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td><code>A|B</code></td><td><strong>Bold</strong><br>Two lines</td></tr></tbody></table>
      <pre><code class="language-text">\`\`\`\n  keep spaces\n\n</code><button>Copy code</button></pre>
      <p>*literal* [label] &lt;tag&gt; <code>\`tick\`</code></p><p>1) Literal marker</p><p>- Not a list</p>
      <p><a href="javascript:alert(1)">unsafe label</a> <a href="http://[bad">invalid label</a></p>
      <details><summary>Details</summary><p>Disclosed prose <kbd>Enter</kbd>.</p></details>
      <p hidden>hidden poison</p><span aria-hidden="true">decorative poison</span><span class="sr-only">helper poison</span><nav>nav poison</nav><footer>footer poison</footer>`;
  });
  await page.getByRole("button", { name: "Copy page", exact: true }).click();
  const markdown = await page.evaluate(() => document.documentElement.dataset.markdown);
  expect(markdown).toContain("## Start `here`");
  expect(markdown).toContain(
    `Use **Library** now *carefully* and [your books](<${baseURL}/archeion/docs/guides/library/#books>).  \nKeep reading.`,
  );
  expect(markdown).toContain("> **Local files**\n>\n> Keep a backup.");
  expect(markdown).toContain("> Quoted advice.");
  expect(markdown).toContain(
    "3. Third\n\n   - Nested *detail*\n   - More\n\n     1. Inner\n\n   Continue this item.\n7. Seventh\n8. Eighth",
  );
  expect(markdown).toContain("| Key | Value |\n| --- | --- |\n| `A\\|B` | **Bold**<br>Two lines |");
  expect(markdown).toContain("````text\n```\n  keep spaces\n\n````");
  expect(markdown).toContain("\\*literal\\* \\[label\\] \\<tag\\> `` `tick` ``");
  expect(markdown).toContain("1\\) Literal marker\n\n\\- Not a list");
  expect(markdown).toContain("unsafe label invalid label");
  expect(markdown).toContain("Details\n\nDisclosed prose Enter.");
  expect(markdown).not.toMatch(/poison|javascript:|http:\/\/\[bad/);
});

test("page and code requests share newest ownership, dismiss invalidation and route disposal", async ({
  page,
}) => {
  await page.goto("/archeion/docs/customization/custom-themes/");
  await page.evaluate(() => {
    let count = 0;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          ++count === 1
            ? new Promise<void>((_resolve, reject) =>
                document.addEventListener("fail-page", () => reject(new Error("late")), {
                  once: true,
                }),
              )
            : Promise.resolve(),
      },
    });
  });
  const copyPage = page.getByRole("button", { name: "Copy page", exact: true });
  const copyCode = page.getByRole("button", { name: "Copy code", exact: true }).first();
  const status = page.locator("main [role=status]");
  await copyPage.click();
  await expect(status).toHaveText("Copying page…");
  await copyCode.click();
  await expect(status).toHaveText("Code copied.");
  await page.evaluate(() => document.dispatchEvent(new Event("fail-page")));
  await expect(status).toHaveText("Code copied.");
  await expect(status).toHaveCount(1);
  await page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      new Promise<void>((resolve) =>
        document.addEventListener("finish-page", () => resolve(), { once: true }),
      );
  });
  await copyPage.click();
  await page.getByRole("button", { name: "Dismiss copy status" }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("finish-page")));
  await expect(status).toBeEmpty();
  await expect(copyPage).toBeFocused();
  await copyPage.click();
  await page
    .getByRole("navigation", { name: "Documentation pages" })
    .getByRole("link", { name: "Next Theme Manager" })
    .click();
  await page.evaluate(() => document.dispatchEvent(new Event("finish-page")));
  await expect(status).toBeEmpty();
});

test("keyboard copy writes article Markdown and code through the shared status", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/archeion/docs/customization/custom-themes/", { waitUntil: "load" });
  const copy = page.getByRole("button", { name: "Copy page", exact: true });
  const status = page.locator("main [role=status]");
  await expect(status).toBeEmpty();
  await copy.focus();
  await copy.press("Enter");
  await expect(status).toHaveText("Page copied as Markdown.");
  await expect(copy).toBeFocused();
  await expect(copy).toHaveAccessibleName("Copy page");
  // Windows native text clipboards normalize line endings to CRLF.
  const markdown = (await page.evaluate(() => navigator.clipboard.readText())).replace(
    /\r\n/g,
    "\n",
  );
  expect(markdown).toMatch(/^# Custom themes\n/);
  expect(markdown).toContain("```json\n");
  expect(markdown).toContain("| Field | Required | Value |");
  expect(markdown).not.toMatch(
    /Copy page|Copy code|On this page|Edit this page|Report a documentation issue/,
  );
  expect(markdown).toContain(
    "[Open the theme schema](<https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json>)",
  );
  const code = page.locator("pre code").first();
  const codeButton = page.getByRole("button", { name: "Copy code", exact: true }).first();
  await codeButton.focus();
  await codeButton.press("Space");
  await expect(status).toHaveText("Code copied.");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    await code.textContent(),
  );
  await expect(codeButton).toBeFocused();
  await expect(codeButton).toHaveAccessibleName("Copy code");
  await expect(page.locator("main [role=status]")).toHaveCount(1);
  const dismiss = page.getByRole("button", { name: "Dismiss copy status" });
  await dismiss.focus();
  await dismiss.press("Enter");
  await expect(status).toBeEmpty();
  await expect(codeButton).toBeFocused();
});

test("clipboard denial preserves action identity and focus, then retry succeeds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let deny = true;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          if (deny) {
            deny = false;
            throw new Error("Clipboard denied");
          }
        },
      },
    });
  });
  await page.goto("/archeion/docs/", { waitUntil: "load" });
  const copy = page.getByRole("button", { name: "Copy page", exact: true });
  await copy.focus();
  await copy.press("Enter");
  const status = page.locator("main [role=status]");
  await expect(status).toHaveText("Could not copy page. Try Copy page again.");
  await expect(copy).toHaveAccessibleName("Copy page");
  await expect(copy).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("copy-failure.png") });
  await copy.press("Space");
  await expect(status).toHaveText("Page copied as Markdown.");
  await expect(copy).toBeFocused();
});

for (const appearance of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`copy action and feedback reflow in ${appearance} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async () => {} },
        }),
      );
      await page.goto("/archeion/docs/reference/about-resources/", {
        waitUntil: "load",
      });
      const copy = page.getByRole("button", { name: "Copy page", exact: true });
      await copy.focus();
      await copy.press("Enter");
      await expect(page.locator("main [role=status]")).toHaveText("Page copied as Markdown.");
      const target = await copy.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(40);
      expect(target!.height).toBeGreaterThanOrEqual(30);
      expect(target!.x + target!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(copy).toHaveCSS("outline-style", "solid");
      await page.screenshot({ path: test.info().outputPath("copy-success.png") });
      // Text resizing must wrap the title/action instead of clipping either.
      const originalTitleSize = await page
        .locator("article h1")
        .evaluate((title) => parseFloat(getComputedStyle(title).fontSize));
      await page.evaluate(() => {
        const elements = [
          ...document.querySelectorAll<HTMLElement>(
            "article, article h1, article h2, article h3, article p, article li, article button, main [role=status]",
          ),
        ];
        const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
        elements.forEach((element, index) => {
          element.style.fontSize = `${sizes[index] * 2}px`;
        });
      });
      await expect(copy).toHaveCSS("font-size", "28px");
      await expect(page.locator("article h1")).toHaveCSS("font-size", `${originalTitleSize * 2}px`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(copy).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("copy-200-percent-text.png") });
    });
  }
}

test("touch targets and forced-colors focus remain visible", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 900 },
    forcedColors: "active",
  });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/archeion/docs/customization/custom-themes/`, {
      waitUntil: "load",
    });
    const copy = page.getByRole("button", { name: "Copy page", exact: true });
    await page.keyboard.press("Tab");
    await copy.focus();
    await expect(copy).toHaveCSS("outline-style", "solid");
    await expect(copy).toHaveCSS("outline-width", "2px");
    for (const button of [
      copy,
      page.getByRole("button", { name: "Copy code", exact: true }).first(),
    ]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath("copy-touch-forced-colors.png") });
  } finally {
    await context.close();
  }
});

test.describe("copy is a progressive enhancement", () => {
  test.use({ javaScriptEnabled: false });
  test("does not expose unavailable copy controls or shift the title on hydration", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.skip(
      process.env.ARCHEION_WEBSITE_MODE === "dev",
      "Development serves a client-only HTML entry; no-JavaScript output belongs to the production build.",
    );
    await page.goto("/archeion/docs/customization/custom-themes/", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy (page|code)/ })).toHaveCount(0);
    const context = await browser.newContext({ javaScriptEnabled: true });
    try {
      const hydrated = await context.newPage();
      await hydrated.goto(`${baseURL}/archeion/docs/customization/custom-themes/`);
      await expect(hydrated.getByRole("button", { name: "Copy page", exact: true })).toBeVisible();
      for (const width of [1440, 320]) {
        for (const surface of [page, hydrated]) {
          await surface.setViewportSize({ width, height: 900 });
          await surface.evaluate(async () => {
            await document.fonts.ready;
          });
        }
        const before = await page.locator("article h1").boundingBox();
        const after = await hydrated.locator("article h1").boundingBox();
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
      }
    } finally {
      await context.close();
    }
  });
});
