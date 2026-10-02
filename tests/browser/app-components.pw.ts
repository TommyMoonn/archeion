import { expect, test } from "@playwright/test";

test("Reader progress exposes the committed value after keyboard seeking", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=reader", { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("slider", { name: "Reading progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await progress.focus();
  await progress.press("ArrowRight");
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await expect(progress).toHaveAttribute("aria-valuetext", "33% · Chapter One");
  await page.getByRole("button", { name: "After progress" }).focus();
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await expect(progress).toHaveAttribute("aria-valuetext", "33% · Chapter One");
});

test("Reader hover and drag preview preserve committed semantics until seek commits", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=reader", { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("slider", { name: "Reading progress" });
  const fill = progress.locator(".reader-progress__fill");
  const preview = progress.locator(".reader-progress__preview");
  const bounds = await progress.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.75, y);

  await expect(preview).toContainText("75%");
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await expect(progress).toHaveAttribute("aria-valuetext", "32% · Chapter One");
  await expect(fill).toHaveAttribute("style", "width: 32%;");

  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.6, y);
  await expect(preview).toContainText("60%");
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await expect(progress).toHaveAttribute("aria-valuetext", "32% · Chapter One");
  await expect(fill).toHaveAttribute("style", "width: 32%;");

  await page.mouse.up();
  await expect(progress).toHaveAttribute("aria-valuenow", "60");
  await expect(progress).toHaveAttribute("aria-valuetext", "60% · Chapter One");
  await expect(fill).toHaveAttribute("style", /width: 60(?:\.0+)?%;/);

  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "After progress" }).focus();
  await expect(preview).toHaveCount(0);
  await expect(progress).toHaveAttribute("aria-valuenow", "60");
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
  await expect(series.locator("span")).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Library" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(series.locator("span")).toBeHidden();
  await page.keyboard.press("Tab");
  await series.focus();
  await expect(tooltip).toHaveText("Series");
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
