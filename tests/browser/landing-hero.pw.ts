import { expect, test } from "@playwright/test";

const viewports = [
  { name: "minimum", width: 320, height: 800 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1600, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`production Hero remains legible without clipping at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/docs/", { waitUntil: "networkidle" });

    const hero = page.locator(".hero");
    const product = page.locator(".hero-product");
    const reader = page.locator(".hero-product__reader");
    const bridge = page.locator(".hero-product__bridge");

    await expect(hero).toBeVisible();
    await expect(product).toBeVisible();
    await expect(reader).toBeVisible();
    await expect(bridge).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your EPUB library");
    await expect(hero.getByRole("link", { name: "Download for Windows" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Explore the library" })).toBeVisible();

    await page.waitForTimeout(900);

    const metrics = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>(".hero");
      const product = document.querySelector<HTMLElement>(".hero-product");
      const reader = document.querySelector<HTMLElement>(".hero-product__reader");
      const bridge = document.querySelector<HTMLElement>(".hero-product__bridge");
      if (!hero || !product || !reader || !bridge) throw new Error("Hero production nodes missing");

      const heroRect = hero.getBoundingClientRect();
      const productRect = product.getBoundingClientRect();
      const readerRect = reader.getBoundingClientRect();
      const bridgeRect = bridge.getBoundingClientRect();
      const contained = (outer: DOMRect, inner: DOMRect) =>
        inner.left >= outer.left - 1 &&
        inner.right <= outer.right + 1 &&
        inner.top >= outer.top - 1 &&
        inner.bottom <= outer.bottom + 1;

      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        productInHero: contained(heroRect, productRect),
        readerInProduct: contained(productRect, readerRect),
        bridgeInHero: contained(heroRect, bridgeRect),
        heroHeight: heroRect.height,
        productHeight: productRect.height,
      };
    });

    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.productInHero).toBe(true);
    expect(metrics.readerInProduct).toBe(true);
    expect(metrics.bridgeInHero).toBe(true);
    expect(metrics.heroHeight).toBeGreaterThan(metrics.productHeight);
  });
}

test("production Hero has bounded full motion and a complete reduced-motion state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/", { waitUntil: "networkidle" });

  const fullMotion = await page.evaluate(() =>
    [".hero-product__library", ".hero-product__bridge", ".hero-product__reader"].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return { name: style.animationName, count: style.animationIterationCount };
    }),
  );
  expect(fullMotion.map(({ name }) => name)).toEqual([
    "hero-library-recede",
    "hero-cover-carry",
    "hero-reader-open",
  ]);
  expect(fullMotion.every(({ count }) => count === "1")).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const reducedMotion = await page.evaluate(() =>
    [".hero-product__library", ".hero-product__bridge", ".hero-product__reader"].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        animation: style.animationName,
        visible:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0,
      };
    }),
  );
  expect(reducedMotion.every(({ animation }) => animation === "none")).toBe(true);
  expect(reducedMotion.every(({ visible }) => visible)).toBe(true);
});

test("Hero actions are keyboard reachable and no-animation rendering keeps the product story", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/", { waitUntil: "networkidle" });

  const hero = page.locator(".hero");
  const primary = hero.getByRole("link", { name: "Download for Windows" });
  await primary.focus();
  await expect(primary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("link", { name: "Explore the library" })).toBeFocused();

  await page.addStyleTag({
    content:
      ".hero-product *, .hero-product *::before, .hero-product *::after { animation: none !important; transition: none !important; }",
  });
  await expect(page.locator(".hero-product__library")).toBeVisible();
  await expect(page.locator(".hero-product__bridge")).toBeVisible();
  await expect(page.locator(".hero-product__reader")).toBeVisible();
});

test("coarse pointer keeps the complete H04 product relationship", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/docs/", { waitUntil: "networkidle" });

  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await expect(page.locator(".hero-product__library")).toBeVisible();
  await expect(page.locator(".hero-product__bridge")).toBeVisible();
  await expect(page.locator(".hero-product__reader")).toBeVisible();
  const hero = page.locator(".hero");
  await expect(hero.getByRole("link", { name: "Download for Windows" })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Explore the library" })).toBeVisible();

  await context.close();
});
