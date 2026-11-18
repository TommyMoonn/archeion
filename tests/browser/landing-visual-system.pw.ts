import { expect, test } from "@playwright/test";

test("first Tab focuses the wordmark and navigation still reaches content", async ({ page }) => {
  await page.goto("/archeion/");
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(0);
  await page.keyboard.press("Tab");
  const home = page.getByRole("link", { name: "Archeion home" });
  await expect(home).toBeFocused();
  await expect(home).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  const library = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
    name: "Library",
  });
  await expect(library).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#library")).toBeFocused();
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

test("landing navigation and footer retain usable hit areas", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/archeion/");
    const targets = [
      page.getByRole("link", { name: "Archeion home" }),
      page.getByRole("link", { name: "Back to top" }),
      ...(await page.getByRole("contentinfo").getByRole("link").all()),
      page.getByRole("link", { name: "View installation guide" }),
    ];
    if (width > 1020) {
      targets.push(
        ...(await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link")
          .all()),
        ...(await page.locator("header > div > div > a").all()),
      );
    }
    for (const target of targets) {
      const box = await target.boundingBox();
      if (!box) throw new Error(`Missing target at ${width}px`);
      expect(box.height, `Hit area too short at ${width}px`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("mobile navigation shows its open state and returns to Menu on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/archeion/");
  const toggle = page.locator('summary[aria-controls="landing-mobile-navigation"]');
  await expect(toggle).toHaveText("Menu");
  const closedWidth = (await toggle.boundingBox())?.width;
  await toggle.click();
  await expect(toggle).toHaveText("Close");
  expect((await toggle.boundingBox())?.width).toBe(closedWidth);
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveText("Menu");
  await expect(toggle).toBeFocused();
});
