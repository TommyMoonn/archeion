import { expect, test } from "@playwright/test";

for (const key of ["Enter", "Space"]) {
  test(`Reader note confirmation cancels safely on repeated ${key}`, async ({ page }) => {
    await page.goto("/tests/browser/fixtures/?view=note-confirmation");
    const opener = page.getByRole("button", { name: "Delete note", exact: true });
    await opener.focus();
    await opener.press(key);

    const confirmation = page.getByRole("group", { name: "Delete note confirmation" });
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press(key);

    await expect(confirmation).toHaveCount(0);
    await expect(page.getByTestId("mutation-count")).toHaveText("0");
    await expect(opener).toBeFocused();
  });

  test(`Clear progress confirmation cancels safely on repeated ${key}`, async ({ page }) => {
    await page.goto("/tests/browser/fixtures/?view=library-confirmations");
    const opener = page.getByRole("button", { name: "Clear reading progress", exact: true });
    await opener.focus();
    await opener.press(key);

    const confirmation = page.getByRole("dialog", { name: "Clear reading progress?" });
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press(key);

    await expect(confirmation).toHaveCount(0);
    await expect(page.getByTestId("mutation-count")).toHaveText("0");
    await expect(
      page.getByRole("button", { name: "Clear reading progress", exact: true }),
    ).toBeFocused();
  });
}

test("Reader note deletion remains available through deliberate keyboard focus", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=note-confirmation");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "Delete note confirmation" });
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmation.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mutation-count")).toHaveText("1");
});

test("Clearing progress remains available through deliberate keyboard focus", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=library-confirmations");
  await page.getByRole("button", { name: "Clear reading progress", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Clear reading progress?" });
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    confirmation.getByRole("button", { name: "Clear progress", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mutation-count")).toHaveText("1");
});

for (const [openerName, title] of [
  ["Delete book", "Delete EPUB file?"],
  ["Delete selected books", "Delete 1 selected books?"],
  ["Delete folder", "Delete “Fixture folder” folder?"],
]) {
  test(`${openerName} preserves its existing safe initial focus`, async ({ page }) => {
    await page.goto("/tests/browser/fixtures/?view=library-confirmations");
    const opener = page.getByRole("button", { name: openerName, exact: true });
    await opener.focus();
    await opener.press("Enter");
    const confirmation = page.getByRole("dialog", { name: title, exact: true });
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByTestId("mutation-count")).toHaveText("0");
    await expect(opener).toBeFocused();
  });
}
