import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/application-font-settings.html";
const fontTrigger = (page: Page, role: "Interface" | "Display") =>
  page.getByRole("button", { name: new RegExp(`^${role} font:`) });
const fontSearch = (page: Page, role: "Interface" | "Display") =>
  page.getByRole("combobox", { name: `Search fonts for ${role} font`, exact: true });
const longFamily =
  "Long family name with multilingual 日本語 Ελληνικά and extended unbroken characters ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function luminance(rgb: string) {
  const channels = rgb
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function openAppearance(page: Page, query = "") {
  await page.goto(`${fixture}${query}`);
  await expect
    .poll(() => page.evaluate(() => window.applicationFontSettingsFixture.ready))
    .toBe(true);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(fontTrigger(page, "Interface")).toBeVisible();
}

async function selectFont(page: Page, role: "Interface" | "Display", label: string) {
  await fontTrigger(page, role).click();
  await fontSearch(page, role).fill(label);
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(fontTrigger(page, role)).toHaveText(label);
}

test("real Settings controls apply both roles, persist, search, and reset with one shared catalog", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await openAppearance(page);
  await expect(fontTrigger(page, "Interface")).toHaveText("Inter (Default)");
  await expect(fontTrigger(page, "Display")).toHaveText("Archeion Default");
  await fontTrigger(page, "Interface").focus();
  await page.keyboard.press("Enter");
  await expect(fontSearch(page, "Interface")).toBeFocused();
  await expect(page.getByRole("option")).toHaveText([
    "Inter (Default)",
    "Arial",
    "Georgia",
    longFamily,
    "Zulu",
  ]);
  await page.getByRole("option", { name: "Arial", exact: true }).hover();
  expect(
    await page.evaluate(
      () => window.applicationFontSettingsFixture.preferences.appearance.interfaceFont,
    ),
  ).toEqual({ kind: "default" });
  await fontSearch(page, "Interface").fill("aRiAl");
  await page.keyboard.press("Enter");
  await expect(fontTrigger(page, "Interface")).toHaveText("Arial");
  await expect(fontTrigger(page, "Interface")).toBeFocused();
  await selectFont(page, "Display", "Use interface font");
  await selectFont(page, "Interface", "Georgia");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-display"),
      ),
    )
    .toContain('"Georgia"');
  await fontTrigger(page, "Display").click();
  await expect(page.getByRole("option")).toHaveText([
    "Use interface font",
    "Archeion Default",
    "Arial",
    "Georgia",
    longFamily,
    "Zulu",
  ]);
  await page.keyboard.press("Escape");
  await selectFont(page, "Display", "Arial");
  await page.screenshot({ path: testInfo.outputPath("desktop-selected.png") });
  await page.reload();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(fontTrigger(page, "Interface")).toHaveText("Georgia");
  await expect(fontTrigger(page, "Display")).toHaveText("Arial");
  const settingsSearch = page.getByRole("searchbox", { name: "Search settings", exact: true });
  await settingsSearch.fill("interface font");
  await expect(fontTrigger(page, "Interface")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Appearance settings search results" }),
  ).toBeVisible();
  await settingsSearch.fill("display font");
  await expect(fontTrigger(page, "Display")).toBeVisible();
  await selectFont(page, "Display", "Use interface font");
  await settingsSearch.fill("");
  await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
  await expect(fontTrigger(page, "Interface")).toHaveText("Inter (Default)");
  await expect(fontTrigger(page, "Display")).toHaveText("Archeion Default");
  expect(await page.evaluate(() => window.applicationFontSettingsFixture.providerCalls)).toBe(1);
  expect(errors).toEqual([]);
});

test("pending catalog does not mislabel a saved family and unavailable choices remain preserved", async ({
  page,
}, testInfo) => {
  await openAppearance(page, "?missing&pending");
  await expect(fontTrigger(page, "Interface")).toHaveText("Arial");
  await expect(fontTrigger(page, "Display")).toHaveText("Missing Display");
  await expect(fontTrigger(page, "Display")).toHaveAttribute("aria-busy", "true");
  await fontTrigger(page, "Display").click();
  await fontSearch(page, "Display").fill("Missing");
  await expect(page.locator(".font-picker__popover").getByRole("status")).toHaveText(
    "Loading fonts…",
  );
  await page.evaluate(() => window.applicationFontSettingsFixture.releaseCatalog());
  const missing = page.getByRole("option", { name: "Missing Display (Unavailable)" });
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await expect(missing).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(fontTrigger(page, "Interface")).toHaveText("Arial");
  await expect(fontTrigger(page, "Display")).toHaveText("Missing Display (Unavailable)");
  expect(
    await page.evaluate(
      () => window.applicationFontSettingsFixture.preferences.appearance.displayFont,
    ),
  ).toEqual({ kind: "system", family: "Missing Display" });
  await page.screenshot({ path: testInfo.outputPath("unavailable.png") });
  await selectFont(page, "Display", "Archeion Default");
  await expect(fontTrigger(page, "Interface")).toHaveText("Arial");
});

for (const scenario of [
  {
    name: "narrow-light",
    width: 320,
    height: 740,
    forced: false,
    rtl: false,
    query: "?light",
    zoom: false,
  },
  {
    name: "rtl-forced-colors",
    width: 760,
    height: 800,
    forced: true,
    rtl: true,
    query: "",
    zoom: false,
  },
  {
    name: "compact-200-percent-text",
    width: 1280,
    height: 1000,
    forced: false,
    rtl: false,
    query: "?compact",
    zoom: true,
  },
]) {
  test(`font controls remain usable with long labels in ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({
      forcedColors: scenario.forced ? "active" : "none",
      reducedMotion: "reduce",
    });
    await openAppearance(page, scenario.query);
    if (scenario.zoom) {
      const originalSize = await fontTrigger(page, "Interface").evaluate((trigger) =>
        parseFloat(getComputedStyle(trigger).fontSize),
      );
      await page.evaluate(() => {
        const root = document.documentElement;
        // All typography size tokens use rem. Enlarge text without transforming coordinates.
        root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * 2}px`;
      });
      const enlargedSize = await fontTrigger(page, "Interface").evaluate((trigger) =>
        parseFloat(getComputedStyle(trigger).fontSize),
      );
      expect(enlargedSize).toBe(originalSize * 2);
    }
    if (scenario.rtl)
      await page.evaluate(() => {
        document.documentElement.dir = "rtl";
      });
    await selectFont(page, "Interface", longFamily);
    await expect(fontTrigger(page, "Interface")).toHaveAttribute("title", longFamily);
    await fontTrigger(page, "Interface").focus();
    await page.keyboard.press("Enter");
    await fontSearch(page, "Interface").fill("Long family");
    await expect(fontSearch(page, "Interface")).toBeFocused();
    const popover = page.locator(".font-picker__popover");
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(scenario.width - 7);
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThanOrEqual(scenario.height - 7);
    expect(
      await page.getByRole("option").evaluate((option) => {
        const label = option.firstElementChild!;
        return label.scrollWidth <= label.clientWidth;
      }),
    ).toBe(true);
    if (scenario.forced) {
      expect(
        await page
          .getByRole("option")
          .evaluate((option) => parseFloat(getComputedStyle(option).outlineWidth)),
      ).toBeGreaterThanOrEqual(2);
      const colors = await page.getByRole("option").evaluate((option) => ({
        label: getComputedStyle(option.firstElementChild!).color,
        row: getComputedStyle(option).color,
        background: getComputedStyle(option).backgroundColor,
        marker: getComputedStyle(option.querySelector(".icon-slot")!).color,
        markerAdjustment: getComputedStyle(option.querySelector(".icon-slot")!).forcedColorAdjust,
      }));
      expect(colors.label, JSON.stringify(colors)).toBe(colors.row);
      expect(colors.marker).toBe(colors.row);
      expect(colors.markerAdjustment).toBe("none");
      expect(
        contrast(colors.label, colors.background),
        JSON.stringify(colors),
      ).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-long-label.png`) });
    await page.keyboard.press("Escape");
    await expect(fontTrigger(page, "Interface")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
    await expect(fontTrigger(page, "Interface")).toHaveText("Inter (Default)");
  });
}

test("font rows and keyboard indicators retain contrast in both built-in appearances", async ({
  page,
}, testInfo) => {
  for (const query of ["", "?light"]) {
    await openAppearance(page, query);
    await fontTrigger(page, "Interface").focus();
    await page.keyboard.press("Enter");
    const colors = await page.evaluate(() => {
      const popover = document.querySelector(".font-picker__popover")!;
      const active = document.querySelector('[role="option"][data-active="true"]')!;
      const normal = document.querySelector('[role="option"]:not([data-active])')!;
      const content = document.querySelector(".settings-window")!;
      const description = document.querySelector(
        '[data-setting-id="appearance.interface-font"] .settings-row__description',
      )!;
      return {
        background: getComputedStyle(popover).backgroundColor,
        text: getComputedStyle(normal).color,
        activeBackground: getComputedStyle(active).backgroundColor,
        ring: getComputedStyle(active).outlineColor,
        description: getComputedStyle(description).color,
        content: getComputedStyle(content).backgroundColor,
      };
    });
    const ratios = {
      optionText: contrast(colors.text, colors.background),
      keyboardIndicator: contrast(colors.ring, colors.activeBackground),
      description: contrast(colors.description, colors.content),
    };
    await testInfo.attach(query ? "light-contrast" : "dark-contrast", {
      body: JSON.stringify({ colors, ratios }, null, 2),
      contentType: "application/json",
    });
    expect(ratios.optionText, JSON.stringify({ colors, ratios })).toBeGreaterThanOrEqual(4.5);
    expect(ratios.keyboardIndicator, JSON.stringify({ colors, ratios })).toBeGreaterThanOrEqual(3);
    expect(ratios.description, JSON.stringify({ colors, ratios })).toBeGreaterThanOrEqual(4.5);
  }
});
