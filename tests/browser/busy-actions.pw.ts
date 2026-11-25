import { expect, test } from "@playwright/test";

for (const mode of ["on", "off", "reduced"] as const) {
  for (const light of [false, true]) {
    test(`busy footprints and input stay stable: ${mode}, light=${light}`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
      await page.goto(
        `/tests/browser/fixtures/index.html?view=busy-actions${light ? "&light" : ""}`,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate((mode) => {
        document.documentElement.dataset.motion = mode === "off" ? "off" : "on";
      }, mode);
      const buttons = page.locator(".button");
      const snapshot = () =>
        buttons.evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height, label: element.textContent };
          }),
        );
      for (const [size, height] of [
        ["compact", "32px"],
        ["standard", "36px"],
        ["prominent", "40px"],
      ] as const) {
        const action = buttons
          .filter({ hasText: "Move" })
          .and(page.locator(`.button--${size}`))
          .first();
        await expect(action).toHaveCSS("min-height", height);
        await expect(action).toHaveCSS("font-size", size === "compact" ? "13px" : "14px");
      }
      const before = await snapshot();
      await buttons.first().focus();
      expect(
        await buttons
          .first()
          .evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
      ).toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Start work" }).click();
      await expect(buttons.first()).toBeDisabled();
      await expect(buttons.first()).toHaveAttribute("aria-busy", "true");
      await expect(buttons.first().locator(".button__busy")).toBeVisible();
      expect(await snapshot()).toEqual(before);
      await buttons.first().evaluate((element: HTMLButtonElement) => element.click());
      await expect(page.locator('p[role="status"]')).toHaveText("Working…");
      await expect(page.getByLabel("Activations")).toHaveText("0");
      const animation = await buttons
        .first()
        .locator(".button__busy")
        .evaluate((element) => getComputedStyle(element).animationName);
      expect(animation).toBe(mode === "on" ? "button-busy-turn" : "none");
      await page.screenshot({ path: testInfo.outputPath("busy.png") });
      await page.getByRole("button", { name: "Fail", exact: true }).click();
      expect(await snapshot()).toEqual(before);
      await expect(buttons.first().locator(".button__busy")).toHaveCount(0);
      await buttons.first().focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expect(page.getByLabel("Activations")).toHaveText("2");
      await page.getByRole("button", { name: "Start work" }).click();
      await page.getByRole("button", { name: "Succeed", exact: true }).click();
      expect(await snapshot()).toEqual(before);
    });
  }
}

// The fake-timer Button unit test covers brief work without relying on browser scheduling.
test("shared controls preserve their geometry, native labels and singular focus outline", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/index.html?view=busy-actions");
  const form = page.getByRole("form", { name: "Shared control form" });
  const query = form.getByRole("textbox", { name: "Query", exact: true });
  const shell = query.locator("..");
  const invalid = form.getByRole("textbox", { name: "Invalid query" }).locator("..");
  const icon = form.getByRole("button", { name: "Search options" });

  await expect(shell).toHaveCSS("min-height", "36px");
  await expect(shell).toHaveCSS("border-top-width", "1px");
  await expect(invalid).toHaveCSS("min-height", "40px");
  await expect(invalid).toHaveCSS("outline-style", "dashed");
  await expect(invalid).toHaveCSS("outline-width", "2px");
  await expect(icon).toHaveCSS("width", "32px");
  await expect(icon).toHaveCSS("height", "32px");
  await expect(icon).toHaveAttribute("aria-disabled", "true");

  await query.click();
  await expect(shell).toHaveCSS("outline-style", "none");
  await query.fill("EPUB");
  await query.press("Enter");
  await expect(form.getByLabel("Submitted query")).toHaveText("EPUB");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(query).toBeFocused();
  await expect(shell).toHaveCSS("outline-style", "solid");
  await expect(shell).toHaveCSS("outline-width", "2px");
  await expect(query).toHaveCSS("outline-width", "0px");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(shell).toHaveCSS("outline-width", "2px");
  await expect(query).toHaveCSS("outline-width", "0px");
});
