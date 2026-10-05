import { expect, test } from "@playwright/test";
import changelog from "../../docs/documentation/assets/docs-changelog-data.json" with { type: "json" };

test("release history remains useful without JavaScript or decorative styling", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.route("**/docs.css", (route) => route.abort());
    await page.goto("/docs/documentation/changelog/", { waitUntil: "load" });
    const releases = page.getByRole("list", { name: "Releases, newest first", exact: true });
    await expect(releases.locator(":scope > li")).toHaveCount(changelog.entries.length);
    await expect(releases.getByRole("heading", { level: 2 })).toHaveText(
      changelog.entries.map((entry) => `v${entry.version}`),
    );
    await expect(releases.locator("time").first()).toHaveAttribute(
      "datetime",
      changelog.entries[0].date,
    );
    await expect(releases.locator("time").first()).toBeVisible();
    await expect(releases.locator("ul").first()).toBeVisible();
    await page.getByRole("link", { name: "Link to section: v1.5.4", exact: true }).press("Enter");
    await expect(page).toHaveURL(/changelog\/#release-1-5-4$/);
    await page.screenshot({ path: test.info().outputPath("timeline-no-css-no-js.png") });
  } finally {
    await context.close();
  }
});

test("header, sidebar, pager, outline and section search reach the canonical history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/docs/documentation/guides/reading/", { waitUntil: "load" });
  const utility = page
    .getByRole("banner")
    .getByRole("link", { name: "Release notes", exact: true });
  await utility.focus();
  await utility.press("Enter");
  await expect(page).toHaveURL(/\/documentation\/changelog\/$/);
  await expect(page.locator('[data-doc-navigation] [aria-current="page"]')).toHaveText("Changelog");
  await expect(page.locator('.article-pager [rel="prev"]')).toHaveAttribute(
    "href",
    "../reference/about-resources/",
  );
  await expect(page.locator('.article-pager [rel="next"]')).toHaveCount(0);
  await expect(page.locator("[data-toc] a").first()).toHaveText(`v${changelog.entries[0].version}`);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  await dialog.getByRole("searchbox").fill("common English inflections");
  const result = dialog.locator('a[href$="/changelog/#release-1-3-0"]');
  await expect(result).toHaveCount(1);
  await result.press("Enter");
  await expect(page).toHaveURL(/changelog\/#release-1-3-0$/);
  await expect(page.locator("#release-1-3-0")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("Copy page retains versions, dates and canonical change formatting", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/documentation/changelog/", { waitUntil: "load" });
  await page.getByRole("button", { name: "Copy page", exact: true }).press("Enter");
  await expect(page.locator("[data-doc-copy-status]")).toHaveText("Page copied as Markdown.");
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  expect(markdown).toContain("## v1.5.4");
  expect(markdown).toContain("September 25, 2026");
  expect(markdown).toContain("**Narrow**");
  expect(markdown).toContain("`Ctrl+F`");
  expect(markdown).not.toMatch(/On this page|Release-note authoring/);
});

for (const appearance of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`${appearance} timeline reflows at ${width}px and keeps text and focus legible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
      await page.goto("/docs/documentation/changelog/", { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Release notes", exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const first = page.locator(".changelog-entry").first();
      await expect(first.locator("h2")).toBeVisible();
      await expect(first.locator("time")).toBeVisible();
      const colors = await first.evaluate((entry) => {
        const computed = (selector: string) => getComputedStyle(entry.querySelector(selector)!);
        return {
          text: computed("li").color,
          muted: computed("time").color,
          link: computed(".release-notes-link").color,
          background: getComputedStyle(document.body).backgroundColor,
        };
      });
      await test.info().attach("contrast-colors", {
        body: JSON.stringify(colors),
        contentType: "application/json",
      });
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      for (const color of [colors.text, colors.muted, colors.link]) {
        const [low, high] = [luminance(color), luminance(colors.background)].sort((a, b) => a - b);
        expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({
        path: test.info().outputPath(`timeline-${appearance}-${width}.png`),
      });
      await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document.querySelector("[data-doc-article]")!,
          NodeFilter.SHOW_TEXT,
        );
        let node;
        while ((node = walker.nextNode())) {
          if (
            !node.parentElement?.closest("button, .heading-permalink") &&
            node.textContent?.trim()
          )
            node.textContent += ` ${node.textContent}`;
        }
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const permalink = page.getByRole("link", { name: "Link to section: v1.5.4", exact: true });
      await permalink.focus();
      await expect(permalink).toBeFocused();
      await expect(permalink).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: test.info().outputPath(`timeline-doubled-${appearance}-${width}.png`),
      });
      await page.emulateMedia({ forcedColors: "active" });
      await page.screenshot({
        path: test.info().outputPath(`timeline-forced-${appearance}-${width}.png`),
      });
      expect(
        await permalink.evaluate((element) => getComputedStyle(element).outlineStyle),
      ).not.toBe("none");
    });
  }
}

test("timeline metadata and header remain reachable with coarse input, RTL and a short viewport", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 320, height: 360 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/docs/documentation/changelog/", { waitUntil: "load" });
    await page.evaluate(() => document.querySelector(".doc-article")!.setAttribute("dir", "rtl"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const utility = page
      .getByRole("banner")
      .getByRole("link", { name: "Release notes", exact: true });
    expect((await utility.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator(".release-metadata").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("timeline-coarse-rtl-short.png") });
    await page.getByRole("button", { name: "Open documentation navigation", exact: true }).click();
    const current = page.locator('[data-doc-navigation] [aria-current="page"]');
    await current.scrollIntoViewIfNeeded();
    await expect(current).toBeVisible();
    await current.press("Enter");
    await expect(
      page.getByRole("button", { name: "Open documentation navigation", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  } finally {
    await context.close();
  }
});

test("timeline text at twice its size reflows without hiding version markers or utilities", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/docs/documentation/changelog/", { waitUntil: "load" });
  await page.evaluate(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>("[data-doc-article], [data-doc-article] *"),
    ];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => {
      element.style.fontSize = `${sizes[index] * 2}px`;
    });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#release-1-5-4").scrollIntoViewIfNeeded();
  await expect(page.locator("#release-1-5-4")).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Release notes", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("timeline-200-percent-text.png") });
});
