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

test("brief work settles before an indicator is revealed", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/fixtures/index.html?view=busy-actions");
  const samples = await page.evaluate(async () => {
    const start = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "Start work",
    )!;
    const finish = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "Succeed",
    )!;
    const samples: { elapsed: number; visible: boolean }[] = [];
    const began = performance.now();
    start.click();
    while (performance.now() - began < 120) {
      await new Promise(requestAnimationFrame);
      const indicator = document.querySelector(".button__busy");
      samples.push({
        elapsed: performance.now() - began,
        visible: !!indicator && getComputedStyle(indicator).visibility === "visible",
      });
      if (performance.now() - began >= 80) finish.click();
    }
    return samples;
  });
  expect(samples.every((sample) => !sample.visible)).toBe(true);
  await testInfo.attach("brief-work-samples", {
    body: JSON.stringify(samples),
    contentType: "application/json",
  });
});
