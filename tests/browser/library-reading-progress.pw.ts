import { expect, test, type Locator } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=2";

for (const [presentation, width] of [
  ["drawer", 900],
  ["pinned panel", 1280],
] as const) {
  test(`manual reading completion uses a full-width secondary action in the ${presentation}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(fixture);
    await page.locator(".book-card__select").first().click();
    if (presentation === "pinned panel") {
      await page.getByRole("button", { name: "Pin book details" }).click();
    }
    const details = page.locator(
      presentation === "drawer" ? "dialog.details-drawer" : ".book-details-panel",
    );
    const badge = page.locator(".book-card__progress-badge");
    const mark = details.getByRole("button", { name: "Mark as read", exact: true });
    const read = details.getByRole("button", { name: "Read book", exact: true });
    await expect(mark).toHaveClass(/button--secondary/);
    await expect(details.locator(".details-actions > button")).toHaveText([
      "Read book",
      "Mark as read",
    ]);
    const [markBox, readBox] = await Promise.all([mark.boundingBox(), read.boundingBox()]);
    expect(markBox?.x).toBe(readBox?.x);
    expect(markBox?.width).toBe(readBox?.width);
    expect(markBox?.height).toBe(readBox?.height);
    await mark.click();
    await expect(details.locator(".details-progress-pill")).toHaveText("100%");
    await expect(badge).toHaveText("100%");
    await expect(read).toBeVisible();
    await expect(details.getByRole("button", { name: "Start from beginning" })).toHaveCount(0);
    await details.getByRole("button", { name: "Undo mark as read", exact: true }).click();
    await expect(details.locator(".details-progress-pill")).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await expect(mark).toBeVisible();
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
