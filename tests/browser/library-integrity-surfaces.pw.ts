import { expect, test, type Locator } from "@playwright/test";

const fixture = "/tests/browser/fixtures/integrity.html";

async function expectFullRowAction(row: Locator, title: string) {
  const details = row.getByRole("button", { name: `Open details for ${title}` });
  const trigger = row.getByRole("button", { name: `File actions for ${title}` });
  await expect(details).toBeVisible();
  await expect(details).toHaveCSS("cursor", "pointer");
  await expect(trigger).toHaveCSS("cursor", "pointer");
  const bounds = await row.boundingBox();
  const buttonBounds = await details.boundingBox();
  const menuBounds = await trigger.boundingBox();
  expect(bounds).not.toBeNull();
  expect(buttonBounds).not.toBeNull();
  expect(menuBounds).not.toBeNull();
  expect(Math.abs(buttonBounds!.width - bounds!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(buttonBounds!.height - bounds!.height)).toBeLessThanOrEqual(1);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(menuBounds!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  const resting = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  // Use the blank right-hand edge of the row, outside the menu button.
  await details.hover({ position: { x: buttonBounds!.width - 4, y: 4 } });
  const hover = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(hover).not.toBe(resting);
  await details.click({ position: { x: buttonBounds!.width - 4, y: 4 } });
  return trigger;
}

for (const width of [1440, 820, 560]) {
  test(`duplicate full-row details and menu actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`${fixture}?view=integrity-duplicates&error`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
    const group = page.getByRole("region", { name: "2 copies" }).first();
    const member = group.locator("article").first();
    const row = member.locator(".integrity-book-row");
    await expect(member.getByText("Shelf/Alpha.epub")).toBeVisible();
    await expect(member.getByRole("button", { name: "Read", exact: true })).toHaveCount(0);
    const menuTrigger = await expectFullRowAction(row, "Alpha");
    await expect(page.locator("output")).toHaveText("details:book-0");
    await menuTrigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "File actions for Alpha" });
    await expect(menu.getByRole("menuitem", { name: "Read" })).toBeFocused();
    await expect(menu.getByRole("menuitem", { name: "Reveal" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Move to folder" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete EPUB" })).toBeVisible();
    await expect(page.locator("output")).toHaveText("details:book-0");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
    await row.getByRole("button", { name: "Open details for Alpha" }).click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Read" }).click();
    await expect(page.locator("output")).toHaveText("read:book-0");
  });
}

for (const theme of ["", "&light", "&themeStress=distinct"]) {
  test(`diagnostic rows and disclosure stay usable with larger text ${theme || "dark"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 560, height: 600 });
    await page.goto(`${fixture}?view=integrity-issues${theme}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
    const book = page.locator("article").first();
    const row = book.locator(".integrity-book-row");
    const trigger = book.getByRole("button", { name: "View 1 diagnostic issue" });
    const details = book.getByRole("region", { name: "Diagnostic details" });
    await expect(row.getByText("Alpha.epub", { exact: true })).toBeVisible();
    await expectFullRowAction(row, "Alpha");
    await expect(page.locator("output")).toHaveText("details:book-0");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveCSS("min-height", "36px");
    await expect(trigger).toHaveCSS("padding-left", "14px");
    await expect(details).toBeHidden();
    await trigger.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(details).toBeVisible();
    const detail = details.locator("li");
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const [panelBounds, detailBounds, severityBounds] = await Promise.all([
      details.boundingBox(),
      detail.boundingBox(),
      detail.locator(".epub-issue-detail__severity").boundingBox(),
    ]);
    const insets = [
      detailBounds!.x - panelBounds!.x,
      detailBounds!.y - panelBounds!.y,
      panelBounds!.x + panelBounds!.width - detailBounds!.x - detailBounds!.width,
      panelBounds!.y + panelBounds!.height - detailBounds!.y - detailBounds!.height,
    ];
    expect(Math.min(...insets)).toBeGreaterThan(0);
    expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(1);
    const innerInsets = await detail.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        parseFloat,
      );
    });
    expect(Math.min(...innerInsets)).toBeGreaterThan(0);
    expect(Math.max(...innerInsets) - Math.min(...innerInsets)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        severityBounds!.y +
          severityBounds!.height / 2 -
          (detailBounds!.y + detailBounds!.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.locator("article").nth(1).getByRole("button", { name: "View 1 diagnostic issue" }),
    ).toHaveAttribute("aria-expanded", "false");
    await trigger.press("Enter");
    await expect(details).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator("output")).toHaveText("details:book-0");
    const blockedTrigger = page
      .locator("article")
      .nth(1)
      .getByRole("button", { name: "File actions for Alpha copy" });
    await blockedTrigger.click();
    const menu = page.getByRole("menu", { name: "File actions for Alpha copy" });
    await expect(menu.getByRole("menuitem", { name: "Read" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(menu.getByRole("menuitem", { name: "Reveal" })).toBeEnabled();
    await menu.getByRole("menuitem", { name: "Reveal" }).click();
    await expect(page.locator("output")).toHaveText("reveal:book-1");
  });
}

test("diagnostic severity stays in the row without displacing the filename and author", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto(`${fixture}?view=integrity-issues`);
  const book = page.locator("article").first();
  const row = book.locator(".integrity-book-row");
  await expectFullRowAction(row, "Alpha");
  const title = row.getByText("Alpha", { exact: true });
  const filename = row.getByText("Alpha.epub", { exact: true });
  const author = row.getByText("Ada", { exact: true });
  const summary = row.getByText("1 warning", { exact: true });
  const [titleBounds, filenameBounds, authorBounds, summaryBounds] = await Promise.all(
    [title, filename, author, summary].map((element) => element.boundingBox()),
  );
  expect(filenameBounds!.y).toBeGreaterThan(titleBounds!.y);
  expect(authorBounds!.y).toBeGreaterThan(filenameBounds!.y);
  expect(summaryBounds!.x).toBeGreaterThan(filenameBounds!.x);
  expect(summaryBounds!.y).toBeLessThan(authorBounds!.y + authorBounds!.height);
  await expect(book).toHaveCSS("border-radius", "6px");
});
