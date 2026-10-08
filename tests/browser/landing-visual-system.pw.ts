import { expect, test } from "@playwright/test";

for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["tablet", 768, 1024],
  ["mobile", 390, 844],
  ["minimum", 320, 800],
] as const) {
  test(`site roles and product controls remain readable at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/docs/", { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => {
      const css = (selector: string) =>
        getComputedStyle(document.querySelector<HTMLElement>(selector)!);
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        bodySize: parseFloat(css("body").fontSize),
        sectionSize: parseFloat(css(".section-heading h2").fontSize),
        localSize: parseFloat(css(".local-first-heading h2").fontSize),
        getStartedSize: parseFloat(css(".get-started__copy h2").fontSize),
        libraryControlSize: parseFloat(css(".app-library__search input").fontSize),
        readerControlSize: parseFloat(css(".reader-mode-switch button").fontSize),
        darkReaderBackground: css(".reader-scene").backgroundColor,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.bodySize).toBeGreaterThanOrEqual(16);
    expect(metrics.sectionSize).toBe(metrics.localSize);
    expect(metrics.sectionSize).toBe(metrics.getStartedSize);
    expect(metrics.libraryControlSize).toBeGreaterThanOrEqual(12);
    expect(metrics.readerControlSize).toBeGreaterThanOrEqual(12);
    expect(metrics.darkReaderBackground).toBe("rgb(23, 23, 23)");
  });
}

test("focus, Reader themes and reduced motion remain meaningful", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/", { waitUntil: "networkidle" });

  const search = page.locator(".app-library__search input");
  await search.focus();
  await expect(search).toBeFocused();
  const searchFocus = await search.evaluate((element) =>
    getComputedStyle(element.parentElement!).boxShadow,
  );
  expect(searchFocus).not.toBe("none");

  const themeGroup = page.locator(".reader-theme-switch");
  await themeGroup.getByRole("radio", { name: /sepia/i }).click();
  await expect(page.locator(".reader-demo")).toHaveAttribute("data-theme", "sepia");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const styles = await page.locator("[data-reveal]").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform, duration: style.transitionDuration };
  });
  expect(styles.opacity).toBe("1");
  expect(styles.transform).toBe("none");
  expect(styles.duration.split(",").every((value) => parseFloat(value) <= 0.001)).toBe(true);
});
