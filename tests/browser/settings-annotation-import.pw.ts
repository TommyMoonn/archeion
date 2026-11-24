import { expect, test } from "@playwright/test";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

test("previews annotation import, cancels by keyboard, and skips the same file after confirming", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/fixtures/ui-stability.html?window=settings&windowInstance=8&settingsDelay=0&motion=off",
  );
  await page.getByRole("button", { name: "Storage", exact: true }).click();
  const importButton = page.getByRole("button", { name: "Import annotations", exact: true });
  const preview = page.getByRole("dialog", { name: "Review annotation import" });
  await importButton.click();
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Cancel" })).toBeFocused();
  const disclosure = preview.getByRole("button", { name: "Unmatched book IDs" });
  const unmatchedId = preview.getByText("unmatched-book", { exact: true });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(unmatchedId).toBeHidden();
  await page.keyboard.press("Shift+Tab");
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Space");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(unmatchedId).toBeVisible();
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(unmatchedId).toBeHidden();
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Space");
  await expect(unmatchedId).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(importButton).toBeFocused();

  await importButton.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await preview.getByRole("button", { name: "Import annotations" }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText("Imported 1 annotation.", { exact: false })).toBeVisible();
  await importButton.click();
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Import annotations" })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Close" })).toBeFocused();
});

for (const theme of ["dark", "light", "custom"] as const) {
  test(`${theme}: archive controls, export actions and import counts remain contained`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/fixtures/ui-stability.html?window=settings&windowInstance=8&settingsDelay=0&theme=${theme}`,
    );
    const resolved =
      theme === "custom"
        ? resolveTheme(shellStressThemes.distinct).app
        : resolveBuiltInAppTheme(theme);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--surface-main")),
      )
      .toBe(resolved.tokens.main);
    const content = page.getByRole("region", { name: "Settings content" });
    await page.getByRole("button", { name: "Archives", exact: true }).click();
    const importDefaults = page.getByRole("group", { name: "Import defaults", exact: true });
    const conflict = importDefaults.getByRole("combobox", { name: "Default conflict handling" });
    await expect(conflict).toBeVisible();
    for (const width of [1100, 380]) {
      await page.setViewportSize({ width, height: 850 });
      const contained = await conflict.evaluate((control) => {
        const row = control.closest('[role="group"][aria-labelledby]');
        if (!row) return false;
        const bounds = row.getBoundingClientRect();
        const rect = control.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
      expect(contained).toBe(true);
      expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }

    await page.getByRole("button", { name: "Storage", exact: true }).click();
    const exports = page.getByRole("group", { name: "Export annotations", exact: true });
    await expect(exports.getByRole("button", { name: "Export JSON" })).toBeVisible();
    for (const width of [1100, 380]) {
      await page.setViewportSize({ width, height: 850 });
      const layout = await exports.evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll("button")].map((button) =>
          button.getBoundingClientRect(),
        );
        const [first, second] = buttons;
        return {
          contained: buttons.every(
            (rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          ),
          separated: first.right <= second.left + 1 || first.bottom <= second.top + 1,
        };
      });
      expect(layout).toEqual({ contained: true, separated: true });
      expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }

    if (theme === "custom") await page.emulateMedia({ forcedColors: "active" });
    await page.getByRole("button", { name: "Import annotations", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Review annotation import" });
    const disclosure = preview.getByRole("button", { name: "Unmatched book IDs" });
    await expect(preview.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(disclosure).toBeFocused();
    if (theme === "custom") await expect(disclosure).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await expect(preview.getByText("unmatched-book", { exact: true })).toBeVisible();
    expect(
      await preview.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const body = dialog.querySelector('[role="region"]');
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth + 1 &&
          body !== null &&
          body.scrollWidth <= body.clientWidth + 1
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
  });
}
