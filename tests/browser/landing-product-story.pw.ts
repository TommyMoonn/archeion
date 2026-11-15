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
