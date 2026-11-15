import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  test(`archive ownership and full tree remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/archeion/#files");
    const section = page.locator("#files");
    await expect(section.getByRole("heading")).toHaveText("Your EPUB files stay in their folders.");
    await expect(section).toContainText("Your books stay where they are");
    const tree = section.getByRole("img", { name: /Example archive/ });
    await expect(tree).toBeVisible();
    for (const name of [
      "Your Archive/",
      ".archeion/",
      "Series/",
      "annotations.json",
      "library.json",
      "progress.json",
      "scanner-cache.json",
      "covers/",
      "backups/",
      "epub-writeback/",
    ])
      await expect(tree).toContainText(name);
    await expect(tree).not.toContainText(/Favorites\/|Filters\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await section.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}
