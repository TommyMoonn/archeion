import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
});

test("Library preview separates destinations, archive folders, and collection tools", async ({
  page,
}) => {
  const preview = page.getByLabel("Interactive Archeion library preview");
  const navigation = preview.getByRole("navigation", { name: "Library preview navigation" });
  const title = preview.locator("[data-preview-title]");
  const results = preview.locator("[data-preview-results]");
  const filter = preview.getByRole("button", { name: "In progress", exact: true });

  await navigation.getByRole("button", { name: "Series", exact: true }).press("Enter");
  await expect(title).toHaveText("Series");
  await expect(preview.locator("[data-series-grid]")).toBeVisible();
  await expect(results).toHaveText("3 series");
  await expect(filter).toBeDisabled();

  await navigation.getByRole("button", { name: "Folders", exact: true }).click();
  await expect(title).toHaveText("Folders");
  await expect(preview.locator("[data-folder-overview]")).toBeVisible();
  await preview.getByRole("button", { name: /Research\s*3 books/ }).click();
  await expect(title).toHaveText("Research");
  await expect(results).toHaveText("3 books");
  await expect(filter).toBeEnabled();

  await navigation.getByRole("button", { name: "Library", exact: true }).click();
  const search = preview.getByRole("searchbox", { name: "Search current Library preview" });
  await search.fill("signal");
  await expect(results).toHaveText("1 book");
  await expect(preview.locator(".book-card:not(.is-hidden) strong")).toHaveText("Signal and Dust");
  await search.fill("");
  await filter.press("Space");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(results).toHaveText("5 books");
});

test("Library preview controls remain reachable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = page.getByLabel("Interactive Archeion library preview");
  const search = preview.getByRole("searchbox", { name: "Search current Library preview" });
  const filter = preview.getByRole("button", { name: "In progress", exact: true });
  const sort = preview.getByRole("combobox", { name: "Sort current Library preview" });

  for (const control of [search, filter, sort]) {
    await control.focus();
    await expect(control).toBeFocused();
  }

  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("Reader rail contains only reading controls and preserves their interactions", async ({
  page,
}) => {
  const readerSection = page.locator("#reader");
  const reader = readerSection.locator("[data-reader-demo]");
  const console = reader.locator(".reader-console");
  const mode = reader.getByRole("group", { name: "Reader mode", exact: true });
  const paged = mode.getByRole("button", { name: "Paged", exact: true });
  const continuous = mode.getByRole("button", { name: "Continuous", exact: true });
  const typeSize = reader.getByRole("slider", { name: "Reader type size", exact: true });

  await expect(console.locator(".reader-console__group")).toHaveCount(3);
  await expect(console.getByText("Ready when you return", { exact: true })).toHaveCount(0);
  await expect(console.getByText("Local dictionary", { exact: true })).toHaveCount(0);
  await expect(console.getByText("Series continuation", { exact: true })).toHaveCount(0);

  await expect(paged).toHaveAttribute("aria-pressed", "true");
  await continuous.press("Space");
  await expect(continuous).toHaveAttribute("aria-pressed", "true");
  await expect(reader).toHaveAttribute("data-mode", "continuous");
  await expect(reader.locator("[data-reader-mode-status]")).toHaveText("Continuous scrolling");

  const sepia = reader.getByRole("radio", { name: "Sepia theme", exact: true });
  await sepia.focus();
  await sepia.press("Space");
  await expect(sepia).toHaveAttribute("aria-checked", "true");
  await expect(reader).toHaveAttribute("data-theme", "sepia");

  await typeSize.focus();
  await typeSize.press("ArrowRight");
  await expect(page.locator("#reader-size-output")).toHaveText("19");

  await expect(reader.locator("[data-reader-page-count]")).toContainText("68%");
  await expect(reader.getByRole("button", { name: "Open annotations", exact: true })).toBeVisible();
  await expect(readerSection.getByText(/Define text with installed dictionaries/)).toBeVisible();
  await expect(readerSection.getByText(/next Series volume after completion/)).toBeVisible();
});
