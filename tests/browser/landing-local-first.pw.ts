import { expect, test } from "@playwright/test";

for (const width of [320, 375, 390, 600, 768, 800, 1020, 1280, 1440]) {
  test(`archive ownership and full tree remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/archeion/#files");
    const section = page.locator("#files");
    await expect(section.getByRole("heading")).toHaveText("Your EPUB files stay in their folders.");
    await expect(section).toContainText("Your books stay where they are");
    const tree = section.getByRole("img", { name: /Example archive/ });
    await expect(tree).toBeVisible();
    await expect(tree.locator("pre")).toHaveCSS("font-size", "13px");
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

    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText("© 2026 Khoa Luong")).toHaveCSS("font-size", "12px");
    await expect(footer.getByRole("navigation", { name: "Footer links" })).toHaveCSS(
      "font-size",
      "13px",
    );
    expect(
      await footer.getByRole("link").evaluateAll((links) =>
        links.every((link) => {
          const bounds = link.getBoundingClientRect();
          return bounds.left >= -1 && bounds.right <= innerWidth + 1;
        }),
      ),
    ).toBe(true);
  });
}

test("supporting text reflows at 200% and 400% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/archeion/");
  await page.evaluate(() => document.fonts.ready);
  for (const zoom of [2, 4]) {
    await page.evaluate((factor) => {
      document.documentElement.style.zoom = String(factor);
    }, zoom);
    await expect(page.getByRole("contentinfo").getByText("© 2026 Khoa Luong")).toBeVisible();
    await expect(page.locator("#files [role=img] pre")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Landing page should not overflow at ${zoom * 100}% zoom`,
    ).toBe(true);
  }
});
