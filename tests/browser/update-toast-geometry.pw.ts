import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const placement of ["top", "side"] as const) {
  test(`${placement} reading progress remains unobstructed after an update notice`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/fixtures/ui-stability.html?count=50&progress=${placement}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".book-grid")).toBeVisible();
    await page.evaluate(() =>
      window.uiStabilityFixture.setUpdate({
        status: "available",
        available: { version: "1.8.0", notes: null, publishedAt: null },
      }),
    );
    await expect(page.locator(".update-toast")).toBeVisible();
    await page.locator(".book-card__select").first().click();
    await page.getByRole("button", { name: "Read book", exact: true }).click();
    const progress = page.getByRole("slider", { name: "Reading progress" });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("data-placement", placement);
    await expect(page.locator(".update-toast")).toHaveCount(0);
    await progress.focus();
    await expect(progress).toBeFocused();
  });
}

for (const view of ["grid", "list"] as const) {
  for (const position of ["top", "middle", "bottom"] as const) {
    test(`${view} ${position}: updater does not rewrite collection extent during entrance or dismissal`, async ({
      page,
    }, info) => {
      await page.goto("/tests/browser/fixtures/ui-stability.html?count=500", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("[data-window-total]")).toBeVisible();
      await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
      const main = page.locator(".page-shell");
      await main.evaluate((element, position) => {
        element.scrollTop =
          position === "top"
            ? 0
            : position === "middle"
              ? element.scrollHeight / 2
              : element.scrollHeight;
        element.focus({ preventScroll: true });
      }, position);
      await page.locator(".library-content--books").evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      const before = await main.evaluate((element) => {
        const item = [...element.querySelectorAll<HTMLElement>("[data-reader-book-id]")].find(
          (item) => item.getBoundingClientRect().bottom > element.getBoundingClientRect().top,
        );
        return {
          padding: getComputedStyle(element).paddingBottom,
          top: element.scrollTop,
          id: item?.dataset.readerBookId,
          y: item?.getBoundingClientRect().y,
        };
      });
      await page.evaluate(() =>
        window.uiStabilityFixture.setUpdate({
          status: "available",
          available: { version: "1.8.0", notes: null, publishedAt: null },
        }),
      );
      const samples = await main.evaluate(async (element) => {
        const samples = [];
        for (let i = 0; i < 24; i++) {
          await new Promise(requestAnimationFrame);
          const item = [...element.querySelectorAll<HTMLElement>("[data-reader-book-id]")].find(
            (item) => item.getBoundingClientRect().bottom > element.getBoundingClientRect().top,
          );
          samples.push({
            top: element.scrollTop,
            height: element.clientHeight,
            padding: getComputedStyle(element).paddingBottom,
            id: item?.dataset.readerBookId,
            y: item?.getBoundingClientRect().y,
          });
        }
        return samples;
      });
      await info.attach("entrance-geometry", {
        body: JSON.stringify({ before, samples }),
        contentType: "application/json",
      });
      expect(new Set(samples.map((sample) => sample.padding))).toEqual(new Set([before.padding]));
      expect(new Set(samples.map((sample) => sample.height)).size).toBe(1);
      expect(samples.every((sample) => sample.id && sample.y !== undefined)).toBe(true);
      expect(new Set(samples.map((sample) => sample.id)).size).toBe(1);
      // Reserving the row can make one discrete end-of-collection adjustment.
      // Interior anchors must also match the pre-notice frame.
      if (position !== "bottom") {
        expect(samples[0]!.id).toBe(before.id);
        expect(Math.abs(samples[0]!.top - before.top)).toBeLessThan(1);
        expect(Math.abs(samples[0]!.y! - before.y!)).toBeLessThan(1);
      }
      expect(
        Math.max(...samples.map((sample) => sample.y!)) -
          Math.min(...samples.map((sample) => sample.y!)),
      ).toBeLessThan(1);
      expect(
        Math.max(...samples.map((sample) => sample.top)) -
          Math.min(...samples.map((sample) => sample.top)),
      ).toBeLessThan(1);
      expect(await main.evaluate((element) => document.activeElement === element)).toBe(true);
      await page.getByRole("button", { name: "Later", exact: true }).click();
      const after = await main.evaluate(async (element) => {
        const samples = [];
        for (let i = 0; i < 16; i++) {
          await new Promise(requestAnimationFrame);
          samples.push(element.scrollTop);
        }
        return samples;
      });
      // A single clamp to the new maximum is valid at the end of a collection.
      expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1);
    });
  }
}

for (const input of ["wheel", "keyboard"] as const) {
  for (const position of ["top", "middle", "bottom"] as const) {
    test(`${input} ${position}: updater leaves input-owned scrolling uninterrupted`, async ({
      page,
    }, info) => {
      await page.goto("/tests/browser/fixtures/ui-stability.html?count=500&view=list", {
        waitUntil: "domcontentloaded",
      });
      const collection = page.locator(".book-list");
      await expect(collection).toBeVisible();
      const main = page.locator(".page-shell");
      await main.evaluate(async (element, position) => {
        element.scrollTop =
          position === "top"
            ? 0
            : position === "middle"
              ? element.scrollHeight / 2
              : element.scrollHeight;
        element.focus({ preventScroll: true });
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, position);
      await page.evaluate(() =>
        window.uiStabilityFixture.setUpdate({
          status: "available",
          available: { version: "1.8.0", notes: null, publishedAt: null },
        }),
      );
      const recording = main.evaluate(async (element) => {
        const item = [...element.querySelectorAll<HTMLElement>("[data-reader-book-id]")].find(
          (item) => item.getBoundingClientRect().top >= element.getBoundingClientRect().top,
        )!;
        const samples = [];
        for (let i = 0; i < 30; i++) {
          await new Promise(requestAnimationFrame);
          samples.push({
            top: element.scrollTop,
            contentY: item.getBoundingClientRect().y + element.scrollTop,
            connected: item.isConnected,
          });
        }
        return samples;
      });
      if (input === "wheel") {
        const box = await main.boundingBox();
        await page.mouse.move(box!.x + 30, box!.y + 100);
        await page.mouse.wheel(0, position === "bottom" ? -80 : 80);
      } else {
        await page.keyboard.press(position === "bottom" ? "ArrowUp" : "ArrowDown");
      }
      const samples = await recording;
      await info.attach("input-geometry", {
        body: JSON.stringify(samples),
        contentType: "application/json",
      });
      expect(samples.every((sample) => sample.connected)).toBe(true);
      expect(Math.abs(samples.at(-1)!.top - samples[0]!.top)).toBeGreaterThan(0);
      expect(
        Math.max(...samples.map((sample) => sample.contentY)) -
          Math.min(...samples.map((sample) => sample.contentY)),
      ).toBeLessThan(1);
      expect(await main.evaluate((element) => document.activeElement === element)).toBe(true);
    });
  }
}

for (const motion of ["app-off", "system-off"] as const) {
  test(`${motion}: narrow long notice has one layout change and reachable actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    if (motion === "system-off") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/fixtures/index.html?view=library-updates${motion === "app-off" ? "&motion=off" : ""}`,
    );
    if (motion === "app-off")
      await page.evaluate(() => {
        document.documentElement.dataset.motion = "off";
      });
    await page.evaluate(() =>
      window.updateToastFixture!.set({
        status: "available",
        available: { version: "123456789.123456789.123456789", notes: null, publishedAt: null },
      }),
    );
    const toast = page.locator(".update-toast");
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((element) => element.getAnimations().length)).toBe(0);
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByRole("button", { name: "Last Library action" }).click();
    await page.getByRole("button", { name: "Later", exact: true }).click();
    await expect(toast).toHaveCount(0);
  });
}
