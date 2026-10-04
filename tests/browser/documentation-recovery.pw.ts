import { expect, test } from "@playwright/test";

const topics = [
  {
    route: "guides/archive-health",
    title: "Archive health",
    type: "guide",
    query: "duplicates",
    group: "Using Archeion",
    heading: "Compare duplicate groups before changing files",
    fragment: "duplicates",
  },
  {
    route: "reference/archive-storage",
    title: "Archive storage, ownership, and maintenance",
    type: "reference",
    query: "recovery copies",
    group: "Reference",
    heading: "Active-archive maintenance",
    fragment: "maintenance",
  },
  {
    route: "reference/troubleshooting",
    title: "Troubleshooting and recovery",
    type: "troubleshooting",
    query: "interrupted edit",
    group: "Reference",
    heading: "A metadata or cover edit fails",
    fragment: "interrupted-edit",
  },
  {
    route: "reference/annotation-export",
    title: "Annotation export",
    type: "reference",
    query: "versioned json",
    group: "Reference",
    heading: "JSON schema and example",
    fragment: "json-contract",
  },
] as const;

for (const javaScriptEnabled of [true, false]) {
  test.describe(`recovery references with JavaScript ${javaScriptEnabled ? "on" : "off"}`, () => {
    test.use({ javaScriptEnabled });
    for (const topic of topics) {
      test(`overview and section links reach ${topic.route} by keyboard`, async ({ page }) => {
        await page.goto("/docs/documentation/", { waitUntil: "load" });
        const overview = page.locator("[data-doc-article]");
        const title = topic.route === "reference/archive-storage" ? "Archive storage" : topic.title;
        await overview.getByRole("link", { name: title, exact: true }).press("Enter");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(topic.title);
        await expect(page.locator("[data-doc-article]")).toHaveAttribute(
          "data-page-type",
          topic.type,
        );
        await expect(page.locator('[data-sidebar] [aria-current="page"]')).toHaveText(title);
        await page
          .getByRole("link", { name: `Link to section: ${topic.heading}`, exact: true })
          .press("Enter");
        await expect(page).toHaveURL(new RegExp(`${topic.route}/#${topic.fragment}$`));
        await expect(page.getByRole("link", { name: "Edit this page" })).toHaveAttribute(
          "href",
          new RegExp(`${topic.route}/index.html$`),
        );
        if (!javaScriptEnabled)
          await expect(page.getByRole("button", { name: "Copy page" })).toHaveCount(0);
      });
    }
    test("native pagers traverse storage, recovery, and export references", async ({ page }) => {
      await page.goto("/docs/documentation/reference/archive-storage/", { waitUntil: "load" });
      for (const title of [
        "Troubleshooting and recovery",
        "Annotation export",
        "About and resources",
      ]) {
        await page
          .getByRole("navigation", { name: "Documentation pages", exact: true })
          .getByRole("link", { name: `Next ${title}`, exact: true })
          .press("Enter");
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          title === "About and resources" ? "About Archeion" : title,
        );
      }
    });
  });
}

test("generated search and native clipboard expose usable reference content", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const topic of topics) {
    await page.goto("/docs/documentation/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Search documentation", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    await dialog.getByRole("searchbox").fill(topic.query);
    const title = topic.route === "reference/archive-storage" ? "Archive storage" : topic.title;
    await dialog.getByRole("link", { name: `${title} ${topic.group}`, exact: true }).press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(topic.title);
    const copy = page.getByRole("button", { name: "Copy page", exact: true });
    await copy.focus();
    await copy.press("Enter");
    await expect(page.locator("[data-doc-copy-status]")).toHaveText("Page copied as Markdown.");
    await expect(copy).toBeFocused();
    const markdown = (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    );
    expect(markdown).toMatch(new RegExp(`^# ${topic.title}\\n`));
    expect(markdown).toContain(`## ${topic.heading}`);
    expect(markdown).not.toMatch(
      /Copy page|On this page|Edit this page|Report a documentation issue/,
    );
    if (topic.type === "troubleshooting") {
      expect(markdown).toContain("Do not delete or rewrite live");
      expect(markdown).toContain("reported backup path");
    }
    if (topic.route === "reference/annotation-export") {
      const code = markdown.match(/```json\n([\s\S]*?)\n```/)![1];
      expect(JSON.parse(code)).toMatchObject({ schema: "archeion.annotation-export", version: 1 });
      expect(markdown).toContain("<http://127.0.0.1:4173/docs/ANNOTATION_EXPORT_FORMAT.md>");
      await page.getByRole("button", { name: "Copy code", exact: true }).press("Enter");
      await expect(page.locator("[data-doc-copy-status]")).toHaveText("Code copied.");
      expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(
        JSON.parse(code),
      );
    }
  }
});

for (const appearance of ["light", "dark"] as const) {
  test(`recovery content reflows with normal and doubled text in ${appearance}`, async ({
    page,
  }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const topic of topics) {
        await page.goto(`/docs/documentation/${topic.route}/`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const slug = topic.route.split("/").at(-1)!;
        const title = page.getByRole("heading", { level: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: test.info().outputPath(`${slug}-${width}-normal.png`) });
        const original = await title.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        );
        await page.evaluate(() => {
          const elements = [
            ...document.querySelectorAll<HTMLElement>(
              ".doc-article, .doc-article h1, .doc-article h2, .doc-article h3, .doc-article p, .doc-article li, .doc-article code, .copy-page-button",
            ),
          ];
          const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
          elements.forEach((element, index) => {
            element.style.fontSize = `${sizes[index] * 2}px`;
          });
        });
        await expect(title).toHaveCSS("font-size", `${original * 2}px`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: test.info().outputPath(`${slug}-${width}-doubled.png`) });
        await page
          .getByRole("heading", { name: topic.heading, exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`${slug}-${width}-body.png`) });
        const article = page.locator("[data-doc-article]");
        expect(
          await article.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
    }
  });
}
