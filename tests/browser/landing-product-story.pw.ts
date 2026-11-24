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
    "Open EPUBs from File Explorer",
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

test("Reading follows the approved desktop, tablet, and mobile layout", async ({ page }) => {
  const reading = page.locator("#reading");
  const image = reading.locator("figure img");
  const features = reading.locator("article");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/archeion/");
  await image.scrollIntoViewIfNeeded();
  const imageBox = await image.boundingBox();
  const featureBoxes = await Promise.all(
    [0, 1, 2].map((index) => features.nth(index).boundingBox()),
  );
  if (!imageBox || featureBoxes.some((box) => !box)) {
    throw new Error("Reader desktop geometry is unavailable");
  }
  const [first, second, third] = featureBoxes;
  if (!first || !second || !third) throw new Error("Reading feature rows are missing");
  expect(first.x).toBeGreaterThan(imageBox.x + imageBox.width);
  expect(first.y).toBeLessThan(second.y);
  expect(second.y).toBeLessThan(third.y);
  expect(imageBox.width / first.width).toBeGreaterThan(2.35);
  expect(first.y).toBeGreaterThan(imageBox.y);
  expect(third.y + third.height).toBeLessThan(imageBox.y + imageBox.height);
  const heading = await reading.locator("h2").boundingBox();
  if (!heading) throw new Error("Reading heading geometry is unavailable");
  expect(imageBox.y - (heading.y + heading.height)).toBeGreaterThanOrEqual(34);
  expect(imageBox.y - (heading.y + heading.height)).toBeLessThanOrEqual(38);

  for (const width of [1080, 1020, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const stackedImage = await image.boundingBox();
    const cards = await Promise.all([0, 1, 2].map((index) => features.nth(index).boundingBox()));
    if (!stackedImage || cards.some((box) => !box)) {
      throw new Error(`Reading tablet geometry is unavailable at ${width}px`);
    }
    const [left, middle, right] = cards;
    if (!left || !middle || !right) throw new Error("Tablet features are missing");
    expect(left.y).toBeGreaterThanOrEqual(stackedImage.y + stackedImage.height);
    expect(Math.abs(left.y - middle.y)).toBeLessThan(2);
    expect(Math.abs(middle.y - right.y)).toBeLessThan(2);
    expect(left.x).toBeLessThan(middle.x);
    expect(middle.x).toBeLessThan(right.x);
  }

  for (const width of [700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const stackedImage = await image.boundingBox();
    const cards = await Promise.all([0, 1, 2].map((index) => features.nth(index).boundingBox()));
    if (!stackedImage || cards.some((box) => !box)) {
      throw new Error(`Reading mobile geometry is unavailable at ${width}px`);
    }
    const [top, middle, bottom] = cards;
    if (!top || !middle || !bottom) throw new Error("Mobile features are missing");
    expect(top.y).toBeGreaterThanOrEqual(stackedImage.y + stackedImage.height);
    expect(top.y).toBeLessThan(middle.y);
    expect(middle.y).toBeLessThan(bottom.y);
    expect(await reading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
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

test("Reading feature rows match the reference without boxed-card styling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/archeion/");
  const rows = page.locator("#reading article");
  await expect(rows).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const row = rows.nth(index);
    const appearance = await row.evaluate((element) => {
      const article = getComputedStyle(element);
      const icon = element.querySelector(".landing-reader-feature-icon");
      if (!icon) throw new Error("Reading feature icon is missing");
      const iconStyle = getComputedStyle(icon);
      return {
        background: article.backgroundColor,
        borderTop: article.borderTopWidth,
        borderRight: article.borderRightWidth,
        borderBottom: article.borderBottomWidth,
        borderLeft: article.borderLeftWidth,
        iconSize: icon.getBoundingClientRect().width,
        iconBorder: iconStyle.borderTopWidth,
        iconBackground: iconStyle.backgroundColor,
        cursor: article.cursor,
      };
    });
    expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
    expect(appearance.borderTop).toBe(index === 0 ? "0px" : "1px");
    expect(appearance.borderRight).toBe("0px");
    expect(appearance.borderBottom).toBe("0px");
    expect(appearance.borderLeft).toBe("0px");
    expect(appearance.iconSize).toBe(40);
    expect(appearance.iconBorder).toBe("1px");
    expect(appearance.iconBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(appearance.cursor).not.toBe("pointer");
    await expect(row.locator("a, button, [role=link], [tabindex]")).toHaveCount(0);
  }
});
