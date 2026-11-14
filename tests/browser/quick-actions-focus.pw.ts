import { expect, test } from "@playwright/test";
import lightManifest from "../../themes/built-in/archeion-light/theme.json" with { type: "json" };
import { themeColorContrastRatio } from "../../src/themes/themeColor";
import type { ThemeColor } from "../../src/themes/themeTokenRegistry";

for (const motion of ["off", "on"]) {
  for (const origin of ["page", "control"]) {
    test(`theme confirmation restores ${origin} focus with motion ${motion}`, async ({ page }) => {
      await page.goto(`/tests/browser/fixtures/ui-stability.html?count=2&motion=${motion}`);
      const main = page.locator("main.page-shell");
      await expect(main).toBeVisible();
      const opener = page.getByRole("button", { name: "Collapse sidebar", exact: true });
      if (origin === "page") await main.click({ position: { x: 10, y: 10 } });
      else await opener.focus();
      await page.keyboard.press("Control+Shift+P");
      const search = page.getByRole("dialog", { name: "Quick Actions" }).getByRole("combobox");
      await search.fill("Change theme");
      await search.press("Enter");
      await expect(search).toHaveAttribute("placeholder", "Change theme…");
      await search.fill("Light");
      await search.press("Enter");
      await expect(page.locator(".quick-actions")).toHaveCount(0);
      await expect(main).not.toBeFocused();
      await expect(main).toHaveCSS("outline-style", "none");
      if (origin === "control") await expect(opener).toBeFocused();
      await expect
        .poll(async () =>
          toHex(await main.evaluate((element) => getComputedStyle(element).backgroundColor)),
        )
        .toBe(lightManifest.app.main.toLowerCase());
    });
  }
}

for (const theme of ["dark", "light", "custom", "forced-colors"]) {
  test(`Skip to content uses themed keyboard focus in ${theme}`, async ({ page }) => {
    if (theme === "forced-colors") await page.emulateMedia({ forcedColors: "active" });
    await page.goto(
      `/tests/browser/fixtures/ui-stability.html?count=2&motion=off&theme=${theme === "forced-colors" ? "light" : theme}`,
    );
    const main = page.locator("main.page-shell");
    await expect(main).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    await expect(main).toHaveCSS("outline-style", "solid");
    await expect(main).toHaveCSS("outline-width", "2px");
    const colors = await main.evaluate((element, forced) => {
      const probe = document.createElement("span");
      probe.style.color = forced ? "Highlight" : "var(--focus)";
      element.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { ring: style.outlineColor, background: style.backgroundColor, expected };
    }, theme === "forced-colors");
    expect(colors.ring).toBe(colors.expected);
    expect(
      themeColorContrastRatio(
        toHex(colors.ring),
        toHex(colors.background),
        toHex(colors.background),
        theme === "light" || theme === "forced-colors" ? "light" : "dark",
      ),
    ).toBeGreaterThanOrEqual(3);
  });
}

function toHex(rgb: string): ThemeColor {
  const channels = rgb.match(/[\d.]+/g)?.map(Number);
  if (!channels || (channels.length !== 3 && channels.length !== 4))
    throw new Error(`Expected RGB or RGBA: ${rgb}`);
  const bytes = channels.slice(0, 3);
  if (channels.length === 4) bytes.push(Math.round(channels[3] * 255));
  return `#${bytes.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
