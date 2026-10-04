import { expect, test } from "@playwright/test";

for (const javaScriptEnabled of [true, false]) {
  test.describe(`static article links (JavaScript ${javaScriptEnabled ? "on" : "off"})`, () => {
    test.use({ javaScriptEnabled });
    test("permalinks are keyboard reachable, preserve heading names, and use canonical fragments", async ({
      page,
    }) => {
      // Initial static CSS/font loading can dominate this native-navigation case.
      test.slow();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/docs/documentation/customization/custom-themes/", {
        waitUntil: "load",
      });
      const article = page.locator("[data-doc-article]");
      const heading = article.locator("h2").first();
      const label = (await heading.innerText()).replace(/\s+/g, " ").trim();
      await expect(page.getByRole("heading", { name: label, exact: true })).toHaveCount(1);
      const link = article.getByRole("link", { name: `Link to section: ${label}`, exact: true });
      // Traverse from the article title through native links, not tabindex overrides.
      await article.locator("h1").evaluate((title: HTMLElement) => {
        title.tabIndex = -1;
        title.focus();
      });
      await expect(article.locator("h1")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("opacity", "1");
      await link.press("Enter");
      await expect(page).toHaveURL(new RegExp(`#${await heading.getAttribute("id")}$`));
      const box = await heading.boundingBox();
      const header = await page.getByRole("banner").boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      await expect(heading).toHaveText(label);
      if (javaScriptEnabled) {
        await expect(page.locator("[data-toc] a").first()).toHaveText(label);
        await expect(page.locator("[data-toc] a").first()).toHaveAttribute(
          "aria-current",
          "location",
        );
      }
      const subsection = article.locator("h3").first();
      const subsectionLabel = (await subsection.innerText()).replace(/\s+/g, " ").trim();
      const subsectionLink = article.getByRole("link", {
        name: `Link to section: ${subsectionLabel}`,
        exact: true,
      });
      await subsection.hover();
      await expect(subsectionLink).toHaveCSS("opacity", "1");
      await subsectionLink.click();
      await expect(page).toHaveURL(new RegExp(`#${await subsection.getAttribute("id")}$`));
    });
  });
}

for (const appearance of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`${appearance} articles retain rhythm and reflow at ${width}px`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
      for (const route of [
        "",
        "getting-started/installing/",
        "customization/custom-themes/",
        "reference/archive-storage/",
      ]) {
        await page.goto(`/docs/documentation/${route}`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const headings = page.locator(".article-heading");
        const rhythm = await headings.evaluateAll((groups) =>
          groups.map((group) => {
            const heading = group.querySelector("h2, h3")!;
            return {
              gap: parseFloat(getComputedStyle(group).marginTop),
              headingGap: getComputedStyle(heading).marginTop,
            };
          }),
        );
        expect(rhythm.every(({ gap, headingGap }) => gap <= 32 && headingGap === "0px")).toBe(true);
        const link = page.locator(".heading-permalink").first();
        await link.focus();
        await expect(link).toHaveCSS("opacity", "1");
        const target = await link.boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(24);
        expect(target!.height).toBeGreaterThanOrEqual(24);
        await page.screenshot({
          path: test.info().outputPath(`${route.replaceAll("/", "-") || "overview"}-top.png`),
        });
        await headings.last().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: test.info().outputPath(`${route.replaceAll("/", "-") || "overview"}-body.png`),
        });
        await expect(page.getByRole("link", { name: "Edit this page" })).toHaveAttribute(
          "href",
          /^https:\/\/github.com\/TommyMoonn\/archeion\/edit\/main\/docs\/documentation\//,
        );
        await expect(
          page.getByRole("link", { name: "Report a documentation issue" }),
        ).toHaveAttribute("href", "https://github.com/TommyMoonn/archeion/issues");
      }
    });
  }
}

test("forced colors keep the permalink focus indicator visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
  const link = page.getByRole("link", { name: "Link to section: Getting started" });
  await page.keyboard.press("Tab");
  await link.focus();
  const focus = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      opacity: style.opacity,
    };
  });
  expect(focus).toEqual({ outline: "solid", width: 2, opacity: "1" });
  await page.screenshot({ path: test.info().outputPath("overview-forced-colors.png") });
});
