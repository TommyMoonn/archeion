import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/?view=select";

for (const [key, expected] of [
  ["ArrowDown", "Option 1"],
  ["ArrowUp", /A substantially longer/],
  ["Home", "Any"],
  ["End", /A substantially longer/],
  ["Enter", "Any"],
  ["Space", "Any"],
] as const) {
  test(`Select opens with ${key} and restores focus on Escape`, async ({ page }) => {
    await page.goto(fixture);
    const trigger = page.getByRole("combobox", { name: "Sort choice" });
    await trigger.focus();
    await page.keyboard.press(key);
    await expect(
      page.getByRole("option", { name: expected, exact: typeof expected === "string" }),
    ).toBeFocused();
    await expect(page.locator('output[aria-label="Open count"]')).toHaveText("1");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("Select commits keyboard navigation, skips disabled options and releases Tab focus", async ({
  page,
}) => {
  await page.goto(fixture);
  const trigger = page.getByRole("combobox", { name: "Sort choice" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Option 1", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  const last = page.getByRole("option", { name: /A substantially longer/ });
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("A substantially longer");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(last).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("option", { name: "Any", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(trigger).toHaveText("Any");
  await trigger.click();
  await expect(page.getByRole("option", { name: "Any", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Icon choice" })).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Any", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Toggle disabled" })).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("compact icon-only Select retains its hit area and selects without a visible label", async ({
  page,
}) => {
  await page.goto(fixture);
  const trigger = page.getByRole("combobox", { name: "Icon choice" });
  await expect(trigger).toHaveCSS("width", "32px");
  await expect(trigger).toHaveCSS("height", "32px");
  await expect(trigger).toHaveText("");
  await trigger.click();
  const popup = page.getByRole("listbox");
  await expect(popup).toBeVisible();
  expect((await popup.boundingBox())?.width).toBeGreaterThanOrEqual(188);
  await popup.getByRole("option", { name: "Option 2", exact: true }).click();
  await expect(page.getByLabel("Selected value")).toHaveText("option-1");
  await expect(trigger).toBeFocused();
});

for (const scaled of [false, true]) {
  test(`Reader Select stays inside the viewport${scaled ? " when scaled" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 360 });
    await page.goto(`${fixture}&surface=reader`);
    if (scaled) await page.getByRole("button", { name: "Toggle scale" }).click();
    const trigger = page.getByRole("combobox", { name: "Reader choice" });
    await trigger.click();
    const popup = page.getByRole("listbox");
    await expect(popup).toBeVisible();
    await expect
      .poll(async () => {
        const menu = await popup.boundingBox();
        const anchor = await trigger.boundingBox();
        if (!menu || !anchor) return false;
        const gap = anchor.y - menu.y - menu.height;
        return menu.x >= 7 && menu.y >= 7 && menu.x + menu.width <= 413 && Math.abs(gap - 6) <= 2;
      })
      .toBe(true);
    expect(await popup.evaluate((node) => node.closest(".reader-page") !== null)).toBe(true);
    await expect(popup).toHaveCSS("background-color", "rgb(238, 229, 210)");
    await page.keyboard.press("End");
    const last = page.getByRole("option", { name: /A substantially longer/ });
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    expect(await popup.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 360, height: 320 });
    await expect
      .poll(async () => {
        const menu = await popup.boundingBox();
        const anchor = await trigger.boundingBox();
        if (!menu || !anchor) return false;
        const gap = anchor.y - menu.y - menu.height;
        return menu.x >= 7 && menu.y >= 7 && menu.x + menu.width <= 353 && Math.abs(gap - 6) <= 2;
      })
      .toBe(true);
    await expect(last).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText("A substantially longer");
    await expect(popup).toHaveCount(0);
    await trigger.click();
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(last).toBeInViewport();
  });
}

test("Select remains in the native dialog and the outer dialog survives selection", async ({
  page,
}) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Select dialog" });
  const trigger = dialog.getByRole("combobox", { name: "Dialog choice" });
  await trigger.click();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await dialog.getByRole("option", { name: "Option 2", exact: true }).click();
  await expect(trigger).toHaveText("Option 2");
  await expect(trigger).toBeFocused();
  await expect(dialog).toBeVisible();
});

test("Library filter retains its outer panel through selection and nested Escape", async ({
  page,
}) => {
  await page.goto(fixture);
  await page.getByLabel("Filter library").click();
  const panel = page.getByRole("dialog", { name: "Library filters" });
  const series = panel.getByRole("combobox", { name: "Add series filter" });
  await series.click();
  await panel.getByRole("option", { name: "First series" }).click();
  await expect(panel).toBeVisible();
  await expect(series).toHaveText("Any");
  await series.click();
  await expect(panel.getByRole("listbox")).toBeVisible();
  await expect(panel.getByRole("option", { name: "First series" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("listbox")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await series.click();
  await panel.getByRole("option", { name: "Second series" }).click();
  await expect(series).toHaveText("No more options");
  await expect(series).toBeDisabled();
  await expect(panel.getByRole("listbox")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
});

test("Library filter checkboxes retain label and keyboard activation", async ({ page }) => {
  await page.goto(fixture);
  await page.getByLabel("Filter library").click();
  const panel = page.getByRole("dialog", { name: "Library filters" });
  const completed = panel.getByRole("checkbox", { name: "Completed", exact: true });
  await expect(completed).toHaveCSS("width", "13px");
  await expect(completed).toHaveCSS("height", "13px");
  await panel.getByText("Completed", { exact: true }).click();
  await expect(completed).toBeChecked();
  const favorites = panel.getByRole("checkbox", { name: "Favorites", exact: true });
  await favorites.focus();
  await page.keyboard.press("Space");
  await expect(favorites).toBeChecked();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Clear all" }).click();
  await expect(completed).not.toBeChecked();
  await expect(favorites).not.toBeChecked();
  await expect(page.getByLabel("Filter library").getByText("2", { exact: true })).toHaveCount(0);
});

for (const theme of ["", "&light", "&themeStress=distinct"]) {
  test(`filter count uses an outlined neutral badge and updates ${theme || "dark"}`, async ({
    page,
  }) => {
    await page.goto(`${fixture}${theme}`);
    const trigger = page.getByLabel("Filter library");
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Library filters" });
    await panel.getByRole("checkbox", { name: "Unread", exact: true }).check();
    await panel.getByRole("checkbox", { name: "Completed", exact: true }).check();
    const count = trigger.locator('[data-slot="badge"]');
    await expect(count).toHaveText("2");
    await expect(count).toBeVisible();
    const colors = await count.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--muted)";
      probe.style.borderTopColor = "var(--muted-soft)";
      probe.style.backgroundColor = "var(--canvas-deep)";
      element.append(probe);
      const expected = getComputedStyle(probe);
      const actual = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const textBounds = element.firstElementChild!.getBoundingClientRect();
      const result = {
        foreground: actual.color,
        border: actual.borderTopColor,
        borderWidth: actual.borderTopWidth,
        background: actual.backgroundColor,
        expectedForeground: expected.color,
        expectedBorder: expected.borderTopColor,
        expectedBackground: expected.backgroundColor,
        width: bounds.width,
        height: bounds.height,
        horizontalOffset: (textBounds.left + textBounds.right - bounds.left - bounds.right) / 2,
        verticalOffset: (textBounds.top + textBounds.bottom - bounds.top - bounds.bottom) / 2,
      };
      probe.remove();
      return result;
    });
    expect(colors.foreground).toBe(colors.expectedForeground);
    expect(colors.background).toBe(colors.expectedBackground);
    expect(colors.border).toBe(colors.expectedBorder);
    expect(colors.borderWidth).toBe("1px");
    expect(colors.width).toBeCloseTo(18, 0);
    expect(colors.height).toBeCloseTo(18, 0);
    expect(Math.abs(colors.horizontalOffset)).toBeLessThanOrEqual(1);
    expect(Math.abs(colors.verticalOffset)).toBeLessThanOrEqual(1);
    await panel.getByRole("button", { name: "Clear all" }).click();
    await expect(count).toHaveCount(0);
  });
}
