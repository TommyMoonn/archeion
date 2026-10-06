import { expect, test, type Locator } from "@playwright/test";

async function weight(element: Locator, expected: string) {
  await expect(element).toHaveCSS("font-weight", expected);
}

for (const appearance of ["dark", "light"]) {
  test(`${appearance} controls load real Inter Medium and retain stronger local hierarchy`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/tests/browser/fixtures/?view=typography");
    await page
      .locator("html")
      .evaluate((element, value) => element.setAttribute("data-app-theme", value), appearance);
    const fonts = await page.evaluate(async () => {
      await Promise.all(
        [400, 500, 600, 700].map((value) => document.fonts.load(`${value} 14px Inter`)),
      );
      return [...document.fonts]
        .filter((face) => face.family.replaceAll('"', "") === "Inter")
        .map((face) => ({ weight: face.weight, status: face.status }));
    });
    expect(fonts.sort((a, b) => Number(a.weight) - Number(b.weight))).toEqual(
      [400, 500, 600, 700].map((value) => ({ weight: String(value), status: "loaded" })),
    );
    await weight(page.getByRole("button", { name: "Add EPUB", exact: true }), "500");
    await weight(page.locator(".settings-row__meta strong"), "500");
    await weight(page.locator(".app-select__label"), "500");
    await weight(page.getByRole("combobox", { name: "Application theme" }), "500");
    await weight(page.locator(".settings-row .app-select__value"), "500");
    await weight(page.getByRole("heading", { name: "Preferences" }), "600");
    await weight(page.getByRole("heading", { name: "Appearance", exact: true }), "600");
    await weight(page.locator(".settings-row__description"), "400");
    await weight(page.locator(".eyebrow"), "600");
    await expect(page.getByRole("heading", { name: "Library", exact: true })).toHaveCSS(
      "font-family",
      /Georgia/,
    );
    await expect(page.getByRole("button", { name: "Clear search" }).locator("svg")).toHaveAttribute(
      "stroke-width",
      "2",
    );
    await expect(
      page.getByRole("button", { name: "Add EPUB", exact: true }).locator("svg"),
    ).toHaveAttribute("stroke-width", "2.25");
    await expect(
      page.getByRole("combobox", { name: "Application theme" }).locator("svg"),
    ).toHaveAttribute("stroke-width", "2");
    await page.screenshot({
      path: testInfo.outputPath(`typography-${appearance}.png`),
      fullPage: true,
    });
    await page
      .locator("html")
      .evaluate((element) => element.setAttribute("data-density", "compact"));
    await weight(page.getByRole("button", { name: "Add EPUB", exact: true }), "500");
    await weight(page.locator(".settings-row__meta strong"), "500");
    await page.screenshot({
      path: testInfo.outputPath(`typography-${appearance}-compact.png`),
      fullPage: true,
    });
  });
}

test("medium form and menu labels preserve dialog keyboard focus and selection emphasis", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/?view=typography");
  const select = page.getByRole("combobox", { name: "Application theme" });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  const selected = page.getByRole("option", { name: "Dark", exact: true });
  await weight(selected, "500");
  await expect(selected.locator("svg")).toHaveAttribute("stroke-width", "2.25");
  await page.keyboard.press("Escape");
  const opener = page.getByRole("button", { name: "Edit archive name" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename archive" });
  await expect(dialog).toBeVisible();
  await weight(dialog.locator(".form-field > span"), "500");
  await weight(dialog.getByRole("button", { name: "Copy archive path" }), "500");
  await weight(dialog.getByRole("button", { name: "Save name" }), "500");
  await expect(dialog.getByRole("textbox", { name: "Archive name" })).toBeFocused();
  expect(
    await dialog.getByRole("textbox").evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("typography-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("type scaling, narrow reflow, RTL, forced colors, and existing sidebar geometry remain coherent", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/?view=typography");
  for (const [width, rootSize] of [
    [900, 16],
    [900, 32],
    [320, 16],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page
      .locator("html")
      .evaluate((element, size) => (element.style.fontSize = `${size}px`), rootSize);
    await weight(page.getByRole("button", { name: "Add EPUB", exact: true }), "500");
    await expect(page.getByRole("button", { name: "Add EPUB", exact: true })).toHaveCSS(
      "font-size",
      `${rootSize * 0.875}px`,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`typography-${width}-${rootSize}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  await page.screenshot({ path: testInfo.outputPath("typography-rtl.png"), fullPage: true });
  await page.emulateMedia({ forcedColors: "active" });
  const opener = page.getByRole("button", { name: "Edit archive name" });
  await opener.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(opener).toBeFocused();
  await expect(opener).toHaveCSS("outline-style", "solid");
  await expect(opener).toHaveCSS("outline-width", "2px");
  await page.screenshot({
    path: testInfo.outputPath("typography-forced-colors.png"),
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "none" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/browser/fixtures/?view=library");
  await expect(page.locator(".sidebar")).toHaveCSS("width", "248px");
  const nav = page.locator(".sidebar__nav .nav-item").first();
  await expect(nav).toHaveCSS("font-size", "14px");
  await expect(nav).toHaveCSS("min-height", "36px");
  await expect(nav.locator("svg").first()).toHaveCSS("width", "16px");
});

test("Archive, Theme Manager, and About retain hierarchy above routine medium labels", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell&themeStress=equal");
  await weight(page.locator(".archive-action-row__title").first(), "500");
  await weight(page.locator(".archive-manager-window__identity h1"), "600");
  await page.screenshot({ path: testInfo.outputPath("typography-archive.png") });
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await weight(page.locator(".theme-catalog-list__item-name").first(), "500");
  await weight(page.locator(".theme-details__header h2"), "600");
  await page.screenshot({ path: testInfo.outputPath("typography-themes.png") });
  await page.goto("/tests/browser/fixtures/?view=typography&surface=about");
  await weight(page.locator(".about-window__link-copy strong").first(), "500");
  await expect(page.locator(".about-window__link .lucide-external-link").first()).toHaveAttribute(
    "stroke-width",
    "2",
  );
  await page.screenshot({ path: testInfo.outputPath("typography-about.png") });
});
