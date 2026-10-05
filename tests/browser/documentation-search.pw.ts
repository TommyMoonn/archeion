import { expect, test } from "@playwright/test";
import registry from "../../docs/documentation/page-registry.json" with { type: "json" };

for (const route of ["", "customization/custom-themes/"]) {
  test(`section search uses the static corpus from ${route || "overview"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: route ? 1280 : 320, height: 900 });
    await page.goto(`/docs/documentation/${route}`, { waitUntil: "load" });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    const input = dialog.getByRole("searchbox", {
      name: "Search documentation content",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("matching digest");
    const results = dialog.getByRole("navigation", { name: "Documentation search results" });
    const result = results.getByRole("link");
    await expect(result).toHaveCount(1);
    await expect(result).toHaveAttribute(
      "href",
      /\/documentation\/guides\/archive-health\/#duplicates$/,
    );
    await expect(result).toHaveAccessibleName(
      "Compare duplicate groups before changing files Archive health · Using Archeion",
    );
    await expect(dialog.getByRole("status")).toHaveText("1 result found.");
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.screenshot({
      path: test
        .info()
        .outputPath(route ? "section-search-desktop.png" : "section-search-narrow.png"),
    });
    await result.press("Enter");
    await expect(page).toHaveURL(/\/guides\/archive-health\/#duplicates$/);
    await expect(page.locator("#duplicates")).toBeInViewport();
    expect(errors).toEqual([]);
  });
}

test("page titles and section headings rank before body matches", async ({ page }) => {
  await page.goto("/docs/documentation/", { waitUntil: "load" });
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox");
  const results = dialog.locator("[data-search-results] a");
  await input.fill("archive health");
  await expect(results.first()).toHaveAttribute("href", /\/guides\/archive-health\/$/);
  await input.fill("compare duplicate groups before changing files");
  await expect(results.first()).toHaveAttribute("href", /\/guides\/archive-health\/#duplicates$/);
  await input.fill("no-such-documentation-term");
  await expect(results).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText("No matching results.");
  await input.fill("");
  await expect(results).toHaveCount(registry.pages.length);
  await expect(dialog.getByRole("status")).toHaveText("");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
