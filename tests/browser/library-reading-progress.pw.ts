import { expect, test } from "@playwright/test";

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
    await expect(read).toBeVisible();
    await expect(details.getByRole("button", { name: "Start from beginning" })).toHaveCount(0);
    await details.getByRole("button", { name: "Undo mark as read", exact: true }).click();
    await expect(details.locator(".details-progress-pill")).toHaveCount(0);
    await expect(mark).toBeVisible();
  });
}
