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

test("overview cards preserve hierarchy and containment at responsive and zoom-equivalent widths", async ({
  page,
}, info) => {
  await page.goto("/archeion/docs/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-docs-overview]")).toHaveCount(5);

  const measureCards = async (width: number, checkType = true) => {
    const grids = page.locator("[data-docs-overview]");
    const columns = await grids.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length),
    );
    expect(columns).toEqual(width <= 600 ? [1, 1, 1, 1, 1] : [3, 2, 2, 2, 2]);

    // Measure every card in one browser round trip to avoid per-card timeout pressure.
    const cards = await grids.locator("a").evaluateAll((links) =>
      links.map((link) => {
        const bounds = link.getBoundingClientRect();
        const arrow = link.querySelector("svg");
        const content = link.querySelector("span");
        const title = content?.children.item(0);
        const description = content?.children.item(1);
        if (!arrow || !(title instanceof HTMLElement) || !(description instanceof HTMLElement))
          throw new Error("Overview card content or arrow is missing");
        const icon = arrow.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          alignment: Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2),
          titleFont: getComputedStyle(title).fontSize,
          descriptionFont: getComputedStyle(description).fontSize,
          textFits: [title, description].every((node) => node.scrollWidth <= node.clientWidth + 1),
        };
      }),
    );
    expect(cards).toHaveLength(23);
    for (const [index, card] of cards.entries()) {
      expect(card.alignment, `Card ${index} arrow alignment at ${width}px`).toBeLessThanOrEqual(1);
      expect(card.left, `Card ${index} left boundary at ${width}px`).toBeGreaterThanOrEqual(-1);
      expect(card.right, `Card ${index} right boundary at ${width}px`).toBeLessThanOrEqual(
        width + 1,
      );
      expect(card.textFits, `Card ${index} text containment at ${width}px`).toBe(true);
      if (checkType) {
        expect(card.titleFont).toBe("14px");
        expect(card.descriptionFont).toBe("13px");
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  };

  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [320, 375, 600, 601, 800, 1020, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await measureCards(width);
      if (width === 320 || width === 1280)
        await page.screenshot({
          path: info.outputPath(`overview-${theme}-${width}.png`),
          fullPage: true,
        });
    }
  }

  // Browser zoom reduces the available CSS viewport. Root-element CSS zoom does
  // not update media queries and produces false page-overflow failures.
  for (const factor of [2, 4]) {
    const width = 1280 / factor;
    await page.setViewportSize({ width, height: 900 });
    await measureCards(width);
    await expect(page.locator("[data-docs-overview] a").first()).toHaveCSS(
      "transition-duration",
      "0s",
    );
  }
});
