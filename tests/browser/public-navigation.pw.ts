import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const activation of ["keyboard", "pointer"] as const) {
  test(`landing ${activation} activation keeps native anchors and destination focus`, async ({
    page,
  }) => {
    if (activation === "keyboard") await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/docs/", { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".nav-toggle");
    const navigation = page.locator("#site-nav");
    await toggle.press("Enter");
    const library = navigation.getByRole("link", { name: "Library", exact: true });
    if (activation === "keyboard") await library.press("Enter");
    else await library.click();
    await expect(page).toHaveURL(/\/docs\/#library$/);
    await expect(navigation).toHaveAttribute("inert", "");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#library")).toBeFocused();
    if (activation === "keyboard") {
      await page.screenshot({ path: test.info().outputPath("landing-destination-focus.png") });
    }
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.getElementById("library")?.contains(document.activeElement),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const dismissal of ["Escape", "toggle", "outside"] as const) {
  test(`landing ${dismissal} dismissal restores the opener`, async ({ page }) => {
    await page.goto("/docs/", { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".nav-toggle");
    await toggle.press("Enter");
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "toggle") await toggle.click();
    else await page.locator("#hero-title").click();
    await expect(toggle).toBeFocused();
    await expect(page.locator("#site-nav")).toHaveAttribute("inert", "");
  });
}

for (const dismissal of ["Escape", "close", "backdrop"] as const) {
  test(`documentation ${dismissal} dismissal restores the opener and releases the modal background`, async ({
    page,
  }) => {
    await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
    const opener = page.locator("[data-nav-open]");
    await opener.press("Enter");
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "close") await page.locator("[data-nav-close]").press("Space");
    else await page.locator("[data-nav-backdrop]").click({ position: { x: 380, y: 400 } });
    await expect(opener).toBeFocused();
    await expect(page.locator("[data-sidebar]")).toHaveAttribute("inert", "");
    await expect(page.locator(".docs-layout")).not.toHaveAttribute("inert", "");
  });
}

test("documentation same-page activation focuses content after releasing the drawer trap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
  const sidebar = page.locator("[data-sidebar]");
  const overview = sidebar.getByRole("link", { name: "Overview", exact: true });
  // The current sidebar uses page routes. Exercise its same-page link contract on the real shell.
  await overview.evaluate((link) => link.setAttribute("href", "#get-started"));
  await page.locator("[data-nav-open]").press("Enter");
  await overview.press("Enter");
  await expect(page).toHaveURL(/\/documentation\/#get-started$/);
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(sidebar).not.toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".docs-layout")).not.toHaveAttribute("inert", "");
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Getting started", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("documentation-destination-focus.png") });
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Link to section: Getting started", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("main").getByRole("link", { name: /Install Archeion/ }),
  ).toBeFocused();
});

test("documentation cross-page activation never briefly restores opener focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.addEventListener("focusin", (event) => {
      if (event.target instanceof HTMLElement && event.target.matches("[data-nav-open]")) {
        sessionStorage.setItem(
          "navigation-opener-focus-count",
          String(Number(sessionStorage.getItem("navigation-opener-focus-count") || 0) + 1),
        );
      }
    });
  });
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-nav-open]").press("Enter");
  await page.evaluate(() => sessionStorage.setItem("navigation-opener-focus-count", "0"));
  await page
    .locator("[data-sidebar]")
    .getByRole("link", { name: "Installation", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/documentation\/getting-started\/installing\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem("navigation-opener-focus-count"))).toBe(
    "0",
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("documentation drawer retains modal semantics and cycles keyboard focus", async ({ page }) => {
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-nav-open]").press("Enter");
  const sidebar = page.getByRole("dialog", { name: "Documentation navigation", exact: true });
  const close = sidebar.getByRole("button", {
    name: "Close documentation navigation",
    exact: true,
  });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const last = sidebar.locator("a[href]").last();
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await expect(page.locator(".docs-header")).toHaveAttribute("inert", "");
  await expect(page.locator(".docs-layout")).toHaveAttribute("inert", "");
});

test("landing desktop navigation is not given mobile focus behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  await page.locator("#site-nav").getByRole("link", { name: "Reader", exact: true }).click();
  await expect(page).toHaveURL(/#reader$/);
  await expect(page.locator("#reader")).not.toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#site-nav")).not.toHaveAttribute("inert", "");
});
