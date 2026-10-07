import { expect, test, type Page } from "@playwright/test";
import { representativeFamilies } from "./fixtures/font-catalog";

const rootStacks = (page: Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return [root.getPropertyValue("--font-ui"), root.getPropertyValue("--font-display")];
  });

async function choose(page: Page, role: string, family: string) {
  const trigger = page.getByRole("button", { name: new RegExp(`^${role}:`) });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("combobox", { name: `Search fonts for ${role}`, exact: true });
  await expect(search).toBeFocused();
  await search.fill(family.toUpperCase());
  await expect(page.getByRole("option")).toHaveText([family]);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText(family);
  await expect(trigger).toBeFocused();
}

async function checkLargeList(page: Page, role: string, count: number) {
  await page.getByRole("button", { name: new RegExp(`^${role}:`) }).click();
  const search = page.getByRole("combobox", { name: `Search fonts for ${role}`, exact: true });
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(count);
  await search.fill("Catalog Family");
  await expect(page.getByRole("option")).toHaveCount(1200);
  await page.keyboard.press("ArrowUp");
  const geometry = await search.evaluate((input) => {
    const active = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
    const list = active.closest<HTMLElement>('[role="listbox"]')!;
    const row = active.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    return {
      top: row.top,
      bottom: row.bottom,
      listTop: bounds.top,
      listBottom: bounds.bottom,
      scroll: list.scrollTop,
    };
  });
  expect(geometry.scroll).toBeGreaterThan(0);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.listTop - 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.listBottom + 1);
  await search.fill("catalog family 1199");
  await expect(page.getByRole("option")).toHaveText(["Catalog Family 1199"]);
  await page.keyboard.press("Enter");
}

test("Appearance roles search a large injected catalog, remain independent, and reset together", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/application-font-settings.html?large");
  await expect
    .poll(() => page.evaluate(() => window.applicationFontSettingsFixture.ready))
    .toBe(true);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await checkLargeList(page, "Interface font", 1204);
  await checkLargeList(page, "Display font", 1205);
  for (const family of representativeFamilies) {
    await choose(page, "Interface font", family);
    const before = await rootStacks(page);
    await choose(page, "Display font", family);
    await expect
      .poll(() => rootStacks(page))
      .toEqual([
        before[0],
        `"${family}", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
      ]);
  }
  await page.screenshot({ path: testInfo.outputPath("appearance-large-catalog.png") });
  await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Interface font:/ })).toHaveText(
    "Inter (Default)",
  );
  await expect(page.getByRole("button", { name: /^Display font:/ })).toHaveText("Archeion Default");
  expect(await page.evaluate(() => window.applicationFontSettingsFixture.providerCalls)).toBe(1);
});

test("Reader searches the same synthetic roles without mutating either application root font", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/reader-fonts.html?panel&large");
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await page.evaluate(async () => {
    await window.readerFontFixture.completeCatalog();
    await window.readerFontFixture.updateApplication({
      appearance: {
        interfaceFont: { kind: "system", family: "Fixture Sans" },
        displayFont: { kind: "system", family: "Fixture Wide Serif" },
      },
    });
  });
  await expect(page.locator("#reader-chrome")).toHaveAttribute("data-panel-ready", "true");
  await page.locator("#reader-chrome").click();
  const roots = await rootStacks(page);
  const publication = page.frameLocator("#publication iframe").locator("p").first();
  await checkLargeList(page, "Reader typeface", 1208);
  for (const family of representativeFamilies) {
    await choose(page, "Reader typeface", family);
    await expect(publication).toHaveCSS(
      "font-family",
      `"${family}", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
    );
    expect(await rootStacks(page)).toEqual(roots);
  }
  expect(await page.evaluate(() => window.readerFontFixture.snapshot())).toMatchObject({
    catalogCalls: 1,
    mountedDocuments: 1,
    sameFrame: true,
  });
  await page.screenshot({ path: testInfo.outputPath("reader-large-catalog.png") });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await expect(publication).toHaveCSS("font-family", /^"Fixture Mono",/);
  expect(await rootStacks(page)).toEqual(roots);
  await page.evaluate(() =>
    window.readerFontFixture.select({ kind: "system", family: "Missing Reader Family" }),
  );
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await expect(publication).toHaveCSS(
    "font-family",
    '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  );
  await expect(page.locator("#reader-chrome")).toHaveAttribute("data-panel-ready", "true");
  await page.locator("#reader-chrome").click();
  await expect(page.getByRole("button", { name: /^Reader typeface:/ })).toHaveText(
    "Missing Reader Family (Unavailable)",
  );
  expect(await rootStacks(page)).toEqual(roots);
  await choose(page, "Reader typeface", "Book serif (Default)");
});
