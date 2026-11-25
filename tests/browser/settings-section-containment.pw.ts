import { expect, test } from "@playwright/test";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";
import { settingsSections } from "../../src/features/settings/settingsSections";

for (const mode of ["dark", "light&compact", "custom&compact"] as const) {
  test(`${mode}: all Settings sections and search remain contained`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/fixtures/application-font-settings.html?${mode}`);
    const theme = mode.startsWith("custom")
      ? resolveTheme(shellStressThemes.distinct).app
      : resolveBuiltInAppTheme(mode.startsWith("light") ? "light" : "dark");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--surface-main")),
      )
      .toBe(theme.tokens.main);
    await expect
      .poll(() => page.evaluate(() => window.applicationFontSettingsFixture.preferences.density))
      .toBe(mode.includes("compact") ? "compact" : "comfortable");
    const content = page.getByRole("region", { name: "Settings content" });
    for (const section of settingsSections) {
      await page.getByRole("button", { name: section.label, exact: true }).click();
      await expect(
        content.getByRole("heading", { name: section.label, exact: true }),
      ).toBeVisible();
      for (const width of [1100, 360]) {
        await page.setViewportSize({ width, height: 850 });
        await expect
          .poll(() => content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
          .toBe(true);
      }
    }
    await page.getByRole("searchbox", { name: "Search settings" }).fill("font");
    await expect(content.getByRole("heading", { name: "Search results" })).toBeVisible();
    await expect
      .poll(() => content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
      .toBe(true);
  });
}
