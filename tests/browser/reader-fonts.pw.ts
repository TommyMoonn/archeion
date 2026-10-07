import { expect, test } from "@playwright/test";

test("live EPUB fonts refresh after catalog load and persist without changing application chrome", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/reader-fonts.html");
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  const publication = page.frameLocator("#publication iframe").locator("p").first();
  const chrome = page.locator("#reader-chrome");
  const defaultChrome = await chrome.evaluate((element) => getComputedStyle(element).fontFamily);
  const fallback = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
  await expect(publication).toHaveCSS("font-family", fallback);
  await page.evaluate(() => window.readerFontFixture.select({ kind: "builtin", id: "literata" }));
  await expect(publication).toHaveCSS("font-family", /^Literata,/);
  await expect(
    page.frameLocator("#publication iframe").locator("#archeion-reader-font-faces"),
  ).toHaveCount(1);
  await page.evaluate(() => window.readerFontFixture.select({ kind: "system", family: "Arial" }));
  await expect(publication).toHaveCSS("font-family", fallback);
  await expect(
    page.frameLocator("#publication iframe").locator("#archeion-reader-font-faces"),
  ).toHaveCount(0);
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  await expect(chrome).toHaveCSS("font-family", defaultChrome);
  await page.evaluate(() =>
    window.readerFontFixture.updateApplication({
      appearance: {
        interfaceFont: { kind: "system", family: "Georgia" },
        displayFont: { kind: "interface" },
      },
    }),
  );
  await expect(chrome).toHaveCSS("font-family", /^Georgia,/);
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  expect(await page.evaluate(() => window.readerFontFixture.snapshot())).toMatchObject({
    catalogCalls: 1,
    mountedDocuments: 1,
    sameFrame: true,
    sameChrome: true,
  });
  await page.screenshot({ path: testInfo.outputPath("reader-fonts-installed.png") });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  expect(await page.evaluate(() => window.readerFontFixture.snapshot().selection)).toEqual({
    kind: "system",
    family: "Arial",
  });
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  await page.evaluate(() =>
    window.readerFontFixture.select({ kind: "system", family: "Missing Reader Family" }),
  );
  await expect(publication).toHaveCSS("font-family", fallback);
  expect(await page.evaluate(() => window.readerFontFixture.snapshot().selection)).toEqual({
    kind: "system",
    family: "Missing Reader Family",
  });
  await page.screenshot({ path: testInfo.outputPath("reader-fonts-unavailable.png") });
});

test("a stylesheet-like family stays one CSS string and injects no font files", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/reader-fonts.html");
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  const publication = page.frameLocator("#publication iframe").locator("p").first();
  const initialColor = await publication.evaluate((element) => getComputedStyle(element).color);
  await page.evaluate(() =>
    window.readerFontFixture.select({
      kind: "system",
      family: 'Odd, "Name" \\ ; } body { color: red',
    }),
  );
  await expect(publication).toHaveCSS(
    "font-family",
    /^"Odd, \\"Name\\" \\\\ ; } body { color: red",/,
  );
  await expect(publication).toHaveCSS("color", initialColor);
  await expect(
    page.frameLocator("#publication iframe").locator("#archeion-reader-font-faces"),
  ).toHaveCount(0);
  expect(
    await publication.evaluate((element) =>
      [...element.ownerDocument.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .some((rule) => /file:|@font-face|url\(/i.test(rule.cssText)),
    ),
  ).toBe(false);
  expect(await page.evaluate(() => window.readerFontFixture.snapshot())).toMatchObject({
    mountedDocuments: 1,
    sameFrame: true,
    sameChrome: true,
  });
});
