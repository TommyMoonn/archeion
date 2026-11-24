import { expect, test } from "@playwright/test";

test("temporary Reader opens a publication with navigation and appearance but no persistence", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/standalone-reader.html");
  await expect(page.locator(".epub-container iframe").first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Close Reader" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Annotations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bookmark", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find in book" })).toBeVisible();
  const navigation = page.getByRole("button", { name: "Book navigation" });
  await navigation.focus();
  await expect(navigation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Book navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /continuation/i }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close book navigation" }).click();
  await page.getByRole("button", { name: "Find in book" }).click();
  await page.getByRole("searchbox", { name: "Find text in book" }).fill("Fixture");
  await expect(page.getByRole("list", { name: "Search results" })).toBeVisible();
  await page.getByRole("button", { name: "Close find in book" }).click();
  await page.getByRole("button", { name: "Reader settings" }).click();
  await expect(page.getByRole("radiogroup", { name: "Book layout" })).toBeVisible();
});

test("malformed external publication stays in the Reader and can be closed", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/standalone-reader.html?malformed");
  await expect(page.locator(".reader-page [role=alert]").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Close Reader" })).toBeVisible();
  await page.getByRole("button", { name: "Close Reader" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-closed-reader", "true");
});
