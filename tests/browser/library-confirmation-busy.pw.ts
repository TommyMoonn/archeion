import { expect, test } from "@playwright/test";

for (const [opener, label, message] of [
  ["Delete selected books", "Delete selected books", "Deleting selected books…"],
  ["Clear reading progress", "Clear progress", "Clearing reading progress…"],
  ["Delete folder", "Delete folder", "Deleting folder…"],
]) {
  for (const [width, scale] of [
    [1100, 1],
    [480, 2],
  ]) {
    for (const failed of [false, true]) {
      test(`${label}, ${width}px, text ${scale}, ${failed ? "rejected" : "resolved"}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 480 ? 520 : 900 });
        await page.goto("/tests/browser/fixtures/index.html?view=library-confirmations&controlled");
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${16 * scale}px`;
        }, scale);
        await page.getByRole("button", { name: opener, exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        const dialog = page.getByRole("dialog");
        const action = dialog.getByRole("button", { name: label, exact: true });
        const geometry = () =>
          dialog.evaluate((element) => {
            const rect = (target: Element) => {
              const { x, y, width, height } = target.getBoundingClientRect();
              return { x, y, width, height };
            };
            return {
              outer: rect(element),
              footer: rect(element.querySelector(".dialog__footer")!),
              actions: [...element.querySelectorAll(".dialog__footer button")].map(rect),
            };
          });
        const idle = await geometry();
        await action.focus();
        await page.keyboard.press("Enter");
        await expect(action).toBeDisabled();
        await expect(action).toHaveAccessibleName(label);
        await expect(action).toHaveAttribute("aria-busy", "true");
        await expect(action.locator(".button__busy")).toBeVisible();
        await expect(dialog.getByRole("status")).toHaveCount(1);
        await expect(dialog.getByRole("status")).toHaveText(message);
        expect(await geometry()).toEqual(idle);
        await action.evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
        await dialog
          .getByRole("button", { name: "Cancel" })
          .evaluate((button: HTMLButtonElement) => button.click());
        await page.keyboard.press("Escape");
        await page.mouse.click(1, 1);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Space");
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId("mutation-count")).toHaveText("1");
        await page.evaluate((failed) => window.confirmationWork!.settle(failed), failed);
        await expect(page.getByTestId("operation-outcome")).toHaveText(
          failed ? "rejected" : "resolved",
        );
        await expect(action).toBeEnabled();
        await expect(action).toHaveAccessibleName(label);
        await expect(dialog.getByRole("status")).toBeEmpty();
        expect(await geometry()).toEqual(idle);
        for (const bounds of [idle.outer, idle.footer, ...idle.actions]) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 480 ? 520 : 900);
        }
        await action.focus();
        await page.keyboard.press("Space");
        await expect(page.getByTestId("mutation-count")).toHaveText("2");
        await page.evaluate(() => window.confirmationWork!.settle());
        await expect(action).toBeEnabled();
      });
    }
  }
}
