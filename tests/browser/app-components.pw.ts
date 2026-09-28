import { expect, test } from "@playwright/test";

test("Reader progress exposes the committed value after keyboard seeking", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=reader", { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("slider", { name: "Reading progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await progress.focus();
  await progress.press("ArrowRight");
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await page.getByRole("button", { name: "After progress" }).focus();
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await expect(progress).toHaveAttribute("aria-valuetext", "33% · Chapter One");
});

test("narrow Library navigation keeps names and positions its collapsed tooltip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/tests/browser/fixtures/?view=library", { waitUntil: "domcontentloaded" });

  const navigation = page.getByRole("navigation", { name: "Library navigation" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const series = navigation.getByRole("button", { name: "Series" });
  await expect(series.locator("span")).toBeHidden();
  await series.hover();

  const tooltip = page.locator(".app-tooltip");
  await expect(tooltip).toHaveText("Series");
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(700);

  await page.setViewportSize({ width: 480, height: 800 });
  await expect(series).toBeVisible();
  await expect(series.locator("span")).toBeHidden();
  await expect(navigation.getByRole("button", { name: "Library" })).toBeVisible();
});

test("Dialog moves focus inside and returns it to its opener on Escape", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=dialog", { waitUntil: "domcontentloaded" });

  const opener = page.getByRole("button", { name: "Open sample dialog" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Sample dialog" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
