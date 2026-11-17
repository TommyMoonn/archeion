import { expect, test } from "@playwright/test";

test("wordmark returns to absolute top and Your files frames archive and download", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1716, height: 1045 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/archeion/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Your files", exact: true })
    .click();
  await expect(page.locator("#files")).toBeFocused();
  const tree = page.locator("#files [role=img]");
  await expect
    .poll(() => tree.evaluate((node) => Math.abs(node.getBoundingClientRect().top - 94)))
    .toBeLessThanOrEqual(2);
  await expect(
    page.locator("#download").getByRole("link", { name: "View all releases" }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("files-destination.png") });
  await page.getByRole("link", { name: "Archeion home", exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#top")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("home-destination.png") });
});

test("native anchors scroll smoothly unless reduced motion is requested", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/archeion/");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "smooth");
  const positions = await page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const link = document.querySelector<HTMLAnchorElement>(
          'nav[aria-label="Main navigation"] a[href="#files"]',
        );
        if (!link) return reject(new Error("Missing files anchor"));
        const values: number[] = [];
        const deadline = performance.now() + 5000;
        const sample = () => {
          values.push(scrollY);
          const files = document.getElementById("files");
          if (files && Math.abs(files.getBoundingClientRect().top + 12) <= 1)
            return resolve(values);
          if (performance.now() > deadline)
            return reject(new Error("Anchor scroll did not settle"));
          requestAnimationFrame(sample);
        };
        link.click();
        sample();
      }),
  );
  expect(positions.some((value) => value > 0 && value < Math.max(...positions) - 10)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  await page.getByRole("link", { name: "Archeion home", exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page.locator("[data-landing]")).toHaveCount(0);
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});

test("desktop links and hero guide lead to the correct destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/archeion/");

  const actions = page.locator("header > div > div > a");
  await expect(actions).toHaveText(["Download", "Docs", "GitHub"]);
  await expect(actions.nth(1)).toHaveAttribute("href", "/archeion/docs/");
  await expect(actions.nth(2)).toHaveAttribute("href", "https://github.com/TommyMoonn/archeion");
  const guide = page.getByRole("link", { name: "View installation guide", exact: true });
  await expect(guide).toHaveAttribute("href", "/archeion/docs/getting-started/installing/");
  await expect(guide).not.toHaveAttribute("target", "_blank");
  await expect(
    page.locator("#download").getByRole("link", { name: "View all releases" }),
  ).toHaveAttribute("href", "https://github.com/TommyMoonn/archeion/releases");
  await guide.click();
  await expect(page).toHaveURL(/\/archeion\/docs\/getting-started\/installing\/$/);
  await expect(page.getByRole("heading", { name: "Install Archeion", exact: true })).toBeVisible();
});

test("mobile navigation exposes Docs without replacing existing items", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/archeion/");
  await page.locator("summary[aria-controls=landing-mobile-navigation]").click();
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const name of ["Library", "Reading", "Your files", "Docs", "GitHub"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute(
    "href",
    "/archeion/docs/",
  );
  await expect(nav.getByRole("link", { name: "Download for Windows" })).toBeVisible();
  await nav.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page).toHaveURL(/\/archeion\/docs\/$/);
  await expect(page.locator("article h1")).toHaveText("Archeion documentation");
});
