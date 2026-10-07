import { expect, test, type Page } from "@playwright/test";

const pinned = [
  "Book serif (Default)",
  "Clean sans",
  "System",
  "Literata",
  "Atkinson Hyperlegible",
];
const longFamily =
  "Long family name with multilingual 日本語 Ελληνικά and extended unbroken characters ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const fallback = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const trigger = (page: Page) => page.getByRole("button", { name: /^Reader typeface:/ });
const search = (page: Page) =>
  page.getByRole("combobox", { name: "Search fonts for Reader typeface", exact: true });

async function openReader(page: Page, complete = true) {
  await page.goto("/tests/browser/fixtures/reader-fonts.html?panel");
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await expect(page.locator("#reader-chrome")).toHaveAttribute("data-panel-ready", "true");
  if (complete) await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await page.locator("#reader-chrome").click();
  await expect(trigger(page)).toBeVisible();
}

function contrast(a: string, b: string) {
  const luminance = (rgb: string) => {
    const channels = rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("Reader picker searches presets and installed families, updates the same publication, and persists independently", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await openReader(page);
  const publication = page.frameLocator("#publication iframe").locator("p").first();
  const chromeFamily = await page
    .locator("#reader-chrome")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole("option")).toHaveText([
    ...pinned,
    "Arial",
    "Georgia",
    longFamily,
    'Odd, "Name" \\ ; } body { color: red',
  ]);
  await expect(
    page.locator(
      ".font-picker__popover h3, .font-picker__popover hr, .font-picker__popover [role=group]",
    ),
  ).toHaveCount(0);
  await search(page).fill("lItErAtA");
  await page.keyboard.press("Enter");
  await expect(trigger(page)).toBeFocused();
  await expect(publication).toHaveCSS("font-family", /^Literata,/);
  await trigger(page).click();
  await search(page).fill("aRiAl");
  await page.getByRole("option", { name: "Arial", exact: true }).hover();
  expect(await page.evaluate(() => window.readerFontFixture.snapshot().selection)).toEqual({
    kind: "builtin",
    id: "literata",
  });
  await page.getByRole("option", { name: "Arial", exact: true }).click();
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  await page.getByRole("button", { name: "Increase text size", exact: true }).click();
  await expect(publication).toHaveCSS("font-size", "19px");
  await page.getByRole("radio", { name: "Airy", exact: true }).click();
  await expect(publication).toHaveCSS("line-height", "38px");
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  await expect(page.locator("#reader-chrome")).toHaveCSS("font-family", chromeFamily);
  await trigger(page).click();
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Reader settings" })).toBeVisible();
  expect(await page.evaluate(() => window.readerFontFixture.snapshot())).toMatchObject({
    catalogCalls: 1,
    mountedDocuments: 1,
    sameFrame: true,
    sameChrome: true,
  });
  await page.screenshot({ path: testInfo.outputPath("reader-selected.png") });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.readerFontFixture?.ready)).toBe(true);
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  await expect(publication).toHaveCSS("font-family", `Arial, ${fallback}`);
  await expect(publication).toHaveCSS("font-size", "19px");
  await expect(publication).toHaveCSS("line-height", "38px");
  expect(errors).toEqual([]);
});

test("a missing saved Reader family is neutral while loading and preserved when unavailable", async ({
  page,
}, testInfo) => {
  await openReader(page, false);
  await page.evaluate(() =>
    window.readerFontFixture.select({ kind: "system", family: "Missing Reader Family" }),
  );
  await expect(trigger(page)).toHaveText("Missing Reader Family");
  await expect(trigger(page)).toHaveAttribute("aria-busy", "true");
  await trigger(page).click();
  await search(page).fill("Missing");
  await expect(page.locator(".font-picker__popover").getByRole("status")).toHaveText(
    "Loading fonts…",
  );
  await page.evaluate(() => window.readerFontFixture.completeCatalog());
  const missing = page.getByRole("option", { name: "Missing Reader Family (Unavailable)" });
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await expect(missing).toHaveAttribute("aria-selected", "true");
  await expect(page.frameLocator("#publication iframe").locator("p").first()).toHaveCSS(
    "font-family",
    fallback,
  );
  await page.screenshot({ path: testInfo.outputPath("reader-unavailable.png") });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.readerFontFixture.snapshot().selection)).toEqual({
    kind: "system",
    family: "Missing Reader Family",
  });
  await trigger(page).click();
  await search(page).fill("no matching font");
  await expect(page.locator(".font-picker__popover").getByRole("status")).toHaveText(
    "No fonts found.",
  );
  await search(page).fill("Book serif");
  await page.keyboard.press("Enter");
  await expect(trigger(page)).toHaveText("Book serif (Default)");
});

for (const scenario of [
  {
    name: "narrow-light",
    width: 320,
    height: 740,
    theme: "light",
    forced: false,
    rtl: false,
    enlarge: false,
  },
  {
    name: "rtl-forced-colors",
    width: 760,
    height: 800,
    theme: "dark",
    forced: true,
    rtl: true,
    enlarge: false,
  },
  {
    name: "200-percent-text",
    width: 1280,
    height: 1000,
    theme: "dark",
    forced: false,
    rtl: false,
    enlarge: true,
  },
] as const) {
  test(`Reader picker wraps long labels and retains keyboard access in ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({
      forcedColors: scenario.forced ? "active" : "none",
      reducedMotion: "reduce",
    });
    await openReader(page);
    await page.evaluate(
      (theme) =>
        window.readerFontFixture.updateApplication({ readerTheme: { kind: "builtin", id: theme } }),
      scenario.theme,
    );
    if (scenario.rtl)
      await page.evaluate(() => {
        document.documentElement.dir = "rtl";
      });
    if (scenario.enlarge) {
      const size = await trigger(page).evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      );
      await page.evaluate(() => {
        const root = document.documentElement;
        root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * 2}px`;
      });
      expect(
        await trigger(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBe(size * 2);
    }
    await trigger(page).click();
    await search(page).fill("Long family");
    await expect(search(page)).toHaveCSS(
      "color-scheme",
      scenario.forced ? "light dark" : scenario.theme === "light" ? "light" : "dark",
    );
    await page.keyboard.press("Enter");
    await expect(trigger(page)).toHaveAttribute("title", longFamily);
    expect(
      await trigger(page).evaluate(
        (element) =>
          element.getBoundingClientRect().width <=
          element.parentElement!.getBoundingClientRect().width,
      ),
    ).toBe(true);
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    await search(page).fill("Long family");
    const row = page.getByRole("option");
    const box = (await page.locator(".font-picker__popover").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(scenario.width - 7);
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThanOrEqual(scenario.height - 7);
    const geometry = await row.evaluate((element) => {
      const menu = element.closest<HTMLElement>(".font-picker__popover")!;
      const rectangle = menu.getBoundingClientRect();
      const ancestors = [];
      for (let parent = menu.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        ancestors.push({
          className: parent.className,
          bounds: parent.getBoundingClientRect().toJSON(),
          containerType: style.containerType,
          contain: style.contain,
          backdropFilter: style.backdropFilter,
          overflow: style.overflow,
        });
      }
      return {
        menu: rectangle.toJSON(),
        left: menu.style.left,
        top: menu.style.top,
        ancestors,
        cornersVisible: [rectangle.left + 7, rectangle.right - 7].every((x) =>
          menu.contains(document.elementFromPoint(x, rectangle.top + 7)),
        ),
      };
    });
    await testInfo.attach("popup-geometry", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    expect(geometry.cornersVisible, JSON.stringify(geometry)).toBe(true);
    expect(
      await row.evaluate(
        (element) =>
          element.firstElementChild!.scrollWidth <= element.firstElementChild!.clientWidth,
      ),
    ).toBe(true);
    const colors = await row.evaluate((element) => {
      const menuBackground = getComputedStyle(
        element.closest(".font-picker__popover")!,
      ).backgroundColor;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const renderedColor = (foreground: string, background = menuBackground) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = background;
        context.fillRect(0, 0, 1, 1);
        context.fillStyle = foreground;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return `rgb(${red}, ${green}, ${blue})`;
      };
      return {
        label: renderedColor(getComputedStyle(element.firstElementChild!).color),
        background: renderedColor(getComputedStyle(element).backgroundColor),
        menu: renderedColor(menuBackground),
        ring: renderedColor(getComputedStyle(element).outlineColor),
        outline: parseFloat(getComputedStyle(element).outlineWidth),
        marker: renderedColor(getComputedStyle(element.querySelector(".icon-slot")!).color),
      };
    });
    expect(colors.outline).toBeGreaterThanOrEqual(2);
    expect(
      contrast(colors.label, colors.background),
      JSON.stringify(colors),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colors.ring, scenario.forced ? colors.menu : colors.background),
      JSON.stringify(colors),
    ).toBeGreaterThanOrEqual(3);
    if (scenario.forced) expect(colors.marker).toBe(colors.label);
    await testInfo.attach("rendered-contrast", {
      body: JSON.stringify(colors, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}.png`) });
    await page.keyboard.press("Escape");
    await expect(trigger(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "Reader settings" })).toHaveCount(0);
  });
}
