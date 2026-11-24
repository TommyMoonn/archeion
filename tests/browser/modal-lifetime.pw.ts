import { expect, test } from "@playwright/test";

test.use({ video: "retain-on-failure" });

for (const surface of ["dialog", "drawer", "palette"]) {
  test(`${surface}: retained native containment, guarded actions, Escape, and deadline`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/fixtures/modal-lifetime.html?surface=${surface}`);
    await page.getByRole("button", { name: "Open surface" }).click();
    await page
      .locator("dialog")
      .evaluate((dialog) => dialog.getAnimations().forEach((a) => a.finish()));
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open surface" })).toBeFocused();
    expect(await page.evaluate(() => window.modalLifetime.dismissals)).toBe(1);
  });

  test(`${surface}: close/reopen/replacement and absent events cannot settle a newer modal`, async ({
    page,
  }, info) => {
    await page.goto(`/tests/browser/fixtures/modal-lifetime.html?surface=${surface}`);
    // Extend tokens only to inspect the intermediate state, without changing production timing.
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--motion-duration-emphasized", "1500ms"),
    );
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--motion-duration-fast", "1500ms"),
    );
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--motion-duration-view", "1500ms"),
    );
    await page.getByRole("button", { name: "Open surface" }).click();
    await page
      .locator("dialog")
      .evaluate((dialog) => dialog.getAnimations().forEach((a) => a.finish()));
    await page.keyboard.press("Escape");
    const closing = page.locator('dialog[data-surface-state="closing"]');
    await expect(closing).toHaveCount(1);
    await page.screenshot({ path: info.outputPath("closing.png") });
    expect(await closing.evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
    expect(
      await closing.evaluate((dialog) => (dialog.firstElementChild as HTMLElement).inert),
    ).toBe(true);
    await closing.evaluate((dialog) => dialog.querySelector<HTMLButtonElement>("button")?.click());
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(0);
    expect(await page.evaluate(() => window.modalLifetime.dismissals)).toBe(1);
    await page.evaluate(() => window.modalLifetime.show());
    await expect(page.locator('dialog[data-surface-state="open"]')).toHaveCount(1);
    await page.evaluate(() => window.modalLifetime.close());
    await page.evaluate(() => window.modalLifetime.show("replacement"));
    await expect(page.locator("dialog")).toHaveCount(1);
    expect(await page.locator("dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
    await page.evaluate(() => window.modalLifetime.teardown());
    await expect(page.locator("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Background action" }).click();
    expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(1);
  });

  test(`${surface}: entry interruption and exit reversal preserve the displayed pose`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/fixtures/modal-lifetime.html?surface=${surface}`);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--motion-duration-emphasized", "1500ms");
      document.documentElement.style.setProperty("--motion-duration-fast", "1500ms");
      document.documentElement.style.setProperty("--motion-duration-view", "1500ms");
      window.modalLifetime.show();
    });
    const samples = await page.locator("dialog").evaluate(async (element) => {
      const dialog = element as HTMLDialogElement;
      const animation = (phase: "enter" | "exit") => {
        const match = dialog
          .getAnimations()
          .find(
            (candidate) =>
              candidate instanceof CSSAnimation && candidate.animationName.endsWith(`-${phase}`),
          );
        if (!match) throw new Error(`Missing ${phase} animation`);
        return match;
      };
      const pose = () => {
        const style = getComputedStyle(dialog);
        const transform = new DOMMatrixReadOnly(
          style.transform === "none" ? undefined : style.transform,
        );
        return {
          opacity: Number(style.opacity),
          scale: transform.a,
          x: transform.e,
          y: transform.f,
        };
      };
      const sampleAt = async (phase: "enter" | "exit") => {
        const current = animation(phase);
        // Seek the running CSS animation without retaining a script-paused animation after its rule changes.
        await current.ready;
        current.currentTime = 400;
        return pose();
      };
      const entering = await sampleAt("enter");
      window.modalLifetime.close();
      animation("exit").currentTime = 0;
      const exitStart = pose();
      const closing = await sampleAt("exit");
      window.modalLifetime.show();
      animation("enter").currentTime = 0;
      const reopen = pose();
      return { entering, exitStart, closing, reopen };
    });
    for (const [before, after] of [
      [samples.entering, samples.exitStart],
      [samples.closing, samples.reopen],
    ]) {
      expect(Math.abs(before.opacity - after.opacity)).toBeLessThan(0.02);
      expect(Math.abs(before.scale - after.scale)).toBeLessThan(0.02);
      expect(Math.abs(before.x - after.x)).toBeLessThan(1);
      expect(Math.abs(before.y - after.y)).toBeLessThan(1);
    }
    await page.evaluate(() => {
      window.modalLifetime.close();
      document.documentElement.dataset.motion = "off";
    });
    await expect(page.locator("dialog")).toHaveCount(0);
  });

  test(`${surface}: outside pointer sequences dismiss once without leaking to background`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/fixtures/modal-lifetime.html?surface=${surface}`);
    await page.getByRole("button", { name: "Open surface" }).click();
    const panel = await page.locator("dialog").evaluate((dialog) => {
      dialog.getAnimations().forEach((animation) => animation.finish());
      const { x, y } = dialog.firstElementChild!.getBoundingClientRect();
      return { x: x + 10, y: y + 10 };
    });
    await page.mouse.move(panel.x, panel.y);
    await page.mouse.down();
    await page.mouse.move(5, 700);
    await page.mouse.up();
    await expect(page.locator("dialog")).toHaveCount(1);
    await page.mouse.click(5, 700);
    await expect(page.locator("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.modalLifetime.dismissals)).toBe(1);
    expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(0);
  });

  for (const motion of ["off", "reduced"]) {
    test(`${surface}: ${motion} closes without an animation delay`, async ({ page }) => {
      if (motion === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/fixtures/modal-lifetime.html?surface=${surface}&motion=${motion === "off" ? "off" : "on"}`,
      );
      await page.getByRole("button", { name: "Open surface" }).click();
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog")).toHaveCount(0);
    });
  }
}

test("palette baseline dismisses immediately; presence supplies a bounded exit without delaying command execution", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/modal-lifetime.html?surface=palette&baseline=1");
  await page.getByRole("button", { name: "Open surface" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.goto("/tests/browser/fixtures/modal-lifetime.html?surface=palette");
  await page.getByRole("button", { name: "Open surface" }).click();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(1);
  await expect(page.locator("dialog")).toHaveCount(0);
});
