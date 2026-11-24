import { expect, test } from "@playwright/test";

const dictionaryFixture = "/tests/browser/fixtures/?view=dictionary-toggle";

for (const [theme, query] of [
  ["dark", ""],
  ["light", "&light"],
  ["custom", "&themeStress=distinct"],
] as const) {
  test(`${theme}: dictionary cards and controls fit at normal and narrow widths`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${dictionaryFixture}${query}&dictionary-state=failed`);
    const installed = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "English Core" }) });
    const catalog = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "French Core with extended metadata" }) });
    await expect(installed.getByText("Ready", { exact: true })).toBeVisible();
    await expect(catalog.getByRole("alert")).toHaveText("Package verification failed");
    await catalog.getByRole("button", { name: "Retry download" }).click();
    const progress = catalog.getByRole("progressbar");
    await expect(progress).toHaveAttribute("aria-valuenow", "512");
    await expect(progress).toHaveAttribute("aria-valuemax", "2048");
    for (const width of [1100, 360]) {
      await page.setViewportSize({ width, height: 800 });
      const metrics = await catalog.evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        const track = card.querySelector('[data-slot="progress-track"]')!;
        const indicator = card.querySelector('[data-slot="progress-indicator"]')!;
        const controls = [...card.querySelectorAll('a, button, [role="progressbar"]')];
        const contains = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        };
        return {
          contained: controls.every(contains),
          trackWidth: track.getBoundingClientRect().width,
          trackHeight: track.getBoundingClientRect().height,
          fill: indicator.getBoundingClientRect().width / track.getBoundingClientRect().width,
          documentContained: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      });
      expect(metrics.contained).toBe(true);
      expect(
        await installed.evaluate((card) => {
          const bounds = card.getBoundingClientRect();
          return [...card.querySelectorAll('a, button, [role="switch"]')].every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          });
        }),
      ).toBe(true);
      expect(metrics.documentContained).toBe(true);
      expect(metrics.trackWidth).toBeGreaterThan(0);
      expect(metrics.trackHeight).toBe(6);
      expect(metrics.fill).toBeCloseTo(0.25, 1);
    }
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    // Forced colors must leave a visible track and filled area, not just a semantic value.
    await expect(progress.locator('[data-slot="progress-track"]')).toHaveCSS(
      "border-top-width",
      "1px",
    );
    await expect(progress.locator('[data-slot="progress-indicator"]')).toHaveCSS(
      "border-top-width",
      "2px",
    );
    const cancel = catalog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(progress).toBeHidden();
    await expect(catalog.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  });
}

test("dictionary search and keyboard filtering distinguish an empty catalog from no matches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(dictionaryFixture);
  const search = page.getByRole("searchbox", { name: "Search dictionaries" });
  await search.fill("unmatched");
  await expect(page.getByText("No dictionaries match this search.")).toBeVisible();
  await search.fill("French");
  const views = page.getByRole("radiogroup", { name: "Dictionary views" });
  await views.getByRole("radio", { name: "All", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(views.getByRole("radio", { name: "Not installed" })).toBeChecked();
  await expect(search).toHaveValue("French");
  await expect(
    page.getByRole("heading", { name: "French Core with extended metadata" }),
  ).toBeVisible();
  await page.goto(`${dictionaryFixture}&dictionary-state=empty`);
  await expect(page.getByText("No catalog has been loaded yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh catalog" })).toBeVisible();
  await page.goto(`${dictionaryFixture}&dictionary-state=loading`);
  await expect(
    page.getByRole("status").filter({ hasText: "Loading available dictionaries" }),
  ).toBeVisible();
});
