import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=48&motion=off&series";

for (const [size, coverWidth, cardInset, cardGap] of [
  ["small", 58, 10, 12],
  ["medium", 72, 13, 16],
  ["large", 88, 16, 19],
] as const) {
  test(`Series ${size} cards preserve their geometry when the view changes`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${fixture}&seriesCardSize=${size}`);
    await page
      .getByRole("navigation", { name: "Library navigation" })
      .getByRole("button", { name: "Series", exact: true })
      .click();
    const overview = page.getByRole("region", { name: "Series", exact: true });
    const card = overview.getByRole("button", { name: "Open Star Saga", exact: true });
    const collection = overview.locator(".collection-content__items");
    const cover = card.locator(".book-cover");
    await expect(card).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });

    for (const width of [1920, 560]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(cover).toHaveCSS("width", `${coverWidth}px`);
      await expect(card).toHaveCSS("padding", `${cardInset}px`);
      await expect(card).toHaveCSS("column-gap", `${cardGap}px`);
      await expect(cover).toHaveCSS("border-radius", "4px");
      await expect
        .poll(() =>
          collection.evaluate((element) => {
            const grid = element.getBoundingClientRect();
            const header = element.closest("section")!.querySelector("header")!;
            const bounds = header.getBoundingClientRect();
            return Math.max(Math.abs(grid.left - bounds.left), Math.abs(grid.right - bounds.right));
          }),
        )
        .toBeLessThan(1);
    }
    await page.setViewportSize({ width: 1920, height: 800 });
    await page.mouse.move(0, 0);
    const surface = card.locator("..");
    const restColor = await surface.evaluate((node) => getComputedStyle(node).backgroundColor);
    await card.hover();
    await expect
      .poll(() => surface.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(restColor);
    await expect(card).toHaveCSS("cursor", "pointer");
    const list = overview.getByRole("radio", { name: "List", exact: true });
    await list.press("Space");
    await expect(list).toHaveAttribute("aria-checked", "true");
    await expect(cover).toHaveCSS("width", "72px");
    await expect(card).toHaveCSS("padding", "13px");
    await expect(card).toHaveCSS("column-gap", "16px");
    await expect
      .poll(() =>
        card.evaluate((button) => {
          const grid = button.closest(".collection-content__items")!;
          return Math.abs(
            grid.getBoundingClientRect().width - button.getBoundingClientRect().width - 2,
          );
        }),
      )
      .toBeLessThan(1);
  });
}

test("Series detail preserves full-row activation, responsive actions, and return focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fixture);
  await page
    .getByRole("navigation", { name: "Library navigation" })
    .getByRole("button", { name: "Series", exact: true })
    .press("Enter");
  const overview = page.getByRole("region", { name: "Series", exact: true });
  const search = overview.getByRole("searchbox", { name: "Search series" });
  await search.fill("Star Saga");
  const card = overview.getByRole("button", { name: "Open Star Saga", exact: true });
  await expect(overview.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await card.press("Enter");
  const detail = page.getByRole("region", { name: "Star Saga", exact: true });
  const back = detail.getByRole("button", { name: "All series", exact: true });
  const expectCompactBack = async () => {
    await expect
      .poll(() =>
        back.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const contentWidth = Array.from(button.children).reduce(
            (width, child) => width + child.getBoundingClientRect().width,
            0,
          );
          const expectedWidth =
            contentWidth +
            parseFloat(style.columnGap) +
            parseFloat(style.paddingLeft) +
            parseFloat(style.paddingRight);
          const header = button.parentElement!.querySelector("header")!;
          return Math.max(
            Math.abs(bounds.width - expectedWidth),
            Math.abs(bounds.left - header.getBoundingClientRect().left),
          );
        }),
      )
      .toBeLessThan(1);
  };
  await expectCompactBack();
  const volumes = detail.getByRole("list", { name: "Series volumes" });
  const row = volumes.getByRole("listitem").first();
  const open = row.getByRole("button");
  await expect(detail.getByRole("heading", { name: "Possible gaps" })).toBeVisible();
  await expect(volumes.getByRole("listitem")).toHaveCount(4);
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(open.locator(".book-cover")).toHaveCSS("width", "54px");
  await page.mouse.move(0, 0);
  const unhovered = await open.evaluate((element) => getComputedStyle(element).backgroundColor);
  await open.hover();
  await expect
    .poll(() => open.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(unhovered);
  for (const width of [621, 620, 560]) {
    await page.setViewportSize({ width, height: 800 });
    await expectCompactBack();
    await expect(open.locator(".book-cover")).toHaveCSS("width", width > 620 ? "54px" : "46px");
    await expect(open).toHaveCSS("column-gap", width > 620 ? "15px" : "11px");
    await expect
      .poll(() =>
        open.evaluate((button) =>
          Math.abs(
            button.getBoundingClientRect().width -
              button.parentElement!.getBoundingClientRect().width,
          ),
        ),
      )
      .toBeLessThan(1);
    if (width > 620) await expect(open.locator(".series-volume__action > span")).toBeVisible();
    else await expect(open.locator(".series-volume__action > span")).toBeHidden();
  }
  await back.press("Enter");
  await expect(card).toBeFocused();
  await expect(search).toHaveValue("Star Saga");
  await overview.getByRole("button", { name: "Clear series search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(overview.getByRole("button", { name: /^Open / })).toHaveCount(12);
});

test("Series enabled actions show the pointer cursor", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fixture);
  await page
    .getByRole("navigation", { name: "Library navigation" })
    .getByRole("button", { name: "Series", exact: true })
    .click();
  const overview = page.getByRole("region", { name: "Series", exact: true });
  const search = overview.getByRole("searchbox", { name: "Search series" });
  const card = overview.getByRole("button", { name: "Open Star Saga", exact: true });
  await expect(card).toHaveCSS("cursor", "pointer");
  await expect(overview.getByRole("combobox", { name: "Sort series" })).toHaveCSS(
    "cursor",
    "pointer",
  );
  for (const name of ["Grid", "List"]) {
    await expect(overview.getByRole("radio", { name, exact: true })).toHaveCSS("cursor", "pointer");
  }
  await search.fill("No matching series name");
  const clearIcon = overview.getByRole("button", { name: "Clear series search", exact: true });
  const clearAction = overview.getByRole("button", { name: "Clear search", exact: true });
  await expect.soft(clearIcon).toHaveCSS("cursor", "pointer");
  await expect.soft(clearAction).toHaveCSS("cursor", "pointer");
  await clearAction.click();
  await card.click();
  const detail = page.getByRole("region", { name: "Star Saga", exact: true });
  await expect
    .soft(detail.getByRole("button", { name: "All series", exact: true }))
    .toHaveCSS("cursor", "pointer");
  await expect
    .soft(detail.getByRole("button", { name: "Continue Series", exact: true }))
    .toHaveCSS("cursor", "pointer");
  const volumes = detail.getByRole("list", { name: "Series volumes" }).getByRole("button");
  await expect(volumes).toHaveCount(4);
  for (const volume of await volumes.all()) {
    await expect(volume).toHaveCSS("cursor", "pointer");
  }
});
