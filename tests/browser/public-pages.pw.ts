import { expect, test } from "@playwright/test";

test("landing mobile navigation moves and restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });

  const toggle = page.locator(".nav-toggle");
  const navigation = page.locator("#site-nav");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName("Open navigation");
  await expect(navigation).toHaveAttribute("inert", "");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Close navigation");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Library" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("Open navigation");
  await expect(navigation).toHaveAttribute("inert", "");
});

test("documentation mobile drawer exposes landmarks and restores its opener", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });

  const opener = page.getByRole("button", { name: "Open documentation navigation" });
  const sidebar = page.locator("#docs-sidebar");
  const layout = page.locator(".docs-layout");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(sidebar).toHaveAttribute("inert", "");

  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Documentation navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close documentation navigation" })).toBeFocused();
  await expect(layout).toHaveAttribute("inert", "");

  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(page.getByRole("main")).toBeVisible();
});

test("forced colors preserve a visible navigation focus indicator", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const opener = page.getByRole("button", { name: "Open documentation navigation" });
  await expect(opener).toBeFocused();
  await expect(opener).toBeVisible();
  expect(
    await opener.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    }),
  ).toEqual({ style: "solid", width: "2px" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reduced motion shows landing content without reveal movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });

  const reveal = page.locator("[data-reveal]").first();
  await expect(reveal).toHaveClass(/is-visible/);
  const style = await reveal.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { opacity: computed.opacity, transform: computed.transform };
  });
  expect(style.opacity).toBe("1");
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(style.transform);
});
