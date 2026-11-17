import { expect, test } from "@playwright/test";

for (const route of ["", "customization/custom-themes/"]) {
  test(`section search uses the static corpus from ${route || "overview"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: route ? 1280 : 320, height: 900 });
    await page.goto(`/archeion/docs/${route}`, { waitUntil: "load" });
    // Load does not guarantee that the deferred React effects registered shortcuts.
    await expect(page.getByRole("button", { name: "Copy page", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    const input = dialog.getByRole("searchbox", {
      name: "Search documentation",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("matching digest");
    const results = dialog.getByRole("navigation", { name: "Documentation search results" });
    const result = results.getByRole("link");
    await expect(result).toHaveCount(1);
    await expect(result).toHaveAttribute("href", /\/docs\/guides\/archive-health\/#duplicates$/);
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

test("body matches show relevant excerpts without changing result names or keyboard navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/archeion/docs/", { waitUntil: "load" });
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox");
  const results = dialog.getByRole("navigation", { name: "Documentation search results" });

  await input.fill("matching digest");
  const result = results.getByRole("link");
  await expect(result).toHaveCount(1);
  await expect(result).toHaveAccessibleName(
    "Compare duplicate groups before changing files Archive health · Using Archeion",
  );
  await expect(result).toHaveAttribute("aria-description", /matching digest/i);
  await expect(result).toHaveAccessibleDescription(/matching digest/i);
  const excerpt = result.locator("[data-search-excerpt]");
  await expect(excerpt).toContainText("matching digest");
  await expect(excerpt.locator("mark")).toHaveText(["matching", "digest"]);
  await expect(excerpt).toHaveCSS("-webkit-line-clamp", "2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await input.fill("archive health");
  await expect(results.getByRole("link").first()).toHaveAttribute(
    "href",
    /\/guides\/archive-health\/$/,
  );
  await expect(results.getByRole("link").first().locator("[data-search-excerpt]")).toHaveCount(0);
  await input.fill("matching digest");
  await input.press("ArrowDown");
  await expect(result).toBeFocused();
  await result.press("Enter");
  await expect(page).toHaveURL(/\/guides\/archive-health\/#duplicates$/);
});

test("page titles and section headings rank before body matches", async ({ page }) => {
  await page.goto("/archeion/docs/", { waitUntil: "load" });
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox");
  const results = dialog
    .getByRole("navigation", { name: "Documentation search results" })
    .locator("a");
  await input.fill("archive health");
  await expect(results.first()).toHaveAttribute("href", /\/guides\/archive-health\/$/);
  await input.fill("compare duplicate groups before changing files");
  await expect(results.first()).toHaveAttribute("href", /\/guides\/archive-health\/#duplicates$/);
  await input.fill("no-such-documentation-term");
  await expect(results).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText("No matching results.");
  await input.fill("");
  await expect(results).toHaveCount(10);
  await expect(dialog.getByRole("status")).toHaveText("");
  await expect(dialog.locator("footer")).toContainText("10 of 24 results");
  expect(
    await results.evaluateAll((links) =>
      links.every((link) => !link.getAttribute("href")?.includes("#")),
    ),
  ).toBe(true);
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
