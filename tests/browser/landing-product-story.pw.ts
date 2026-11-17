import { expect, test } from "@playwright/test";

test("six factual cards replace interactive Library and Reader demos", async ({ page }) => {
  await page.goto("/archeion/");
  await expect(page.locator("main article h3")).toHaveText([
    "Folders and series",
    "Search and filters",
    "Batch actions",
    "Reader settings",
    "Bookmarks and highlights",
    "Offline dictionaries",
  ]);
  for (const claim of [
    "filter by series, subject, language, publisher, or reading status",
    "Move selected books, update book details, regenerate covers, and export annotations",
    "paged or continuous reading, typeface, line spacing, page width, and colors",
    "highlight passages in four colors, and add notes",
    "Install compatible dictionaries to look up selected words offline",
  ])
    await expect(page.locator("main article").filter({ hasText: claim })).toHaveCount(1);
  const preview = page.getByRole("region", { name: "Archeion application preview" });
  await expect(preview.getByRole("img")).toHaveAttribute(
    "alt",
    /Library.*folders, search, filters, and book covers/,
  );
  await expect(preview.locator("a, button, input, [tabindex]")).toHaveCount(0);
  await expect(page.locator("#reading button, #reading input, #reading [role=radio]")).toHaveCount(
    0,
  );
  await expect(page.locator("main")).not.toContainText(
    /encrypted|zero knowledge|military|secure by design/i,
  );
});

test("the Reading section displays an authentic non-interactive reader screenshot", async ({
  page,
}) => {
  await page.goto("/archeion/");
  const reader = page.locator("#reading img");
  await expect(reader).toHaveAttribute("src", "/archeion/assets/images/landing-reader.png");
  await expect(reader).toHaveAttribute("alt", /continuous mode.*Appearance settings/);
  await expect(reader).toHaveAttribute("width", "1919");
  await expect(reader).toHaveAttribute("height", "1079");
  await expect(reader).toHaveAttribute("loading", "lazy");
  await reader.scrollIntoViewIfNeeded();
  await expect
    .poll(() => reader.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth))
    .toBe(1919);
  await expect(page.locator("#reading figure a, #reading figure button")).toHaveCount(0);
});

test("Reading places the preview beside its features on desktop and stacks on smaller screens", async ({
  page,
}) => {
  const reading = page.locator("#reading");
  const image = reading.locator("figure img");
  const cards = reading.locator("article");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/archeion/");
  await image.scrollIntoViewIfNeeded();
  const desktopImage = await image.boundingBox();
  const [firstDesktopCard, secondDesktopCard, thirdDesktopCard] = await Promise.all(
    [0, 1, 2].map((index) => cards.nth(index).boundingBox()),
  );
  if (!desktopImage || !firstDesktopCard || !secondDesktopCard || !thirdDesktopCard) {
    throw new Error("Reader desktop geometry is unavailable");
  }
  for (const card of [firstDesktopCard, secondDesktopCard, thirdDesktopCard]) {
    expect(card.x).toBeGreaterThan(desktopImage.x + desktopImage.width);
  }
  expect(firstDesktopCard.y).toBeLessThan(secondDesktopCard.y);
  expect(secondDesktopCard.y).toBeLessThan(thirdDesktopCard.y);

  for (const width of [1020, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const stackedImage = await image.boundingBox();
    const firstCard = await cards.first().boundingBox();
    if (!stackedImage || !firstCard) {
      throw new Error(`Reader geometry is unavailable at ${width}px`);
    }
    expect(firstCard.y).toBeGreaterThanOrEqual(stackedImage.y + stackedImage.height);
  }
});

test("informational feature cards do not react as clickable targets on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/archeion/");
  const card = page.locator("#library article").first();
  await card.scrollIntoViewIfNeeded();
  const surface = card.locator("div").first();
  const icon = card.locator("span").first();
  const styles = async () =>
    await surface.evaluate((element) => ({
      cursor: getComputedStyle(element).cursor,
      background: getComputedStyle(element).backgroundColor,
      border: getComputedStyle(element).borderColor,
      shadow: getComputedStyle(element).boxShadow,
      transform: getComputedStyle(element).transform,
    }));
  const before = await styles();
  const iconBefore = await icon.evaluate((element) => getComputedStyle(element).transform);
  await card.hover();
  await expect.poll(styles).toEqual(before);
  await expect
    .poll(() => icon.evaluate((element) => getComputedStyle(element).transform))
    .toBe(iconBefore);
  await expect(card.locator("svg")).toHaveCount(1);
  await expect(card.locator("a, button, [role=link], [tabindex]")).toHaveCount(0);
  expect(before.cursor).not.toBe("pointer");
});
