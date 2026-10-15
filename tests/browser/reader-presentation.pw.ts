import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
});

for (const mode of ["continuous", "paged"] as const) {
  test(`cold open applies Publisher before first content preparation in ${mode}`, async ({
    page,
  }) => {
    await page.evaluate(
      (flow) => window.readerInteractions.open("nested-prose", flow, "presentation", "publisher"),
      mode,
    );
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    const paragraph = page.frameLocator(".epub-container iframe").locator("#nested-anchor");
    await expect
      .poll(() => paragraph.evaluate((node) => getComputedStyle(node).textIndent))
      .toBe("27px");
    expect(
      await paragraph.evaluate((node) =>
        node.ownerDocument.getElementById("archeion-reader-reflowable-layout"),
      ),
    ).toBeNull();
  });
  test(`Publisher restores EPUB indentation while retaining typography and theme in ${mode}`, async ({
    page,
  }) => {
    await page.evaluate(async (flow) => {
      await window.readerInteractions.open("nested-prose", flow, "presentation");
    }, mode);
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    const paragraph = page.frameLocator(".epub-container iframe").locator("#nested-anchor");
    await expect
      .poll(() => paragraph.evaluate((node) => getComputedStyle(node).textIndent))
      .toBe("0px");
    const typography = await paragraph.evaluate((node) => ({
      size: getComputedStyle(node).fontSize,
      color: getComputedStyle(node).color,
    }));
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await expect
      .poll(() =>
        paragraph.evaluate(
          (node) =>
            node.ownerDocument.querySelectorAll(
              "[data-archeion-running-prose], [data-archeion-prose-continuation], [data-archeion-prose-flow]",
            ).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() => paragraph.evaluate((node) => getComputedStyle(node).textIndent))
      .toBe("27px");
    expect(
      await paragraph.evaluate((node) => ({
        size: getComputedStyle(node).fontSize,
        color: getComputedStyle(node).color,
      })),
    ).toEqual(typography);
    expect(typography.size).toBe("18px");
    expect(
      await paragraph.evaluate((node) =>
        node.ownerDocument.querySelector("#archeion-reader-reflowable-layout"),
      ),
    ).toBeNull();
    await page.evaluate(() => window.readerInteractions.settings({ fontSize: 20 }));
    await expect
      .poll(() => paragraph.evaluate((node) => getComputedStyle(node).textIndent))
      .toBe("30px");
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await expect
      .poll(() => paragraph.evaluate((node) => getComputedStyle(node).textIndent))
      .toBe("0px");
    expect(
      await paragraph.evaluate(
        (node) =>
          node.ownerDocument.querySelectorAll("#epubjs-inserted-css-archeion-reader").length,
      ),
    ).toBe(1);
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  });
}

test("fixed-layout ignores presentation input and retains publisher pages", async ({ page }) => {
  await page.evaluate(() => window.readerInteractions.open("fixed-layout"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(() => window.readerInteractions.presentation("archeion"));
  const frame = page.frameLocator(".epub-container iframe");
  expect(
    await frame
      .locator("body")
      .evaluate(
        (body) =>
          body.ownerDocument.querySelectorAll(
            "#archeion-reader-reflowable-layout, #epubjs-inserted-css-archeion-reader",
          ).length,
      ),
  ).toBe(0);
  expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
});

test("Appearance book layout supports keyboard selection and fits a narrow drawer", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/fixtures/reader-fonts.html?panel");
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await expect(page.locator("#reader-chrome")).toHaveAttribute("data-panel-ready", "true");
  await page.locator("#reader-chrome").click();
  const group = page.getByRole("radiogroup", { name: "Book layout", exact: true });
  const archeion = group.getByRole("radio", { name: "Archeion", exact: true });
  const publisher = group.getByRole("radio", { name: "Publisher", exact: true });
  await archeion.focus();
  await page.keyboard.press("ArrowRight");
  await expect(publisher).toBeFocused();
  await expect(publisher).toHaveAttribute("aria-checked", "true");
  expect(await group.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("book-layout-appearance.png") });
});
