import { expect, test } from "@playwright/test";

const guides = [
  {
    route: "quick-actions",
    title: "Quick Actions",
    query: "command",
    heading: "Open Quick Actions",
  },
  {
    route: "metadata-covers",
    title: "Metadata and covers",
    query: "embedded cover",
    heading: "Replace the embedded cover",
  },
] as const;

for (const javaScriptEnabled of [true, false]) {
  test.describe(`core workflow navigation (JavaScript ${javaScriptEnabled ? "on" : "off"})`, () => {
    test.use({ javaScriptEnabled });
    test("overview, sidebar, permalinks, and adjacent pagers reach both guides", async ({
      page,
    }) => {
      await page.goto("/docs/documentation/", { waitUntil: "load" });
      await page
        .locator("[data-doc-article]")
        .getByRole("link", { name: "Quick Actions", exact: true })
        .press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quick Actions");
      await expect(page.locator('[data-sidebar] [aria-current="page"]')).toHaveText(
        "Quick Actions",
      );
      const permalink = page.getByRole("link", {
        name: "Link to section: Open Quick Actions",
        exact: true,
      });
      await permalink.focus();
      await permalink.press("Enter");
      await expect(page).toHaveURL(/quick-actions\/#open$/);
      await page.locator('.article-pager a[rel="next"]').press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Metadata and covers");
      await expect(page.locator('[data-sidebar] [aria-current="page"]')).toHaveText(
        "Metadata and covers",
      );
      await expect(page.locator('.article-pager a[rel="prev"]')).toHaveAttribute(
        "href",
        "../quick-actions/",
      );
      await expect(page.locator('.article-pager a[rel="next"]')).toHaveAttribute(
        "href",
        "../series/",
      );
      await expect(page.getByRole("link", { name: "Edit this page" })).toHaveAttribute(
        "href",
        /guides\/metadata-covers\/index\.html$/,
      );
      if (!javaScriptEnabled)
        await expect(page.getByRole("button", { name: "Copy page" })).toHaveCount(0);
    });
  });
}

test("generated search discovers workflow descriptions and both guides copy portable Markdown", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const guide of guides) {
    await page.goto("/docs/documentation/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Search documentation", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    await dialog.getByRole("searchbox").fill(guide.query);
    await dialog
      .getByRole("link", { name: `${guide.title} Using Archeion`, exact: true })
      .press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);
    const copy = page.getByRole("button", { name: "Copy page", exact: true });
    await copy.focus();
    await copy.press("Enter");
    await expect(page.locator("[data-doc-copy-status]")).toHaveText("Page copied as Markdown.");
    await expect(copy).toBeFocused();
    const markdown = (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    );
    expect(markdown).toMatch(new RegExp(`^# ${guide.title}\\n`));
    expect(markdown).toContain(`## ${guide.heading}`);
    expect(markdown).toContain("<http://127.0.0.1:4173/docs/documentation/");
    expect(markdown).not.toMatch(
      /Copy page|On this page|Edit this page|Report a documentation issue/,
    );
  }
});

for (const appearance of ["light", "dark"] as const) {
  test(`workflow articles reflow with normal and doubled text in ${appearance}`, async ({
    page,
  }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const guide of guides) {
        await page.goto(`/docs/documentation/guides/${guide.route}/`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const title = page.getByRole("heading", { level: 1 });
        await expect(title).toHaveText(guide.title);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: test.info().outputPath(`${guide.route}-${width}-normal.png`),
        });
        const originalSize = await title.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        );
        await page.evaluate(() => {
          const elements = [
            ...document.querySelectorAll<HTMLElement>(
              ".doc-article, .doc-article h1, .doc-article h2, .doc-article p, .doc-article li, .copy-page-button",
            ),
          ];
          const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
          elements.forEach((element, index) => {
            element.style.fontSize = `${sizes[index] * 2}px`;
          });
        });
        await expect(title).toHaveCSS("font-size", `${originalSize * 2}px`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: test.info().outputPath(`${guide.route}-${width}-doubled.png`),
        });
        await page
          .getByRole("heading", { name: guide.heading, exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`${guide.route}-${width}-body.png`) });
      }
    }
  });
}
