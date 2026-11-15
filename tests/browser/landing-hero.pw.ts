import { expect, test } from "@playwright/test";

for (const width of [320, 1280]) {
  test(`landing first paint is stable before hydration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if ("value" in entry && typeof entry.value === "number") {
            document.documentElement.dataset.shift = String(
              Number(document.documentElement.dataset.shift || 0) + entry.value,
            );
          }
      }).observe({ type: "layout-shift", buffered: true });
    });
    let release = () => {};
    const scripts = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fonts: string[] = [];
    await page.route("**/*.woff2", (route) => {
      fonts.push(route.request().url());
      return route.abort();
    });
    await page.route("**/*.js", async (route) => {
      await scripts;
      await route.continue();
    });
    try {
      await page.goto("/archeion/", { waitUntil: "commit" });
      await expect(page.locator("h1")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(() => performance.getEntriesByName("first-contentful-paint").length),
        )
        .toBe(1);
      const geometry = () =>
        page.locator("header, h1, #top p, main img").evaluateAll((nodes) =>
          nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      const before = await geometry();
      release();
      await page.waitForLoadState("load");
      await page.locator("summary").count();
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => Number(document.documentElement.dataset.shift || 0))).toBe(
        0,
      );
      expect(fonts).toEqual([]);
      expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
    } finally {
      release();
    }
  });
}

for (const route of ["/archeion/", "/archeion/docs/"]) {
  test(`font rejection reveals static content without React at ${route}`, async ({ page }) => {
    await page.addInitScript(() => {
      document.fonts.load = () => {
        document.documentElement.dataset.fontLoadRejected = "true";
        return Promise.reject(new Error("fixture font rejection"));
      };
    });
    await page.route("**/*.js", (route) => route.abort());
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-font-load-rejected", "true");
    await expect(page.locator("html")).not.toHaveAttribute("data-site-fonts-loading");
    expect(
      await page.locator("h1").evaluate((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility === "visible";
      }),
    ).toBe(true);
  });
}
