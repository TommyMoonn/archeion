import { expect, test, type Locator } from "@playwright/test";

async function toggleRepeatedly(control: Locator, state: "aria-pressed" | "aria-checked") {
  await expect(control).toHaveAttribute(state, "false");
  await control.focus();
  for (const active of [true, false, true, false]) {
    await control.press("Space");
    await expect(control).toHaveAttribute(state, String(active));
    await expect(control).toBeFocused();
  }
}

test("bookmark keeps its name and focus through repeated keyboard toggles", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=reader-toggles");
  await toggleRepeatedly(
    page.getByRole("button", { name: "Bookmark", exact: true }),
    "aria-pressed",
  );
});

test("Reader collection controls form a named group with queryable selected state", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=reader-toggles");
  await page.getByRole("button", { name: "Book navigation", exact: true }).click();
  const group = page.getByRole("group", { name: "Book navigation collections" });
  await expect(group.getByRole("button")).toHaveCount(2);
  await expect(group.getByRole("button", { name: "Contents", pressed: true })).toBeVisible();
  await group.getByRole("button", { name: "Pages" }).press("Enter");
  await expect(group.getByRole("button", { name: "Pages", pressed: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Contents", pressed: false })).toBeVisible();
});

test("selection mode can be entered and finished with the keyboard", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=library-toggles");
  const filters = page.getByRole("group", { name: "Active filters", exact: true });
  await expect(
    filters.getByRole("button", { name: "Remove Series: Fixture series filter", exact: true }),
  ).toBeVisible();
  for (const key of ["Enter", "Space"]) {
    const toggle = page.getByRole("button", { name: "Select books", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.focus();
    await toggle.press(key);
    const selection = page.getByRole("group", { name: "Book selection actions", exact: true });
    await expect(selection).toBeVisible();
    await expect(toggle).toHaveCount(0);
    await selection.getByRole("button", { name: "Done", exact: true }).press(key);
    await expect(selection).toHaveCount(0);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
});

for (const view of ["Grid", "List"]) {
  test(`${view} favorites and selection keep stable names and synchronize state`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/?view=library-toggles");
    const region = page.getByRole("region", { name: `${view} fixture` });
    await toggleRepeatedly(
      region.getByRole("button", { name: "Favorite Fixture", exact: true }),
      "aria-pressed",
    );
    const other = page.getByRole("region", {
      name: `${view === "Grid" ? "List" : "Grid"} fixture`,
    });
    await expect(
      other.getByRole("button", { name: "Favorite Fixture", pressed: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Select books", exact: true }).click();
    await toggleRepeatedly(
      region.getByRole("button", { name: "Select Fixture", exact: true }),
      "aria-pressed",
    );
    await expect(
      other.getByRole("button", { name: "Select Fixture", pressed: false }),
    ).toBeVisible();
  });
}

test("book details favorite retains its name inside the native dialog", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=details-toggle");
  await page.getByRole("button", { name: "Open book details" }).click();
  await toggleRepeatedly(
    page.getByRole("dialog").getByRole("button", { name: "Favorite Fixture", exact: true }),
    "aria-pressed",
  );
});

test("dictionary switch retains its name and checked state through keyboard activation", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=dictionary-toggle");
  await toggleRepeatedly(
    page.getByRole("switch", { name: "Enable English Core", exact: true }),
    "aria-checked",
  );
});

test("shared switch preserves visible geometry, expanded hit area and explained disabled behavior", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/preference-controls.html");
  const standard = page.getByRole("switch", { name: "Watch archive" });
  const compact = page.getByRole("switch", { name: "Compact switch" });
  for (const [control, width, height] of [
    [standard, 38, 22],
    [compact, 34, 20],
  ] as const) {
    await expect(control).toHaveCSS("width", `${width}px`);
    await expect(control).toHaveCSS("height", `${height}px`);
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error("Switch bounds missing");
    await page.mouse.click(bounds.x + width / 2, bounds.y - 1);
    await expect(control).toHaveAttribute("aria-checked", "true");
    const thumb = control.locator('[data-slot="switch-thumb"]');
    await expect
      .poll(async () => {
        const checkedThumb = await thumb.boundingBox();
        return checkedThumb
          ? Math.abs(checkedThumb.x + checkedThumb.width - (bounds.x + bounds.width - 3))
          : Infinity;
      })
      .toBeLessThan(1);
    await control.press("Space");
    await expect(control).toHaveAttribute("aria-checked", "false");
  }
  const explained = page.getByRole("switch", { name: "Automatic scan" });
  await expect(explained).toHaveAccessibleDescription("Archive is offline");
  await compact.focus();
  await page.keyboard.press("Tab");
  await expect(explained).toBeFocused();
  await expect(explained).toHaveAttribute("aria-disabled", "true");
  await expect(explained).toHaveCSS("cursor", "not-allowed");
  await explained.press("Space");
  await expect(explained).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Unexpected changes")).toHaveText("0");
  await expect(page.getByRole("switch", { name: "Unavailable" })).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Grid" })).toBeFocused();
});

test("segmented radio group keeps one selection and skips disabled options with keyboard and pointer", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/preference-controls.html");
  const group = page.getByRole("radiogroup", { name: "Collection view" });
  const grid = group.getByRole("radio", { name: "Grid" });
  const list = group.getByRole("radio", { name: "List" });
  await expect(group.getByRole("radio", { name: "Cards" })).toBeDisabled();
  await grid.focus();
  for (const [key, selected] of [
    ["ArrowRight", list],
    ["ArrowDown", grid],
    ["ArrowLeft", list],
    ["ArrowUp", grid],
    ["End", list],
    ["Home", grid],
  ] as const) {
    await page.keyboard.press(key);
    await expect(selected).toBeFocused();
    await expect(selected).toBeChecked();
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  }
  await list.click();
  await expect(list).toBeChecked();
  await list.press("Space");
  await expect(list).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("slider", { name: "Font size" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(list).toBeFocused();
  await expect(list).toHaveCSS("outline-width", "2px");
  await expect(list).toHaveAccessibleDescription("List");
});

test.describe("coarse pointer preference controls", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("the compact switch can be activated just outside its visible track", async ({ page }) => {
    await page.goto("/tests/browser/fixtures/preference-controls.html");
    const compact = page.getByRole("switch", { name: "Compact switch" });
    const bounds = await compact.boundingBox();
    if (!bounds) throw new Error("Switch bounds missing");
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y - 4);
    await expect(compact).toBeChecked();
  });
});

test("forced colors distinguish selected preference controls without hiding the switch thumb", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/tests/browser/fixtures/preference-controls.html");
  const control = page.getByRole("switch", { name: "Watch archive" });
  const thumb = control.locator('[data-slot="switch-thumb"]');
  const trackColor = await control.evaluate((node) => getComputedStyle(node).backgroundColor);
  const offThumb = await thumb.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(offThumb).not.toBe(trackColor);
  await control.click();
  await expect(control).toBeChecked();
  const onTrack = await control.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(onTrack).not.toBe(trackColor);
  expect(await thumb.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(onTrack);
  const group = page.getByRole("radiogroup", { name: "Collection view" });
  const grid = group.getByRole("radio", { name: "Grid" });
  const list = group.getByRole("radio", { name: "List" });
  const selected = await grid.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(selected).not.toBe(await list.evaluate((node) => getComputedStyle(node).backgroundColor));
  await list.click();
  await expect(list).toBeChecked();
  await expect(list).toHaveCSS("background-color", selected);
});
