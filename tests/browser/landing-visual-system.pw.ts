import { expect, test } from "@playwright/test";

test("keyboard skip and visible focus reach real content", async ({ page }) => {
  await page.goto("/archeion/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("coarse pointer never tilts media or produces pointer glows", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/archeion/");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await page.mouse.move(150, 250);
    await page.getByRole("region", { name: "Archeion application preview" }).tap();
    await expect(page.locator("[data-landing] > svg")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Archeion application preview" }).locator("div"),
    ).toHaveCSS("transform", "none");
    await page.locator("summary").tap();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("200 percent zoom reflows full labels and usable menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/archeion/");
  // CSS zoom exercises doubled text/control metrics and layout, unlike pinch scaling.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const link of await page.getByRole("contentinfo").getByRole("link").all()) {
    expect(await link.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  // Browser zoom also halves the effective CSS viewport; exercise that reflow separately.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await page.setViewportSize({ width: 640, height: 450 });
  await page.locator("summary").click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu.getByRole("link", { name: "Library", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("summary")).toBeFocused();
});
