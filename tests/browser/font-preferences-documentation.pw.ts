import { expect, test } from "@playwright/test";

test("font documentation exposes the three roles, recovery, and reachable links at narrow and wide widths", async ({
  page,
}, testInfo) => {
  for (const appearance of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/docs/documentation/customization/appearance/#app-fonts", {
        waitUntil: "load",
      });
      await page.evaluate(() => document.fonts.ready);
      const article = page.locator("[data-doc-article]");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(article).toContainText("Inter (Default)");
      await expect(article).toContainText("Archeion Default");
      await expect(article).toContainText("Use interface font");
      await expect(article).toContainText("Restart Archeion");
      await expect(page.locator("#app-fonts")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`appearance-${appearance}-${width}.png`) });
      const reader = article.getByRole("link", { name: "Reader typeface", exact: true });
      await reader.press("Enter");
      await expect(page).toHaveURL(/reading\/#reader-typeface$/);
      await expect(article).toContainText("Book serif (Default)");
      await expect(article).toContainText("Atkinson Hyperlegible");
      await expect(article).toContainText("Unavailable");
      await expect(article).toContainText("Restart Archeion");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`reader-${appearance}-${width}.png`) });
    }
  }
});
