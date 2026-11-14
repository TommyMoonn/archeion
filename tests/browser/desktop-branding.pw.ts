import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html";

for (const mode of ["about", "archive-manager"] as const) {
  test(`${mode}: approved logo follows the application base without moving the identity`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${fixture}?window=${mode}&windowInstance=7`);
    const brand = page.locator(".brand-logo");
    await expect(brand).toBeVisible();
    await expect(page.getByRole("heading", { name: "Archeion", exact: true })).toBeVisible();
    const before = await brand.boundingBox();
    for (const base of ["light", "dark"]) {
      await page.evaluate((base) => {
        document.documentElement.dataset.appTheme = base;
      }, base);
      const image = brand.locator("img:visible");
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute("src", new RegExp(`archeion-logo-${base}\\.png`));
      await expect
        .poll(() =>
          image.evaluate(
            (node: HTMLImageElement) =>
              node.complete && node.naturalWidth === 500 && node.naturalHeight === 500,
          ),
        )
        .toBe(true);
      expect(await brand.boundingBox()).toEqual(before);
      expect((await image.boundingBox())!.width).toBe(mode === "about" ? 64 : 68);
      await page.screenshot({ path: test.info().outputPath(`${mode}-${base}.png`) });
    }
    const heading = page.getByRole("heading", { name: "Archeion", exact: true });
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--font-display", "monospace"),
    );
    expect(await heading.evaluate((node) => getComputedStyle(node).fontFamily)).toBe("monospace");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(heading).toBeVisible();
    await expect(page.locator('img[src*="wordmark"]')).toHaveCount(0);
  });
}

test("Library retains text branding and Settings keeps its compact product eyebrow", async ({
  page,
}) => {
  await page.goto(`${fixture}?window=main`);
  const title = page.locator(".library-titlebar-composition__wordmark");
  await expect(title).toHaveText("Archeion");
  await expect(title.locator("img")).toHaveCount(0);
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--font-display", "monospace"),
  );
  expect(await title.evaluate((node) => getComputedStyle(node).fontFamily)).toBe("monospace");
  await page.goto(`${fixture}?window=settings&windowInstance=7`);
  await expect(page.locator(".settings-sidebar__header > p")).toHaveText("Archeion");
  await expect(page.locator(".settings-sidebar img")).toHaveCount(0);
});
