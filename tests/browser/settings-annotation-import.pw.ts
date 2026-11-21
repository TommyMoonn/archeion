import { expect, test } from "@playwright/test";

test("previews annotation import, cancels by keyboard, and skips the same file after confirming", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/fixtures/ui-stability.html?window=settings&windowInstance=8&settingsDelay=0&motion=off",
  );
  await page.getByRole("button", { name: "Storage", exact: true }).click();
  const importButton = page.getByRole("button", { name: "Import annotations", exact: true });
  const preview = page.getByRole("dialog", { name: "Review annotation import" });
  await importButton.click();
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Cancel" })).toBeFocused();
  await preview.getByText("Unmatched book IDs", { exact: true }).click();
  await expect(preview.getByText("unmatched-book", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(importButton).toBeFocused();

  await importButton.click();
  await preview.getByRole("button", { name: "Import annotations" }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText("Imported 1 annotation.", { exact: false })).toBeVisible();
  await importButton.click();
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Import annotations" })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Close" })).toBeFocused();
});
