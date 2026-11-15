import { expect, test } from "@playwright/test";
import { readDocument, sidebarGroups } from "../documentationMdxTestSupport";

test("overview cards preserve all destinations, factual summaries and framework category order", async ({
  page,
}) => {
  await page.goto("/archeion/docs/");
  const cards = page.locator("article [data-docs-overview] a");
  await expect(cards).toHaveCount(23);
  const expected = sidebarGroups()
    .slice(1)
    .flatMap((group) => group.items.map((id) => readDocument(id)));
  expect(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
  ).toEqual(expected.map((doc) => `/archeion/docs${doc.metadata.slug}`));
  for (const [index, doc] of expected.entries()) {
    await expect(cards.nth(index)).toContainText(doc.metadata.overview_title);
    await expect(cards.nth(index)).toContainText(doc.metadata.overview_description);
  }
  await cards.first().focus();
  await expect(cards.first()).toHaveCSS("outline-style", "solid");
  await cards.first().press("Enter");
  await expect(page).toHaveURL(/getting-started\/installing\/$/);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("overview cards keep measured columns, local containment and enlarged text across themes", async ({
  page,
}, info) => {
  await page.goto("/archeion/docs/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-docs-overview]")).toHaveCount(5);
  for (const theme of ["dark", "light"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [1440, 800, 601, 600, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const grids = page.locator("[data-docs-overview]");
      const columns = await grids.evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length),
      );
      expect(columns).toEqual(width <= 600 ? [1, 1, 1, 1, 1] : [3, 2, 2, 2, 2]);
      for (const card of await grids.locator("a").all()) {
        const bounds = await card.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440 || width === 320)
        await page.screenshot({
          path: info.outputPath(`overview-${theme}-${width}.png`),
          fullPage: true,
        });
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.locator("[data-docs-overview] a").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("overview-text-200.png"), fullPage: true });
});
