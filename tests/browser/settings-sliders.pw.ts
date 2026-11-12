import { expect, test } from "@playwright/test";

for (const width of [1280, 760, 560]) {
  test(`reader slider values stay beside their controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      "/tests/browser/fixtures/application-font-settings.html" +
        (width === 760 ? "?light&compact" : ""),
    );
    await page.getByRole("button", { name: "Reader", exact: true }).click();

    for (const label of ["Font size", "Line height"]) {
      const slider = page.getByRole("slider", { name: label, exact: true });
      const row = page.getByRole("group", { name: label, exact: true });
      const value = row.locator(".settings-slider__value");
      await expect(slider).toBeVisible();
      await slider.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await expect(value).toHaveText(label === "Font size" ? "15px" : "1.5");
      await expect(slider).toHaveAttribute(
        "aria-valuetext",
        label === "Font size" ? "15px" : "1.5",
      );

      const geometry = await row.evaluate((element) => {
        const output = element.querySelector(".settings-slider__value");
        const input = element.querySelector('input[type="range"]');
        if (!output || !input) throw new Error("Slider control is incomplete.");
        const valueRect = output.getBoundingClientRect();
        const sliderRect = input.getBoundingClientRect();
        return {
          gap: sliderRect.left - valueRect.right,
          centerDifference: Math.abs(
            valueRect.top + valueRect.height / 2 - sliderRect.top - sliderRect.height / 2,
          ),
          right: sliderRect.right,
          rowRight: element.getBoundingClientRect().right,
        };
      });
      expect(geometry.gap).toBeGreaterThanOrEqual(12);
      expect(geometry.centerDifference).toBeLessThanOrEqual(1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.rowRight);
    }
  });
}
