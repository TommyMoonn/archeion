import { expect, test } from "@playwright/test";
import { defaultAppPreferences } from "../../src/types/appSettings";
import { defaultReaderSettings } from "../../src/types/reader";

const fixture = "/tests/browser/fixtures/application-font-settings.html";

for (const { width, query } of [
  { width: 1280, query: "" },
  { width: 760, query: "?light&compact" },
  { width: 560, query: "?custom" },
]) {
  test(`Reader preferences stay contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture + query);
    await page.getByRole("button", { name: "Reader", exact: true }).click();
    const content = page.getByRole("region", { name: "Settings content" });

    for (const [label, text] of [
      ["Font size", "18px"],
      ["Line height", "1.6"],
    ]) {
      const row = content.getByRole("group", { name: label, exact: true });
      const slider = row.getByRole("slider", { name: label, exact: true });
      const value = row.getByText(text, { exact: true });
      await expect(slider).toHaveAttribute("aria-valuetext", text);
      await expect(value).toBeVisible();
      const track = row.locator('[data-slot="slider-control"]');
      await expect
        .poll(async () => {
          const [output, control, bounds] = await Promise.all([
            value.boundingBox(),
            track.boundingBox(),
            row.boundingBox(),
          ]);
          if (!output || !control || !bounds) return false;
          return (
            control.x - output.x - output.width >= 11 &&
            Math.abs(output.y + output.height / 2 - control.y - control.height / 2) <= 1 &&
            output.x >= bounds.x - 1 &&
            control.x + control.width <= bounds.x + bounds.width + 1
          );
        })
        .toBe(true);
    }
    for (const [label, role, name] of [
      ["Font family", "button", /^Reader font family:/],
      ["Reader theme", "combobox", "Reader theme"],
      ["Page width", "radiogroup", "Default reader page width"],
      ["Progress placement", "radiogroup", "Reader progress placement"],
      ["Reset reader settings", "button", "Reset Reader"],
    ] as const) {
      const row = content.getByRole("group", { name: label, exact: true });
      const control = row.getByRole(role, { name, exact: true });
      await expect(control).toBeVisible();
      await expect
        .poll(async () => {
          const [box, bounds] = await Promise.all([control.boundingBox(), row.boundingBox()]);
          return (
            !!box &&
            !!bounds &&
            box.x >= bounds.x - 1 &&
            box.x + box.width <= bounds.x + bounds.width + 1
          );
        })
        .toBe(true);
    }
    expect(
      await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  });
}

test("Reader defaults update through Settings and search and reset independently", async ({
  page,
}) => {
  await page.goto(fixture + "?light");
  await page.getByRole("button", { name: "Reader", exact: true }).click();
  const fontSize = page.getByRole("slider", { name: "Font size", exact: true });
  const lineHeight = page.getByRole("slider", { name: "Line height", exact: true });
  await fontSize.press("Home");
  await fontSize.press("ArrowRight");
  await expect(fontSize).toHaveAttribute("aria-valuetext", "15px");
  await lineHeight.press("Home");
  await lineHeight.press("ArrowRight");
  await expect(lineHeight).toHaveAttribute("aria-valuetext", "1.5");
  await page
    .getByRole("radiogroup", { name: "Default reader page width" })
    .getByRole("radio", { name: "Wide", exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: "Reader progress placement" })
    .getByRole("radio", { name: "Side" })
    .click();
  await page.getByRole("combobox", { name: "Reader theme" }).click();
  await page.getByRole("option", { name: "Sepia", exact: true }).click();
  const preferences = () => page.evaluate(() => window.applicationFontSettingsFixture.preferences);
  await expect.poll(preferences).toMatchObject({
    reader: { fontSize: 15, lineHeight: 1.5, readingWidth: "wide", progressPlacement: "side" },
    readerTheme: { kind: "builtin", id: "sepia" },
    appTheme: { kind: "builtin", id: "light" },
  });
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("line height");
  await page.getByRole("slider", { name: "Line height", exact: true }).press("End");
  await expect.poll(preferences).toMatchObject({ reader: { lineHeight: 2 } });
  await search.clear();
  await expect(lineHeight).toHaveAttribute("aria-valuetext", "2");
  await page.getByRole("button", { name: "Reset Reader", exact: true }).click();
  await expect.poll(preferences).toMatchObject({
    reader: defaultReaderSettings,
    readerTheme: defaultAppPreferences.readerTheme,
    appTheme: { kind: "builtin", id: "light" },
  });
  await expect(fontSize).toHaveAttribute("aria-valuetext", "18px");
  await expect(lineHeight).toHaveAttribute("aria-valuetext", "1.6");
});

test("preference slider supports track presses, dragging, keyboard bounds and forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/tests/browser/fixtures/preference-controls.html");
  const slider = page.getByRole("slider", { name: "Font size" });
  const track = page.locator('[data-slot="slider-control"]');
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "28px");
  await slider.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "14px");
  await slider.press("ArrowUp");
  await expect(slider).toHaveAttribute("aria-valuetext", "15px");
  await expect(page.locator('[data-slot="slider-thumb"]')).toHaveCSS("outline-width", "2px");
  const bounds = await track.boundingBox();
  if (!bounds) throw new Error("Slider bounds missing");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(slider).toHaveAttribute("aria-valuetext", "21px");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuetext", "28px");
});
