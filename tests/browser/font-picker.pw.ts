import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/font-picker.html?fixture=font-picker";
const trigger = (page: Page) => page.getByRole("button", { name: /^Family:/ });
const search = (page: Page) =>
  page.getByRole("combobox", { name: "Search fonts for Family", exact: true });

async function expectActiveVisible(page: Page) {
  const geometry = await search(page).evaluate((input) => {
    const option = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
    const list = option.closest<HTMLElement>('[role="listbox"]')!;
    const row = option.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    return {
      rowTop: row.top,
      rowBottom: row.bottom,
      top: box.top,
      bottom: box.bottom,
      scroll: list.scrollTop,
    };
  });
  expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.top - 1);
  expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.bottom + 1);
  await expect(search(page)).toBeFocused();
  return geometry;
}

test("large catalog keeps active rows visible, resets filtered scroll, selects immediately and caches across controls", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await page.goto(fixture);
  await trigger(page).click();
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(506);
  expect(await page.getByRole("option").allTextContents()).toEqual([
    "Default choice",
    "Follow another choice",
    "Alpha Serif",
    "Beta Sans",
    ...Array.from(
      { length: 500 },
      (_, index) => `Catalog Family ${String(index).padStart(3, "0")}`,
    ),
    "Long family name with multilingual 日本語 Ελληνικά and extended unbroken characters ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "Zulu",
  ]);
  await page.keyboard.press("ArrowUp");
  expect((await expectActiveVisible(page)).scroll).toBeGreaterThan(0);
  await search(page).fill("CATALOG FAMILY");
  expect((await expectActiveVisible(page)).scroll).toBe(0);
  for (let index = 0; index < 40; index += 1) await page.keyboard.press("ArrowDown");
  expect((await expectActiveVisible(page)).scroll).toBeGreaterThan(0);
  await search(page).fill("fAmIlY 049");
  await expect(page.getByRole("option")).toHaveText(["Catalog Family 049"]);
  await page.keyboard.press("Enter");
  await expect(trigger(page)).toHaveText("Catalog Family 049");
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByTestId("selection-count")).toHaveText("1");
  await trigger(page).click();
  await expect(
    page.getByRole("option", { name: "Catalog Family 049", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expectActiveVisible(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Secondary family:/ }).click();
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("provider-calls")).toHaveText("1");
  await trigger(page).click();
  await search(page).fill("Beta");
  await page.getByRole("option", { name: "Beta Sans" }).click();
  await expect(trigger(page)).toHaveText("Beta Sans");
  await expect(page.getByTestId("selection-count")).toHaveText("2");
  await trigger(page).click();
  await page.screenshot({ path: testInfo.outputPath("desktop-selected.png") });
  expect(errors).toEqual([]);
});

for (const scenario of [
  { width: 320, height: 640, query: "", name: "narrow" },
  { width: 640, height: 420, query: "&bottom", name: "above" },
  { width: 900, height: 660, query: "&transform", name: "transformed" },
  { width: 900, height: 660, query: "&modal", name: "modal" },
]) {
  test(`picker is contained and long labels wrap in ${scenario.name} surface`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto(`${fixture}${scenario.query}`);
    await trigger(page).click();
    await expect(search(page)).toBeFocused();
    const popover = page.locator(".font-picker__popover");
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(scenario.width - 7);
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThanOrEqual(scenario.height - 7);
    if (scenario.name === "above") await expect(popover).toHaveAttribute("data-placement", "above");
    await page.keyboard.press("ArrowUp");
    await expectActiveVisible(page);
    await search(page).fill("Long family");
    const row = page.getByRole("option");
    const rowMetrics = await row.evaluate((element) => {
      const label = element.firstElementChild! as HTMLElement;
      const input = document.querySelector(".font-picker__search input")!;
      return {
        client: label.clientWidth,
        scroll: label.scrollWidth,
        height: element.getBoundingClientRect().height,
        font: getComputedStyle(label).fontFamily,
        inputFont: getComputedStyle(input).fontFamily,
      };
    });
    expect(rowMetrics.scroll).toBeLessThanOrEqual(rowMetrics.client);
    expect(rowMetrics.height).toBeGreaterThan(32);
    expect(rowMetrics.font).toBe(rowMetrics.inputFont);
    await expectActiveVisible(page);
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-long-label.png`) });
    await page.keyboard.press("Escape");
    await expect(trigger(page)).toBeFocused();
  });
}

test("empty and unavailable states have distinct accessible semantics without mutation", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture}&missing&empty`);
  await expect(trigger(page)).toHaveText("Missing Family (Unavailable)");
  await trigger(page).click();
  const missing = page.getByRole("option", { name: "Missing Family (Unavailable)" });
  await expect(missing).toHaveAttribute("aria-selected", "true");
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await search(page).fill("unknown");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.locator(".font-picker__popover").getByRole("status")).toHaveText(
    "No fonts found.",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selection-count")).toHaveText("0");
  await expect(search(page)).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("empty.png") });
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toHaveText("Missing Family (Unavailable)");
});

test("Tab and outside pointer dismiss without a selection or focus theft", async ({ page }) => {
  await page.goto(fixture);
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Secondary family:/ })).toBeFocused();
  await trigger(page).click();
  await page.getByRole("button", { name: "After picker" }).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "After picker" })).toBeFocused();
  await expect(page.getByTestId("selection-count")).toHaveText("0");
});

test("forced colors retain visible selected and keyboard-active indicators", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(fixture);
  await trigger(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const activeRow = page.locator('[role="option"][data-active="true"]');
  expect(
    await activeRow.evaluate((row) => parseFloat(getComputedStyle(row).outlineWidth)),
  ).toBeGreaterThanOrEqual(2);
  const colors = await activeRow.evaluate((row) => {
    const label = row.firstElementChild!;
    return {
      background: getComputedStyle(row).backgroundColor,
      labelColor: getComputedStyle(label).color,
      adjustment: getComputedStyle(label).forcedColorAdjust,
    };
  });
  expect(colors.adjustment).toBe("none");
  expect(colors.labelColor).not.toBe(colors.background);
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveText("Default choice");
  await page.screenshot({ path: testInfo.outputPath("forced-colors.png") });
});

test("rendered row text and keyboard indicator meet contrast against the actual surface", async ({
  page,
}) => {
  await page.goto(fixture);
  await trigger(page).click();
  const colors = await page.evaluate(() => {
    const popover = document.querySelector(".font-picker__popover")!;
    const active = document.querySelector('[role="option"][data-active="true"]')!;
    const normal = document.querySelector('[role="option"]:not([data-active])')!;
    return {
      background: getComputedStyle(popover).backgroundColor,
      text: getComputedStyle(normal).color,
      activeBackground: getComputedStyle(active).backgroundColor,
      ring: getComputedStyle(active).outlineColor,
    };
  });
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
  expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.ring, colors.activeBackground)).toBeGreaterThanOrEqual(3);
});
