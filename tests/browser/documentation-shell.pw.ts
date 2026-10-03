import { expect, test, type Locator } from "@playwright/test";

const articles = [
  { name: "overview", route: "", title: "Archeion documentation" },
  { name: "reading", route: "guides/reading/", title: "Read and annotate" },
  { name: "installation", route: "getting-started/installing/", title: "Install Archeion" },
  {
    name: "storage",
    route: "reference/archive-storage/",
    title: "Archive storage, ownership, and maintenance",
  },
];

async function visualStyle(locator: Locator, pseudo?: string) {
  return locator.evaluate((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement);
    return {
      font: style.fontFamily,
      size: parseFloat(style.fontSize),
      weight: parseInt(style.fontWeight),
      color: style.color,
      background: style.backgroundColor,
      border: style.borderInlineStartWidth,
      borderColor: style.borderInlineStartColor,
      outline: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      shadow: style.boxShadow,
      width: parseFloat(style.width),
    };
  }, pseudo);
}

function contrast(foreground: string, background: string) {
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
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

for (const appearance of ["light", "dark"] as const) {
  for (const width of [320, 480, 780, 781, 1024, 1280, 1920]) {
    test(`${appearance} shell keeps readable typography and reachable utilities at ${width}px`, async ({
      page,
    }) => {
      // Each viewport case exercises four complete articles and waits for their fonts.
      test.slow();
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: appearance });
      for (const article of articles) {
        await page.goto(`/docs/documentation/${article.route}`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: test.info().outputPath(`${article.name}-${appearance}-${width}.png`),
        });
        const banner = page.getByRole("banner");
        await expect(
          banner.getByRole("link", { name: "Archeion Docs", exact: true }),
        ).toBeVisible();
        await expect(banner.getByRole("link", { name: "Home", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const title = page.locator(".doc-article h1");
        await expect(title).toHaveText(article.title);
        const heading = page.locator(".doc-article h2").first();
        const paragraph = page.locator(".doc-article p").last();
        const [titleStyle, headingStyle, paragraphStyle] = await Promise.all([
          visualStyle(title),
          visualStyle(heading),
          visualStyle(paragraph),
        ]);
        expect(titleStyle.font).toContain("Literata");
        expect(headingStyle.font).toBe(paragraphStyle.font);
        expect(headingStyle.font).not.toContain("Literata");
        expect(headingStyle.size).toBeLessThan(titleStyle.size);
        expect(await page.evaluate(() => document.fonts.check('32px "Literata"'))).toBe(true);
        if (article.name === "installation") {
          const callout = page.locator(".notice");
          const calloutStyle = await visualStyle(callout);
          const adviceStyle = await visualStyle(callout.locator("p"));
          expect(calloutStyle.border).toBe("0px");
          expect(contrast(adviceStyle.color, calloutStyle.background)).toBeGreaterThanOrEqual(4.5);
          await callout.screenshot({
            path: test.info().outputPath(`callout-${appearance}-${width}.png`),
          });
        }
        if (article.name === "reading" || article.name === "storage") {
          await page.locator(".doc-article h2").nth(2).scrollIntoViewIfNeeded();
          await page.screenshot({
            path: test.info().outputPath(`${article.name}-body-${appearance}-${width}.png`),
          });
        }
      }
    });
  }

  test(`${appearance} sidebar selection uses its rail and keyboard focus stays distinct`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: appearance });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/docs/documentation/guides/settings/", { waitUntil: "domcontentloaded" });
    const sidebar = page.getByRole("navigation", { name: "Documentation sidebar", exact: true });
    const selected = sidebar.getByRole("link", { name: "Settings", exact: true });
    const neighbor = sidebar.getByRole("link", { name: "Dictionaries and Define", exact: true });
    await expect(selected).toHaveAttribute("aria-current", "page");
    const selectedStyle = await visualStyle(selected);
    expect(selectedStyle.background).toBe("rgba(0, 0, 0, 0)");
    expect(selectedStyle.shadow).toBe("none");
    expect(selectedStyle.weight).toBeGreaterThan(
      await neighbor.evaluate((element) => parseInt(getComputedStyle(element).fontWeight)),
    );
    const selectedRail = await visualStyle(selected, "::before");
    const inactiveRail = await visualStyle(neighbor, "::before");
    await neighbor.hover();
    const hoverRail = await visualStyle(neighbor, "::before");
    expect(hoverRail.background).not.toBe(inactiveRail.background);
    expect(hoverRail.background).not.toBe(selectedRail.background);
    expect((await visualStyle(neighbor)).background).toBe("rgba(0, 0, 0, 0)");
    expect(selectedRail.width).toBeGreaterThan(inactiveRail.width);
    const sidebarBackground = await page
      .locator(".docs-sidebar")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(contrast(selectedRail.background, sidebarBackground)).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Tab");
    await selected.focus();
    await expect(selected).toBeFocused();
    const focus = await visualStyle(selected);
    expect(focus.outline).toBe("solid");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(contrast(focus.outlineColor, sidebarBackground)).toBeGreaterThanOrEqual(3);
    await sidebar.screenshot({ path: test.info().outputPath(`sidebar-${appearance}.png`) });
  });
}

for (const width of [320, 1280]) {
  test(`forced colors preserve selection, focus, and callout boundaries at ${width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/docs/documentation/getting-started/installing/", {
      waitUntil: "domcontentloaded",
    });
    const notice = page.locator(".notice");
    const boundary = await notice.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: parseFloat(style.borderTopWidth),
        style: style.borderTopStyle,
        color: style.borderTopColor,
        background: style.backgroundColor,
      };
    });
    expect(boundary.style).toBe("solid");
    expect(boundary.width).toBeGreaterThanOrEqual(1);
    expect(boundary.color).not.toBe(boundary.background);
    await notice.screenshot({ path: test.info().outputPath(`callout-forced-${width}.png`) });
    if (width === 320)
      await page.getByRole("button", { name: "Open documentation navigation" }).click();
    const selected = page.locator('[data-sidebar] a[aria-current="page"]');
    await page.keyboard.press("Tab");
    await selected.focus();
    await expect(selected).toBeFocused();
    const rail = await visualStyle(selected, "::before");
    const focus = await visualStyle(selected);
    expect(rail.width).toBeGreaterThanOrEqual(2);
    expect(focus.outline).toBe("solid");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
    await page
      .locator("[data-sidebar]")
      .screenshot({ path: test.info().outputPath(`sidebar-forced-${width}.png`) });
  });
}

test("brand and Home utility support native keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/docs/documentation/guides/settings/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Archeion Docs", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/docs\/documentation\/$/);
  await page.getByRole("banner").getByRole("link", { name: "Home", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/docs\/$/);
});

test("article text at twice its size remains readable without viewport overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/docs/documentation/guides/reading/", { waitUntil: "domcontentloaded" });
  await page.locator(".doc-article").evaluate((article) => {
    const elements = [article, ...article.querySelectorAll<HTMLElement>("h1, h2, h3, p, li")];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    for (const [index, element] of elements.entries())
      element.style.fontSize = `${sizes[index] * 2}px`;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("banner").getByRole("link", { name: "Home", exact: true }).focus();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Home", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("reading-text-200-percent.png") });
});
