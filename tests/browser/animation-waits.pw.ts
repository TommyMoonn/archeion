import { expect, test } from "@playwright/test";
import { installAnimationWaits } from "./animation-waits";

test("animation waits fail locally with target and play-state diagnostics", async ({ page }) => {
  await page.setContent('<div class="wait-target">content</div>');
  await page.evaluate(installAnimationWaits);
  const acquisition = await page.evaluate(async () => {
    try {
      await window.animationWaits.acquire(document.querySelector("div")!, 50);
    } catch (error) {
      return String(error);
    }
    throw new Error("Missing animation was accepted");
  });
  expect(acquisition).toContain("Animation acquisition timed out");
  expect(acquisition).toContain("wait-target");
  const completion = await page.evaluate(async () => {
    const node = document.querySelector("div")!;
    const animation = node.animate({ opacity: [0, 1] }, 100);
    animation.pause();
    try {
      await window.animationWaits.finish([node], 50);
    } catch (error) {
      return String(error);
    } finally {
      animation.cancel();
    }
    throw new Error("Paused animation was accepted");
  });
  expect(completion).toContain("Animation completion timed out");
  expect(completion).toContain('"state":"paused"');
  expect(completion).toContain("opacity");
});
