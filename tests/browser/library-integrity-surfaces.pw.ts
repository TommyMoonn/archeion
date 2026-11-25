import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/integrity.html";

for (const width of [1440, 820, 560]) {
  test(`duplicate member geometry and actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`${fixture}?view=integrity-duplicates&error`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
    const group = page.getByRole("region", { name: "2 copies" }).first();
    const member = group.locator("article").first();
    await expect(member.getByRole("button", { name: "Open details for Alpha" })).toBeVisible();
    await expect(member.locator(".book-cover")).toHaveCSS("width", "46px");
    const menuTrigger = member.getByRole("button", { name: "File actions for Alpha" });
    await expect(menuTrigger).toHaveCSS("width", "32px");
    await expect(menuTrigger.locator("svg")).toHaveCSS("width", "18px");
    const fits = await member.evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return [
        ".duplicate-member__details",
        ".duplicate-member__metadata",
        ".duplicate-member__actions",
      ].every((selector) => {
        const child = row.querySelector(selector)!.getBoundingClientRect();
        return child.left >= bounds.left && child.right <= bounds.right + 1;
      });
    });
    expect(fits).toBe(true);
    await menuTrigger.scrollIntoViewIfNeeded();
    await menuTrigger.focus();
    await expect(menuTrigger).toBeInViewport();
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "File actions for Alpha" });
    await expect(menu.getByRole("menuitem", { name: "Move to folder" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
    await member.getByRole("button", { name: "Read" }).click();
    await expect(page.locator("output")).toHaveText("book-0");
  });
}

for (const theme of ["", "&light", "&themeStress=distinct"]) {
  test(`diagnostic disclosure is keyboard reachable and contains long paths ${theme || "dark"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 560, height: 600 });
    await page.goto(`${fixture}?view=integrity-issues${theme}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
    const book = page.locator("article").first();
    const trigger = book.getByRole("button", { name: "View 1 diagnostic issue" });
    const details = book.getByRole("region", { name: "Diagnostic details" });
    await expect(book.locator(".book-cover")).toHaveCSS("width", "56px");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(details).toBeHidden();
    await trigger.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(details).toBeVisible();
    const detail = details.locator("li");
    await expect(detail.locator(".epub-issue-detail__severity")).toHaveCSS(
      "grid-row-end",
      "span 2",
    );
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await expect(
      page.locator("article").nth(1).getByRole("button", { name: "View 1 diagnostic issue" }),
    ).toHaveAttribute("aria-expanded", "false");
    await trigger.press("Enter");
    await expect(details).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(
      page.locator("article").nth(1).getByRole("button", { name: "Read" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
}
