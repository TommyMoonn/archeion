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
  const dialog = page.getByRole("dialog", { name: "Edit keybind" });
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

test("pointer-opened keybind capture expands as one surface and visibly indicates focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(fixture);
  await page.getByRole("button", { name: "Keyboard", exact: true }).click();
  const trigger = page.getByRole("button", { name: `Change shortcut for ${label}` });
  await expect(trigger).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.documentElement.dataset.motion = "on";
    // Keep the entrance available for deterministic sampling without a timed sleep.
    document.documentElement.style.setProperty("--motion-duration-emphasized", "1500ms");
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit keybind" });
  const capture = dialog.getByRole("group", { name: "Shortcut capture" });
  const save = dialog.getByRole("button", { name: "Save shortcut" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(capture).toBeFocused();
  const samples = await dialog.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Dialog element is missing");
    const animation = element
      .getAnimations()
      .find(
        (candidate) =>
          candidate instanceof CSSAnimation && candidate.animationName === "dialog-presence-enter",
      );
    if (!animation || !animation.effect) throw new Error("Dialog entrance is missing");
    const duration = Number(animation.effect.getTiming().duration);
    const targets = [
      element,
      ...element.querySelectorAll("h2, [aria-label='Shortcut capture'], button"),
    ];
    const pose = () => ({
      bounds: targets.map((target) => target.getBoundingClientRect().toJSON()),
      opacity: Number(getComputedStyle(element).opacity),
    });
    const sample = (fraction: number) => {
      animation.currentTime = duration * fraction;
      return pose();
    };
    animation.pause();
    const start = sample(0);
    const middle = sample(0.3);
    const late = sample(0.65);
    const end = sample(1);
    animation.finish();
    return { start, middle, late, end, settled: pose() };
  });
  expect(samples.start.opacity).toBe(0);
  expect(samples.middle.opacity).toBeGreaterThan(samples.start.opacity);
  expect(samples.late.opacity).toBeGreaterThan(samples.middle.opacity);
  expect(samples.end.opacity).toBe(1);
  expect(samples.start.bounds[0].width / samples.end.bounds[0].width).toBeCloseTo(0.985, 3);
  for (const frame of [samples.start, samples.middle]) {
    const scale = frame.bounds[0].width / samples.end.bounds[0].width;
    const centerX = frame.bounds[0].x + frame.bounds[0].width / 2;
    const centerY = frame.bounds[0].y + frame.bounds[0].height / 2;
    expect(centerX).toBeCloseTo(samples.end.bounds[0].x + samples.end.bounds[0].width / 2, 1);
    expect(centerY).toBeCloseTo(samples.end.bounds[0].y + samples.end.bounds[0].height / 2, 1);
    for (const [index, rect] of frame.bounds.entries()) {
      const final = samples.end.bounds[index];
      expect(rect.width / final.width).toBeCloseTo(scale, 3);
      expect(rect.x - centerX).toBeCloseTo((final.x - centerX) * scale, 1);
      expect(rect.y - centerY).toBeCloseTo((final.y - centerY) * scale, 1);
    }
  }
  expect(samples.middle.bounds[0].width).toBeGreaterThan(samples.start.bounds[0].width);
  expect(samples.late.bounds).toEqual(samples.end.bounds);
  expect(samples.settled.bounds).toEqual(samples.end.bounds);
  await expect(capture.getByText("Press a shortcut", { exact: true })).toBeVisible();
  await expect(save.locator("svg")).toBeVisible();
  const focusedBorder = await capture.evaluate((element) => getComputedStyle(element).borderColor);
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.mouse.move(0, 0);
  await expect(capture.getByText("Click to capture", { exact: true })).toBeVisible();
  await expect
    .poll(() => capture.evaluate((element) => getComputedStyle(element).borderColor))
    .not.toBe(focusedBorder);
  await capture.click();
  await expect(capture).toBeFocused();
  await expect(capture.getByText("Press a shortcut", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+K");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toBeHidden();
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
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("border-top-width", "1px");
  expect(
    await dialog.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      probe.style.backgroundColor = "Canvas";
      document.body.append(probe);
      const expected = getComputedStyle(probe);
      const actual = getComputedStyle(element);
      const matches =
        actual.borderTopColor === expected.color &&
        actual.backgroundColor === expected.backgroundColor;
      probe.remove();
      return matches;
    }),
  ).toBe(true);
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
