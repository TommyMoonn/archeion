import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html";

async function instrument(page: Page, hold = false) {
  await page.addInitScript((hold) => {
    const control = {
      hold,
      fail: false,
      decodes: 0,
      active: 0,
      peak: 0,
      created: 0,
      revoked: 0,
      live: new Set<string>(),
      release: [] as Array<() => void>,
    };
    Object.assign(window, { coverControl: control });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      control.created++;
      control.live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (control.live.delete(url)) control.revoked++;
      revoke(url);
    };
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      control.decodes++;
      control.active++;
      control.peak = Math.max(control.peak, control.active);
      try {
        if (control.hold) await new Promise<void>((resolve) => control.release.push(resolve));
        if (control.fail) throw new Error("Synthetic invalid cover");
        await decode.call(this);
      } finally {
        control.active--;
      }
    };
  }, hold);
}

declare global {
  interface Window {
    coverControl: {
      hold: boolean;
      fail: boolean;
      decodes: number;
      active: number;
      peak: number;
      created: number;
      revoked: number;
      live: Set<string>;
      release: Array<() => void>;
    };
  }
}

test("keeps card geometry and placeholder until decode completes", async ({ page }) => {
  await instrument(page, true);
  await page.goto(`${fixture}?count=2`);
  const cover = page.locator(".book-card .book-cover").first();
  await expect.poll(() => page.evaluate(() => window.coverControl.created)).toBe(2);
  await expect(cover).toHaveAttribute("data-cover-state", "loading");
  await expect(cover.locator("img")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.coverControl.decodes)).toBe(2);
  const before = await cover.boundingBox();
  await page.evaluate(() => {
    window.coverControl.hold = false;
    window.coverControl.release.forEach((resolve) => resolve());
  });
  await expect(cover).toHaveAttribute("data-cover-state", "available");
  const after = await cover.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
  expect(await cover.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(
    120,
  );
});

test("failed decode keeps fallback and releases invalid URLs", async ({ page }) => {
  await instrument(page, true);
  await page.goto(`${fixture}?count=2`);
  await expect.poll(() => page.evaluate(() => window.coverControl.decodes)).toBe(2);
  await page.evaluate(() => {
    window.coverControl.fail = true;
    window.coverControl.release.forEach((resolve) => resolve());
  });
  await expect(page.locator(".book-card [data-cover-state=unavailable]")).toHaveCount(2);
  await expect(page.locator(".book-card .book-cover img")).toHaveCount(0);
  expect(await page.evaluate(() => window.coverControl.revoked)).toBe(2);
});

test("search, grid/list and Reader return reuse decoded resources", async ({ page }) => {
  await instrument(page);
  await page.goto(`${fixture}?count=2`);
  await expect(page.locator(".book-card [data-cover-state=available]")).toHaveCount(2);
  const url = await page.locator(".book-card img").first().getAttribute("src");
  const count = await page.evaluate(() => window.coverControl.decodes);
  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.fill("no-such-book");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await search.fill("");
  await expect(page.locator(".book-card [data-cover-state=available]")).toHaveCount(2);
  expect(await page.locator(".book-card img").first().getAttribute("src")).toBe(url);
  await page.evaluate(() => window.uiStabilityFixture.setView("list"));
  await expect(page.locator(".book-row [data-cover-state=available]")).toHaveCount(2);
  expect(await page.evaluate(() => window.coverControl.decodes)).toBe(count);
  await page.locator(".book-row__select").first().click();
  await page.getByRole("button", { name: "Read book", exact: true }).click();
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect(page.locator(".book-row [data-cover-state=available]")).toHaveCount(2);
  expect(await page.locator(".book-row img").first().getAttribute("src")).toBe(url);
  expect(await page.evaluate(() => window.coverControl.decodes)).toBe(count);
  await page.evaluate(() => window.uiStabilityFixture.switchArchive("b"));
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().archive)).toBe("b");
  await expect(page.locator(".book-row [data-cover-state=available]")).toHaveCount(2);
  expect(await page.evaluate((url) => window.coverControl.live.has(url!), url)).toBe(false);
});

for (const view of ["grid", "list"] as const) {
  for (const count of [50, 500, 3000]) {
    test(`${view} bounds loading and resources across ${count} books and fast reversal`, async ({
      page,
    }, info) => {
      await instrument(page);
      await page.goto(`${fixture}?count=${count}`);
      await expect(page.locator(".book-grid")).toBeVisible();
      await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
      await expect(page.locator(`.book-${view}`)).toBeVisible();
      await expect(page.locator("[data-cover-state=available]").first()).toBeVisible();
      const initial = await page.evaluate(() => ({
        decodes: window.coverControl.decodes,
        mounted: document.querySelectorAll(".book-cover").length,
      }));
      expect(initial.decodes).toBeLessThan(count);
      for (const fraction of [0.5, 0.9, 0.1, 0]) {
        await page.locator(".page-shell").evaluate((node, fraction) => {
          node.scrollTop = node.scrollHeight * fraction;
        }, fraction);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      }
      await expect(page.locator("[data-cover-state=available]").first()).toBeVisible();
      const resources = await page.evaluate(() => ({
        live: window.coverControl.live.size,
        peak: window.coverControl.peak,
        decodes: window.coverControl.decodes,
        mounted: document.querySelectorAll(".book-cover").length,
      }));
      expect(resources.peak).toBeLessThanOrEqual(4);
      expect(resources.live).toBeLessThanOrEqual(resources.mounted + 48);
      await info.attach("cover-resources", {
        body: JSON.stringify({ view, count, initial, resources }),
        contentType: "application/json",
      });
    });
  }
}
