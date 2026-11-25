import { expect, test, type Locator, type Page } from "@playwright/test";

async function bounds(menu: Locator) {
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  if (!box) throw new Error("Menu is not visible");
  return box;
}

async function contained(page: Page, menu: Locator) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Missing viewport");
  await expect
    .poll(async () => {
      const { x, y, width, height } = await bounds(menu);
      return (
        x >= 7 && y >= 7 && x + width <= viewport.width - 7 && y + height <= viewport.height - 7
      );
    })
    .toBe(true);
}

for (const theme of ["", "&light", "&themeStress=distinct"]) {
  test(`book actions preserve natural width and theme (${theme || "dark"})`, async ({ page }) => {
    await page.setViewportSize({ width: 248, height: 353 });
    await page.goto(`/tests/browser/fixtures/?view=action-menu&book${theme}`);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-ui", "monospace");
      document.documentElement.style.fontSize = "16px";
    });
    const trigger = page.getByRole("button", { name: "Actions for Book" });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Actions for Book" });
    await contained(page, menu);
    const metrics = await menu.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--surface-raised)";
      element.append(probe);
      const background = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const style = getComputedStyle(element);
      return {
        width: element.getBoundingClientRect().width,
        background: style.backgroundColor,
        expectedBackground: background,
        padding: style.paddingTop,
        labels: Array.from(element.querySelectorAll<HTMLElement>(".menu-item__label")).map(
          (label) => ({
            width: label.clientWidth,
            scrollWidth: label.scrollWidth,
            whiteSpace: getComputedStyle(label).whiteSpace,
          }),
        ),
      };
    });
    expect(metrics.width).toBeGreaterThan(168);
    expect(metrics.background).toBe(metrics.expectedBackground);
    expect(metrics.padding).toBe("5px");
    expect(
      metrics.labels.every(
        (label) => label.whiteSpace === "nowrap" && label.scrollWidth <= label.width + 1,
      ),
    ).toBe(true);
    const menuBox = await bounds(menu);
    const triggerBox = await bounds(trigger);
    expect(Math.abs(triggerBox.y - (menuBox.y + menuBox.height) - 4)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("point and anchored menus preserve invocation, keyboard, disabled reasons and modal handoff", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto("/tests/browser/fixtures/?view=action-menu");
  const resource = page.getByRole("button", { name: "Resource" });
  const trigger = page.getByRole("button", { name: "Actions", exact: true });
  const menu = page.getByRole("menu", { name: "Resource actions" });
  const point = await bounds(resource);
  await page.mouse.click(point.x + 5, point.y + 5, { button: "right" });
  await contained(page, menu);
  const rect = await bounds(menu);
  expect(Math.abs(rect.x - point.x - 5)).toBeLessThanOrEqual(1);
  expect(Math.abs(rect.y - point.y - 5)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Outside" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Outside" })).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const read = menu.getByRole("menuitem", { name: "Read" });
  await expect(read).toBeFocused();
  await expect(read).toHaveAccessibleDescription("File missing");
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Edit metadata" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Edit metadata" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Edit metadata" });
  const dialogTrigger = dialog.getByRole("button", { name: "Dialog actions" });
  await dialogTrigger.click();
  const dialogMenu = dialog.getByRole("menu", { name: "Dialog actions" });
  await contained(page, dialogMenu);
  await page.keyboard.press("Escape");
  await expect(dialogMenu).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialogTrigger).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delete EPUB" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("short viewport keeps all actions scrollable and inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 150 });
  await page.goto("/tests/browser/fixtures/?view=action-menu&book");
  const trigger = page.getByRole("button", { name: "Actions for Book" });
  await trigger.click();
  const menu = page.getByRole("menu");
  await contained(page, menu);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete EPUB" })).toBeFocused();
  await expect(menu).toBeVisible();
});

test("right-edge point menu repositions as actions change", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 280 });
  await page.goto("/tests/browser/fixtures/?view=action-menu&edge");
  const resource = page.getByRole("button", { name: "Resource" });
  const box = await bounds(resource);
  await page.mouse.click(box.x + box.width - 5, box.y + 5, { button: "right" });
  const menu = page.getByRole("menu", { name: "Resource actions" });
  await contained(page, menu);
  const before = await bounds(menu);
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-add-menu-action")));
  await expect(menu.getByRole("menuitem", { name: "Additional file action" })).toBeVisible();
  await contained(page, menu);
  await expect.poll(async () => (await bounds(menu)).height).toBeGreaterThan(before.height);
  await page.keyboard.press("Escape");
  await expect(resource).toBeFocused();
});

test("bulk action menu paints above overlapping book selection indicators", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/tests/browser/fixtures/?view=library-toggles");
  await page.getByRole("button", { name: "Select books", exact: true }).click();
  const trigger = page.getByRole("button", { name: "More bulk actions", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "More bulk actions" });
  await expect(menu).toBeVisible();
  const indicator = page
    .getByRole("region", { name: "Grid fixture" })
    .locator(".book-selection-control");
  await expect(indicator).toBeVisible();
  const layers = await indicator.evaluate((element) => {
    const popup = document.querySelector('.library-selection-actions-menu[role="menu"]');
    if (!(element instanceof HTMLElement) || !popup) throw new Error("Missing selection overlay");
    const a = element.getBoundingClientRect();
    const b = popup.getBoundingClientRect();
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top)
      throw new Error("Fixture must exercise overlapping surfaces");
    // The visual indicator normally ignores hit testing. Include it temporarily to inspect paint order.
    const previous = element.style.pointerEvents;
    element.style.pointerEvents = "auto";
    try {
      const stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        menu: stack.findIndex((node) => popup.contains(node)),
        indicator: stack.indexOf(element),
      };
    } finally {
      element.style.pointerEvents = previous;
    }
  });
  expect(layers.menu).toBeGreaterThanOrEqual(0);
  expect(layers.indicator).toBeGreaterThan(layers.menu);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
