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
    .toBeLessThanOrEqual(1);
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
