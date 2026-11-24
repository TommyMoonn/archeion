import { expect, test } from "@playwright/test";
import { commandDefinitions } from "../../src/features/commands/commandBindings";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

const fixture = "/tests/browser/fixtures/application-font-settings.html";
const label = commandDefinitions.quickActions.label;

for (const theme of ["dark", "light", "custom"] as const) {
  test(`${theme}: shortcut controls and fixed keycaps fit the Settings rows`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${fixture}?${theme}`);
    const resolved =
      theme === "custom"
        ? resolveTheme(shellStressThemes.distinct).app
        : resolveBuiltInAppTheme(theme);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--surface-main")),
      )
      .toBe(resolved.tokens.main);
    await page.getByRole("button", { name: "Keyboard", exact: true }).click();
    const content = page.getByRole("region", { name: "Settings content" });
    const trigger = content.getByRole("button", { name: `Change shortcut for ${label}` });
    const keycaps = content
      .getByRole("group", { name: "Directional navigation", exact: true })
      .locator("kbd");
    await expect(trigger).toBeVisible();
    await expect(keycaps).toHaveCount(4);
    for (const width of [1100, 760, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
        .toBe(true);
      await expect
        .poll(() =>
          trigger.evaluate((element) => {
            const row = element.closest('[role="group"][aria-labelledby]');
            if (!row) return false;
            const bounds = row.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.height >= 31
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(() =>
          keycaps.evaluateAll((elements) =>
            elements.every((element) => {
              const row = element.closest('[role="group"][aria-labelledby]');
              if (!row) return false;
              const bounds = row.getBoundingClientRect();
              const rect = element.getBoundingClientRect();
              return (
                rect.left >= bounds.left - 1 &&
                rect.right <= bounds.right + 1 &&
                rect.height >= 31 &&
                element.scrollWidth <= element.clientWidth + 1
              );
            }),
          ),
        )
        .toBe(true);
    }
  });
}

test("keyboard-only shortcut capture rejects conflicts, saves, and restores focus on cancel", async ({
  page,
}) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Keyboard", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search shortcuts" });
  await search.fill(label);
  const trigger = page.getByRole("button", { name: `Change shortcut for ${label}` });
  await search.press("Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Change ${label}` });
  const capture = dialog.getByRole("group", { name: "Shortcut capture" });
  const save = dialog.getByRole("button", { name: "Save shortcut" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(capture).toBeFocused();
  await page.keyboard.press("Control+Comma");
  await expect(dialog.getByRole("alert")).toContainText("conflicts");
  await expect(save).toBeDisabled();
  await page.keyboard.press("Control+Shift+K");
  await expect(dialog.getByRole("status")).toHaveText("Shortcut available.");
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(capture).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("Ctrl+Shift+K");
  await page.keyboard.press("Enter");
  await expect(capture).toBeFocused();
  await page.keyboard.press("Control+Shift+J");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("Ctrl+Shift+K");
});

test("forced colors retain visible focus and conflict feedback", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(fixture);
  await page.getByRole("button", { name: "Keyboard", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search shortcuts" });
  await search.fill(label);
  await search.press("Tab");
  await page.keyboard.press("Enter");
  const capture = page.getByRole("group", { name: "Shortcut capture" });
  await expect(capture).toBeFocused();
  await page.keyboard.press("Control+Comma");
  const error = page.getByRole("alert");
  await expect(error).toContainText("conflicts");
  const visible = await error.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "MarkText";
    probe.style.backgroundColor = "Mark";
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(element);
    const result =
      actual.color === expected.color &&
      actual.backgroundColor === expected.backgroundColor &&
      actual.color !== actual.backgroundColor;
    probe.remove();
    return result;
  });
  expect(visible).toBe(true);
  await page.keyboard.press("Tab");
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeFocused();
  await expect(cancel).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
});
