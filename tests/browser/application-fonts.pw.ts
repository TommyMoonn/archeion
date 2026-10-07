import { expect, test } from "@playwright/test";

test("application runtime preserves exact defaults, independent roles, and browser persistence", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/application-fonts.html");
  await expect.poll(() => page.evaluate(() => window.applicationFontFixture?.ready)).toBe(true);
  const ui = page.locator("#interface-copy");
  const display = page.getByRole("heading", { name: "Library" });
  const publication = page.frameLocator("iframe").locator("p");
  const defaultUI = 'Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  const defaultDisplay = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
  await expect(ui).toHaveCSS("font-family", defaultUI);
  await expect(display).toHaveCSS("font-family", defaultDisplay);
  await expect(publication).toHaveCSS("font-family", "serif");
  await page.evaluate(async () => {
    await document.fonts.load("400 14px Inter");
  });
  await page.screenshot({ path: testInfo.outputPath("application-fonts-default.png") });
  await page.evaluate(() =>
    window.applicationFontFixture.update({
      appearance: { interfaceFont: { kind: "system", family: "Arial" } },
    }),
  );
  await expect(ui).toHaveCSS("font-family", `Arial, ${defaultUI}`);
  await expect(display).toHaveCSS("font-family", defaultDisplay);
  await page.evaluate(() =>
    window.applicationFontFixture.update({ appearance: { displayFont: { kind: "interface" } } }),
  );
  await expect(display).toHaveCSS("font-family", `Arial, ${defaultUI}`);
  await page.evaluate(() =>
    window.applicationFontFixture.update({
      appearance: { interfaceFont: { kind: "system", family: "Georgia" } },
    }),
  );
  await expect(display).toHaveCSS("font-family", `Georgia, ${defaultUI}`);
  await page.evaluate(() =>
    window.applicationFontFixture.update({
      appearance: { displayFont: { kind: "system", family: "Arial" } },
    }),
  );
  await expect(display).toHaveCSS("font-family", `Arial, ${defaultDisplay}`);
  await expect(ui).toHaveCSS("font-family", `Georgia, ${defaultUI}`);
  await expect(publication).toHaveCSS("font-family", "serif");
  await page.screenshot({ path: testInfo.outputPath("application-fonts-independent.png") });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.applicationFontFixture?.ready)).toBe(true);
  await expect(ui).toHaveCSS("font-family", `Georgia, ${defaultUI}`);
  await expect(display).toHaveCSS("font-family", `Arial, ${defaultDisplay}`);
});

test("missing and stylesheet-like names fall back safely without changing unrelated CSS", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/application-fonts.html");
  await expect.poll(() => page.evaluate(() => window.applicationFontFixture?.ready)).toBe(true);
  const baselineColor = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).color);
  await page.evaluate(() =>
    window.applicationFontFixture.update({
      appearance: {
        interfaceFont: { kind: "system", family: 'Odd, "Name" \\ ; } body { color: red' },
      },
    }),
  );
  const family = await page
    .locator("#interface-copy")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toContain('Odd, \\"Name\\" \\\\ ; } body { color: red');
  expect(family).toContain('Inter, "Segoe UI"');
  await expect(page.locator("body")).toHaveCSS("color", baselineColor);
  await page.evaluate(() =>
    window.applicationFontFixture.update({
      appearance: {
        interfaceFont: { kind: "system", family: "Missing UI" },
        displayFont: { kind: "system", family: "Missing Display" },
      },
    }),
  );
  await expect(page.locator("#interface-copy")).toHaveCSS("font-family", /^Inter,/);
  await expect(page.getByRole("heading", { name: "Library" })).toHaveCSS(
    "font-family",
    /^"Iowan Old Style",/,
  );
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.applicationFontFixture?.ready)).toBe(true);
  const persisted = await page.evaluate(
    () =>
      Object.values(localStorage)
        .map((value: string) => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })
        .find((value) => value?.appearance)?.appearance,
  );
  expect(persisted.interfaceFont).toEqual({ kind: "system", family: "Missing UI" });
  expect(persisted.displayFont).toEqual({ kind: "system", family: "Missing Display" });
});
