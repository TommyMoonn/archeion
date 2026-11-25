import { expect, test, type Locator } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=2";

for (const [presentation, width] of [
  ["drawer", 900],
  ["pinned panel", 1280],
] as const) {
  test(`manual reading completion keeps full-width actions stable in the ${presentation}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${fixture}&motion=off`);
    await page.locator(".book-card__select").first().click();
    if (presentation === "pinned panel") {
      await page.getByRole("button", { name: "Pin book details" }).click();
    }
    const details = page.locator(
      presentation === "drawer" ? "dialog.details-drawer" : ".book-details-panel",
    );
    const badge = page.locator(".book-card__progress-badge");
    const detailsBadge = details.locator(".details-progress-pill");
    const mark = details.getByRole("button", { name: "Mark as read", exact: true });
    const undo = details.getByRole("button", { name: "Undo mark as read", exact: true });
    const read = details.getByRole("button", { name: "Read book", exact: true });
    const metadata = details.locator(".book-metadata");
    await expect(mark).toHaveClass(/button--secondary/);
    await expect(details.locator(".details-actions > button")).toHaveText([
      "Read book",
      "Mark as read",
    ]);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const [markBox, readBox, metadataBox] = await Promise.all([
      mark.boundingBox(),
      read.boundingBox(),
      metadata.boundingBox(),
    ]);
    if (!markBox || !readBox || !metadataBox) throw new Error("Expected visible book details");
    expect(markBox.x).toBe(readBox.x);
    expect(markBox.width).toBe(readBox.width);
    expect(markBox.height).toBe(readBox.height);
    await expect(detailsBadge).toBeVisible();
    await expect(detailsBadge).toHaveText("Unread");
    await expect(page.locator(".book-card").getByText("Unread", { exact: true })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Clear reading progress" })).toHaveCount(0);
    await mark.click();
    await expect(detailsBadge).toHaveText("100%");
    await expect(badge).toHaveText("100%");
    await expect.poll(() => read.boundingBox()).toEqual(readBox);
    await expect.poll(() => undo.boundingBox()).toEqual(markBox);
    await expect.poll(() => metadata.boundingBox()).toEqual(metadataBox);
    await expect(details.getByRole("button", { name: "Start from beginning" })).toHaveCount(0);
    await undo.click();
    await expect(detailsBadge).toHaveText("Unread");
    await expect(badge).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Clear reading progress" })).toHaveCount(0);
    await expect.poll(() => read.boundingBox()).toEqual(readBox);
    await expect.poll(() => mark.boundingBox()).toEqual(markBox);
    await expect.poll(() => metadata.boundingBox()).toEqual(metadataBox);
  });
}

async function cardGeometry(cards: Locator) {
  return cards.evaluateAll((elements) =>
    elements.map((card) => {
      const rect = (node: Element) => node.getBoundingClientRect().toJSON();
      return [
        rect(card),
        ...Array.from(
          card.querySelectorAll(".book-cover, .book-card__copy strong, .book-card__copy > span"),
          rect,
        ),
      ];
    }),
  );
}

for (const { width, theme, cardSize } of [
  { width: 1280, theme: "dark", cardSize: "medium" },
  { width: 900, theme: "light", cardSize: "small" },
  { width: 900, theme: "custom", cardSize: "small" },
]) {
  test(`cover progress preserves card geometry in the ${theme} ${cardSize} grid`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(
      `${fixture}&theme=${theme}&cardSize=${cardSize}&covers=artwork&longBookMetadata&motion=off`,
    );
    const grid = page.locator(".book-grid");
    await expect(grid).toHaveAttribute("data-book-card-size", cardSize);
    const cards = grid.locator(".book-card");
    await expect(cards).toHaveCount(2);
    const card = cards.filter({ hasText: "A comprehensively annotated history" });
    const primary = card.getByRole("button", { name: /^View details for Book-0000/ });
    const cover = card.locator(".book-cover");
    const badge = cover.locator(":scope > .book-card__progress-badge");
    const image = cover.locator("img");
    await expect(card.locator(".book-card__copy > span")).toHaveText(/A very long author name/);
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(120);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(badge).toHaveCount(0);
    const baseline = await cardGeometry(cards);
    const coverUrl = await image.getAttribute("src");

    await primary.focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Mark as read", exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(badge).toHaveText("100%");
    await expect(primary).toHaveAccessibleDescription("Reading progress 100 percent.");
    await expect.poll(() => cardGeometry(cards)).toEqual(baseline);
    await expect(image).toHaveAttribute("src", coverUrl ?? "");
    const badgeBox = await badge.boundingBox();
    const coverBox = await cover.boundingBox();
    if (!badgeBox || !coverBox) throw new Error("Expected visible cover and progress badge");
    expect(coverBox.height / coverBox.width).toBeCloseTo(1.5, 2);
    expect(coverBox.x + coverBox.width - badgeBox.x - badgeBox.width).toBeCloseTo(9, 1);
    expect(coverBox.y + coverBox.height - badgeBox.y - badgeBox.height).toBeCloseTo(9, 1);
    expect(badgeBox.width).toBeLessThan(coverBox.width / 2);
    expect(badgeBox.height).toBeLessThan(coverBox.height / 4);
    await expect(badge).toHaveCSS("border-radius", "6px");
    const title = card.locator(".book-card__copy strong");
    const titleLines = await title.evaluate((node) => {
      const style = getComputedStyle(node);
      return node.getBoundingClientRect().height / parseFloat(style.lineHeight);
    });
    expect(titleLines).toBeCloseTo(2, 1);

    const x = badgeBox.x + badgeBox.width / 2;
    const y = badgeBox.y + badgeBox.height / 2;
    await page.mouse.move(x, y);
    const favorite = card.getByRole("button", { name: /^Favorite Book-0000/ });
    await expect(favorite).toHaveCSS("opacity", "1");
    await expect(card.getByRole("button", { name: /^Actions for Book-0000/ })).toHaveCSS(
      "opacity",
      "1",
    );
    await page.mouse.click(x, y, { button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Undo mark as read", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(primary).toBeFocused();
    await page.mouse.click(x, y);
    await expect(page.locator("dialog.details-drawer")).toBeVisible();

    if (theme === "dark") {
      await page.getByRole("button", { name: "Close book details" }).click();
      await favorite.click();
      await page.getByRole("button", { name: "Favorites", exact: true }).click();
      await expect(page.locator(".book-grid .book-card__progress-badge")).toHaveText("100%");
      await page.evaluate(() => window.uiStabilityFixture.setView("list"));
      await expect(page.locator(".book-list .book-row")).toHaveCount(1);
      await expect(page.locator(".book-card__progress-badge")).toHaveCount(0);
    }
  });
}

test("selected grid covers keep an in-bounds accent border and do not lift on hover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${fixture}&motion=off`);
  const card = page.locator(".book-card").first();
  const primary = card.locator(".book-card__select");
  const cover = card.locator(".book-cover");
  await expect(cover).toHaveAttribute("data-cover-state", "available");
  await page.mouse.move(0, 0);
  const before = await cover.boundingBox();
  await page.getByRole("button", { name: "Select books", exact: true }).click();
  await primary.focus();
  await page.keyboard.press("Space");
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await expect(cover).toHaveCSS("border-top-width", "2px");
  await expect(cover).toHaveCSS("border-right-width", "2px");
  await expect(cover).toHaveCSS("border-bottom-width", "2px");
  await expect(cover).toHaveCSS("border-left-width", "2px");
  await expect.poll(() => cover.boundingBox()).toEqual(before);
  const selectedBorder = await cover.evaluate((node) => getComputedStyle(node).borderTopColor);
  await primary.hover();
  await expect(cover).toHaveCSS("border-top-color", selectedBorder);
  await expect(cover).toHaveCSS("transform", "none");
  await expect(card.locator(".book-favorite")).toHaveCSS("visibility", "hidden");
  await expect(card.getByRole("button", { name: /^Actions for / })).toBeVisible();
  await page.emulateMedia({ forcedColors: "active" });
  const hasHighlight = await cover.evaluate((node) => {
    const sample = document.createElement("div");
    sample.style.border = "2px solid Highlight";
    document.body.append(sample);
    const matches =
      getComputedStyle(node).borderTopColor === getComputedStyle(sample).borderTopColor;
    sample.remove();
    return matches;
  });
  expect(hasHighlight).toBe(true);
});

test("Continue Reading keeps compact covers and remains actionable as the grid narrows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${fixture}&motion=off`);
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page.evaluate(() => window.uiStabilityFixture.suggestLastRead(false));
  const resume = page.getByRole("region", { name: "Continue reading" });
  const buttons = resume.locator(".continue-book");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.first()).toContainText("42%");
  const cover = buttons.first().locator(".book-cover");
  await expect(cover).toHaveCSS("width", "42px");
  await expect(cover).toHaveCSS("height", "63px");
  await expect(resume).toHaveCSS("border-bottom-width", "1px");
  await expect(resume).toHaveCSS("border-top-width", "0px");
  await page.setViewportSize({ width: 560, height: 850 });
  const boxes = await buttons.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
  expect(boxes[0].left).toBeCloseTo(boxes[1].left, 1);
  await expect(cover).toHaveCSS("width", "42px");
  await buttons.first().focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().route)).toBe("reader");
});
