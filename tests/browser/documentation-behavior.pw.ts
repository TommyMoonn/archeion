import { expect, test } from "@playwright/test";

const topics = [
  {
    route: "customization/appearance",
    heading: "Adjust spacing and motion",
    fragment: "density-motion",
    term: "reduced motion",
  },
  {
    route: "guides/library",
    heading: "What to expect while scrolling",
    fragment: "large-libraries",
    term: "nearby covers",
  },
  {
    route: "guides/settings",
    heading: "Know what follows you across archives",
    fragment: "ownership",
    term: "other open windows",
  },
  {
    route: "guides/dictionaries",
    heading: "Recover an unavailable dictionary",
    fragment: "repair",
    term: "Rebuild index",
  },
  {
    route: "guides/keyboard-shortcuts",
    heading: "Configurable bindings",
    fragment: "customize",
    term: "Save shortcut",
  },
  {
    route: "customization/theme-manager",
    heading: "Preview before committing",
    fragment: "preview",
    term: "Revert",
  },
  {
    route: "reference/archive-storage",
    heading: "Scans, live changes, and derived covers",
    fragment: "scanning",
    term: "first scan",
  },
  {
    route: "reference/about-resources",
    heading: "Identify the installed version and supported platform",
    fragment: "identify",
    term: "local build",
  },
] as const;

for (const javaScriptEnabled of [true, false]) {
  test.describe(`behavior guide navigation with JavaScript ${javaScriptEnabled}`, () => {
    test.use({ javaScriptEnabled });
    test("native links reach motion, preview, and canonical format guidance", async ({ page }) => {
      await page.goto("/docs/documentation/", { waitUntil: "load" });
      await page
        .locator("[data-doc-article]")
        .getByRole("link", { name: "Appearance", exact: true })
        .press("Enter");
      await page
        .getByRole("link", { name: "Link to section: Adjust spacing and motion", exact: true })
        .press("Enter");
      await expect(page).toHaveURL(/appearance\/#density-motion$/);
      await expect(page.locator("[data-doc-article]")).toContainText(
        "operating system is not requesting reduced motion",
      );
      await page
        .locator("[data-doc-article]")
        .getByRole("link", { name: "Theme Manager", exact: true })
        .press("Enter");
      await page
        .getByRole("link", { name: "Link to section: Preview before committing", exact: true })
        .press("Enter");
      await expect(page).toHaveURL(/theme-manager\/#preview$/);
      await page
        .locator("[data-doc-article]")
        .getByRole("link", { name: "Custom themes", exact: true })
        .press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Custom themes");
      await expect(page.locator("[data-doc-article] table")).toHaveCount(3);
      if (!javaScriptEnabled)
        await expect(page.getByRole("button", { name: "Copy page" })).toHaveCount(0);
    });
  });
}

test("new behavior sections copy readable Markdown with canonical links", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const topic of topics.filter((topic) =>
    ["density-motion", "repair", "scanning"].includes(topic.fragment),
  )) {
    await page.goto(`/docs/documentation/${topic.route}/`, { waitUntil: "load" });
    const copy = page.getByRole("button", { name: "Copy page", exact: true });
    await copy.focus();
    await copy.press("Enter");
    await expect(page.locator("[data-doc-copy-status]")).toHaveText("Page copied as Markdown.");
    await expect(copy).toBeFocused();
    const markdown = (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    );
    expect(markdown).toContain(`## ${topic.heading}`);
    expect(markdown).toContain(topic.term);
    expect(markdown).not.toMatch(/On this page|Edit this page|Copy page/);
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`behavior articles reflow at ${width}px in ${colorScheme}, including doubled text`, async ({
      page,
    }) => {
      test.slow();
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      for (const topic of topics) {
        await page.goto(`/docs/documentation/${topic.route}/`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const title = page.getByRole("heading", { level: 1 });
        const originalSize = await title.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        );
        for (const doubled of [false, true]) {
          if (doubled) {
            await page.evaluate(() => {
              const elements = [
                ...document.querySelectorAll<HTMLElement>(
                  ".doc-article, .doc-article h1, .doc-article h2, .doc-article h3, .doc-article p, .doc-article li, .copy-page-button",
                ),
              ];
              const sizes = elements.map((element) =>
                parseFloat(getComputedStyle(element).fontSize),
              );
              elements.forEach((element, index) => {
                element.style.fontSize = `${sizes[index] * 2}px`;
              });
            });
            await expect(title).toHaveCSS("font-size", `${originalSize * 2}px`);
          }
          await page
            .getByRole("heading", { name: topic.heading, exact: true })
            .scrollIntoViewIfNeeded();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(page.locator("[data-doc-article]")).toContainText(topic.term);
          await page.screenshot({
            path: test.info().outputPath(`${topic.fragment}-${doubled ? "doubled" : "normal"}.png`),
          });
        }
      }
    });
  }
}
